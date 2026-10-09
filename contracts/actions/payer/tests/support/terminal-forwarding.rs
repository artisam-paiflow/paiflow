use super::*;
use soroban_sdk::{contracttype, vec, xdr::ScVal};

#[contracttype]
#[derive(Clone)]
enum ProbeKey {
    Balance(Address),
    Reads,
    RejectBalance,
}

/// Test-only token: transfers read storage directly so `balance` counts only
/// explicit cross-contract balance invocations, not transfer implementation work.
#[contract]
struct ProbeToken;

#[contractimpl]
impl ProbeToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        assert!(amount >= 0);
        let balance = Self::inspect(env.clone(), to.clone());
        env.storage().persistent().set(
            &ProbeKey::Balance(to),
            &balance.checked_add(amount).unwrap(),
        );
    }

    pub fn inspect(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&ProbeKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        assert!(!env
            .storage()
            .instance()
            .get::<_, bool>(&ProbeKey::RejectBalance)
            .unwrap_or(false));
        let reads = Self::reads(env.clone());
        env.storage().instance().set(&ProbeKey::Reads, &(reads + 1));
        Self::inspect(env, id)
    }

    pub fn reads(env: Env) -> u32 {
        env.storage().instance().get(&ProbeKey::Reads).unwrap_or(0)
    }

    pub fn reject_balance(env: Env, reject: bool) {
        env.storage()
            .instance()
            .set(&ProbeKey::RejectBalance, &reject);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount >= 0);
        let balance = Self::inspect(env.clone(), from.clone());
        assert!(balance >= amount);
        env.storage()
            .persistent()
            .set(&ProbeKey::Balance(from.clone()), &(balance - amount));
        let receiving = Self::inspect(env.clone(), to.clone());
        env.storage().persistent().set(
            &ProbeKey::Balance(to.clone()),
            &receiving.checked_add(amount).unwrap(),
        );
        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("transfer"), from, to), amount);
    }
}

#[contract]
struct Sink;

#[contractimpl]
impl Sink {
    pub fn execute_step(env: Env, _asset: Address, amount: i128) {
        env.storage()
            .instance()
            .set(&symbol_short!("received"), &amount);
    }

    pub fn received(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("received"))
            .unwrap_or(0)
    }
}

#[derive(Clone, Copy, Debug)]
enum Entry {
    Execute,
    Receive,
    Distribute,
}

fn entries(kind: Kind) -> &'static [Entry] {
    if kind.is_split() {
        &[Entry::Execute, Entry::Receive, Entry::Distribute]
    } else {
        &[Entry::Execute, Entry::Receive]
    }
}

fn probe_world(kind: Kind) -> World {
    let env = Env::default();
    let admin = Address::generate(&env);
    let asset = env.register(ProbeToken, ());
    let parent = env.register(Parent, ());
    let action = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    register_action(&env, kind, &action, &parent, &admin, &asset, (&a, &b));
    World {
        env,
        kind,
        admin,
        asset,
        parent,
        action,
        a,
        b,
    }
}

fn send(w: &World, entry: Entry, amount: i128) {
    assert!(try_send(w, entry, amount).is_ok());
}

fn try_send(w: &World, entry: Entry, amount: i128) -> InvocationResult {
    let token = ProbeTokenClient::new(&w.env, &w.asset);
    match entry {
        Entry::Execute | Entry::Receive => {
            token.mint(&w.parent, &amount);
            w.env.set_auths(&[]);
            let from = matches!(entry, Entry::Receive).then(|| w.parent.clone());
            ParentClient::new(&w.env, &w.parent).try_send(&w.action, &w.asset, &amount, &from)
        }
        Entry::Distribute => {
            // A direct deposit is account-authorized; the other entry points
            // above use real contract-parent authorization with no auth mocks.
            let depositor = w.admin.clone();
            token.mint(&depositor, &amount);
            w.env.mock_auths(&[MockAuth {
                address: &depositor,
                invoke: &MockAuthInvoke {
                    contract: &w.action,
                    fn_name: "distribute",
                    args: (&depositor, amount).into_val(&w.env),
                    sub_invokes: &[MockAuthInvoke {
                        contract: &w.asset,
                        fn_name: "transfer",
                        args: (&depositor, &w.action, amount).into_val(&w.env),
                        sub_invokes: &[],
                    }],
                },
            }]);
            SplitterClient::new(&w.env, &w.action).try_distribute(&depositor, &amount)
        }
    }
}

