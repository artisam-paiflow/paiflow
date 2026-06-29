#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Recipient {
    pub address: Address,
    pub amount: i128,
}

#[contracttype]
pub enum Key {
    Admin,
    Asset,
    Employer,
    Recipients,
    IntervalSeconds,
    StartTime,
    EndTime,
    NextChargeAt,
    Relayer,
    Cancelled,
    Version,
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
    PayrollEnded = 6,
    NotCancelled = 7,
    NoRecipients = 8,
}

const VERSION: u32 = 1;

#[contract]
pub struct Payroll;

#[contractimpl]
impl Payroll {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        employer: Address,
        recipients: Vec<Recipient>,
        relayer: Address,
        start_time: u64,
        interval_seconds: u64,
        end_time: u64,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if interval_seconds == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if end_time <= start_time {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        validate_recipients(&env, &recipients);

        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Employer, &employer);
        env.storage().instance().set(&Key::Recipients, &recipients);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::Version, &VERSION);
        env.storage().instance().set(&Key::Cancelled, &false);
        env.storage().instance().set(&Key::StartTime, &start_time);
        env.storage()
            .instance()
            .set(&Key::IntervalSeconds, &interval_seconds);
        env.storage().instance().set(&Key::EndTime, &end_time);
        env.storage()
            .instance()
            .set(&Key::NextChargeAt, &start_time);
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

    pub fn update_recipients(env: Env, recipients: Vec<Recipient>) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        validate_recipients(&env, &recipients);
        env.storage().instance().set(&Key::Recipients, &recipients);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "recipient_updated"), admin), recipients);
    }

    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Relayer, &new_relayer);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_relayer"), admin), new_relayer);
    }

    pub fn unsubscribe(env: Env) {
        let employer: Address = env.storage().instance().get(&Key::Employer).unwrap();
        employer.require_auth();

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
        token::Client::new(&env, &asset).approve(&employer, &contract, &0, &expiration_ledger);

        env.storage().instance().set(&Key::Cancelled, &true);

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("cancel"), employer), ());
    }

    pub fn subscribe(env: Env) {
        let employer: Address = env.storage().instance().get(&Key::Employer).unwrap();
        employer.require_auth();

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
            .publish((symbol_short!("subscribe"), employer), ());
    }

    pub fn recipients(env: Env) -> Vec<Recipient> {
        env.storage().instance().get(&Key::Recipients).unwrap()
    }

    pub fn employer(env: Env) -> Address {
        env.storage().instance().get(&Key::Employer).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    pub fn next_charge_at(env: Env) -> u64 {
        env.storage().instance().get(&Key::NextChargeAt).unwrap()
    }

    pub fn interval_seconds(env: Env) -> u64 {
        env.storage().instance().get(&Key::IntervalSeconds).unwrap()
    }

    pub fn start_time(env: Env) -> u64 {
        env.storage().instance().get(&Key::StartTime).unwrap()
    }

    pub fn end_time(env: Env) -> u64 {
        env.storage().instance().get(&Key::EndTime).unwrap()
    }

    pub fn is_cancelled(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&Key::Cancelled)
            .unwrap_or(false)
    }

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
    }
}

fn validate_recipients(env: &Env, recipients: &Vec<Recipient>) {
    if recipients.is_empty() {
        panic_with_error!(env, Error::NoRecipients);
    }
    let mut total: i128 = 0;
    for r in recipients.iter() {
        if r.amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
        total = total
            .checked_add(r.amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::InvalidAmount));
    }
    if total <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
}

