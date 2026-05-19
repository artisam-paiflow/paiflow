#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Recipient {
    pub address: Address,
    pub bps: u32,
}

#[contracttype]
pub enum Key {
    Admin,
    Recipients,
    Asset,
    Rate,
    StartTs,
    EndTs,
    Claimed,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    NothingToClaim = 3,
    BadWindow = 4,
    BpsSumInvalid = 5,
    NoRecipients = 6,
}

const VERSION: u32 = 2;
const TOTAL_BPS: u32 = 10_000;

#[contract]
pub struct Streamer;

#[contractimpl]
impl Streamer {
    pub fn __constructor(
        env: Env,
        admin: Address,
        recipients: Vec<Recipient>,
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
        if recipients.is_empty() {
            panic_with_error!(&env, Error::NoRecipients);
        }
        let mut sum: u32 = 0;
        for r in recipients.iter() {
            sum = sum
                .checked_add(r.bps)
                .unwrap_or_else(|| panic_with_error!(&env, Error::BpsSumInvalid));
        }
        if sum != TOTAL_BPS {
            panic_with_error!(&env, Error::BpsSumInvalid);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Recipients, &recipients);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Rate, &rate_per_second);
        env.storage().instance().set(&Key::StartTs, &start_ts);
        env.storage().instance().set(&Key::EndTs, &end_ts);
        env.storage().instance().set(&Key::Claimed, &0i128);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn claim(env: Env) -> i128 {
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();
        let caller = recipients.first().unwrap().address.clone();
        caller.require_auth();

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

        env.storage().instance().set(&Key::Claimed, &vested);

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let client = token::Client::new(&env, &asset);

        let len = recipients.len();
        let last_idx = len - 1;
        let mut distributed: i128 = 0;
        let mut i: u32 = 0;
        while i < len {
            let r = recipients.get(i).unwrap();
            let share: i128 = if i == last_idx {
                available.checked_sub(distributed).unwrap_or(0)
            } else {
                available
                    .checked_mul(r.bps as i128)
                    .and_then(|v| v.checked_div(TOTAL_BPS as i128))
                    .unwrap_or(0)
            };
            if share > 0 {
                client.transfer(&env.current_contract_address(), &r.address, &share);
                distributed = distributed.checked_add(share).unwrap_or(distributed);
            }
            i += 1;
        }

        env.events()
            .publish((symbol_short!("claim"), recipients), available);
        available
    }

    pub fn available(env: Env) -> i128 {
        let rate: i128 = env.storage().instance().get(&Key::Rate).unwrap();
        let start: u64 = env.storage().instance().get(&Key::StartTs).unwrap();
        let end: u64 = env.storage().instance().get(&Key::EndTs).unwrap();
        let claimed: i128 = env.storage().instance().get(&Key::Claimed).unwrap();
        let now = env.ledger().timestamp();
        let cap = if now > end { end } else { now };
        if cap <= start {
            return 0;
        }
        let elapsed: i128 = (cap - start) as i128;
        let vested = elapsed.checked_mul(rate).unwrap_or(0);
        vested.checked_sub(claimed).unwrap_or(0)
    }

    pub fn top_up(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).transfer(&from, env.current_contract_address(), &amount);
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
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, vec, Env};

    fn make_recipients(env: &Env, a: &Address, b: &Address, c: &Address) -> Vec<Recipient> {
        vec![
            env,
            Recipient {
                address: a.clone(),
                bps: 6000,
            },
            Recipient {
                address: b.clone(),
                bps: 3000,
            },
            Recipient {
                address: c.clone(),
                bps: 1000,
            },
        ]
    }

    #[test]
    fn vest_and_claim_multi() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                make_recipients(&env, &a, &b, &c),
                asset.address(),
                10_i128,
                1000_u64,
                2000_u64,
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        let funder = Address::generate(&env);
        sac.mint(&funder, &10_000);
        client.top_up(&funder, &10_000);

        env.ledger().set_timestamp(1500);
        let claimed = client.claim();
        assert_eq!(claimed, 5_000);
        // 5000 split 60/30/10 = 3000, 1500, 500
        assert_eq!(tok.balance(&a), 3_000);
        assert_eq!(tok.balance(&b), 1_500);
        assert_eq!(tok.balance(&c), 500);

        env.ledger().set_timestamp(3000);
        let claimed2 = client.claim();
        assert_eq!(claimed2, 5_000);
        assert_eq!(tok.balance(&a), 6_000);
        assert_eq!(tok.balance(&b), 3_000);
        assert_eq!(tok.balance(&c), 1_000);
    }

    #[test]
    #[should_panic]
    fn bad_bps_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let a = Address::generate(&env);
        let bad = vec![
            &env,
            Recipient {
                address: a.clone(),
                bps: 6000,
            },
        ];
        env.register(
            Streamer,
            (admin, bad, asset.address(), 10_i128, 1000_u64, 2000_u64),
        );
    }
}
