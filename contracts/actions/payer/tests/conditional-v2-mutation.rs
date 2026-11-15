//! Guarded mutation uses real source-admin authorization and exact parent calls.
use payer::{conditional_v2 as v2, execution_v1 as v1};
use soroban_sdk::{
    testutils::{Events as _, MockAuthInvoke},
    vec, xdr, Address, IntoVal, Symbol, TryFromVal, Vec,
};
#[path = "../../../conditional-v2-test-support.rs"]
mod support;
use support::{s, wallet, Terminal, World};

fn mutable_world(yes: Terminal, no: Terminal, prefix: Option<v1::PayoutRule>) -> World {
    World::new_with_mutable(yes, no, v2::ComparisonV2::AmountLt, 50, prefix, true)
}
fn threshold(w: &World, value: i128, revision: u64) -> v2::NodeChangeV2 {
    v2::NodeChangeV2::Condition(v2::ConditionMutationV2 {
        node_id: s(&w.env, "condition"),
        expected_revision: revision,
        threshold: value,
    })
}
fn pay(w: &World, id: &str, value: i128, revision: u64) -> v2::NodeChangeV2 {
    v2::NodeChangeV2::Pay(v1::PayMutation {
        node_id: s(&w.env, id),
        expected_revision: revision,
        recipient: None,
        payout_value: v1::MaybeAllocation::Present(v1::Allocation::Fixed(value)),
    })
}
fn split(w: &World, id: &str, revision: u64, recipient: &Address) -> v2::NodeChangeV2 {
    v2::NodeChangeV2::Split(v1::SplitMutation {
        node_id: s(&w.env, id),
        expected_revision: revision,
        rows: vec![
            &w.env,
            v1::RowInput {
                row_id: s(&w.env, "worker"),
                recipient: Some(recipient.clone()),
                allocation: v1::MaybeAllocation::Missing,
            },
        ],
        additional: None,
    })
}
fn current_bindings(w: &World) -> Vec<v2::GraphBindingV2> {
    let mut bindings = w.bindings();
    for i in 0..bindings.len() {
        let mut binding = bindings.get(i).unwrap();
        binding.expected_revision = w.status(&binding.contract_address).state.revision;
        bindings.set(i, binding);
    }
    bindings
}
fn auth_tree(
    w: &World,
    address: &Address,
    context: &v2::MutationContextV2,
) -> xdr::SorobanAuthorizedInvocation {
    let entry = w
        .manifest
        .nodes
        .get(v2::index(&w.env, &w.manifest, address))
        .unwrap();
    let root = *address == w.root;
    let args = if root {
        (&context.bindings, &context.changes).into_val(&w.env)
    } else {
        (context,).into_val(&w.env)
    };
    let mut invocation: xdr::SorobanAuthorizedInvocation = (&MockAuthInvoke {
        contract: address,
        fn_name: if root { "mutate_v2" } else { "mutate_step_v2" },
        args,
        sub_invokes: &[],
    })
        .into();
    fn descendants(
        w: &World,
        address: &Address,
        context: &v2::MutationContextV2,
    ) -> std::vec::Vec<xdr::SorobanAuthorizedInvocation> {
        let state = w
            .manifest
            .nodes
            .get(v2::index(&w.env, &w.manifest, address))
            .unwrap()
            .state;
        if context.changes.iter().any(|change| match change {
            v2::NodeChangeV2::Pay(v) => v.node_id == state.node_id,
            v2::NodeChangeV2::Split(v) => v.node_id == state.node_id,
            v2::NodeChangeV2::Condition(v) => v.node_id == state.node_id,
        }) {
            std::vec![auth_tree(w, address, context)]
        } else {
            state
                .next_steps
                .iter()
                .flat_map(|child| descendants(w, &child, context))
                .collect()
        }
    }
    invocation.sub_invocations = entry
        .state
        .next_steps
        .iter()
        .flat_map(|next| descendants(w, &next, context))
        .collect::<std::vec::Vec<_>>()
        .try_into()
        .unwrap();
    invocation
}
fn authorize(w: &World, context: &v2::MutationContextV2, source: &Address, omit_last: bool) {
    let xdr::ScAddress::Account(account) = xdr::ScAddress::from(source) else {
        panic!()
    };
    w.env.host().set_source_account(account).unwrap();
    let mut invocation = auth_tree(w, &w.root, context);
    if omit_last {
        // Remove the False terminal's admin approval, leaving all earlier approvals.
        fn omit(
            mut invocation: xdr::SorobanAuthorizedInvocation,
        ) -> xdr::SorobanAuthorizedInvocation {
            let mut children = invocation.sub_invocations.to_vec();
            if children.len() == 1 {
                let child = children.pop().unwrap();
                if !child.sub_invocations.is_empty() {
                    children.push(omit(child));
                }
            } else {
                children.pop();
            }
            invocation.sub_invocations = children.try_into().unwrap();
            invocation
        }
        invocation = omit(invocation);
    }
    w.env.set_auths(&[xdr::SorobanAuthorizationEntry {
        credentials: xdr::SorobanCredentials::SourceAccount,
        root_invocation: invocation,
    }]);
}
fn mutate_with(
    w: &World,
    bindings: Vec<v2::GraphBindingV2>,
    changes: Vec<v2::NodeChangeV2>,
    omit_last: bool,
    source: &Address,
) -> bool {
    let context = v2::MutationContextV2 {
        root: w.root.clone(),
        admin: w.admin.clone(),
        bindings,
        changes,
    };
    authorize(w, &context, source, omit_last);
    w.env.cost_estimate().budget().reset_default();
    let result = w.env.try_invoke_contract::<(), soroban_sdk::Error>(
        &w.root,
        &Symbol::new(&w.env, "mutate_v2"),
        (&context.bindings, &context.changes).into_val(&w.env),
    );

    result.is_ok()
}
fn mutate(w: &World, changes: Vec<v2::NodeChangeV2>) -> bool {
    mutate_with(w, current_bindings(w), changes, false, &w.admin)
}
fn execute_current(
    w: &World,
    amount: i128,
    nonce: u8,
    truth: bool,
    condition_amount: i128,
) -> bool {
    let route = v2::RouteV2 {
        selected_branch: if truth {
            v2::BranchV2::True
        } else {
            v2::BranchV2::False
        },
        amount_at_condition: condition_amount,
    };
    let args = w.args(
        amount,
        nonce,
        100,
        &current_bindings(w),
        &w.inputs(&route),
        &route,
    );
    w.authorize(amount, args.clone());
    w.try_args(args)
}

