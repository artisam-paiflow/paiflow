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
    Threshold,
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
    ThresholdNotMet = 4,
}

const VERSION: u32 = 1;

#[contract]
pub struct OracleTrigger;

#[contractimpl]
impl OracleTrigger {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        threshold: i128,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Threshold, &threshold);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    /// Called by a relayer with the current oracle price. If the price meets
    /// or exceeds the stored threshold, funds are pulled from `from` and
    /// pushed downstream.
    pub fn execute(env: Env, from: Address, amount: i128, price: i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let threshold: i128 = env.storage().instance().get(&Key::Threshold).unwrap();
        if price < threshold {
            panic_with_error!(&env, Error::ThresholdNotMet);
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
            .publish((symbol_short!("execute"), from), (price, amount));
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::NextSteps).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    pub fn threshold(env: Env) -> i128 {
        env.storage().instance().get(&Key::Threshold).unwrap()
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
    fn executes_when_price_meets_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let user = Address::generate(&env);
        sac.mint(&user, &1_000);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            OracleTrigger,
            (admin, asset.address(), 50_i128, next_steps),
        );
        let client = OracleTriggerClient::new(&env, &contract_id);

        client.execute(&user, &500, &100);

        assert_eq!(tok.balance(&user), 500);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&next), 500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn below_threshold_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let user = Address::generate(&env);
        sac.mint(&user, &1_000);

        let contract_id = env.register(
            OracleTrigger,
            (
                admin,
                asset.address(),
                100_i128,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = OracleTriggerClient::new(&env, &contract_id);

        client.execute(&user, &500, &50);
    }
}
