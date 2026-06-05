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
    Subscriber,
    AmountPerPeriod,
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
}

const VERSION: u32 = 1;

#[contract]
pub struct SubscriptionTrigger;

#[contractimpl]
impl SubscriptionTrigger {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        subscriber: Address,
        amount_per_period: i128,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if amount_per_period <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Subscriber, &subscriber);
        env.storage()
            .instance()
            .set(&Key::AmountPerPeriod, &amount_per_period);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    /// Pulls the pre-authorized subscription amount from the subscriber and
    /// forwards it downstream. Only the admin may call this.
    pub fn charge(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let subscriber: Address = env.storage().instance().get(&Key::Subscriber).unwrap();
        let amount: i128 = env.storage().instance().get(&Key::AmountPerPeriod).unwrap();
        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        token::Client::new(&env, &asset).transfer_from(
            &env.current_contract_address(),
            &subscriber,
            &env.current_contract_address(),
            &amount,
        );

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
            .publish((symbol_short!("charge"), subscriber), amount);
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::NextSteps).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    pub fn subscriber(env: Env) -> Address {
        env.storage().instance().get(&Key::Subscriber).unwrap()
    }

    pub fn amount_per_period(env: Env) -> i128 {
        env.storage().instance().get(&Key::AmountPerPeriod).unwrap()
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
    fn charge_pulls_and_forwards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let subscriber = Address::generate(&env);
        sac.mint(&subscriber, &1_000);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            SubscriptionTrigger,
            (
                admin,
                asset.address(),
                subscriber.clone(),
                200_i128,
                next_steps,
            ),
        );
        let client = SubscriptionTriggerClient::new(&env, &contract_id);

        // Approve the contract to pull funds
        tok.approve(&subscriber, &contract_id, &500, &1000);

        client.charge();

        assert_eq!(tok.balance(&subscriber), 800);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&next), 200);

        // Charge again
        client.charge();
        assert_eq!(tok.balance(&subscriber), 600);
        assert_eq!(tok.balance(&next), 400);
    }
}
