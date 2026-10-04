use super::*;
use soroban_sdk::testutils::{storage::Instance as _, Address as _, Ledger};

fn ttl(env: &Env, contract: &Address) -> u32 {
    env.as_contract(contract, || env.storage().instance().get_ttl())
}

fn setup() -> (Env, Address, Address) {
    setup_with_initial_ttl(4096)
}

fn setup_with_initial_ttl(initial_ttl: u32) -> (Env, Address, Address) {
    let env = Env::default();
    env.ledger().set_min_persistent_entry_ttl(initial_ttl);
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let contract = env.register(
        WebhookTrigger,
        (
            admin,
            asset.clone(),
            relayer.clone(),
            Vec::<WorkflowTarget>::new(&env),
        ),
    );
    token::StellarAssetClient::new(&env, &asset).mint(&relayer, &1_000);
    token::StellarAssetClient::new(&env, &asset).mint(&contract, &1_000);
    (env, contract, relayer)
}

fn age_to(env: &Env, contract: &Address, remaining: u32) {
    let elapsed = ttl(env, contract) - remaining;
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + elapsed);
    assert_eq!(ttl(env, contract), remaining);
}

#[test]
fn ttl_mutations_extend_at_threshold_and_skip_above_it() {
    for action in 0..3 {
        for remaining in [TTL_THRESHOLD + 1, TTL_THRESHOLD, TTL_THRESHOLD - 1] {
            let (env, contract, relayer) = setup();
            assert_eq!(ttl(&env, &contract), TTL_EXTEND_TO);
            age_to(&env, &contract, remaining);
            let client = WebhookTriggerClient::new(&env, &contract);
            match action {
                0 => client.execute(&relayer, &200),
                1 => client.execute_escrow(&200),
                2 => client.deposit(&relayer, &200),
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
fn ttl_getters_and_invalid_mutations_do_not_extend() {
    let (env, contract, relayer) = setup();
    age_to(&env, &contract, TTL_THRESHOLD - 1);
    let client = WebhookTriggerClient::new(&env, &contract);
    client.asset();
    client.relayer();
    client.next_steps();
    assert_eq!(ttl(&env, &contract), TTL_THRESHOLD - 1);
    assert!(client.try_execute(&relayer, &0).is_err());
    assert!(client.try_execute_escrow(&-1).is_err());
    assert!(client.try_deposit(&relayer, &0).is_err());
    assert_eq!(ttl(&env, &contract), TTL_THRESHOLD - 1);
}

#[test]
fn constructor_does_not_extend_fresh_instance_above_threshold() {
    // TESTNET currently starts fresh entries above our maintenance threshold.
    let (env, contract, _) = setup_with_initial_ttl(120_960);
    assert_eq!(ttl(&env, &contract), 120_959);
}