#[test]
fn nonterminal_balance_or_downstream_failure_rolls_back_retained_funds_and_payouts() {
    for kind in KINDS {
        for &entry in entries(kind) {
            for balance_fails in [false, true] {
                let w = probe_world(kind);
                let token = ProbeTokenClient::new(&w.env, &w.asset);
                token.mint(&w.action, &17);
                send(&w, entry, 101);
                let before = balances(&w);
                let accumulated = w.accumulated();
                let next = Address::generate(&w.env);
                let wrong_parent = Address::generate(&w.env);
                register_action(
                    &w.env,
                    Kind::PayPercentage,
                    &next,
                    &wrong_parent,
                    &w.admin,
                    &w.asset,
                    (&w.a, &w.b),
                );
                set_steps(&w, std::slice::from_ref(&next));
                token.reject_balance(&balance_fails);
                assert!(try_send(&w, entry, 101).is_err(), "{kind:?} {entry:?}");
                w.assert_no_action_events();
                assert_eq!(balances(&w), before);
                assert_eq!(w.accumulated(), accumulated);
                assert_eq!(token.inspect(&next), 0);
                assert_eq!(
                    token.inspect(if matches!(entry, Entry::Distribute) {
                        &w.admin
                    } else {
                        &w.parent
                    }),
                    101
                );
                // A failed transaction also rolls back the test token's read counter.
                assert_eq!(token.reads(), 0);
            }
        }
    }
}

#[test]
fn removing_next_steps_requires_the_stored_admin() {
    for kind in KINDS {
        let w = probe_world(kind);
        let next = w.env.register(Sink, ());
        set_steps(&w, std::slice::from_ref(&next));
        if kind.is_split() {
            let client = SplitterClient::new(&w.env, &w.action);
            assert!(client.try_set_next_steps(&Vec::new(&w.env)).is_err());
            assert_eq!(client.next_steps().first().unwrap().address, next);
        } else {
            let client = PayerClient::new(&w.env, &w.action);
            assert!(client.try_set_next_steps(&Vec::new(&w.env)).is_err());
            // Payer has no public next-steps getter. The subsequent execution
            // must still forward into the target after unauthorized removal.
            send(&w, Entry::Execute, 101);
            assert_eq!(ProbeTokenClient::new(&w.env, &w.asset).reads(), 1);
            assert_eq!(
                SinkClient::new(&w.env, &next).received(),
                expected_payout(kind, 101).0
            );
        }
    }
}

fn set_steps(w: &World, targets: &[Address]) {
    let mut steps = Vec::new(&w.env);
    for target in targets {
        steps.push_back(WorkflowTarget {
            address: target.clone(),
            data: String::from_str(&w.env, ""),
        });
    }
    w.authorize(
        &w.admin,
        &w.action,
        "set_next_steps",
        (&steps,).into_val(&w.env),
    );
    if w.kind.is_split() {
        let mut split_steps = Vec::new(&w.env);
        for target in targets {
            split_steps.push_back(paiflow_splitter::WorkflowTarget {
                address: target.clone(),
                data: String::from_str(&w.env, ""),
            });
        }
        SplitterClient::new(&w.env, &w.action).set_next_steps(&split_steps);
    } else {
        PayerClient::new(&w.env, &w.action).set_next_steps(&steps);
    }
    assert_eq!(w.env.auths()[0].0, w.admin);
    w.env.set_auths(&[]);
}

fn balances(w: &World) -> (i128, i128, i128) {
    let token = ProbeTokenClient::new(&w.env, &w.asset);
    (
        token.inspect(&w.action),
        token.inspect(&w.a),
        token.inspect(&w.b),
    )
}

fn expected_payout(kind: Kind, amount: i128) -> (i128, i128, i128) {
    match kind {
        Kind::PayFixed => (amount - amount.min(100), amount.min(100), 0),
        Kind::PayPercentage => (amount - amount / 2, amount / 2, 0),
        Kind::SplitFixed => (amount - 100, 60, 40),
        Kind::SplitPercentage => (0, amount * 6_000 / 10_000, amount - amount * 6_000 / 10_000),
    }
}

fn assert_forward_event(w: &World, target: &Address, amount: i128) {
    let action_events = w.env.events().all().filter_by_contract(&w.action);
    let events = action_events.events();
    let forward = events
        .iter()
        .find(|event| {
            let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
            body.topics.first() == Some(&symbol_short!("forward").into_val(&w.env))
        })
        .expect("forward event");
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &forward.body;
    assert_eq!(body.topics[1], w.asset.to_val().into_val(&w.env));
    assert_eq!(body.topics[2], target.to_val().into_val(&w.env));
    assert_eq!(body.data, ScVal::from(amount));
}

