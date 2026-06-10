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
    Recipient,
    Amount,
    PercentageBps,
    NextSteps,
    ParentNode,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
}

const VERSION: u32 = 1;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct Payer;

#[contractimpl]
impl Payer {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        recipient: Address,
        amount: i128,
        percentage_bps: u32,
        next_steps: Vec<WorkflowTarget>,
        parent: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if amount <= 0 && percentage_bps == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Recipient, &recipient);
        env.storage().instance().set(&Key::Amount, &amount);
        env.storage()
            .instance()
            .set(&Key::PercentageBps, &percentage_bps);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();

        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let percentage_bps: u32 = env
            .storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0);
        let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
        let payment = if percentage_bps > 0 {
            (amount * i128::from(percentage_bps)) / 10_000
        } else {
            let configured_amount: i128 = env.storage().instance().get(&Key::Amount).unwrap();
            if amount > configured_amount {
                configured_amount
            } else {
                amount
            }
        };

        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &payment,
        );

        let next_steps: Vec<WorkflowTarget> = env
            .storage()
            .instance()
            .get(&Key::NextSteps)
            .unwrap_or_else(|| Vec::new(&env));
        for step in next_steps.iter() {
            invoke_execute_step(&env, &step.address, &asset, &0);
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("pay"), recipient), (asset, payment));
    }

    pub fn cancel(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let client = token::Client::new(&env, &asset);
        let balance = client.balance(&env.current_contract_address());
        if balance > 0 {
            client.transfer(&env.current_contract_address(), &admin, &balance);
        }
        #[allow(deprecated)]
        env.events().publish((symbol_short!("cancel"),), balance);
    }

    pub fn balance(env: Env) -> i128 {
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).balance(&env.current_contract_address())
    }

    pub fn configured_amount(env: Env) -> i128 {
        env.storage().instance().get(&Key::Amount).unwrap()
    }

    pub fn percentage_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0)
    }

    pub fn recipient(env: Env) -> Address {
        env.storage().instance().get(&Key::Recipient).unwrap()
    }

    /// Called by receive_and_forward triggers (webhook, oracle, subscription).
    /// Funds are expected to already be held by this contract.
    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        bump_ttl(&env);
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let percentage_bps: u32 = env
            .storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0);
        let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
        let payment = if percentage_bps > 0 {
            (amount * i128::from(percentage_bps)) / 10_000
        } else {
            let configured_amount: i128 = env.storage().instance().get(&Key::Amount).unwrap();
            if amount > configured_amount {
                configured_amount
            } else {
                amount
            }
        };

        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &payment,
        );

        let next_steps: Vec<WorkflowTarget> = env
            .storage()
            .instance()
            .get(&Key::NextSteps)
            .unwrap_or_else(|| Vec::new(&env));
        for step in next_steps.iter() {
            invoke_execute_step(&env, &step.address, &asset, &0);
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("pay"), recipient), (asset, payment));
    }
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn invoke_execute_step(env: &Env, target: &Address, asset: &Address, amount: &i128) {
    let func = soroban_sdk::Symbol::new(env, "execute_step");
    env.invoke_contract::<()>(
        target,
        &func,
        vec![env, asset.into_val(env), amount.into_val(env)],
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
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    fn make_next_steps(env: &Env, target: &Address) -> Vec<WorkflowTarget> {
        vec![
            env,
            WorkflowTarget {
                address: target.clone(),
                data: String::from_str(env, ""),
            },
        ]
    }

    #[test]
    fn pays_configured_amount_when_incoming_exceeds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let next = env.register(Dummy, ());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                make_next_steps(&env, &next),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
        assert_eq!(client.configured_amount(), 100);
    }

    #[test]
    fn pays_partial_when_incoming_less_than_configured() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &50);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &50);
        client.execute_step(&asset.address(), &50);

        assert_eq!(tok.balance(&recipient), 50);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn cancel_returns_balance_to_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&contract_id), 900);
        client.cancel();
        assert_eq!(tok.balance(&admin), 900);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn pays_percentage_of_incoming_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 500);
        assert_eq!(tok.balance(&contract_id), 500);
        assert_eq!(client.percentage_bps(), 5_000);
    }

    #[test]
    fn pays_full_amount_via_10000_bps() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                10_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 1_000);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn percentage_zero_falls_back_to_fixed_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }

    #[test]
    fn receive_and_forward_pays_configured_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }

    #[test]
    fn receive_and_forward_pays_percentage() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 500);
        assert_eq!(tok.balance(&contract_id), 500);
        assert_eq!(client.percentage_bps(), 5_000);
    }

    #[test]
    fn receive_and_forward_forwards_to_next_steps() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);
        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                next_steps,
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }
}
