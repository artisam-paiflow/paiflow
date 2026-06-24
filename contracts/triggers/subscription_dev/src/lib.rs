#![no_std]
#![allow(clippy::too_many_arguments)]
//! SUBSCRIPTION_DEV — the mutable / parameterized variant of the `subscription`
//! trigger.
//!
//! Same execution interface as `subscription` (`charge`, `charge_by_relayer`)
//! so it slots into the pipeline, but the subscriber, per-period amount and the
//! schedule itself (start / interval / end) can be left blank at deploy time
//! and filled / changed later via auth-gated setters (admin OR relayer).
//! Charging before the trigger is configured fails cleanly with `NotConfigured`.
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
    EndTime,
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
    SubscriptionEnded = 6,
    NotCancelled = 7,
    /// Charge was triggered before the mutable params were filled in.
    NotConfigured = 8,
}

const VERSION: u32 = 1;

#[contract]
pub struct SubscriptionDev;

#[contractimpl]
impl SubscriptionDev {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        subscriber: Option<Address>,
        amount_per_period: i128,
        next_steps: Vec<WorkflowTarget>,
        relayer: Address,
        start_time: u64,
        interval_seconds: u64,
        end_time: u64,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        // Blank params are allowed at deploy time. Negative amounts never are.
        if amount_per_period < 0 {
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
        env.storage().instance().set(&Key::EndTime, &end_time);
        env.storage().instance().set(&Key::NextChargeAt, &start_time);
    }

    pub fn charge(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        execute_charge(&env);
    }

    pub fn charge_by_relayer(env: Env) {
        let relayer: Address = env.storage().instance().get(&Key::Relayer).unwrap();
        relayer.require_auth();
        execute_charge(&env);
    }

    /// Fill / change the subscriber. Auth: admin OR relayer.
    pub fn update_subscriber(env: Env, caller: Address, subscriber: Address) {
        require_admin_or_relayer(&env, &caller);
        env.storage()
            .instance()
            .set(&Key::Subscriber, &Some(subscriber.clone()));
        #[allow(deprecated)]
        env.events().publish(
            (Symbol::new(&env, "subscriber_updated"), caller),
            subscriber,
        );
    }

    /// Fill / change the per-period amount. Auth: admin OR relayer.
    pub fn set_amount(env: Env, caller: Address, amount_per_period: i128) {
        require_admin_or_relayer(&env, &caller);
        if amount_per_period <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&Key::AmountPerPeriod, &amount_per_period);
        #[allow(deprecated)]
        env.events().publish(
            (Symbol::new(&env, "amount_updated"), caller),
            amount_per_period,
        );
    }

    /// Fill / change the schedule. Auth: admin OR relayer. Resets the next
    /// charge time to the new start so a reschedule takes effect immediately.
    pub fn update_schedule(
        env: Env,
        caller: Address,
        start_time: u64,
        interval_seconds: u64,
        end_time: u64,
    ) {
        require_admin_or_relayer(&env, &caller);
        if interval_seconds == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if end_time <= start_time {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(&Key::StartTime, &start_time);
        env.storage()
            .instance()
            .set(&Key::IntervalSeconds, &interval_seconds);
        env.storage().instance().set(&Key::EndTime, &end_time);
        env.storage().instance().set(&Key::NextChargeAt, &start_time);
        #[allow(deprecated)]
        env.events().publish(
            (Symbol::new(&env, "schedule_updated"), caller),
            (start_time, interval_seconds, end_time),
        );
    }

    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Relayer, &new_relayer);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_relayer"), admin), new_relayer);
    }

    pub fn is_configured(env: Env) -> bool {
        is_configured(&env)
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::NextSteps).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    pub fn subscriber(env: Env) -> Option<Address> {
        env.storage().instance().get(&Key::Subscriber).unwrap()
    }

    pub fn amount_per_period(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&Key::AmountPerPeriod)
            .unwrap_or(0)
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

    pub fn end_time(env: Env) -> u64 {
        env.storage().instance().get(&Key::EndTime).unwrap()
    }

    pub fn unsubscribe(env: Env) {
        let subscriber: Address = require_subscriber(&env);
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

    pub fn subscribe(env: Env) {
        let subscriber: Address = require_subscriber(&env);
        subscriber.require_auth();

        if !env
            .storage()
            .instance()
            .get(&Key::Cancelled)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::NotCancelled);
        }

        env.storage().instance().set(&Key::Cancelled, &false);

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("subscribe"), subscriber), ());
    }
}

fn require_admin_or_relayer(env: &Env, caller: &Address) {
    caller.require_auth();
    let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
    let relayer: Address = env.storage().instance().get(&Key::Relayer).unwrap();
    if *caller != admin && *caller != relayer {
        panic_with_error!(env, Error::Unauthorized);
    }
}

fn require_subscriber(env: &Env) -> Address {
    let subscriber: Option<Address> = env
        .storage()
        .instance()
        .get(&Key::Subscriber)
        .unwrap_or(None);
    match subscriber {
        Some(s) => s,
        None => panic_with_error!(env, Error::NotConfigured),
    }
}