fn total_amount(env: &Env) -> i128 {
    let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();
    let mut total: i128 = 0;
    for r in recipients.iter() {
        total = total
            .checked_add(r.amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::InvalidAmount));
    }
    total
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

    let end_time: u64 = env.storage().instance().get(&Key::EndTime).unwrap();
    if now >= end_time {
        panic_with_error!(env, Error::PayrollEnded);
    }

    let interval_seconds: u64 = env.storage().instance().get(&Key::IntervalSeconds).unwrap();
    let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
    let employer: Address = env.storage().instance().get(&Key::Employer).unwrap();
    let amount = total_amount(env);
    let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();

    token::Client::new(env, &asset).transfer_from(
        &env.current_contract_address(),
        &employer,
        &env.current_contract_address(),
        &amount,
    );

    let client = token::Client::new(env, &asset);
    for r in recipients.iter() {
        client.transfer(&env.current_contract_address(), &r.address, &r.amount);
    }

    env.storage().instance().set(
        &Key::NextChargeAt,
        &next_charge_at.saturating_add(interval_seconds),
    );

    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("charge"), employer.clone()), amount);

    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("payout"), employer), recipients);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{vec, Env};

    const START_TIME: u64 = 1000;
    const INTERVAL: u64 = 60;
    const END_TIME: u64 = 10_000;

    fn deploy_contract(
        env: &Env,
        admin: Address,
        employer: Address,
        relayer: Address,
        recipients: Vec<Recipient>,
    ) -> (Address, Address) {
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let contract_id = env.register(
            Payroll,
            (
                admin,
                asset.address(),
                employer,
                recipients,
                relayer,
                START_TIME,
                INTERVAL,
                END_TIME,
            ),
        );
        (contract_id, asset.address())
    }

    fn recipient(_env: &Env, address: Address, amount: i128) -> Recipient {
        Recipient { address, amount }
    }

    #[test]
    fn charge_pulls_and_distributes() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let employer = Address::generate(&env);
        let relayer = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let recipients = vec![
            &env,
            recipient(&env, alice.clone(), 200),
            recipient(&env, bob.clone(), 100),
        ];

        let (contract_id, asset) =
            deploy_contract(&env, admin, employer.clone(), relayer, recipients);
        let token = token::Client::new(&env, &asset);

        // Mint and approve funds for the employer.
        token::StellarAssetClient::new(&env, &asset).mint(&employer, &1000);
        token.approve(&employer, &contract_id, &1000, &(START_TIME as u32 + 100));

        env.ledger().set_timestamp(START_TIME);

        let payroll = PayrollClient::new(&env, &contract_id);
        payroll.charge();

        assert_eq!(token.balance(&alice), 200);
        assert_eq!(token.balance(&bob), 100);
        assert_eq!(token.balance(&employer), 700);
        assert_eq!(payroll.next_charge_at(), START_TIME + INTERVAL);
    }

    #[test]
    fn charge_by_relayer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let employer = Address::generate(&env);
        let relayer = Address::generate(&env);
        let alice = Address::generate(&env);

        let recipients = vec![&env, recipient(&env, alice.clone(), 200)];
        let (contract_id, asset) =
            deploy_contract(&env, admin, employer.clone(), relayer.clone(), recipients);
        let token = token::Client::new(&env, &asset);

        token::StellarAssetClient::new(&env, &asset).mint(&employer, &1000);
        token.approve(&employer, &contract_id, &1000, &(START_TIME as u32 + 100));

        env.ledger().set_timestamp(START_TIME);

        let payroll = PayrollClient::new(&env, &contract_id);
        payroll.charge_by_relayer();

        assert_eq!(token.balance(&alice), 200);
    }

    #[test]
    fn update_recipients_changes_distribution() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let employer = Address::generate(&env);
        let relayer = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);

        let recipients = vec![
            &env,
            recipient(&env, alice.clone(), 200),
            recipient(&env, bob.clone(), 100),
        ];

        let (contract_id, asset) =
            deploy_contract(&env, admin.clone(), employer.clone(), relayer, recipients);
        let token = token::Client::new(&env, &asset);
        token::StellarAssetClient::new(&env, &asset).mint(&employer, &1000);
        token.approve(&employer, &contract_id, &1000, &(START_TIME as u32 + 100));

        let payroll = PayrollClient::new(&env, &contract_id);
        let new_recipients = vec![
            &env,
            recipient(&env, alice.clone(), 150),
            recipient(&env, carol.clone(), 50),
        ];
        payroll.update_recipients(&new_recipients);

        env.ledger().set_timestamp(START_TIME);
        payroll.charge();

        assert_eq!(token.balance(&alice), 150);
        assert_eq!(token.balance(&bob), 0);
        assert_eq!(token.balance(&carol), 50);
    }

    #[test]
    fn unsubscribe_cancels_and_revokes_allowance() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let employer = Address::generate(&env);
        let relayer = Address::generate(&env);
        let alice = Address::generate(&env);

        let recipients = vec![&env, recipient(&env, alice, 200)];
        let (contract_id, asset) =
            deploy_contract(&env, admin, employer.clone(), relayer, recipients);
        let token = token::Client::new(&env, &asset);

        token::StellarAssetClient::new(&env, &asset).mint(&employer, &1000);
        token.approve(&employer, &contract_id, &1000, &(START_TIME as u32 + 100));

        let payroll = PayrollClient::new(&env, &contract_id);
        payroll.unsubscribe();

        assert!(payroll.is_cancelled());
        assert_eq!(token.allowance(&employer, &contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn charge_fails_before_due() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let employer = Address::generate(&env);
        let relayer = Address::generate(&env);
        let alice = Address::generate(&env);

        let recipients = vec![&env, recipient(&env, alice, 200)];
        let (contract_id, _asset) = deploy_contract(&env, admin, employer, relayer, recipients);

        let payroll = PayrollClient::new(&env, &contract_id);
        env.ledger().set_timestamp(START_TIME - 1);
        payroll.charge();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn charge_fails_after_end_time() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let employer = Address::generate(&env);
        let relayer = Address::generate(&env);
        let alice = Address::generate(&env);

        let recipients = vec![&env, recipient(&env, alice, 200)];
        let (contract_id, _asset) = deploy_contract(&env, admin, employer, relayer, recipients);

        let payroll = PayrollClient::new(&env, &contract_id);
        env.ledger().set_timestamp(END_TIME);
        payroll.charge();
    }
}
