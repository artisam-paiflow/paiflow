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
    Vault,
    NextSteps,
    TotalDeposited,
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

#[contract]
pub struct Yield;

#[contractimpl]
impl Yield {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        vault: Address,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Vault, &vault);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::TotalDeposited, &0i128);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let vault: Address = env.storage().instance().get(&Key::Vault).unwrap();
        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        // Deposit the incoming tokens into the vault.
        // In a real integration this might call a specific deposit function on the vault.
        token::Client::new(&env, &asset).transfer(&env.current_contract_address(), &vault, &amount);

        let total: i128 = env
            .storage()
            .instance()
            .get(&Key::TotalDeposited)
            .unwrap_or(0);
        env.storage().instance().set(
            &Key::TotalDeposited,
            &total.checked_add(amount).unwrap_or(total),
        );

        // Forward execution control to next steps with amount=0 since funds
        // have been moved into the yield vault.
        for step in next_steps.iter() {
            invoke_receive_and_forward(
                &env,
                &step.address,
                &env.current_contract_address(),
                &asset,
                &0,
            );
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("deposit"), vault), amount);
    }

    pub fn total_deposited(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&Key::TotalDeposited)
            .unwrap_or(0)
    }

    pub fn vault(env: Env) -> Address {
        env.storage().instance().get(&Key::Vault).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
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
    fn deposits_to_vault_and_forwards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let vault = Address::generate(&env);
        // Give vault some tokens so it can receive (not needed for mock)
        // In real Soroban, any address can receive.

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Yield,
            (admin.clone(), asset.address(), vault.clone(), next_steps),
        );
        let client = YieldClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &500);
        client.receive_and_forward(&predecessor, &asset.address(), &500, &vec![&env]);

        assert_eq!(client.total_deposited(), 500);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&vault), 500);
    }
}
