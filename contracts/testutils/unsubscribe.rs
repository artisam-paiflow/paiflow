// Shared regression suite included by Subscription, Subscription Dev and Payroll.
use super::{cancellation_fixture, Key, START_TIME};
use soroban_sdk::testutils::{
    Address as _, AuthorizedFunction, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, symbol_short, token, vec, Address, Env,
    Error as HostError, IntoVal, Symbol, Vec,
};

fn invoke(env: &Env, contract: &Address, name: &str) {
    env.invoke_contract::<()>(contract, &Symbol::new(env, name), Vec::new(env));
}

fn try_invoke(
    env: &Env,
    contract: &Address,
    name: &str,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<HostError, soroban_sdk::InvokeError>> {
    env.try_invoke_contract::<(), HostError>(contract, &Symbol::new(env, name), Vec::new(env))
}

fn cancelled(env: &Env, contract: &Address) -> bool {
    env.invoke_contract(contract, &Symbol::new(env, "is_cancelled"), Vec::new(env))
}

fn setup(amount: i128) -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(START_TIME);
    env.mock_all_auths();
    let (admin, payer, contract, asset) = cancellation_fixture(&env);
    token::Client::new(&env, &asset).approve(&payer, &contract, &amount, &1000);
    (env, admin, payer, contract, asset)
}

fn assert_cancel_event(env: &Env, contract: &Address, payer: &Address) {
    assert_eq!(
        env.events().all().filter_by_contract(contract),
        vec![
            env,
            (
                contract.clone(),
                vec![
                    env,
                    symbol_short!("cancel").into_val(env),
                    payer.into_val(env)
                ],
                ().into_val(env)
            )
        ]
    );
}

fn replay_prepared_cancellation(amount: i128) {
    let (env, admin, payer, contract, asset) = setup(amount);
    // Native simulation records the exact authorization tree. Restore its
    // preconditions via public methods before submitting that same tree later.
    invoke(&env, &contract, "unsubscribe");
    let prepared = env.auths();
    assert_eq!(prepared.len(), 1);
    assert_eq!(prepared[0].0, payer);
    let root = &prepared[0].1;
    assert_eq!(
        root.function,
        AuthorizedFunction::Contract((
            contract.clone(),
            Symbol::new(&env, "unsubscribe"),
            Vec::new(&env)
        ))
    );
    assert_eq!(root.sub_invocations.len(), 1);
    let approval = &root.sub_invocations[0];
    assert!(approval.sub_invocations.is_empty());
    let AuthorizedFunction::Contract((_, _, root_args)) = &root.function else {
        panic!("unexpected root")
    };
    let AuthorizedFunction::Contract((_, _, approval_args)) = &approval.function else {
        panic!("unexpected approval")
    };
    let prepared_approval = MockAuthInvoke {
        contract: &asset,
        fn_name: "approve",
        args: approval_args.clone(),
        sub_invokes: &[],
    };
    let prepared_root = MockAuthInvoke {
        contract: &contract,
        fn_name: "unsubscribe",
        args: root_args.clone(),
        sub_invokes: &[prepared_approval],
    };
    invoke(&env, &contract, "subscribe");
    token::Client::new(&env, &asset).approve(&payer, &contract, &amount, &1000);
    assert!(!cancelled(&env, &contract));
    assert_eq!(
        token::Client::new(&env, &asset).allowance(&payer, &contract),
        amount
    );

    env.ledger().set_sequence_number(107);
    // Strict tree matching, not mock_all_auths: the old sequence + 1 argument
    // fails both the captured argument assertion and this later invocation.
    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &prepared_root,
    }]);
    invoke(&env, &contract, "unsubscribe");
    assert_eq!(env.auths(), prepared);
    assert_eq!(
        approval.function,
        AuthorizedFunction::Contract((
            asset.clone(),
            Symbol::new(&env, "approve"),
            (&payer, &contract, 0_i128, 0_u32).into_val(&env)
        ))
    );
    assert_cancel_event(&env, &contract, &payer);
    assert!(cancelled(&env, &contract));
    assert_eq!(
        token::Client::new(&env, &asset).allowance(&payer, &contract),
        0
    );

    let charge = MockAuthInvoke {
        contract: &contract,
        fn_name: "charge",
        args: Vec::new(&env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &charge,
    }]);
    assert_eq!(
        try_invoke(&env, &contract, "charge"),
        Err(Ok(HostError::from_contract_error(4)))
    );
    assert!(env
        .events()
        .all()
        .filter_by_contract(&contract)
        .events()
        .is_empty());
    assert!(cancelled(&env, &contract));
    assert_eq!(
        token::Client::new(&env, &asset).allowance(&payer, &contract),
        0
    );

    // Cancellation blocks the automated charging entrypoint as well.
    env.mock_all_auths();
    assert_eq!(
        try_invoke(&env, &contract, "charge_by_relayer"),
        Err(Ok(HostError::from_contract_error(4)))
    );
    assert!(env
        .events()
        .all()
        .filter_by_contract(&contract)
        .events()
        .is_empty());

    // Repeated cancellation is authorized by the payer but rejected by guard.
    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &prepared_root,
    }]);
    assert_eq!(
        try_invoke(&env, &contract, "unsubscribe"),
        Err(Ok(HostError::from_contract_error(4)))
    );
    assert!(env
        .events()
        .all()
        .filter_by_contract(&contract)
        .events()
        .is_empty());
    assert!(cancelled(&env, &contract));
}

