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

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Env};

    #[test]
    fn vest_and_claim() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);

        // Start at t=1000, end at t=2000, rate=10/sec → 10_000 total.
        let contract_id = env.register(
            Streamer,
            (admin.clone(), recipient.clone(), asset.address(), 10_i128, 1000_u64, 2000_u64),
        );
        let client = StreamerClient::new(&env, &contract_id);

        // Top up the contract.
        let funder = Address::generate(&env);
        sac.mint(&funder, &10_000);
        client.top_up(&funder, &10_000);

        // Move ledger to t=1500 → half vested.
        env.ledger().set_timestamp(1500);
        let claimed = client.claim();
        assert_eq!(claimed, 5_000);
        assert_eq!(tok.balance(&recipient), 5_000);

        // Past the end → remaining.
        env.ledger().set_timestamp(3000);
        let claimed2 = client.claim();
        assert_eq!(claimed2, 5_000);
        assert_eq!(tok.balance(&recipient), 10_000);
    }
}