fn is_configured(env: &Env) -> bool {
    let subscriber: Option<Address> = env
        .storage()
        .instance()
        .get(&Key::Subscriber)
        .unwrap_or(None);
    if subscriber.is_none() {
        return false;
    }
    let amount: i128 = env
        .storage()
        .instance()
        .get(&Key::AmountPerPeriod)
        .unwrap_or(0);
    let interval: u64 = env.storage().instance().get(&Key::IntervalSeconds).unwrap_or(0);
    let start: u64 = env.storage().instance().get(&Key::StartTime).unwrap_or(0);
    let end: u64 = env.storage().instance().get(&Key::EndTime).unwrap_or(0);
    amount > 0 && interval > 0 && end > start
}

fn execute_charge(env: &Env) {
    if !is_configured(env) {
        panic_with_error!(env, Error::NotConfigured);
    }
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

    let end_time: u64 = env.storage().instance().get(&Key::EndTime).unwrap();
    if now >= end_time {
        panic_with_error!(env, Error::SubscriptionEnded);
    }

    let interval_seconds: u64 = env.storage().instance().get(&Key::IntervalSeconds).unwrap();
    let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
    let subscriber: Address = env
        .storage()
        .instance()
        .get::<_, Option<Address>>(&Key::Subscriber)
        .unwrap()
        .unwrap();
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

    env.storage().instance().set(
        &Key::NextChargeAt,
        &next_charge_at.saturating_add(interval_seconds),
    );

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
    const END_TIME: u64 = 10_000;

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

    fn deploy(
        env: &Env,
        subscriber: Option<Address>,
        amount: i128,
        start: u64,
        interval: u64,
        end: u64,
    ) -> (Address, Address, Address, Address) {
        let admin = Address::generate(env);
        let relayer = Address::generate(env);
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
            SubscriptionDev,
            (
                admin.clone(),
                asset.address(),
                subscriber,
                amount,
                next_steps,
                relayer.clone(),
                start,
                interval,
                end,
            ),
        );
        (contract_id, asset.address(), admin, relayer)
    }

    #[test]
    fn configured_at_construction_charges() {
        let env = Env::default();
        env.mock_all_auths();

        let subscriber = Address::generate(&env);
        let (contract_id, asset, _admin, _relayer) = deploy(
            &env,
            Some(subscriber.clone()),
            200,
            START_TIME,
            INTERVAL,
            END_TIME,
        );
        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        env.ledger().set_timestamp(START_TIME);
        let client = SubscriptionDevClient::new(&env, &contract_id);
        assert!(client.is_configured());
        client.charge();
        assert_eq!(tok.balance(&subscriber), 800);
        assert_eq!(client.next_charge_at(), START_TIME + INTERVAL);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn charge_before_configured_panics() {
        let env = Env::default();
        env.mock_all_auths();

        // Blank: no subscriber, no amount, no schedule.
        let (contract_id, _asset, _admin, _relayer) = deploy(&env, None, 0, 0, 0, 0);
        let client = SubscriptionDevClient::new(&env, &contract_id);
        assert!(!client.is_configured());
        env.ledger().set_timestamp(START_TIME);
        client.charge();
    }

    #[test]
    fn fill_blanks_then_charge() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, admin, _relayer) = deploy(&env, None, 0, 0, 0, 0);
        let client = SubscriptionDevClient::new(&env, &contract_id);
        let subscriber = Address::generate(&env);

        client.update_subscriber(&admin, &subscriber);
        client.set_amount(&admin, &200);
        client.update_schedule(&admin, &START_TIME, &INTERVAL, &END_TIME);
        assert!(client.is_configured());

        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        env.ledger().set_timestamp(START_TIME);
        client.charge();
        assert_eq!(tok.balance(&subscriber), 800);
        assert_eq!(client.next_charge_at(), START_TIME + INTERVAL);
    }

    #[test]
    fn relayer_can_fill_blanks() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, _admin, relayer) = deploy(&env, None, 0, 0, 0, 0);
        let client = SubscriptionDevClient::new(&env, &contract_id);
        let subscriber = Address::generate(&env);

        client.update_subscriber(&relayer, &subscriber);
        client.set_amount(&relayer, &200);
        client.update_schedule(&relayer, &START_TIME, &INTERVAL, &END_TIME);

        let tok = token::TokenClient::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
        tok.approve(&subscriber, &contract_id, &500, &1000);

        env.ledger().set_timestamp(START_TIME);
        client.charge_by_relayer();
        assert_eq!(tok.balance(&subscriber), 800);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn stranger_cannot_set_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _asset, _admin, _relayer) = deploy(&env, None, 0, 0, 0, 0);
        let stranger = Address::generate(&env);
        let client = SubscriptionDevClient::new(&env, &contract_id);
        client.set_amount(&stranger, &200);
    }

    #[test]
    fn reschedule_resets_next_charge() {
        let env = Env::default();
        env.mock_all_auths();

        let subscriber = Address::generate(&env);
        let (contract_id, _asset, admin, _relayer) = deploy(
            &env,
            Some(subscriber),
            200,
            START_TIME,
            INTERVAL,
            END_TIME,
        );
        let client = SubscriptionDevClient::new(&env, &contract_id);
        client.update_schedule(&admin, &5000, &120, &20_000);
        assert_eq!(client.start_time(), 5000);
        assert_eq!(client.interval_seconds(), 120);
        assert_eq!(client.next_charge_at(), 5000);
    }
}
