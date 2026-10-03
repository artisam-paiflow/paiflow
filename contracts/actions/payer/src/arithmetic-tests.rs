use super::*;
#[path = "../../../payment-test-token.rs"]
mod test_token;
use soroban_sdk::testutils::{Address as _, Events as _};
use test_token::{WideToken, WideTokenClient};

#[test]
fn percentage_payment_handles_i128_max_and_preserves_rounding() {
    for (amount, bps, expected) in [
        (i128::MAX, 10_000u32, i128::MAX),
        (i128::MAX, 5_000, i128::MAX / 2),
        (11, 3_333, 3),
        (1, 1, 0),
    ] {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let parent = Address::generate(&env);
        let asset = env.register(WideToken, ());
        let token = WideTokenClient::new(&env, &asset);
        let id = env.register(
            Payer,
            (
                admin,
                asset.clone(),
                recipient.clone(),
                0i128,
                bps,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        token.mint(&id, &amount);
        let client = PayerClient::new(&env, &id);
        client.receive_and_forward(&parent, &asset, &amount, &Vec::new(&env));
        assert_eq!(env.events().all().filter_by_contract(&id).events().len(), 1);
        assert_eq!(token.balance(&recipient), expected);
        assert_eq!(token.balance(&id), amount - expected);
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn constructor_rejects_percentage_above_100() {
    let env = Env::default();
    env.register(
        Payer,
        (
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            0i128,
            10_001u32,
            Vec::<WorkflowTarget>::new(&env),
            Address::generate(&env),
            false,
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn constructor_rejects_negative_amount_even_in_percentage_mode() {
    let env = Env::default();
    env.register(
        Payer,
        (
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
            -1i128,
            5_000u32,
            Vec::<WorkflowTarget>::new(&env),
            Address::generate(&env),
            false,
        ),
    );
}

#[test]
fn fixed_pay_still_pays_partial_incoming_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let asset = env.register(WideToken, ());
    let recipient = Address::generate(&env);
    let id = env.register(
        Payer,
        (
            Address::generate(&env),
            asset.clone(),
            recipient.clone(),
            100i128,
            0u32,
            Vec::<WorkflowTarget>::new(&env),
            Address::generate(&env),
            false,
        ),
    );
    let token = WideTokenClient::new(&env, &asset);
    token.mint(&id, &40);
    PayerClient::new(&env, &id).execute_step(&asset, &40);
    assert_eq!(token.balance(&recipient), 40);
    assert_eq!(token.balance(&id), 0);
}
