#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct WorkflowTarget {
    pub address: Address,
    pub data: String,
}

#[contracttype]
pub enum Key {
    Admin,
    Asset,
    Relayer,
    NextSteps,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
}

const VERSION: u32 = 1;

#[contract]
pub struct WebhookTrigger;

#[contractimpl]
impl WebhookTrigger {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        relayer: Address,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    /// Called by the authorized relayer to pull funds from `from` and start the chain.
    pub fn execute(env: Env, from: Address, amount: i128) {
        let relayer: Address = env.storage().instance().get(&Key::Relayer).unwrap();
        relayer.require_auth();
        from.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        token::Client::new(&env, &asset).transfer(&from, env.current_contract_address(), &amount);

        for step in next_steps.iter() {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &step.address,
                &amount,
            );
            invoke_receive_and_forward(
                &env,
                &step.address,
                &env.current_contract_address(),
                &asset,
                &amount,
            );
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("execute"), from), amount);
    }

    /// Called by the authorized relayer to distribute funds already held by this contract.
    /// Does not require auth from an external `from` address.
    /// Pass `amount = 0` to send the entire contract balance.
    pub fn execute_escrow(env: Env, amount: i128) {
        let relayer: Address = env.storage().instance().get(&Key::Relayer).unwrap();
        relayer.require_auth();

        if amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let contract = env.current_contract_address();
        let balance = token::Client::new(&env, &asset).balance(&contract);
        let send_amount = if amount == 0 { balance } else { amount };

        if send_amount == 0 || balance < send_amount {
            panic_with_error!(&env, Error::InsufficientBalance);
        }

        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        for step in next_steps.iter() {
            token::Client::new(&env, &asset).transfer(&contract, &step.address, &send_amount);
            invoke_receive_and_forward(&env, &step.address, &contract, &asset, &send_amount);
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("escrow"), contract), send_amount);
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::NextSteps).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
    }
}

fn invoke_receive_and_forward(
    env: &Env,
    target: &Address,
    from: &Address,
    asset: &Address,
    amount: &i128,
) {
    let func = soroban_sdk::Symbol::new(env, "receive_and_forward");
    let empty_steps = Vec::<WorkflowTarget>::new(env);
    env.invoke_contract::<()>(
        target,
        &func,
        vec![
            env,
            from.into_val(env),
            asset.into_val(env),
            amount.into_val(env),
            empty_steps.into_val(env),
        ],
    );
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn receive_and_forward(
            _env: Env,
            _from: Address,
            _asset: Address,
            _amount: i128,
            _next_steps: Vec<WorkflowTarget>,
        ) {
        }
    }

    #[test]
    fn relayer_executes_and_forwards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let relayer = Address::generate(&env);
        sac.mint(&relayer, &1_000);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            WebhookTrigger,
            (admin, asset.address(), relayer.clone(), next_steps),
        );
        let client = WebhookTriggerClient::new(&env, &contract_id);

        // The relayer calls execute and authorizes; funds are pulled from the relayer
        client.execute(&relayer, &500);

        assert_eq!(tok.balance(&relayer), 500);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&next), 500);
    }

    #[test]
    fn relayer_executes_escrow_with_zero_amount_sends_full_balance() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let relayer = Address::generate(&env);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            WebhookTrigger,
            (admin, asset.address(), relayer.clone(), next_steps),
        );
        let client = WebhookTriggerClient::new(&env, &contract_id);

        // Fund the contract directly
        sac.mint(&contract_id, &750);

        // Pass 0 to send the entire contract balance
        client.execute_escrow(&0);

        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&next), 750);
    }

    #[test]
    fn relayer_executes_escrow_with_explicit_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let relayer = Address::generate(&env);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            WebhookTrigger,
            (admin, asset.address(), relayer.clone(), next_steps),
        );
        let client = WebhookTriggerClient::new(&env, &contract_id);

        // Fund the contract
        sac.mint(&contract_id, &1_000);

        // Send only a portion
        client.execute_escrow(&400);

        assert_eq!(tok.balance(&contract_id), 600);
        assert_eq!(tok.balance(&next), 400);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn execute_escrow_with_zero_amount_and_empty_balance_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());

        let relayer = Address::generate(&env);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            WebhookTrigger,
            (admin, asset.address(), relayer.clone(), next_steps),
        );
        let client = WebhookTriggerClient::new(&env, &contract_id);

        // Contract has no funds — should fail with InsufficientBalance
        client.execute_escrow(&0);
    }
}