#[test]
fn terminal_paths_omit_balance_even_when_it_would_fail() {
    for kind in KINDS {
        for &entry in entries(kind) {
            let w = probe_world(kind);
            let token = ProbeTokenClient::new(&w.env, &w.asset);
            token.mint(&w.action, &17);
            token.reject_balance(&true);
            send(&w, entry, 101);
            assert_eq!(
                w.env
                    .events()
                    .all()
                    .filter_by_contract(&w.action)
                    .events()
                    .len(),
                1
            );
            let (retained, a, b) = expected_payout(kind, 101);
            assert_eq!(balances(&w), (17 + retained, a, b), "{kind:?} {entry:?}");
            assert_eq!(token.reads(), 0);
            if matches!(kind, Kind::SplitFixed) {
                assert_eq!(w.accumulated(), 1);
            }
        }
    }
}

#[test]
fn terminal_fixed_split_accumulates_shortfalls_without_balance_reads() {
    for &entry in entries(Kind::SplitFixed) {
        let w = probe_world(Kind::SplitFixed);
        let token = ProbeTokenClient::new(&w.env, &w.asset);
        token.reject_balance(&true);
        send(&w, entry, 30);
        assert_eq!(
            w.env
                .events()
                .all()
                .filter_by_contract(&w.action)
                .events()
                .len(),
            1
        );
        assert_eq!(balances(&w), (30, 0, 0));
        assert_eq!(w.accumulated(), 30);
        send(&w, entry, 80);
        assert_eq!(balances(&w), (10, 60, 40));
        assert_eq!(w.accumulated(), 10);
        assert_eq!(token.reads(), 0);
    }
}

#[test]
fn terminal_fixed_pay_preserves_partial_payment_without_balance_read() {
    for &entry in entries(Kind::PayFixed) {
        let w = probe_world(Kind::PayFixed);
        let token = ProbeTokenClient::new(&w.env, &w.asset);
        token.mint(&w.action, &17);
        token.reject_balance(&true);
        send(&w, entry, 30);
        assert_eq!(balances(&w), (17, 30, 0));
        assert_eq!(token.reads(), 0);
    }
}

#[test]
fn enabling_next_steps_forwards_previous_retained_funds_to_first_target() {
    for kind in KINDS {
        for &entry in entries(kind) {
            let w = probe_world(kind);
            let token = ProbeTokenClient::new(&w.env, &w.asset);
            token.mint(&w.action, &17);
            send(&w, entry, 101);
            assert_eq!(token.reads(), 0);
            let first = w.env.register(Sink, ());
            let second = w.env.register(Sink, ());
            set_steps(&w, &[first.clone(), second.clone()]);
            send(&w, entry, 101);
            let (retained, a, b) = expected_payout(kind, 101);
            let forwarded = 17 + 2 * retained;
            assert_forward_event(&w, &first, forwarded);
            assert_eq!(balances(&w), (0, 2 * a, 2 * b));
            assert_eq!(token.inspect(&first), forwarded);
            assert_eq!(SinkClient::new(&w.env, &first).received(), forwarded);
            assert_eq!(token.inspect(&second), 0);
            assert_eq!(SinkClient::new(&w.env, &second).received(), 0);
            assert_eq!(token.reads(), 1);
            assert_eq!(w.accumulated(), 0);
            set_steps(&w, &[]);
            token.reject_balance(&true);
            send(&w, entry, 101);
            assert_eq!(balances(&w), (retained, 3 * a, 3 * b));
            assert_eq!(token.reads(), 1);
            if matches!(kind, Kind::SplitFixed) {
                assert_eq!(w.accumulated(), 1);
            }
        }
    }
}

