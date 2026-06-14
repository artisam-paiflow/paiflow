#![no_std]
#![allow(clippy::too_many_arguments)]
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
    AmountPerInterval,
    IntervalSeconds,
    StartTs,
    EndTs,
    Claimed,
    ParentNode,
    Version,
    Paused,
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
    Paused = 7,
}

const VERSION: u32 = 2;
const TOTAL_BPS: u32 = 10_000;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct Streamer;

#[contractimpl]
#[allow(clippy::too_many_arguments)]
impl Streamer {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        recipients: Vec<Recipient>,
        asset: Address,
        amount_per_interval: i128,
        interval_seconds: u64,
        start_ts: u64,
        end_ts: u64,
        parent: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if end_ts <= start_ts || amount_per_interval <= 0 || interval_seconds == 0 {
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
        env.storage()
            .instance()
            .set(&Key::AmountPerInterval, &amount_per_interval);
        env.storage()
            .instance()
            .set(&Key::IntervalSeconds, &interval_seconds);
        env.storage().instance().set(&Key::StartTs, &start_ts);
        env.storage().instance().set(&Key::EndTs, &end_ts);
        env.storage().instance().set(&Key::Claimed, &0i128);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
        env.storage().instance().set(&Key::Paused, &false);
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();

        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("receive"), asset), amount);
    }

    pub fn claim(env: Env) -> i128 {
        bump_ttl(&env);
        if env
            .storage()
            .instance()
            .get::<_, bool>(&Key::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::Paused);
        }
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();
        let amount_per_interval: i128 = env
            .storage()
            .instance()
            .get(&Key::AmountPerInterval)
            .unwrap();
        let interval_seconds: u64 = env.storage().instance().get(&Key::IntervalSeconds).unwrap();
        let start: u64 = env.storage().instance().get(&Key::StartTs).unwrap();
        let end: u64 = env.storage().instance().get(&Key::EndTs).unwrap();
        let claimed: i128 = env.storage().instance().get(&Key::Claimed).unwrap();

        let now = env.ledger().timestamp();
        let cap = if now > end { end } else { now };
        if cap <= start {
            panic_with_error!(&env, Error::NothingToClaim);
        }
        let elapsed = cap.saturating_sub(start);
        let intervals = elapsed / interval_seconds;
        let vested = (intervals as i128)
            .checked_mul(amount_per_interval)
            .unwrap_or(0);
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

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("claim"), recipients), available);
        available
    }

    pub fn available(env: Env) -> i128 {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&Key::Paused)
            .unwrap_or(false)
        {
            return 0;
        }
        let amount_per_interval: i128 = env
            .storage()
            .instance()
            .get(&Key::AmountPerInterval)
            .unwrap();
        let interval_seconds: u64 = env.storage().instance().get(&Key::IntervalSeconds).unwrap();
        let start: u64 = env.storage().instance().get(&Key::StartTs).unwrap();
        let end: u64 = env.storage().instance().get(&Key::EndTs).unwrap();
        let claimed: i128 = env.storage().instance().get(&Key::Claimed).unwrap();
        let now = env.ledger().timestamp();
        let cap = if now > end { end } else { now };
        if cap <= start {
            return 0;
        }
        let elapsed = cap.saturating_sub(start);
        let intervals = elapsed / interval_seconds;
        let vested = (intervals as i128)
            .checked_mul(amount_per_interval)
            .unwrap_or(0);
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

    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Paused, &true);
    }

    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Paused, &false);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&Key::Paused).unwrap_or(false)
    }

    pub fn start_ts(env: Env) -> u64 {
        env.storage().instance().get(&Key::StartTs).unwrap()
    }

    pub fn end_ts(env: Env) -> u64 {
        env.storage().instance().get(&Key::EndTs).unwrap()
    }

    pub fn amount_per_interval(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&Key::AmountPerInterval)
            .unwrap()
    }

    pub fn interval_seconds(env: Env) -> u64 {
        env.storage().instance().get(&Key::IntervalSeconds).unwrap()
    }

    pub fn claimed(env: Env) -> i128 {
        env.storage().instance().get(&Key::Claimed).unwrap_or(0)
    }
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
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
        let parent = Address::generate(&env);

        // 1000 per 100-second interval, window 1000-2000 => 10 intervals total.
        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                make_recipients(&env, &a, &b, &c),
                asset.address(),
                1000_i128,
                100_u64,
                1000_u64,
                2000_u64,
                parent.clone(),
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        let funder = Address::generate(&env);
        sac.mint(&funder, &10_000);
        client.top_up(&funder, &10_000);

        // 500 elapsed seconds = 5 intervals => 5000 vested.
        env.ledger().set_timestamp(1500);
        let claimed = client.claim();
        assert_eq!(claimed, 5_000);
        // 5000 split 60/30/10 = 3000, 1500, 500
        assert_eq!(tok.balance(&a), 3_000);
        assert_eq!(tok.balance(&b), 1_500);
        assert_eq!(tok.balance(&c), 500);

        // At 3000 we cap at end (2000): 1000 elapsed seconds = 10 intervals => 10000 vested.
        env.ledger().set_timestamp(3000);
        let claimed2 = client.claim();
        assert_eq!(claimed2, 5_000);
        assert_eq!(tok.balance(&a), 6_000);
        assert_eq!(tok.balance(&b), 3_000);
        assert_eq!(tok.balance(&c), 1_000);
    }

    #[test]
    fn vest_and_claim_partial_matches_user_scenario() {
        // User scenario: 2 XLM every minute for 5 occurrences.
        // Discrete vesting: 2 XLM vests only after each full minute.
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let recipient = Address::generate(&env);
        let parent = Address::generate(&env);

        let start_ts = 1_000_000_u64;
        let end_ts = start_ts + 5 * 60; // 5 occurrences * 1 minute
        let amount_per_interval = 20_000_000_i128; // 2 XLM
        let interval_seconds = 60_u64;

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: recipient.clone(),
                        bps: 10_000,
                    },
                ],
                asset.address(),
                amount_per_interval,
                interval_seconds,
                start_ts,
                end_ts,
                parent.clone(),
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        // Top up with the full expected vesting amount (10 XLM).
        let total_expected = amount_per_interval * 5;
        let funder = Address::generate(&env);
        sac.mint(&funder, &total_expected);
        client.top_up(&funder, &total_expected);

        // Claim after 3 minutes: exactly 3 intervals => 6 XLM.
        env.ledger().set_timestamp(start_ts + 3 * 60);
        let expected_after_3_min = amount_per_interval * 3;
        let available = client.available();
        assert_eq!(available, expected_after_3_min);
        let claimed = client.claim();
        assert_eq!(claimed, expected_after_3_min);
        assert_eq!(tok.balance(&recipient), expected_after_3_min);

        // Claiming again immediately should yield nothing new.
        assert_eq!(client.available(), 0);
    }

    #[test]
    fn partial_interval_vests_nothing() {
        // 2 XLM every 3 minutes. After 4.5 minutes only one full interval has passed.
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let recipient = Address::generate(&env);
        let parent = Address::generate(&env);

        let start_ts = 1_000_000_u64;
        let amount_per_interval = 20_000_000_i128; // 2 XLM
        let interval_seconds = 3 * 60_u64;
        let end_ts = start_ts + 10 * interval_seconds;

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: recipient.clone(),
                        bps: 10_000,
                    },
                ],
                asset.address(),
                amount_per_interval,
                interval_seconds,
                start_ts,
                end_ts,
                parent.clone(),
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        let funder = Address::generate(&env);
        let top_up_amount = amount_per_interval * 10;
        sac.mint(&funder, &top_up_amount);
        client.top_up(&funder, &top_up_amount);

        // 4.5 minutes => only 1 full 3-minute interval => 2 XLM.
        env.ledger().set_timestamp(start_ts + 4 * 60 + 30);
        assert_eq!(client.available(), amount_per_interval);
        assert_eq!(client.claim(), amount_per_interval);
        assert_eq!(tok.balance(&recipient), amount_per_interval);
    }

    #[test]
    fn execute_step_accepts_pipeline_funds() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: Address::generate(&env),
                        bps: 10_000,
                    },
                ],
                asset.address(),
                1000_i128,
                100_u64,
                1000_u64,
                2000_u64,
                parent.clone(),
            ),
        );
        sac.mint(&parent, &10_000);
        let client = StreamerClient::new(&env, &contract_id);

        // Parent sends funds and calls execute_step
        token::Client::new(&env, &asset.address()).transfer(&parent, &contract_id, &10_000);
        client.execute_step(&asset.address(), &10_000);
        assert_eq!(
            token::Client::new(&env, &asset.address()).balance(&contract_id),
            10_000
        );
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
        let parent = Address::generate(&env);
        env.register(
            Streamer,
            (
                admin,
                bad,
                asset.address(),
                1000_i128,
                100_u64,
                1000_u64,
                2000_u64,
                parent,
            ),
        );
    }

    #[test]
    fn pause_and_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: Address::generate(&env),
                        bps: 10_000,
                    },
                ],
                asset.address(),
                1000_i128,
                100_u64,
                1000_u64,
                2000_u64,
                parent.clone(),
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        assert!(!client.is_paused());
        client.pause();
        assert!(client.is_paused());
        client.unpause();
        assert!(!client.is_paused());
    }

    #[test]
    fn getters_expose_contract_state() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: Address::generate(&env),
                        bps: 10_000,
                    },
                ],
                asset.address(),
                123_i128,
                60_u64,
                1000_u64,
                2000_u64,
                parent.clone(),
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        assert_eq!(client.start_ts(), 1000);
        assert_eq!(client.end_ts(), 2000);
        assert_eq!(client.amount_per_interval(), 123);
        assert_eq!(client.interval_seconds(), 60);
        assert_eq!(client.claimed(), 0);
    }

    #[test]
    #[should_panic]
    fn claim_rejects_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: Address::generate(&env),
                        bps: 10_000,
                    },
                ],
                asset.address(),
                1000_i128,
                100_u64,
                1000_u64,
                2000_u64,
                parent.clone(),
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        let funder = Address::generate(&env);
        sac.mint(&funder, &10_000);
        client.top_up(&funder, &10_000);

        env.ledger().set_timestamp(1500);
        client.pause();
        client.claim();
    }

    #[test]
    fn available_is_zero_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let parent = Address::generate(&env);

        let contract_id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: Address::generate(&env),
                        bps: 10_000,
                    },
                ],
                asset.address(),
                1000_i128,
                100_u64,
                1000_u64,
                2000_u64,
                parent.clone(),
            ),
        );
        let client = StreamerClient::new(&env, &contract_id);

        let funder = Address::generate(&env);
        sac.mint(&funder, &10_000);
        client.top_up(&funder, &10_000);

        env.ledger().set_timestamp(1500);
        assert!(client.available() > 0);
        client.pause();
        assert_eq!(client.available(), 0);
        client.unpause();
        assert!(client.available() > 0);
    }
}
