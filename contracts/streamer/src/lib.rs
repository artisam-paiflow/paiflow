#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env,
};

#[contracttype]
pub enum Key {
    Admin,
    Recipient,
    Asset,
    Rate,
    StartTs,
    EndTs,
    Claimed,
    Version,
}

#[derive(Copy, Clone)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    NothingToClaim = 3,
    BadWindow = 4,
}

const VERSION: u32 = 1;

#[contract]
pub struct Streamer;

#[contractimpl]
impl Streamer {
    pub fn __constructor(
        env: Env,
        admin: Address,
        recipient: Address,
        asset: Address,
        rate_per_second: i128,
        start_ts: u64,
        end_ts: u64,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if end_ts <= start_ts || rate_per_second <= 0 {
            panic_with_error!(&env, Error::BadWindow);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Recipient, &recipient);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Rate, &rate_per_second);
        env.storage().instance().set(&Key::StartTs, &start_ts);
        env.storage().instance().set(&Key::EndTs, &end_ts);
        env.storage().instance().set(&Key::Claimed, &0i128);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn claim(env: Env) -> i128 {
        let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
        recipient.require_auth();

        let rate: i128 = env.storage().instance().get(&Key::Rate).unwrap();
        let start: u64 = env.storage().instance().get(&Key::StartTs).unwrap();
        let end: u64 = env.storage().instance().get(&Key::EndTs).unwrap();
        let claimed: i128 = env.storage().instance().get(&Key::Claimed).unwrap();

        let now = env.ledger().timestamp();
        let cap = if now > end { end } else { now };
        if cap <= start {
            panic_with_error!(&env, Error::NothingToClaim);
        }
        let elapsed: i128 = (cap - start) as i128;
        let vested = elapsed.checked_mul(rate).unwrap_or(0);
        let available = vested.checked_sub(claimed).unwrap_or(0);
        if available <= 0 {
            panic_with_error!(&env, Error::NothingToClaim);
        }

        env.storage()
            .instance()
            .set(&Key::Claimed, &vested);

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &available,
        );
        env.events()
            .publish((symbol_short!("claim"), recipient.clone()), available);
        available
    }

    pub fn top_up(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
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
        env.events().publish((symbol_short!("cancel"),), balance);
    }
}
