#![no_std]
//! CASH_OUT — immutable terminal "leave the chain" sink.
//!
//! Production counterpart to `cash_out_dev`. It receives the configured asset,
//! sinks it to the off-ramp treasury, and emits a `cash_out` event that the
//! backend cron turns into a fiat bank withdrawal via PDAX.
//!
//! Unlike the dev variant, bank details are supplied at deploy time and cannot
//! be changed on-chain. The contract still allows admin-only operations such as
//! pausing, setting a new treasury, or rotating the relayer address.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct WorkflowTarget {
    pub address: Address,
    pub data: String,
}

/// Snapshot of the bank destination returned by the `bank` getter.
#[contracttype]
#[derive(Clone)]
pub struct BankDetails {
    pub account_name: String,
    pub account_number: String,
    pub bank_code: String,
}

#[contracttype]
pub enum Key {
    Admin,
    Relayer,
    Asset,
    Treasury,
    Parent,
    Paused,
    Version,
    AccountName,
    AccountNumber,
    BankCode,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Paused = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InvalidBank = 5,
}

const VERSION: u32 = 1;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct CashOut;

#[contractimpl]
impl CashOut {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        relayer: Address,
        asset: Address,
        treasury: Address,
        parent: Address,
        account_name: String,
        account_number: String,
        bank_code: String,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        if account_name.is_empty() || account_number.is_empty() || bank_code.is_empty() {
            panic_with_error!(&env, Error::InvalidBank);
        }

        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Treasury, &treasury);
        env.storage().instance().set(&Key::Parent, &parent);
        env.storage().instance().set(&Key::Paused, &false);
        env.storage().instance().set(&Key::Version, &VERSION);
        env.storage().instance().set(&Key::AccountName, &account_name);
        env.storage()
            .instance()
            .set(&Key::AccountNumber, &account_number);
        env.storage().instance().set(&Key::BankCode, &bank_code);
    }

    /// Direct-call entry: pull `amount` from `from` and sink it to the treasury.
    pub fn distribute(env: Env, from: Address, amount: i128) {
        from.require_auth();
        bump_ttl(&env);
        require_not_paused(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let client = token::Client::new(&env, &asset);
        client.transfer(&from, &env.current_contract_address(), &amount);
        sink_to_treasury(&env, &asset, amount, &from);
    }

    /// Pipeline leaf entry: the parent node has already transferred `amount` of
    /// `asset` into this contract before invoking us. Auth: the parent node.
    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::Parent).unwrap();
        parent.require_auth();
        require_not_paused(&env);
        require_asset(&env, &asset);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        sink_to_treasury(&env, &asset, amount, &parent);
    }

    /// Trigger-driven entry (webhook / oracle / subscription forwarding). Funds
    /// are expected to already be held by this contract. `next_steps` is ignored
    /// — cash-out is terminal.
    pub fn receive_and_forward(
        env: Env,
        from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        bump_ttl(&env);
        require_not_paused(&env);
        require_asset(&env, &asset);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        sink_to_treasury(&env, &asset, amount, &from);
    }

    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Relayer, &new_relayer);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_relayer"), admin), new_relayer);
    }

    pub fn set_treasury(env: Env, new_treasury: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Treasury, &new_treasury);
    }

    pub fn pause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::Paused, &true);
    }

    pub fn unpause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::Paused, &false);
    }

    pub fn bank(env: Env) -> BankDetails {
        BankDetails {
            account_name: env.storage().instance().get(&Key::AccountName).unwrap(),
            account_number: env.storage().instance().get(&Key::AccountNumber).unwrap(),
            bank_code: env.storage().instance().get(&Key::BankCode).unwrap(),
        }
    }

    pub fn treasury(env: Env) -> Address {
        env.storage().instance().get(&Key::Treasury).unwrap()
    }

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
    }
}

/// Move `amount` of `asset` held by this contract to the off-ramp treasury and
/// emit the `cash_out` intent event the backend cron consumes. `source` is the
/// address the on-chain funds came from — recorded for the refund path.
fn sink_to_treasury(env: &Env, asset: &Address, amount: i128, source: &Address) {
    let treasury: Address = env.storage().instance().get(&Key::Treasury).unwrap();
    let client = token::Client::new(env, asset);
    client.transfer(&env.current_contract_address(), &treasury, &amount);

    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("cash_out"), source.clone()), amount);
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn require_not_paused(env: &Env) {
    if env
        .storage()
        .instance()
        .get::<_, bool>(&Key::Paused)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::Paused);
    }
}

fn require_asset(env: &Env, asset: &Address) {
    let stored: Address = env.storage().instance().get(&Key::Asset).unwrap();
    if *asset != stored {
        panic_with_error!(env, Error::InvalidAmount);
    }
}
