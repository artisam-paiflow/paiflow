#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Symbol, Vec,
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
    Cancelled,
    Relayer,
    StartTime,
    IntervalSeconds,
    NextChargeAt,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    AlreadyCancelled = 4,
    NotYetDue = 5,
}

const VERSION: u32 = 3;

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
        relayer: Address,
        start_time: u64,
        interval_seconds: u64,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if amount_per_period <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if interval_seconds == 0 {
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
        env.storage().instance().set(&Key::Cancelled, &false);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::StartTime, &start_time);
        env.storage()
            .instance()
            .set(&Key::IntervalSeconds, &interval_seconds);
        env.storage()
            .instance()
            .set(&Key::NextChargeAt, &start_time);
    }

    /// Pulls the pre-authorized subscription amount from the subscriber and
    /// forwards it downstream. Only the admin may call this.
    pub fn charge(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        execute_charge(&env);
    }

    /// Pulls the pre-authorized subscription amount from the subscriber and
    /// forwards it downstream. Only the configured relayer may call this.
    pub fn charge_by_relayer(env: Env) {
        let relayer: Address = env.storage().instance().get(&Key::Relayer).unwrap();
        relayer.require_auth();
        execute_charge(&env);
    }

    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Relayer, &new_relayer);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_relayer"), admin), new_relayer);
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

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
    }

    pub fn start_time(env: Env) -> u64 {
        env.storage().instance().get(&Key::StartTime).unwrap()
    }

    pub fn interval_seconds(env: Env) -> u64 {
        env.storage().instance().get(&Key::IntervalSeconds).unwrap()
    }

    pub fn next_charge_at(env: Env) -> u64 {
        env.storage().instance().get(&Key::NextChargeAt).unwrap()
    }

    /// Cancel the subscription. The subscriber stops future charges and the
    /// contract's token allowance is revoked.
    pub fn unsubscribe(env: Env) {
        let subscriber: Address = env.storage().instance().get(&Key::Subscriber).unwrap();
        subscriber.require_auth();

        if env
            .storage()
            .instance()
            .get(&Key::Cancelled)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::AlreadyCancelled);
        }

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let contract = env.current_contract_address();
        let expiration_ledger = env.ledger().sequence().saturating_add(1);
        token::Client::new(&env, &asset).approve(&subscriber, &contract, &0, &expiration_ledger);

        env.storage().instance().set(&Key::Cancelled, &true);

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("cancel"), subscriber), ());
    }

    pub fn is_cancelled(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&Key::Cancelled)
            .unwrap_or(false)
    }
}

fn execute_charge(env: &Env) {
    if env
        .storage()
        .instance()
        .get(&Key::Cancelled)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::AlreadyCancelled);
    }

    let now = env.ledger().timestamp();
    let next_charge_at: u64 = env.storage().instance().get(&Key::NextChargeAt).unwrap();
    if now < next_charge_at {
        panic_with_error!(env, Error::NotYetDue);
    }

    let interval_seconds: u64 = env.storage().instance().get(&Key::IntervalSeconds).unwrap();
    env.storage().instance().set(
        &Key::NextChargeAt,
        &next_charge_at.saturating_add(interval_seconds),
    );

    let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
    let subscriber: Address = env.storage().instance().get(&Key::Subscriber).unwrap();
    let amount: i128 = env.storage().instance().get(&Key::AmountPerPeriod).unwrap();
    let next_steps: Vec<WorkflowTarget> = env.storage().instance().get(&Key::NextSteps).unwrap();

    token::Client::new(env, &asset).transfer_from(
        &env.current_contract_address(),
        &subscriber,
        &env.current_contract_address(),
        &amount,
    );

    for step in next_steps.iter() {
        token::Client::new(env, &asset).transfer(
            &env.current_contract_address(),
            &step.address,
            &amount,
        );
        invoke_receive_and_forward(
            env,
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
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    const START_TIME: u64 = 1000;
    const INTERVAL: u64 = 60;

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

    fn deploy_contract(
        env: &Env,
        admin: Address,
        subscriber: Address,
        relayer: Address,
    ) -> (Address, Address) {
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let next = env.register(Dummy, ());
        let next_steps = vec![
            env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(env, ""),
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
                relayer,
                START_TIME,
                INTERVAL,
            ),
        );
        (contract_id, asset.address())
    }

    #[test]
    fn charge_pulls_and_forwards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, asset) = deploy_contract(&env, admin, subscriber.clone(), relayer);
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);

        tok.approve(&subscriber, &contract_id, &500, &1000);

        env.ledger().set_timestamp(START_TIME);
        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        client.charge();

        assert_eq!(tok.balance(&subscriber), 800);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(client.next_charge_at(), START_TIME + INTERVAL);
    }

    #[test]
    fn charge_by_relayer_pulls_and_forwards() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, asset) =
            deploy_contract(&env, admin, subscriber.clone(), relayer.clone());
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);

        tok.approve(&subscriber, &contract_id, &500, &1000);

        env.ledger().set_timestamp(START_TIME);
        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        client.charge_by_relayer();

        assert_eq!(tok.balance(&subscriber), 800);
        assert_eq!(client.next_charge_at(), START_TIME + INTERVAL);
    }

    #[test]
    fn set_relayer_changes_relayer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let new_relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, asset) =
            deploy_contract(&env, admin.clone(), subscriber.clone(), relayer);
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        env.ledger().set_timestamp(START_TIME);
        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        client.set_relayer(&new_relayer);
        assert_eq!(client.relayer(), new_relayer);

        // New relayer can charge; old relayer cannot (would fail auth in real env).
        client.charge_by_relayer();
        assert_eq!(tok.balance(&subscriber), 800);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn charge_fails_before_due() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, asset) = deploy_contract(&env, admin, subscriber.clone(), relayer);
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        env.ledger().set_timestamp(START_TIME - 1);
        client.charge();
    }

    #[test]
    fn charge_succeeds_when_due_and_advances_schedule() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, asset) = deploy_contract(&env, admin, subscriber.clone(), relayer);
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        env.ledger().set_timestamp(START_TIME);
        client.charge();
        assert_eq!(client.next_charge_at(), START_TIME + INTERVAL);

        env.ledger().set_timestamp(START_TIME + INTERVAL);
        client.charge();
        assert_eq!(client.next_charge_at(), START_TIME + 2 * INTERVAL);
        assert_eq!(tok.balance(&subscriber), 600);
    }

    #[test]
    fn unsubscribe_cancels_and_revokes_allowance() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, asset) = deploy_contract(&env, admin, subscriber.clone(), relayer);
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        client.unsubscribe();

        assert!(client.is_cancelled());
        assert_eq!(tok.allowance(&subscriber, &contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn charge_fails_after_unsubscribe() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, asset) = deploy_contract(&env, admin, subscriber.clone(), relayer);
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        env.ledger().set_timestamp(START_TIME);
        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        client.unsubscribe();
        client.charge();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn unsubscribe_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let (contract_id, _) = deploy_contract(&env, admin, subscriber.clone(), relayer);

        let client = SubscriptionTriggerClient::new(&env, &contract_id);
        client.unsubscribe();
        client.unsubscribe();
    }
}