#[test]
fn grouped_mutation_preserves_initials_and_moves_no_funds_with_full_events() {
    let w = mutable_world(
        Terminal::FixedSplit,
        Terminal::FixedSplit,
        Some(v1::PayoutRule::Fixed(10)),
    );
    let other = wallet(&w.env, 9);
    for entry in w.manifest.nodes.iter() {
        w.mint(&entry.state.contract_address, 77);
    }
    let changes = vec![
        &w.env,
        pay(&w, "prefix", 11, 0),
        threshold(&w, 200, 0),
        split(&w, "yes", 0, &other),
        split(&w, "no", 0, &other),
    ];
    assert!(mutate(&w, changes));
    let events = w.env.events().all();
    assert_eq!(events.events().len(), 4);
    for event in events.events() {
        let xdr::ContractEventBody::V0(body) = &event.body;
        assert_eq!(
            body.topics[0],
            xdr::ScVal::Symbol("config_v2".try_into().unwrap())
        );
        let state = v2::NodeStateV2::try_from_val(&w.env, &body.data).unwrap();
        assert_eq!(state.revision, 1);
    }
    for (i, entry) in w.manifest.nodes.iter().enumerate() {
        assert_eq!(w.balance(&entry.state.contract_address), 77);
        assert_eq!(
            w.status(&entry.state.contract_address).state.revision,
            if i == 0 { 0 } else { 1 }
        );
        let initial: v2::NodeStateV2 = w.env.invoke_contract(
            &entry.state.contract_address,
            &Symbol::new(&w.env, "initial_config_v2"),
            Vec::new(&w.env),
        );
        assert_eq!(initial, entry.state);
    }
    assert_eq!(w.balance(&w.payer), i128::MAX);
    assert_eq!(w.balance(&w.admin), 0);
    assert!(!w.execute(110, 1)); // Old complete bindings fail before payer debit.
    assert!(execute_current(&w, 111, 1, true, 100));
    assert_eq!(w.balance(&other), 90);
    assert_eq!(w.balance(&w.platform), 21);
}