#[test]
fn unsubscribe_replays_prepared_auth_after_several_ledgers() {
    replay_prepared_cancellation(500);
}

#[test]
fn unsubscribe_with_zero_allowance_replays_prepared_auth() {
    replay_prepared_cancellation(0);
}

#[test]
fn unsubscribe_rejects_unauthorized_caller_without_changes() {
    let (env, _, payer, contract, asset) = setup(500);
    let stranger = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "unsubscribe",
            args: Vec::new(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(try_invoke(&env, &contract, "unsubscribe").is_err());
    assert!(env
        .events()
        .all()
        .filter_by_contract(&contract)
        .events()
        .is_empty());
    assert!(!cancelled(&env, &contract));
    assert_eq!(
        token::Client::new(&env, &asset).allowance(&payer, &contract),
        500
    );
}

#[test]
fn unsubscribe_requires_authorization_for_nested_revocation() {
    let (env, _, payer, contract, asset) = setup(500);
    // Root consent alone must not authorize the token approval.
    env.mock_auths(&[MockAuth {
        address: &payer,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "unsubscribe",
            args: Vec::new(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(try_invoke(&env, &contract, "unsubscribe").is_err());
    assert!(env
        .events()
        .all()
        .filter_by_contract(&contract)
        .events()
        .is_empty());
    assert!(!cancelled(&env, &contract));
    assert_eq!(
        token::Client::new(&env, &asset).allowance(&payer, &contract),
        500
    );
}

#[contract]
struct FailingRevoke;

#[contractimpl]
impl FailingRevoke {
    pub fn approve(env: Env, from: Address, _spender: Address, _amount: i128, _expiration: u32) {
        from.require_auth();
        // Write before failing to verify rollback also covers the token call.
        env.storage()
            .instance()
            .set(&symbol_short!("allowance"), &0_i128);
        panic_with_error!(&env, HostError::from_contract_error(99));
    }
}

#[test]
fn unsubscribe_rolls_back_when_token_revocation_fails() {
    let (env, _, _, contract, _) = setup(500);
    let asset = env.register(FailingRevoke, ());
    env.as_contract(&asset, || {
        env.storage()
            .instance()
            .set(&symbol_short!("allowance"), &500_i128)
    });
    env.as_contract(&contract, || {
        env.storage().instance().set(&Key::Asset, &asset)
    });
    assert_eq!(
        try_invoke(&env, &contract, "unsubscribe"),
        Err(Ok(HostError::from_contract_error(99)))
    );
    assert!(env
        .events()
        .all()
        .filter_by_contract(&contract)
        .events()
        .is_empty());
    assert!(!cancelled(&env, &contract));
    assert_eq!(
        env.as_contract(&asset, || env
            .storage()
            .instance()
            .get::<_, i128>(&symbol_short!("allowance"))
            .unwrap()),
        500
    );
}
