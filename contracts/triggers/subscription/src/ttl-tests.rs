use super::*;
use soroban_sdk::testutils::{storage::Instance as _, Address as _, Ledger};

fn ttl(env: &Env, contract: &Address) -> u32 {
    env.as_contract(contract, || env.storage().instance().get_ttl())
}

fn setup() -> (Env, Address) {
    setup_with_initial_ttl(4096)
}

fn setup_with_initial_ttl(initial_ttl: u32) -> (Env, Address) {
    let env = Env::default();
    env.ledger().set_min_persistent_entry_ttl(initial_ttl);
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let relayer = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract = env.register(
        SubscriptionTrigger,
        (
            admin,
            asset.clone(),
            subscriber.clone(),
            200_i128,
            Vec::<WorkflowTarget>::new(&env),
            relayer,
            1_000_u64,
            60_u64,
            10_000_u64,
        ),
    );
    token::StellarAssetClient::new(&env, &asset).mint(&subscriber, &1_000);
    token::Client::new(&env, &asset).approve(&subscriber, &contract, &1_000, &1_000_000);
    env.ledger().set_timestamp(1_000);
    (env, contract)
}

fn age_to(env: &Env, contract: &Address, remaining: u32) {
    let elapsed = ttl(env, contract) - remaining;
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + elapsed);
    assert_eq!(ttl(env, contract), remaining);
}

#[test]
fn ttl_mutations_extend_at_threshold_and_skip_above_it() {
    for action in 0..5 {
        for remaining in [TTL_THRESHOLD + 1, TTL_THRESHOLD, TTL_THRESHOLD - 1] {
            let (env, contract) = setup();
            assert_eq!(ttl(&env, &contract), TTL_EXTEND_TO);
            let client = SubscriptionTriggerClient::new(&env, &contract);
            if action == 4 {
                client.unsubscribe();
            }
            age_to(&env, &contract, remaining);
            match action {
                0 => client.charge(),
                1 => client.charge_by_relayer(),
                2 => client.set_relayer(&Address::generate(&env)),
                3 => client.unsubscribe(),
                4 => client.subscribe(),
                _ => unreachable!(),
            }
            assert_eq!(
                ttl(&env, &contract),
                if remaining > TTL_THRESHOLD {
                    remaining
                } else {
                    TTL_EXTEND_TO
                }
            );
        }
    }
}

#[test]
fn ttl_getters_and_failed_charge_do_not_extend() {
    let (env, contract) = setup();
    age_to(&env, &contract, TTL_THRESHOLD - 1);
    let client = SubscriptionTriggerClient::new(&env, &contract);
    client.state();
    client.next_steps();
    client.start_time();
    client.interval_seconds();
    client.end_time();
    assert_eq!(ttl(&env, &contract), TTL_THRESHOLD - 1);
    env.ledger().set_timestamp(999);
    assert!(client.try_charge_by_relayer().is_err());
    assert_eq!(client.next_charge_at(), 1_000);
    assert_eq!(ttl(&env, &contract), TTL_THRESHOLD - 1);
}

#[test]
fn constructor_does_not_extend_fresh_instance_above_threshold() {
    // TESTNET currently starts fresh entries above our maintenance threshold.
    let (env, contract) = setup_with_initial_ttl(120_960);
    assert_eq!(ttl(&env, &contract), 120_959);
}
