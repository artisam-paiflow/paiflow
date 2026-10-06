use super::*;
#[path = "../../../payment-test-token.rs"]
mod test_token;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use test_token::{WideToken, WideTokenClient};

fn recipients(env: &Env, a: &Address, b: &Address) -> Vec<Recipient> {
    soroban_sdk::vec![
        env,
        Recipient {
            address: a.clone(),
            bps: 5_000,
            amount: 0
        },
        Recipient {
            address: b.clone(),
            bps: 5_000,
            amount: 0
        }
    ]
}

#[test]
fn near_max_vesting_and_distribution_preserve_rounding_and_accounting() {
    let env = Env::default();
    let asset = env.register(WideToken, ());
    let token = WideTokenClient::new(&env, &asset);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let id = env.register(
        Streamer,
        (
            Address::generate(&env),
            recipients(&env, &a, &b),
            asset.clone(),
            i128::MAX,
            1u64,
            10u64,
            11u64,
            Address::generate(&env),
            true,
            true,
        ),
    );
    token.mint(&id, &i128::MAX);
    let client = StreamerClient::new(&env, &id);
    env.ledger().set_timestamp(10);
    assert_eq!(client.available(), 0);
    env.ledger().set_timestamp(11);
    assert_eq!(client.available(), i128::MAX);
    assert_eq!(client.claim(), i128::MAX);
    assert_eq!(token.balance(&a), i128::MAX / 2);
    assert_eq!(token.balance(&b), i128::MAX - i128::MAX / 2);
    assert_eq!(token.balance(&id), 0);
    assert_eq!(client.available(), 0);
    assert_eq!(client.try_claim(), Err(Ok(Error::NothingToClaim.into())));
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn constructor_rejects_unrepresentable_lifetime_payout() {
    let env = Env::default();
    env.register(
        Streamer,
        (
            Address::generate(&env),
            recipients(&env, &Address::generate(&env), &Address::generate(&env)),
            Address::generate(&env),
            i128::MAX,
            1u64,
            10u64,
            12u64,
            Address::generate(&env),
            true,
            true,
        ),
    );
}

#[test]
fn legacy_vesting_overflow_fails_reads_claim_and_retrieval_explicitly() {
    let env = Env::default();
    env.mock_all_auths();
    let asset = env.register(WideToken, ());
    let token = WideTokenClient::new(&env, &asset);
    let id = env.register(
        Streamer,
        (
            Address::generate(&env),
            recipients(&env, &Address::generate(&env), &Address::generate(&env)),
            asset.clone(),
            1i128,
            1u64,
            10u64,
            12u64,
            Address::generate(&env),
            true,
            true,
        ),
    );
    // Mimic a legacy instance that did not validate its lifetime bound.
    env.as_contract(&id, || {
        env.storage()
            .instance()
            .set(&Key::AmountPerInterval, &i128::MAX)
    });
    token.mint(&id, &100);
    env.ledger().set_timestamp(12);
    let client = StreamerClient::new(&env, &id);
    client.pause();
    assert_eq!(
        client.try_available(),
        Err(Ok(Error::ArithmeticOverflow.into()))
    );
    assert!(env.events().all().events().is_empty());
    assert_eq!(
        client.try_claim(),
        Err(Ok(Error::ArithmeticOverflow.into()))
    );
    assert!(env.events().all().events().is_empty());
    assert_eq!(
        client.try_retrieve_unvested(),
        Err(Ok(Error::ArithmeticOverflow.into()))
    );
    assert!(env.events().all().events().is_empty());
    assert_eq!(token.balance(&id), 100);
    assert_eq!(
        env.as_contract(&id, || env
            .storage()
            .instance()
            .get::<_, i128>(&Key::Claimed)
            .unwrap()),
        0
    );
}

#[test]
fn arithmetic_failure_rolls_back_claimed_state_and_earlier_recipient_transfer() {
    let env = Env::default();
    let asset = env.register(WideToken, ());
    let token = WideTokenClient::new(&env, &asset);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let mut rs = recipients(&env, &a, &b);
    let id = env.register(
        Streamer,
        (
            Address::generate(&env),
            rs.clone(),
            asset.clone(),
            100i128,
            1u64,
            10u64,
            12u64,
            Address::generate(&env),
            true,
            true,
        ),
    );
    let middle = Recipient {
        address: Address::generate(&env),
        bps: 10_001,
        amount: 0,
    };
    rs.insert(1, middle);
    env.as_contract(&id, || env.storage().instance().set(&Key::Recipients, &rs));
    token.mint(&id, &100);
    env.ledger().set_timestamp(11);
    let client = StreamerClient::new(&env, &id);
    assert_eq!(
        client.try_claim(),
        Err(Ok(Error::ArithmeticOverflow.into()))
    );
    assert!(env.events().all().events().is_empty());
    assert_eq!(token.balance(&id), 100);
    assert_eq!(token.balance(&a), 0);
    assert_eq!(token.balance(&b), 0);
    assert_eq!(
        env.as_contract(&id, || env
            .storage()
            .instance()
            .get::<_, i128>(&Key::Claimed)
            .unwrap()),
        0
    );
    assert_eq!(client.available(), 100);
}