#[test]
fn nonterminal_zero_balance_is_read_without_forwarding() {
    for kind in KINDS {
        for &entry in entries(kind) {
            let w = probe_world(kind);
            let next = w.env.register(Sink, ());
            set_steps(&w, std::slice::from_ref(&next));
            // Fixed payouts consume exactly 100; percentage Split consumes all
            // incoming funds. Set percentage Pay to 100% for its zero case.
            if matches!(kind, Kind::PayPercentage) {
                w.env.as_contract(&w.action, || {
                    w.env
                        .storage()
                        .instance()
                        .set(&payer::Key::PercentageBps, &10_000u32);
                });
            }
            send(&w, entry, 100);
            assert_eq!(
                w.env
                    .events()
                    .all()
                    .filter_by_contract(&w.action)
                    .events()
                    .len(),
                1
            );
            let token = ProbeTokenClient::new(&w.env, &w.asset);
            assert_eq!(token.reads(), 1);
            assert_eq!(token.inspect(&w.action), 0);
            assert_eq!(token.inspect(&next), 0);
            assert_eq!(SinkClient::new(&w.env, &next).received(), 0);
        }
    }
}

#[test]
fn fixed_split_direct_shortfall_still_forwards_and_resets_nonterminal_accumulator() {
    for &entry in entries(Kind::SplitFixed) {
        let w = probe_world(Kind::SplitFixed);
        let next = w.env.register(Sink, ());
        set_steps(&w, std::slice::from_ref(&next));
        send(&w, entry, 30);
        let token = ProbeTokenClient::new(&w.env, &w.asset);
        if matches!(entry, Entry::Distribute) {
            assert_eq!(token.reads(), 1);
            assert_eq!(balances(&w), (0, 0, 0));
            assert_eq!(token.inspect(&next), 30);
            assert_eq!(w.accumulated(), 0);
        } else {
            assert_eq!(token.reads(), 0);
            assert_eq!(balances(&w), (30, 0, 0));
            assert_eq!(token.inspect(&next), 0);
            assert_eq!(w.accumulated(), 30);
        }
    }
}

/// Repeat with the same fixture before/after the source change. Optional local
/// WASM uses the same release artifacts as deployment, but this remains a local
/// host estimate, not RPC simulation or a fee/capacity benchmark.
#[test]
#[ignore = "manual before/after resource measurement; see contract docs §4.1.3"]
fn profile_terminal_execution() {
    let wasm_dir = std::env::var_os("PAIFLOW_PROFILE_WASM_DIR");
    for kind in KINDS {
        let env = Env::default();
        let admin = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let parent = Address::generate(&env);
        let action = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        if let Some(dir) = &wasm_dir {
            let filename = if kind.is_split() {
                "paiflow_splitter.wasm"
            } else {
                "payer.wasm"
            };
            let wasm = std::fs::read(std::path::Path::new(dir).join(filename)).unwrap();
            if kind.is_split() {
                let fixed = matches!(kind, Kind::SplitFixed);
                env.register_at(
                    &action,
                    wasm.as_slice(),
                    (
                        &admin,
                        &asset,
                        vec![
                            &env,
                            Recipient {
                                address: a.clone(),
                                bps: if fixed { 0 } else { 6_000 },
                                amount: if fixed { 60 } else { 0 },
                                is_cash_out: false,
                            },
                            Recipient {
                                address: b.clone(),
                                bps: if fixed { 0 } else { 4_000 },
                                amount: if fixed { 40 } else { 0 },
                                is_cash_out: false,
                            },
                        ],
                        0i128,
                        &parent,
                        Vec::<paiflow_splitter::WorkflowTarget>::new(&env),
                    ),
                );
            } else {
                let fixed = matches!(kind, Kind::PayFixed);
                env.register_at(
                    &action,
                    wasm.as_slice(),
                    (
                        &admin,
                        &asset,
                        &a,
                        if fixed { 100i128 } else { 0 },
                        if fixed { 0u32 } else { 5_000 },
                        Vec::<WorkflowTarget>::new(&env),
                        &parent,
                        false,
                    ),
                );
            }
        } else {
            register_action(&env, kind, &action, &parent, &admin, &asset, (&a, &b));
        }
        env.mock_all_auths();
        token::StellarAssetClient::new(&env, &asset).mint(&action, &118);
        if kind.is_split() {
            SplitterClient::new(&env, &action).execute_step(&asset, &101);
        } else {
            PayerClient::new(&env, &action).execute_step(&asset, &101);
        }
        eprintln!(
            "PROFILE {} {kind:?}: {:?}",
            if wasm_dir.is_some() {
                "wasm-local"
            } else {
                "native"
            },
            env.cost_estimate().resources()
        );
        let (retained, paid_a, paid_b) = expected_payout(kind, 101);
        let token = token::Client::new(&env, &asset);
        assert_eq!(token.balance(&action), 17 + retained);
        assert_eq!(token.balance(&a), paid_a);
        assert_eq!(token.balance(&b), paid_b);
    }
}
