use super::*;
#[path = "../../../payment-test-token.rs"]
mod test_token;
use soroban_sdk::testutils::{Address as _, Events as _};
use test_token::{WideToken, WideTokenClient};

fn recipients(env: &Env, a: &Address, b: &Address) -> Vec<Recipient> {
    vec![
        env,
        Recipient {
            address: a.clone(),
            bps: 5_000,
            amount: 0,
            is_cash_out: false,
        },
        Recipient {
            address: b.clone(),
            bps: 5_000,
            amount: 0,
            is_cash_out: false,
        },
    ]
}

#[test]
fn near_max_percentage_split_conserves_funds_and_assigns_remainder_to_last() {
    for amount in [1, 11, i128::MAX] {
        let env = Env::default();
        env.mock_all_auths();
        let asset = env.register(WideToken, ());
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let id = env.register(
            Splitter,
            (
                Address::generate(&env),
                asset.clone(),
                recipients(&env, &a, &b),
                0i128,
                Address::generate(&env),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let token = WideTokenClient::new(&env, &asset);
        token.mint(&id, &amount);
        SplitterClient::new(&env, &id).execute_step(&asset, &amount);
        assert_eq!(token.balance(&a), amount / 2);
        assert_eq!(token.balance(&b), amount - amount / 2);
        assert_eq!(token.balance(&id), 0);
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn constructor_rejects_fixed_total_overflow() {
    let env = Env::default();
    let mut rs = recipients(&env, &Address::generate(&env), &Address::generate(&env));
    for i in 0..2 {
        let mut r = rs.get(i).unwrap();
        r.bps = 0;
        r.amount = if i == 0 { i128::MAX } else { 1 };
        rs.set(i, r);
    }
    env.register(
        Splitter,
        (
            Address::generate(&env),
            Address::generate(&env),
            rs,
            0i128,
            Address::generate(&env),
            Vec::<WorkflowTarget>::new(&env),
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn constructor_rejects_negative_fixed_recipient() {
    let env = Env::default();
    let mut rs = recipients(&env, &Address::generate(&env), &Address::generate(&env));
    for i in 0..2 {
        let mut r = rs.get(i).unwrap();
        r.bps = 0;
        r.amount = if i == 0 { 100 } else { -1 };
        rs.set(i, r);
    }
    env.register(
        Splitter,
        (
            Address::generate(&env),
            Address::generate(&env),
            rs,
            0i128,
            Address::generate(&env),
            Vec::<WorkflowTarget>::new(&env),
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn constructor_rejects_negative_minimum() {
    let env = Env::default();
    env.register(
        Splitter,
        (
            Address::generate(&env),
            Address::generate(&env),
            recipients(&env, &Address::generate(&env), &Address::generate(&env)),
            -1i128,
            Address::generate(&env),
            Vec::<WorkflowTarget>::new(&env),
        ),
    );
}

#[test]
fn arithmetic_failure_rolls_back_prior_transfer_and_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let asset = env.register(WideToken, ());
    let token = WideTokenClient::new(&env, &asset);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let from = Address::generate(&env);
    let mut rs = recipients(&env, &a, &b);
    let id = env.register(
        Splitter,
        (
            Address::generate(&env),
            asset.clone(),
            rs.clone(),
            0i128,
            Address::generate(&env),
            Vec::<WorkflowTarget>::new(&env),
        ),
    );
    // Inject invalid legacy state solely to exercise defensive arithmetic after
    // an earlier payout. New constructors cannot produce this configuration.
    let mut middle = rs.get(0).unwrap();
    middle.address = Address::generate(&env);
    middle.bps = 10_001;
    rs.insert(1, middle);
    env.as_contract(&id, || env.storage().instance().set(&Key::Recipients, &rs));
    token.mint(&from, &100);
    assert_eq!(
        SplitterClient::new(&env, &id).try_distribute(&from, &100),
        Err(Ok(Error::ArithmeticOverflow.into()))
    );
    assert!(env.events().all().events().is_empty());
    assert_eq!(token.balance(&from), 100);
    assert_eq!(token.balance(&id), 0);
    assert_eq!(token.balance(&a), 0);
    assert_eq!(token.balance(&b), 0);
}

#[test]
fn fixed_accumulation_overflow_is_named_and_keeps_accounting() {
    let env = Env::default();
    env.mock_all_auths();
    let asset = env.register(WideToken, ());
    let a = Address::generate(&env);
    let rs = vec![
        &env,
        Recipient {
            address: a.clone(),
            bps: 0,
            amount: i128::MAX,
            is_cash_out: false,
        },
    ];
    let id = env.register(
        Splitter,
        (
            Address::generate(&env),
            asset.clone(),
            rs.clone(),
            0i128,
            Address::generate(&env),
            Vec::<WorkflowTarget>::new(&env),
        ),
    );
    // Defensive test of inconsistent legacy accounting, not a normal deposit.
    env.as_contract(&id, || {
        env.storage()
            .instance()
            .set(&Key::AccumulatedBalance, &i128::MAX)
    });
    let token = WideTokenClient::new(&env, &asset);
    token.mint(&id, &1);
    let client = SplitterClient::new(&env, &id);
    assert_eq!(
        client.try_execute_step(&asset, &1),
        Err(Ok(Error::ArithmeticOverflow.into()))
    );
    assert!(env.events().all().events().is_empty());
    assert_eq!(client.accumulated_balance(), i128::MAX);
    assert_eq!(token.balance(&id), 1);
    assert_eq!(token.balance(&a), 0);
}
