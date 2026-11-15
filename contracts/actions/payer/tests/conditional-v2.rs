use payer::{conditional_v2 as v2, execution_v1 as v1};
use soroban_sdk::{testutils::Ledger as _, vec, BytesN, IntoVal, Symbol, Vec};
#[path = "../../../conditional-v2-test-support.rs"]
mod support;
use support::{s, Terminal, World};

#[test]
fn strict_comparisons_all_terminal_combinations_and_owner_not_payer() {
    for comparison in [v2::ComparisonV2::AmountGt, v2::ComparisonV2::AmountLt] {
        for yes in [Terminal::Pay, Terminal::Split, Terminal::Return] {
            for no in [Terminal::Pay, Terminal::Split, Terminal::Return] {
                for funded in [109, 110, 111] {
                    let w = World::new(
                        yes,
                        no,
                        comparison.clone(),
                        100,
                        Some(v1::PayoutRule::Fixed(10)),
                    );
                    let route = w.route(funded);
                    let selected = if route.selected_branch == v2::BranchV2::True {
                        yes
                    } else {
                        no
                    };
                    assert!(w.execute(funded, 1));
                    assert_eq!(w.balance(&w.payer), i128::MAX - funded);
                    let incoming = funded - 10;
                    match selected {
                        Terminal::Pay => assert_eq!(w.balance(&w.worker), incoming),
                        Terminal::Split => {
                            assert_eq!(w.balance(&w.worker), incoming - incoming / 10);
                            assert_eq!(w.balance(&w.platform), 10 + incoming / 10);
                        }
                        Terminal::Return => {
                            assert_eq!(w.balance(&w.admin), incoming);
                            assert_eq!(w.balance(&w.worker), 0);
                        }
                        _ => unreachable!(),
                    }
                    assert_eq!(w.balance(&w.root), 0);
                    assert_eq!(w.balance(&w.condition), 0);
                    assert_eq!(w.balance(&w.yes), 0);
                    assert_eq!(w.balance(&w.no), 0);
                }
            }
        }
    }
}
#[test]
fn threshold_extremes_i128_and_percentage_prefix_do_not_overflow() {
    for comparison in [v2::ComparisonV2::AmountGt, v2::ComparisonV2::AmountLt] {
        for threshold in [0, i128::MAX] {
            let w = World::new(
                Terminal::Return,
                Terminal::Pay,
                comparison.clone(),
                threshold,
                None,
            );
            assert!(w.execute(i128::MAX, 1));
            assert_eq!(w.balance(&w.payer), 0);
            assert_eq!(w.balance(&w.worker) + w.balance(&w.admin), i128::MAX);
        }
    }
    let w = World::new(
        Terminal::Return,
        Terminal::Pay,
        v2::ComparisonV2::AmountGt,
        50,
        Some(v1::PayoutRule::Percentage(5000)),
    );
    assert_eq!(w.route(100).selected_branch, v2::BranchV2::False);
    assert!(w.execute(100, 1));
    assert_eq!(w.balance(&w.platform), 50);
    assert_eq!(w.balance(&w.worker), 50);
}
#[test]
fn fixed_pay_underfunding_terminal_refund_and_percentage_rounding() {
    let w = World::new(
        Terminal::FixedPay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    assert!(!w.execute(39, 1));
    assert_eq!(w.balance(&w.payer), i128::MAX);
    assert!(w.execute(100, 1));
    assert_eq!(w.balance(&w.worker), 40);
    assert_eq!(w.balance(&w.payer), i128::MAX - 40);
    let w = World::new(
        Terminal::PercentPay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    assert!(w.execute(101, 1));
    assert_eq!(w.balance(&w.worker), 33);
    assert_eq!(w.balance(&w.payer), i128::MAX - 33);
    let w = World::new(
        Terminal::Return,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        Some(v1::PayoutRule::Fixed(10)),
    );
    assert!(!w.execute(10, 1));
    assert_eq!(w.balance(&w.payer), i128::MAX);
}
#[test]
fn fixed_split_runtime_exact_funding_and_constant_accumulation_preserve_debt() {
    let w = World::new(
        Terminal::RuntimeSplit,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    for amount in [99, 101] {
        assert!(!w.execute(amount, 1));
        assert_eq!(w.balance(&w.payer), i128::MAX);
    }
    assert!(w.execute(100, 1));
    assert_eq!(w.balance(&w.platform), 10);
    assert_eq!(w.balance(&w.worker), 90);
    let w = World::new(
        Terminal::FixedSplit,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    w.mint(&w.yes, 77);
    assert!(w.execute(40, 1));
    assert_eq!(w.status(&w.yes).obligations, 40);
    assert_eq!(w.balance(&w.yes), 117);
    assert!(w.execute(70, 2));
    assert_eq!(w.status(&w.yes).obligations, 10);
    assert_eq!(w.balance(&w.yes), 87);
    assert_eq!(w.balance(&w.platform), 10);
    assert_eq!(w.balance(&w.worker), 90);
    // Token loss does not erase admitted accounting.
    w.env.mock_all_auths();
    soroban_sdk::token::Client::new(&w.env, &w.asset).transfer(&w.yes, &w.platform, &87);
    assert_eq!(w.balance(&w.yes), 0);
    assert_eq!(w.status(&w.yes).obligations, 10);
}
#[test]
fn complete_bindings_route_nonce_expiry_and_input_substitution_fail_without_funding() {
    for attack in 0..10 {
        let w = World::new(
            Terminal::Pay,
            Terminal::Pay,
            v2::ComparisonV2::AmountGt,
            100,
            Some(v1::PayoutRule::Fixed(10)),
        );
        let mut bindings = w.bindings();
        let mut route = w.route(111);
        let mut inputs = w.inputs(&route);
        let mut expiry = 100;
        match attack {
            0 => {
                let mut last = bindings.pop_back().unwrap();
                last.expected_revision = 1;
                bindings.push_back(last);
            }
            1 => {
                bindings.pop_back();
            }
            2 => {
                let mut last = bindings.pop_back().unwrap();
                last.wasm_hash = BytesN::from_array(&w.env, &[99; 32]);
                bindings.push_back(last);
            }
            3 => {
                route.selected_branch = v2::BranchV2::False;
            }
            4 => {
                route.amount_at_condition += 1;
            }
            5 => {
                inputs = Vec::new(&w.env);
            }
            6 => {
                inputs.push_back(v1::NodeInput::Pay(v1::PayInput {
                    node_id: s(&w.env, "no"),
                    recipient: w.worker.clone(),
                }));
            }
            7 => {
                inputs.push_back(inputs.first().unwrap());
            }
            8 => {
                expiry = 10;
            }
            _ => {
                expiry = 731;
            }
        }
        let args = w.args(111, 1, expiry, &bindings, &inputs, &route);
        w.authorize(111, args.clone());
        assert!(!w.try_args(args));
        assert_eq!(w.balance(&w.payer), i128::MAX);
        assert_eq!(w.balance(&w.platform), 0);
        assert_eq!(w.balance(&w.worker), 0);
    }
    let w = World::new(
        Terminal::Pay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    assert!(w.execute(100, 1));
    assert!(!w.execute(100, 1));
    assert_eq!(w.balance(&w.worker), 100);
    w.env
        .ledger()
        .with_mut(|ledger| ledger.sequence_number = 100);
    assert!(!w.execute(100, 2));
}
#[test]
fn payer_auth_binds_exact_input_body_and_direct_children_require_parent() {
    let w = World::new(
        Terminal::Pay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    let route = w.route(100);
    let inputs = w.inputs(&route);
    let args = w.args(100, 1, 100, &w.bindings(), &inputs, &route);
    w.authorize(100, args.clone());
    let changed = vec![
        &w.env,
        v1::NodeInput::Pay(v1::PayInput {
            node_id: s(&w.env, "yes"),
            recipient: w.platform.clone(),
        }),
    ];
    assert!(!w.try_args(w.args(100, 1, 100, &w.bindings(), &changed, &route)));
    w.env.set_auths(&[]);
    assert!(!w.try_args(args));
    let context = v2::ExecutionContextV2 {
        payer: w.payer.clone(),
        root: w.root.clone(),
        asset: w.asset.clone(),
        funded_amount: 100,
        nonce: BytesN::from_array(&w.env, &[1; 32]),
        expires_at_ledger: 100,
        bindings: w.bindings(),
        inputs,
        route,
    };
    // Without parent authorization, this preexisting balance must remain safe.
    // A missing require_auth() would otherwise permit a direct full payout.
    w.mint(&w.yes, 100);
    assert!(w
        .env
        .try_invoke_contract::<(), soroban_sdk::Error>(
            &w.yes,
            &Symbol::new(&w.env, "execute_step_v2"),
            (context, 100i128).into_val(&w.env)
        )
        .is_err());
    assert_eq!(w.balance(&w.payer), i128::MAX);
    assert_eq!(w.balance(&w.yes), 100);
}
#[test]
fn late_failure_rolls_back_fee_transfers_nonce_and_surplus() {
    let w = World::new(
        Terminal::Pay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        Some(v1::PayoutRule::Fixed(10)),
    );
    // Force a selected-recipient overflow after the earlier platform transfer.
    w.mint(&w.worker, i128::MAX);
    w.mint(&w.root, 7);
    w.mint(&w.condition, 8);
    w.mint(&w.yes, 9);
    assert!(!w.execute(111, 1));
    assert_eq!(w.balance(&w.platform), 0);
    assert_eq!(w.balance(&w.payer), i128::MAX);
    assert_eq!(w.balance(&w.root), 7);
    assert_eq!(w.balance(&w.condition), 8);
    assert_eq!(w.balance(&w.yes), 9);
    // Remove only the overflow cause; same nonce succeeds, proving atomic nonce rollback.
    w.env.mock_all_auths();
    soroban_sdk::token::Client::new(&w.env, &w.asset).transfer(&w.worker, &w.admin, &i128::MAX);
    assert!(w.execute(111, 1));
    assert_eq!(w.balance(&w.platform), 10);
    assert_eq!(w.balance(&w.worker), 101);
    assert_eq!(w.balance(&w.root), 7);
    assert_eq!(w.balance(&w.condition), 8);
    assert_eq!(w.balance(&w.yes), 9);
}
#[test]
fn getters_are_versioned_and_all_retained_entry_paths_reject_v2() {
    let w = World::new(
        Terminal::Split,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    for entry in w.manifest.nodes.iter() {
        let state: &v2::NodeStateV2 = &entry.state;
        let initial: v2::NodeStateV2 = w.env.invoke_contract(
            &state.contract_address,
            &Symbol::new(&w.env, "initial_config_v2"),
            Vec::new(&w.env),
        );
        assert_eq!(*state, initial);
        let policy: v2::NodeStateV2 = w.env.invoke_contract(
            &state.contract_address,
            &Symbol::new(&w.env, "field_policy_v2"),
            Vec::new(&w.env),
        );
        assert_eq!(policy, initial);
        let caps: v2::CapabilitiesV2 = w.env.invoke_contract(
            &state.contract_address,
            &Symbol::new(&w.env, "capabilities_v2"),
            Vec::new(&w.env),
        );
        assert!(!caps.mutation);
        assert_eq!(caps.mutation_abi, 0);
        for method in [
            "capabilities",
            "current_config",
            "field_policy",
            "mutation_status",
            "config_revision",
        ] {
            assert!(w
                .env
                .try_invoke_contract::<soroban_sdk::Val, soroban_sdk::Error>(
                    &state.contract_address,
                    &Symbol::new(&w.env, method),
                    Vec::new(&w.env)
                )
                .is_err());
        }
    }
    assert!(deposit_trigger::DepositTriggerClient::new(&w.env, &w.root)
        .try_deposit(&w.payer, &10)
        .is_err());
    assert!(paiflow_splitter::SplitterClient::new(&w.env, &w.yes)
        .try_distribute(&w.payer, &10)
        .is_err());
    assert!(paiflow_splitter::SplitterClient::new(&w.env, &w.yes)
        .try_pause()
        .is_err());
    assert!(payer::PayerClient::new(&w.env, &w.no).try_cancel().is_err());
    assert!(router::RouterClient::new(&w.env, &w.condition)
        .try_execute_step(&w.asset, &10)
        .is_err());
}

#[test]
fn direct_child_rejects_wrong_budget_and_inactive_context_despite_parent_auth_mock() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    let w = World::new(
        Terminal::Pay,
        Terminal::Pay,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    let route = w.route(100);
    let context = v2::ExecutionContextV2 {
        payer: w.payer.clone(),
        root: w.root.clone(),
        asset: w.asset.clone(),
        funded_amount: 100,
        nonce: BytesN::from_array(&w.env, &[1; 32]),
        expires_at_ledger: 100,
        bindings: w.bindings(),
        inputs: w.inputs(&route),
        route,
    };
    for wrong_budget in [true, false] {
        let mut context = context.clone();
        let amount = if wrong_budget { 99i128 } else { 100 };
        if !wrong_budget {
            context.inputs.push_back(v1::NodeInput::Pay(v1::PayInput {
                node_id: s(&w.env, "no"),
                recipient: w.platform.clone(),
            }));
        }
        let args: soroban_sdk::Vec<soroban_sdk::Val> = (context, amount).into_val(&w.env);
        w.env.mock_auths(&[MockAuth {
            address: &w.condition,
            invoke: &MockAuthInvoke {
                contract: &w.yes,
                fn_name: "execute_step_v2",
                args: args.clone(),
                sub_invokes: &[],
            },
        }]);
        assert!(w
            .env
            .try_invoke_contract::<(), soroban_sdk::Error>(
                &w.yes,
                &Symbol::new(&w.env, "execute_step_v2"),
                args
            )
            .is_err());
        assert_eq!(w.balance(&w.worker), 0);
    }
}
#[test]
fn wrong_asset_payer_and_live_inactive_revision_or_manifest_reject_before_funding() {
    for attack in 0..4 {
        let w = World::new(
            Terminal::Pay,
            Terminal::Return,
            v2::ComparisonV2::AmountGt,
            0,
            None,
        );
        let route = w.route(100);
        let mut args = w.args(100, 1, 100, &w.bindings(), &w.inputs(&route), &route);
        match attack {
            0 => args.set(1, w.root.clone().into_val(&w.env)),
            1 => args.set(0, w.admin.clone().into_val(&w.env)),
            2 => w.env.as_contract(&w.no, || {
                let mut current = v2::current(&w.env);
                current.revision = 1;
                w.env
                    .storage()
                    .instance()
                    .set(&v2::V2Key::Current, &current);
            }),
            _ => w.env.as_contract(&w.no, || {
                let mut manifest = v2::manifest(&w.env);
                manifest.asset = w.root.clone();
                w.env
                    .storage()
                    .instance()
                    .set(&v2::V2Key::Manifest, &manifest);
            }),
        }
        w.authorize(100, args.clone());
        assert!(!w.try_args(args));
        assert_eq!(w.balance(&w.payer), i128::MAX);
        assert_eq!(w.balance(&w.worker), 0);
    }
}
#[test]
fn split_event_keeps_existing_recipient_wire_shape() {
    use soroban_sdk::{testutils::Events as _, TryFromVal};
    let w = World::new(
        Terminal::Split,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    assert!(w.execute(101, 1));
    let events = w.env.events().all();
    let payout = events
        .events()
        .iter()
        .find(|event| {
            let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
            body.topics[0] == soroban_sdk::xdr::ScVal::Symbol("payout".try_into().unwrap())
        })
        .unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &payout.body;
    let recipients = Vec::<paiflow_splitter::Recipient>::try_from_val(&w.env, &body.data)
        .expect("retained payout ABI");
    assert_eq!(recipients.len(), 2);
    assert_eq!(recipients.get(0).unwrap().address, w.platform);
    assert_eq!(recipients.get(0).unwrap().bps, 1000);
    assert_eq!(recipients.get(1).unwrap().address, w.worker);
}

#[test]
fn constructors_reject_redundant_slot_disagreement_and_invalid_owner_manifest() {
    use soroban_sdk::{testutils::Address as _, Address};
    for attack in 0..5 {
        let w = World::new(
            Terminal::Return,
            Terminal::Pay,
            v2::ComparisonV2::AmountGt,
            0,
            None,
        );
        let address = Address::generate(&w.env);
        let mut manifest = w.manifest.clone();
        let ci = v2::condition_index(&manifest);
        let own = ci + 1;
        let mut entry = manifest.nodes.get(own).unwrap();
        entry.state.contract_address = address.clone();
        if attack == 4 {
            entry.state.configuration = v2::NodeConfigurationV2::ReturnToOwner(v2::ReturnStateV2 {
                recipient: w.payer.clone(),
            });
        }
        manifest.nodes.set(own, entry);
        let mut router = manifest.nodes.get(ci).unwrap();
        router.state.next_steps.set(0, address.clone());
        manifest.nodes.set(ci, router);
        let init: soroban_sdk::Val = v2::NodeInitV2 {
            version: 2,
            node_id: s(&w.env, "yes"),
            manifest,
        }
        .into_val(&w.env);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            w.env.register_at(
                &address,
                payer::Payer,
                (
                    if attack == 0 { &w.payer } else { &w.admin },
                    if attack == 1 { &w.root } else { &w.asset },
                    init,
                    if attack == 2 { 1i128 } else { 0 },
                    10000u32,
                    Vec::<payer::WorkflowTarget>::new(&w.env),
                    if attack == 3 { &w.root } else { &w.condition },
                ),
            )
        }));
        assert!(result.is_err(), "constructor attack {attack}");
    }
}

#[test]
fn root_payer_auth_is_required_even_with_an_independently_authorized_token_transfer() {
    use soroban_sdk::{testutils::MockAuthInvoke, xdr};
    let w = World::new(
        Terminal::Pay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    let route = w.route(100);
    let args = w.args(100, 1, 100, &w.bindings(), &w.inputs(&route), &route);
    let xdr::ScAddress::Account(account) = xdr::ScAddress::from(&w.payer) else {
        panic!()
    };
    w.env.host().set_source_account(account).unwrap();
    // A transfer-only auth tree would authorize the nested debit if execute_v2
    // omitted its own explicit payer.require_auth(). It does not authorize root
    // terms, branches, inputs or revisions.
    w.env.set_auths(&[xdr::SorobanAuthorizationEntry {
        credentials: xdr::SorobanCredentials::SourceAccount,
        root_invocation: (&MockAuthInvoke {
            contract: &w.asset,
            fn_name: "transfer",
            args: (&w.payer, &w.root, 100i128).into_val(&w.env),
            sub_invokes: &[],
        })
            .into(),
    }]);
    assert!(!w.try_args(args));
    assert_eq!(w.balance(&w.payer), i128::MAX);
    assert_eq!(w.balance(&w.worker), 0);
    // Verify the exact same transfer-only credential is usable as a nested
    // token debit. Thus the refusal above exercises root authorization itself.
    let probe = w.env.register(DebitOnlyProbe, ());
    w.env.set_auths(&[xdr::SorobanAuthorizationEntry {
        credentials: xdr::SorobanCredentials::SourceAccount,
        root_invocation: (&MockAuthInvoke {
            contract: &w.asset,
            fn_name: "transfer",
            args: (&w.payer, &w.root, 100i128).into_val(&w.env),
            sub_invokes: &[],
        })
            .into(),
    }]);
    DebitOnlyProbeClient::new(&w.env, &probe).debit(&w.payer, &w.asset, &w.root, &100);
    assert_eq!(w.balance(&w.payer), i128::MAX - 100);
    assert_eq!(w.balance(&w.root), 100);
}

#[test]
fn separate_payers_can_reuse_nonce_without_exchanging_destinations_or_residuals() {
    let w = World::new(
        Terminal::Pay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    w.mint(&w.yes, 77);
    assert!(w.execute(100, 1));
    let second = support::wallet(&w.env, 5);
    w.mint(&second, 1000);
    let route = w.route(70);
    let inputs = vec![
        &w.env,
        v1::NodeInput::Pay(v1::PayInput {
            node_id: s(&w.env, "yes"),
            recipient: w.platform.clone(),
        }),
    ];
    let mut args = w.args(70, 1, 100, &w.bindings(), &inputs, &route);
    args.set(0, second.clone().into_val(&w.env));
    w.authorize_for(&second, 70, args.clone());
    assert!(w.try_args(args));
    assert_eq!(w.balance(&second), 930);
    assert_eq!(w.balance(&w.payer), i128::MAX - 100);
    assert_eq!(w.balance(&w.worker), 100);
    assert_eq!(w.balance(&w.platform), 70);
    assert_eq!(w.balance(&w.yes), 77);
}

#[soroban_sdk::contract]
struct WrongParent;
#[soroban_sdk::contractimpl]
impl WrongParent {
    pub fn call(env: soroban_sdk::Env, target: soroban_sdk::Address, args: Vec<soroban_sdk::Val>) {
        env.invoke_contract::<()>(&target, &Symbol::new(&env, "execute_step_v2"), args);
    }
}
#[test]
fn unrelated_contract_cannot_forward_forged_parent_context_into_prefunded_child() {
    let w = World::new(
        Terminal::Pay,
        Terminal::Return,
        v2::ComparisonV2::AmountGt,
        0,
        None,
    );
    w.mint(&w.yes, 100);
    let route = w.route(100);
    let context = v2::ExecutionContextV2 {
        payer: w.payer.clone(),
        root: w.root.clone(),
        asset: w.asset.clone(),
        funded_amount: 100,
        nonce: BytesN::from_array(&w.env, &[1; 32]),
        expires_at_ledger: 100,
        bindings: w.bindings(),
        inputs: w.inputs(&route),
        route,
    };
    let outsider = w.env.register(WrongParent, ());
    w.env.set_auths(&[]);
    let args: Vec<soroban_sdk::Val> = (context, 100i128).into_val(&w.env);
    assert!(WrongParentClient::new(&w.env, &outsider)
        .try_call(&w.yes, &args)
        .is_err());
    assert_eq!(w.balance(&w.worker), 0);
    assert_eq!(w.balance(&w.yes), 100);
}

#[soroban_sdk::contract]
struct DebitOnlyProbe;
#[soroban_sdk::contractimpl]
impl DebitOnlyProbe {
    pub fn debit(
        env: soroban_sdk::Env,
        payer: soroban_sdk::Address,
        asset: soroban_sdk::Address,
        target: soroban_sdk::Address,
        amount: i128,
    ) {
        soroban_sdk::token::Client::new(&env, &asset).transfer(&payer, &target, &amount);
    }
}

fn percentage_slot_manifest(
    w: &World,
    branch: v2::BranchV2,
    known_bps: u32,
    slots: u8,
    optional_roster: bool,
) -> v2::GraphManifestV2 {
    let mut manifest = w.manifest.clone();
    let selected = v2::selected_index(&manifest, &branch);
    let mut entry = manifest.nodes.get(selected).unwrap();
    let mut rows = vec![
        &w.env,
        v1::ConfiguredRow {
            row_id: s(&w.env, "platform"),
            recipient_mode: v1::FieldMode::Constant,
            allocation_mode: v1::FieldMode::Constant,
            recipient: Some(w.platform.clone()),
            allocation: v1::MaybeAllocation::Present(v1::Allocation::Percentage(known_bps)),
        },
    ];
    for slot in 0..slots {
        rows.push_back(v1::ConfiguredRow {
            row_id: s(&w.env, &format!("variable{slot}")),
            recipient_mode: v1::FieldMode::Constant,
            allocation_mode: v1::FieldMode::Execution,
            recipient: Some(support::wallet(&w.env, 10 + slot)),
            allocation: v1::MaybeAllocation::Missing,
        });
    }
    entry.state.configuration = v2::NodeConfigurationV2::Split(v1::StoredSplitConfig {
        policy: v1::SplitConfig {
            version: 1,
            node_id: entry.state.node_id.clone(),
            allocation_mode: v1::AllocationMode::Percentage,
            rows,
            additional_mode: if optional_roster {
                v1::FieldMode::Execution
            } else {
                v1::FieldMode::Constant
            },
        },
        additional: Vec::new(&w.env),
    });
    manifest.nodes.set(selected, entry);
    manifest
}
fn assert_manifest_and_root_constructor(
    w: &World,
    mut manifest: v2::GraphManifestV2,
    accepted: bool,
) {
    use soroban_sdk::{testutils::Address as _, Address};
    let direct = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        w.env
            .as_contract(&w.root, || v2::validate_manifest(&w.env, &manifest));
    }));
    assert_eq!(direct.is_ok(), accepted, "whole-manifest validation");
    // The real Receive constructor must inspect both terminal definitions even
    // before either child exists at the newly declared root address.
    let fresh_root = Address::generate(&w.env);
    let original_root = manifest.root.clone();
    manifest.root = fresh_root.clone();
    for position in 0..manifest.nodes.len() {
        let mut node = manifest.nodes.get(position).unwrap();
        if position == 0 {
            node.state.contract_address = fresh_root.clone();
        }
        if node.state.parent == Some(original_root.clone()) {
            node.state.parent = Some(fresh_root.clone());
        }
        manifest.nodes.set(position, node);
    }
    let init: soroban_sdk::Val = v2::NodeInitV2 {
        version: 2,
        node_id: s(&w.env, "root"),
        manifest,
    }
    .into_val(&w.env);
    let constructor = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        w.env.register_at(
            &fresh_root,
            deposit_trigger::DepositTrigger,
            (&w.admin, &w.asset, init),
        )
    }));
    assert_eq!(
        constructor.is_ok(),
        accepted,
        "real constructor whole-graph admission"
    );
}
#[test]
fn configured_execution_allocations_reserve_positive_bps_on_both_inactive_branches() {
    for branch in [v2::BranchV2::True, v2::BranchV2::False] {
        for (known, slots, accepted) in [
            (10000, 1, false),
            (10000, 2, false),
            (9999, 2, false),
            (9999, 1, true),
            (9998, 2, true),
        ] {
            let w = World::new(
                Terminal::Split,
                Terminal::Split,
                v2::ComparisonV2::AmountGt,
                100,
                None,
            );
            let inactive_payment = if branch == v2::BranchV2::True {
                50
            } else {
                150
            };
            assert_ne!(w.route(inactive_payment).selected_branch, branch);
            let manifest = percentage_slot_manifest(&w, branch.clone(), known, slots, false);
            assert_manifest_and_root_constructor(&w, manifest, accepted);
        }
    }
}
#[test]
fn optional_execution_roster_can_be_empty_when_known_rows_use_all_bps() {
    for branch in [v2::BranchV2::True, v2::BranchV2::False] {
        let w = World::new(
            Terminal::Split,
            Terminal::Split,
            v2::ComparisonV2::AmountGt,
            100,
            None,
        );
        let manifest = percentage_slot_manifest(&w, branch, 10000, 0, true);
        assert_manifest_and_root_constructor(&w, manifest, true);
    }
}
#[test]
fn stored_initial_roster_is_included_in_known_percentage_budget() {
    for branch in [v2::BranchV2::True, v2::BranchV2::False] {
        let w = World::new(
            Terminal::Split,
            Terminal::Split,
            v2::ComparisonV2::AmountGt,
            100,
            None,
        );
        let mut manifest = percentage_slot_manifest(&w, branch.clone(), 1000, 0, false);
        let index = v2::selected_index(&manifest, &branch);
        let mut entry = manifest.nodes.get(index).unwrap();
        let v2::NodeConfigurationV2::Split(ref mut config) = entry.state.configuration else {
            panic!()
        };
        config.policy.additional_mode = v1::FieldMode::Mutable;
        config.additional.push_back(v1::AdditionalRow {
            row_id: s(&w.env, "stored"),
            recipient: w.worker.clone(),
            allocation: v1::Allocation::Percentage(9000),
        });
        manifest.nodes.set(index, entry);
        assert_manifest_and_root_constructor(&w, manifest, true);
    }
}

fn executable_percentage_world(
    branch: v2::BranchV2,
    known: u32,
    slots: u8,
    optional: bool,
) -> World {
    use soroban_sdk::{testutils::Address as _, Address};
    let mut w = World::new(
        Terminal::Split,
        Terminal::Split,
        v2::ComparisonV2::AmountGt,
        100,
        None,
    );
    let mut manifest = percentage_slot_manifest(&w, branch, known, slots, optional);
    let addresses = [
        Address::generate(&w.env),
        Address::generate(&w.env),
        Address::generate(&w.env),
        Address::generate(&w.env),
    ];
    manifest.root = addresses[0].clone();
    for position in 0..manifest.nodes.len() {
        let mut entry = manifest.nodes.get(position).unwrap();
        entry.state.contract_address = addresses[position as usize].clone();
        entry.state.parent = if position == 0 {
            None
        } else {
            Some(addresses[if position == 1 { 0 } else { 1 }].clone())
        };
        entry.state.next_steps = match position {
            0 => vec![&w.env, addresses[1].clone()],
            1 => vec![&w.env, addresses[2].clone(), addresses[3].clone()],
            _ => Vec::new(&w.env),
        };
        manifest.nodes.set(position, entry);
    }
    for entry in manifest.nodes.iter() {
        let state = entry.state;
        let init: soroban_sdk::Val = v2::NodeInitV2 {
            version: 2,
            node_id: state.node_id.clone(),
            manifest: manifest.clone(),
        }
        .into_val(&w.env);
        match state.configuration {
            v2::NodeConfigurationV2::Receive(_) => {
                w.env.register_at(
                    &state.contract_address,
                    deposit_trigger::DepositTrigger,
                    (&w.admin, &w.asset, init),
                );
            }
            v2::NodeConfigurationV2::Condition(_) => {
                w.env.register_at(
                    &state.contract_address,
                    router::Router,
                    (
                        &w.admin,
                        &w.asset,
                        init,
                        vec![
                            &w.env,
                            router::WorkflowTarget {
                                address: addresses[2].clone(),
                                data: s(&w.env, ""),
                            },
                        ],
                        vec![
                            &w.env,
                            router::WorkflowTarget {
                                address: addresses[3].clone(),
                                data: s(&w.env, ""),
                            },
                        ],
                        &addresses[0],
                    ),
                );
            }
            v2::NodeConfigurationV2::Split(_) => {
                w.env.register_at(
                    &state.contract_address,
                    paiflow_splitter::Splitter,
                    (
                        &w.admin,
                        &w.asset,
                        init,
                        0i128,
                        &addresses[1],
                        Vec::<paiflow_splitter::WorkflowTarget>::new(&w.env),
                    ),
                );
            }
            _ => panic!("bounded four-node percentage fixture"),
        }
    }
    w.root = addresses[0].clone();
    w.condition = addresses[1].clone();
    w.yes = addresses[2].clone();
    w.no = addresses[3].clone();
    w.manifest = manifest;
    w
}
#[test]
fn minimum_allocation_boundaries_and_optional_empty_roster_execute_with_real_payer_auth() {
    for branch in [v2::BranchV2::True, v2::BranchV2::False] {
        for slots in [0u8, 1, 2] {
            let optional = slots == 0;
            let w = executable_percentage_world(
                branch.clone(),
                10000 - u32::from(slots),
                slots,
                optional,
            );
            let amount = if branch == v2::BranchV2::True {
                150
            } else {
                50
            };
            let route = w.route(amount);
            assert_eq!(route.selected_branch, branch);
            let state = w
                .manifest
                .nodes
                .get(v2::selected_index(&w.manifest, &branch))
                .unwrap()
                .state;
            let mut rows = Vec::new(&w.env);
            for slot in 0..slots {
                rows.push_back(v1::RowInput {
                    row_id: s(&w.env, &format!("variable{slot}")),
                    recipient: None,
                    allocation: v1::MaybeAllocation::Present(v1::Allocation::Percentage(1)),
                });
            }
            let input = vec![
                &w.env,
                v1::NodeInput::Split(v1::SplitInput {
                    node_id: state.node_id,
                    rows,
                    additional: optional.then(|| Vec::new(&w.env)),
                }),
            ];
            let args = w.args(amount, 1, 100, &w.bindings(), &input, &route);
            w.authorize(amount, args.clone());
            assert!(w.try_args(args));
            let variable_total: i128 = (0..slots)
                .map(|slot| w.balance(&support::wallet(&w.env, 10 + slot)))
                .sum();
            assert_eq!(w.balance(&w.platform) + variable_total, amount);
            assert_eq!(w.balance(&w.payer), i128::MAX - amount);
            assert_eq!(w.balance(&w.yes), 0);
            assert_eq!(w.balance(&w.no), 0);
        }
    }
}