#[test]
fn missing_late_child_admin_auth_rolls_back_the_whole_group() {
    let w = mutable_world(
        Terminal::FixedSplit,
        Terminal::FixedSplit,
        Some(v1::PayoutRule::Fixed(10)),
    );
    let changes = vec![
        &w.env,
        pay(&w, "prefix", 11, 0),
        threshold(&w, 60, 0),
        split(&w, "no", 0, &w.admin),
    ];
    assert!(!mutate_with(&w, w.bindings(), changes, true, &w.admin));
    for entry in w.manifest.nodes.iter() {
        assert_eq!(w.status(&entry.state.contract_address).state, entry.state);
    }
    assert_eq!(w.balance(&w.payer), i128::MAX);
}

#[test]
fn inactive_branch_debt_and_raw_zero_block_all_changes_until_actual_settlement() {
    let w = mutable_world(Terminal::FixedSplit, Terminal::Return, None);
    assert!(w.execute(40, 1));
    assert_eq!(w.status(&w.yes).obligations, 40);
    // A higher payment now selects False, but admission still includes True debt.
    assert!(!mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
    w.env.mock_all_auths();
    soroban_sdk::token::Client::new(&w.env, &w.asset).transfer(&w.yes, &w.platform, &40);
    assert_eq!(w.balance(&w.yes), 0);
    assert_eq!(w.status(&w.yes).obligations, 40);
    assert!(!mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
    w.mint(&w.yes, 40);
    assert!(!mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
    assert!(w.execute(20, 2));
    assert_eq!(w.status(&w.yes).obligations, 60);
    assert!(w.execute(40, 3));
    assert_eq!(w.status(&w.yes).obligations, 0);
    w.mint(&w.yes, 77);
    assert!(mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
    assert_eq!(w.balance(&w.yes), 77);
    assert!(!w.execute(100, 4));
    assert_eq!(w.balance(&w.payer), i128::MAX - 100);
    assert!(execute_current(&w, 100, 4, false, 100));
    assert_eq!(w.balance(&w.admin), 100);
}

#[test]
fn threshold_zero_max_and_strict_equality_survive_updates_and_nonce_reuse() {
    for value in [0, i128::MAX] {
        let w = mutable_world(Terminal::Return, Terminal::Pay, None);
        assert!(mutate(&w, vec![&w.env, threshold(&w, value, 0)]));
        // The old preparation fails without consuming nonce1 or funds.
        assert!(!w.execute(50, 1));
        let amount = if value == 0 { 1 } else { i128::MAX };
        assert!(execute_current(&w, amount, 1, false, amount));
        assert_eq!(w.balance(&w.worker), amount);
        assert_eq!(w.balance(&w.admin), 0);
    }
}

#[test]
fn constant_threshold_and_constant_pay_cannot_be_changed() {
    let w = World::new_configured(
        Terminal::FixedPay,
        Terminal::Return,
        v2::ComparisonV2::AmountLt,
        50,
        None,
        false,
        |_, graph| {
            let i = v2::condition_index(graph);
            let mut entry = graph.nodes.get(i).unwrap();
            if let v2::NodeConfigurationV2::Condition(ref mut c) = entry.state.configuration {
                c.threshold_mode = v2::StoredModeV2::Constant;
            }
            graph.nodes.set(i, entry);
        },
    );
    assert!(!mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
    assert!(!mutate(&w, vec![&w.env, pay(&w, "yes", 41, 0)]));
    assert_eq!(w.status(&w.condition).state.revision, 0);
}

#[test]
fn malformed_empty_duplicate_unordered_unknown_irrelevant_and_noop_groups_reject() {
    let w = mutable_world(
        Terminal::FixedSplit,
        Terminal::Return,
        Some(v1::PayoutRule::Fixed(10)),
    );
    let groups = [
        Vec::new(&w.env),
        vec![&w.env, threshold(&w, 60, 0), threshold(&w, 70, 0)],
        vec![&w.env, threshold(&w, 60, 0), pay(&w, "prefix", 11, 0)],
        vec![&w.env, pay(&w, "unknown", 10, 0)],
        vec![&w.env, pay(&w, "root", 10, 0)],
        vec![&w.env, pay(&w, "no", 10, 0)],
        vec![&w.env, threshold(&w, 50, 0)],
        vec![&w.env, pay(&w, "prefix", 10, 0)],
        vec![&w.env, threshold(&w, -1, 0)],
    ];
    for changes in groups {
        assert!(!mutate(&w, changes));
    }
    for entry in w.manifest.nodes.iter() {
        assert_eq!(w.status(&entry.state.contract_address).state.revision, 0);
    }
}

#[test]
fn late_invalid_split_and_prefix_full_percentage_refuse_without_partial_changes() {
    let w = mutable_world(
        Terminal::FixedSplit,
        Terminal::FixedSplit,
        Some(v1::PayoutRule::Percentage(1000)),
    );
    let prefix = v2::NodeChangeV2::Pay(v1::PayMutation {
        node_id: s(&w.env, "prefix"),
        expected_revision: 0,
        recipient: None,
        payout_value: v1::MaybeAllocation::Present(v1::Allocation::Percentage(10000)),
    });
    assert!(!mutate(&w, vec![&w.env, prefix, threshold(&w, 60, 0)]));
    let invalid = split(&w, "no", 0, &w.platform); // Duplicate configured recipient.
    assert!(!mutate(&w, vec![&w.env, threshold(&w, 60, 0), invalid]));
    assert_eq!(w.status(&w.condition).state.revision, 0);
}

#[test]
fn revisions_advance_once_and_stale_or_overflow_groups_refuse_atomically() {
    let w = mutable_world(Terminal::Return, Terminal::Return, None);
    assert!(mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
    assert!(!mutate_with(
        &w,
        w.bindings(),
        vec![&w.env, threshold(&w, 70, 0)],
        false,
        &w.admin
    ));
    assert!(mutate(&w, vec![&w.env, threshold(&w, 70, 1)]));
    assert_eq!(w.status(&w.condition).state.revision, 2);
    w.env.as_contract(&w.condition, || {
        let mut current = v2::current(&w.env);
        current.revision = u64::MAX;
        w.env
            .storage()
            .instance()
            .set(&v2::V2Key::Current, &current);
    });
    assert!(!mutate(&w, vec![&w.env, threshold(&w, 80, u64::MAX)]));
    assert_eq!(w.status(&w.condition).state.revision, u64::MAX);
}

#[test]
fn wrong_admin_and_direct_child_calls_cannot_bypass_whole_graph_admission() {
    let w = mutable_world(Terminal::Return, Terminal::Return, None);
    let changes = vec![&w.env, threshold(&w, 60, 0)];
    assert!(!mutate_with(
        &w,
        w.bindings(),
        changes.clone(),
        false,
        &w.payer
    ));
    let context = v2::MutationContextV2 {
        root: w.root.clone(),
        admin: w.admin.clone(),
        bindings: w.bindings(),
        changes,
    };
    authorize(&w, &context, &w.admin, false);
    assert!(w
        .env
        .try_invoke_contract::<(), soroban_sdk::Error>(
            &w.condition,
            &Symbol::new(&w.env, "mutate_step_v2"),
            (context,).into_val(&w.env)
        )
        .is_err());
    assert_eq!(w.status(&w.condition).state.revision, 0);
}

#[test]
fn forged_binding_manifest_or_current_constants_fail_closed() {
    for attack in 0..7 {
        let w = mutable_world(
            Terminal::FixedSplit,
            Terminal::Return,
            Some(v1::PayoutRule::Fixed(10)),
        );
        let mut bindings = w.bindings();
        match attack {
            0 => {
                bindings.pop_back();
            }
            1 => {
                let mut b = bindings.get(3).unwrap();
                b.expected_revision = 1;
                bindings.set(3, b);
            }
            2 => {
                let mut b = bindings.get(3).unwrap();
                b.wasm_hash = soroban_sdk::BytesN::from_array(&w.env, &[99; 32]);
                bindings.set(3, b);
            }
            3 => w.env.as_contract(&w.no, || {
                let mut x = v2::current(&w.env);
                x.parent = Some(w.root.clone());
                w.env.storage().instance().set(&v2::V2Key::Current, &x);
            }),
            4 => w.env.as_contract(&w.no, || {
                let mut x = v2::current(&w.env);
                if let v2::NodeConfigurationV2::ReturnToOwner(ref mut value) = x.configuration {
                    value.recipient = w.payer.clone();
                }
                w.env.storage().instance().set(&v2::V2Key::Current, &x);
            }),
            5 => w.env.as_contract(&w.yes, || {
                let mut x = v2::current(&w.env);
                if let v2::NodeConfigurationV2::Split(ref mut value) = x.configuration {
                    let mut row = value.policy.rows.get(0).unwrap();
                    row.row_id = s(&w.env, "renamed");
                    value.policy.rows.set(0, row);
                }
                w.env.storage().instance().set(&v2::V2Key::Current, &x);
            }),
            _ => w.env.as_contract(&w.no, || {
                let mut x = v2::manifest(&w.env);
                x.admin = w.payer.clone();
                w.env.storage().instance().set(&v2::V2Key::Manifest, &x);
            }),
        }
        assert!(!mutate_with(
            &w,
            bindings,
            vec![&w.env, threshold(&w, 60, 0)],
            false,
            &w.admin
        ));
        assert_eq!(w.status(&w.condition).state.revision, 0);
        assert_eq!(w.balance(&w.payer), i128::MAX);
    }
}

#[test]
fn immutable_nodes_cannot_acquire_revisions_even_with_matching_bindings() {
    for address_kind in 0..3 {
        let w = World::new(
            Terminal::FixedPay,
            Terminal::Return,
            v2::ComparisonV2::AmountLt,
            50,
            None,
        );
        let address = match address_kind {
            0 => &w.root,
            1 => &w.yes,
            _ => &w.no,
        };
        w.env.as_contract(address, || {
            let mut state = v2::current(&w.env);
            state.revision = 1;
            w.env.storage().instance().set(&v2::V2Key::Current, &state);
        });
        assert!(!mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
        assert!(!w.execute(100, 1));
        assert_eq!(w.balance(&w.payer), i128::MAX);
    }
}

#[test]
fn child_only_and_root_only_admin_entries_cannot_authorize_the_group() {
    for child_only in [false, true] {
        let w = mutable_world(Terminal::Return, Terminal::Return, None);
        let context = v2::MutationContextV2 {
            root: w.root.clone(),
            admin: w.admin.clone(),
            bindings: w.bindings(),
            changes: vec![&w.env, threshold(&w, 60, 0)],
        };
        let xdr::ScAddress::Account(account) = xdr::ScAddress::from(&w.admin) else {
            panic!()
        };
        w.env.host().set_source_account(account).unwrap();
        let mut invocation = auth_tree(
            &w,
            if child_only { &w.condition } else { &w.root },
            &context,
        );
        invocation.sub_invocations = std::vec::Vec::new().try_into().unwrap();
        w.env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: invocation,
        }]);
        assert!(w
            .env
            .try_invoke_contract::<(), soroban_sdk::Error>(
                &w.root,
                &Symbol::new(&w.env, "mutate_v2"),
                (&context.bindings, &context.changes).into_val(&w.env)
            )
            .is_err());
        assert_eq!(w.status(&w.condition).state.revision, 0);
    }
}

#[test]
fn explicit_empty_mutable_roster_is_a_value_and_absence_does_not_erase_it() {
    let w = mutable_world(Terminal::FixedSplit, Terminal::Return, None);
    let appended = vec![
        &w.env,
        v1::AdditionalRow {
            row_id: s(&w.env, "appended"),
            recipient: wallet(&w.env, 9),
            allocation: v1::Allocation::Fixed(10),
        },
    ];
    let patch = |revision, additional| {
        v2::NodeChangeV2::Split(v1::SplitMutation {
            node_id: s(&w.env, "yes"),
            expected_revision: revision,
            rows: Vec::new(&w.env),
            additional,
        })
    };
    assert!(mutate(&w, vec![&w.env, patch(0, Some(appended.clone()))]));
    assert!(!mutate(&w, vec![&w.env, patch(1, None)]));
    if let v2::NodeConfigurationV2::Split(config) = w.status(&w.yes).state.configuration {
        assert_eq!(config.additional, appended);
    } else {
        panic!()
    }
    assert!(mutate(&w, vec![&w.env, patch(1, Some(Vec::new(&w.env)))]));
    assert_eq!(w.status(&w.yes).state.revision, 2);
    assert!(!mutate(&w, vec![&w.env, patch(2, Some(Vec::new(&w.env)))]));
}

#[test]
fn inactive_only_and_prefix_only_changes_each_invalidate_prepared_payments_before_debit() {
    for prefix_only in [false, true] {
        let w = mutable_world(
            Terminal::FixedSplit,
            Terminal::Return,
            Some(v1::PayoutRule::Fixed(10)),
        );
        let change = if prefix_only {
            pay(&w, "prefix", 11, 0)
        } else {
            split(&w, "yes", 0, &w.admin)
        };
        assert!(mutate(&w, vec![&w.env, change]));
        assert_eq!(w.status(&w.condition).state.revision, 0);
        assert_eq!(w.status(&w.no).state.revision, 0);
        assert!(!w.execute(110, 1));
        assert_eq!(w.balance(&w.payer), i128::MAX);
        assert_eq!(w.balance(&w.admin), 0);
        assert_eq!(w.balance(&w.platform), 0);
        let incoming = if prefix_only { 99 } else { 100 };
        assert!(execute_current(&w, 110, 1, false, incoming));
        assert_eq!(w.balance(&w.admin), incoming);
    }
}

#[test]
fn current_percentage_feasibility_preserves_execution_slots_after_recipient_mutation() {
    let w = World::new_configured(
        Terminal::RuntimeSplit,
        Terminal::Return,
        v2::ComparisonV2::AmountLt,
        50,
        None,
        true,
        |_, graph| {
            let i = v2::condition_index(graph) + 1;
            let mut entry = graph.nodes.get(i).unwrap();
            if let v2::NodeConfigurationV2::Split(ref mut split) = entry.state.configuration {
                split.policy.allocation_mode = v1::AllocationMode::Percentage;
                split.policy.additional_mode = v1::FieldMode::Constant;
                let mut known = split.policy.rows.get(0).unwrap();
                known.allocation_mode = v1::FieldMode::Constant;
                known.allocation = v1::MaybeAllocation::Present(v1::Allocation::Percentage(9999));
                split.policy.rows.set(0, known);
                let mut runtime = split.policy.rows.get(1).unwrap();
                runtime.allocation_mode = v1::FieldMode::Execution;
                runtime.allocation = v1::MaybeAllocation::Missing;
                split.policy.rows.set(1, runtime);
            }
            graph.nodes.set(i, entry);
        },
    );
    let patch = v2::NodeChangeV2::Split(v1::SplitMutation {
        node_id: s(&w.env, "yes"),
        expected_revision: 0,
        rows: vec![
            &w.env,
            v1::RowInput {
                row_id: s(&w.env, "platform"),
                recipient: Some(w.admin.clone()),
                allocation: v1::MaybeAllocation::Missing,
            },
        ],
        additional: None,
    });
    assert!(mutate(&w, vec![&w.env, patch]));
    let inputs = vec![
        &w.env,
        v1::NodeInput::Split(v1::SplitInput {
            node_id: s(&w.env, "yes"),
            rows: vec![
                &w.env,
                v1::RowInput {
                    row_id: s(&w.env, "worker"),
                    recipient: Some(w.worker.clone()),
                    allocation: v1::MaybeAllocation::Present(v1::Allocation::Percentage(1)),
                },
            ],
            additional: None,
        }),
    ];
    let args = w.args(40, 1, 100, &current_bindings(&w), &inputs, &w.route(40));
    w.authorize(40, args.clone());
    assert!(w.try_args(args));
    assert_eq!(w.balance(&w.admin), 39);
    assert_eq!(w.balance(&w.worker), 1);
    // Even a forged current configuration cannot consume the final required slot.
    w.env.as_contract(&w.yes, || {
        let mut state = v2::current(&w.env);
        if let v2::NodeConfigurationV2::Split(ref mut split) = state.configuration {
            let mut row = split.policy.rows.get(0).unwrap();
            row.allocation = v1::MaybeAllocation::Present(v1::Allocation::Percentage(10000));
            split.policy.rows.set(0, row);
        }
        w.env.storage().instance().set(&v2::V2Key::Current, &state);
    });
    assert!(!mutate(&w, vec![&w.env, threshold(&w, 60, 0)]));
    let args = w.args(40, 2, 100, &current_bindings(&w), &inputs, &w.route(40));
    w.authorize(40, args.clone());
    assert!(!w.try_args(args));
    assert_eq!(w.balance(&w.payer), i128::MAX - 40);
}

#[test]
fn reversed_partial_row_patches_preserve_configured_order_and_duplicates_refuse() {
    let w = mutable_world(Terminal::FixedSplit, Terminal::Return, None);
    let row = |id, amount| v1::RowInput {
        row_id: s(&w.env, id),
        recipient: None,
        allocation: v1::MaybeAllocation::Present(v1::Allocation::Fixed(amount)),
    };
    let patch = |rows| {
        v2::NodeChangeV2::Split(v1::SplitMutation {
            node_id: s(&w.env, "yes"),
            expected_revision: 0,
            rows,
            additional: None,
        })
    };
    assert!(!mutate(
        &w,
        vec![
            &w.env,
            patch(vec![&w.env, row("worker", 80), row("worker", 70)])
        ]
    ));
    assert!(mutate(
        &w,
        vec![
            &w.env,
            patch(vec![&w.env, row("worker", 80), row("platform", 20)])
        ]
    ));
    if let v2::NodeConfigurationV2::Split(config) = w.status(&w.yes).state.configuration {
        assert_eq!(
            config.policy.rows.get(0).unwrap().row_id,
            s(&w.env, "platform")
        );
        assert_eq!(
            config.policy.rows.get(1).unwrap().row_id,
            s(&w.env, "worker")
        );
    } else {
        panic!()
    }
    assert!(execute_current(&w, 40, 1, true, 40));
    assert_eq!(w.status(&w.yes).obligations, 40);
}

#[test]
fn mutable_percentage_pay_and_split_edits_preserve_rounding_and_reject_invalid_group() {
    let w = mutable_world(
        Terminal::Split,
        Terminal::Return,
        Some(v1::PayoutRule::Percentage(1000)),
    );
    let pay_patch = |bps| {
        v2::NodeChangeV2::Pay(v1::PayMutation {
            node_id: s(&w.env, "prefix"),
            expected_revision: 0,
            recipient: None,
            payout_value: v1::MaybeAllocation::Present(v1::Allocation::Percentage(bps)),
        })
    };
    let split_patch = |first, second| {
        v2::NodeChangeV2::Split(v1::SplitMutation {
            node_id: s(&w.env, "yes"),
            expected_revision: 0,
            rows: vec![
                &w.env,
                v1::RowInput {
                    row_id: s(&w.env, "worker"),
                    recipient: None,
                    allocation: v1::MaybeAllocation::Present(v1::Allocation::Percentage(second)),
                },
                v1::RowInput {
                    row_id: s(&w.env, "platform"),
                    recipient: None,
                    allocation: v1::MaybeAllocation::Present(v1::Allocation::Percentage(first)),
                },
            ],
            additional: None,
        })
    };
    for changes in [
        vec![&w.env, pay_patch(2000), split_patch(4444, 6667)],
        vec![&w.env, pay_patch(0)],
        vec![&w.env, pay_patch(10001)],
    ] {
        assert!(!mutate(&w, changes));
        assert_eq!(w.env.events().all().events().len(), 0);
        assert_eq!(w.status(w.prefix.as_ref().unwrap()).state.revision, 0);
        assert_eq!(w.status(&w.yes).state.revision, 0);
        assert_eq!(w.balance(&w.payer), i128::MAX);
        assert_eq!(w.balance(&w.platform), 0);
        assert_eq!(w.balance(&w.worker), 0);
    }
    assert!(mutate(
        &w,
        vec![&w.env, pay_patch(2000), split_patch(3333, 6667)]
    ));
    assert_eq!(w.status(w.prefix.as_ref().unwrap()).state.revision, 1);
    assert_eq!(w.status(&w.yes).state.revision, 1);
    assert_eq!(w.status(&w.condition).state.revision, 0);
    assert!(!w.execute(41, 1));
    assert_eq!(w.balance(&w.payer), i128::MAX);
    assert!(execute_current(&w, 41, 1, true, 33));
    assert_eq!(w.balance(&w.platform), 18);
    assert_eq!(w.balance(&w.worker), 23);
    assert_eq!(w.balance(&w.payer), i128::MAX - 41);
    for entry in w.manifest.nodes.iter() {
        assert_eq!(w.balance(&entry.state.contract_address), 0);
    }
}
