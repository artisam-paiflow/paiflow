use deposit_trigger::{execution_v1 as abi, DepositTrigger, DepositTriggerClient};
use paiflow_splitter::{execution_v1 as split, Splitter, SplitterClient};
use payer::{execution_v1 as pay, Payer, PayerClient, WorkflowTarget};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _, MockAuthInvoke},
    token, vec, xdr, Address, BytesN, Env, IntoVal, String, TryFromVal, Val, Vec,
};
#[path = "../../../payment-test-token.rs"]
mod payment_test_token;
fn s(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}
fn wallet(env: &Env, byte: u8) -> Address {
    Address::try_from_val(
        env,
        &xdr::ScVal::Address(xdr::ScAddress::Account(xdr::AccountId(
            xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256([byte; 32])),
        ))),
    )
    .unwrap()
}
struct World {
    env: Env,
    admin: Address,
    root: Address,
    pay: Address,
    split: Address,
    asset: Address,
    payer: Address,
    platform: Address,
    worker: Address,
    other: Address,
}
impl World {
    fn new(fixed: bool, wasm: bool) -> Self {
        Self::build(fixed, wasm, false, false)
    }
    fn build(fixed: bool, wasm: bool, configured: bool, percentage: bool) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(10);
        let admin = wallet(&env, 1);
        let payer = wallet(&env, 2);
        let platform = wallet(&env, 3);
        let worker = wallet(&env, 4);
        let other = wallet(&env, 5);
        let root = Address::generate(&env);
        let pay = Address::generate(&env);
        let split = Address::generate(&env);
        let asset = env.register(payment_test_token::WideToken, ());
        payment_test_token::WideTokenClient::new(&env, &asset).mint(&payer, &100_000);
        let mut initial = split::StoredSplitConfig {
            policy: split::SplitConfig {
                version: 1,
                node_id: s(&env, "split"),
                allocation_mode: if fixed {
                    split::AllocationMode::Fixed
                } else {
                    split::AllocationMode::Percentage
                },
                rows: vec![
                    &env,
                    split::ConfiguredRow {
                        row_id: s(&env, "platform"),
                        recipient_mode: split::FieldMode::Constant,
                        allocation_mode: split::FieldMode::Constant,
                        recipient: Some(platform.clone()),
                        allocation: split::MaybeAllocation::Present(if fixed {
                            split::Allocation::Fixed(15)
                        } else {
                            split::Allocation::Percentage(1500)
                        }),
                    },
                ],
                additional_mode: split::FieldMode::Mutable,
            },
            additional: vec![
                &env,
                split::AdditionalRow {
                    row_id: s(&env, "worker"),
                    recipient: worker.clone(),
                    allocation: if fixed {
                        split::Allocation::Fixed(85)
                    } else {
                        split::Allocation::Percentage(8500)
                    },
                },
            ],
        };
        if configured {
            let row = initial.additional.first().unwrap();
            initial.policy.rows.push_back(split::ConfiguredRow {
                row_id: row.row_id,
                recipient_mode: split::FieldMode::Mutable,
                allocation_mode: split::FieldMode::Mutable,
                recipient: Some(row.recipient),
                allocation: split::MaybeAllocation::Present(row.allocation),
            });
            initial.additional = Vec::new(&env);
            initial.policy.additional_mode = split::FieldMode::Constant;
        }
        let config: Val = initial.into_val(&env);
        let args = (
            &admin,
            &asset,
            config,
            0i128,
            &pay,
            Vec::<paiflow_splitter::WorkflowTarget>::new(&env),
        );
        if wasm {
            let bytes =
                std::fs::read("../../target/wasm32v1-none/release/paiflow_splitter.wasm").unwrap();
            env.register_at(&split, bytes.as_slice(), args);
        } else {
            env.register_at(&split, Splitter, args);
        }
        let config: Val = pay::PayConfig {
            version: 1,
            node_id: s(&env, "fee"),
            recipient_mode: pay::FieldMode::Mutable,
            payout_value_mode: pay::FieldMode::Mutable,
            recipient: Some(platform.clone()),
            payout_rule: if percentage {
                pay::PayoutRule::Percentage(1000)
            } else {
                pay::PayoutRule::Fixed(10)
            },
        }
        .into_val(&env);
        let args = (
            &admin,
            &asset,
            config,
            if percentage { 0i128 } else { 10i128 },
            if percentage { 1000u32 } else { 0u32 },
            vec![
                &env,
                WorkflowTarget {
                    address: split.clone(),
                    data: s(&env, ""),
                },
            ],
            &root,
        );
        if wasm {
            let bytes = std::fs::read("../../target/wasm32v1-none/release/payer.wasm").unwrap();
            env.register_at(&pay, bytes.as_slice(), args);
        } else {
            env.register_at(&pay, Payer, args);
        }
        let config: Val = abi::RootConfig {
            version: 1,
            node_id: s(&env, "root"),
            min_amount: 1,
            next_steps: vec![
                &env,
                abi::Target {
                    address: pay.clone(),
                    data: s(&env, ""),
                },
            ],
        }
        .into_val(&env);
        if wasm {
            let bytes =
                std::fs::read("../../target/wasm32v1-none/release/deposit_trigger.wasm").unwrap();
            env.register_at(&root, bytes.as_slice(), (&admin, &asset, config));
        } else {
            env.register_at(&root, DepositTrigger, (&admin, &asset, config));
        }
        Self {
            env,
            admin,
            root,
            pay,
            split,
            asset,
            payer,
            platform,
            worker,
            other,
        }
    }
    fn bindings(&self) -> Vec<abi::Binding> {
        vec![
            &self.env,
            abi::Binding {
                node_id: s(&self.env, "root"),
                contract_address: self.root.clone(),
                expected_revision: 0,
            },
            abi::Binding {
                node_id: s(&self.env, "fee"),
                contract_address: self.pay.clone(),
                expected_revision: PayerClient::new(&self.env, &self.pay).config_revision(),
            },
            abi::Binding {
                node_id: s(&self.env, "split"),
                contract_address: self.split.clone(),
                expected_revision: SplitterClient::new(&self.env, &self.split).config_revision(),
            },
        ]
    }
    fn changes(&self, fixed: bool) -> Vec<abi::NodeMutation> {
        vec![
            &self.env,
            abi::NodeMutation::Pay(abi::PayMutation {
                node_id: s(&self.env, "fee"),
                expected_revision: PayerClient::new(&self.env, &self.pay).config_revision(),
                recipient: Some(self.other.clone()),
                payout_value: abi::MaybeAllocation::Present(abi::Allocation::Fixed(20)),
            }),
            abi::NodeMutation::Split(abi::SplitMutation {
                node_id: s(&self.env, "split"),
                expected_revision: SplitterClient::new(&self.env, &self.split).config_revision(),
                rows: Vec::new(&self.env),
                additional: Some(vec![
                    &self.env,
                    abi::AdditionalRow {
                        row_id: s(&self.env, "replacement"),
                        recipient: self.other.clone(),
                        allocation: if fixed {
                            abi::Allocation::Fixed(85)
                        } else {
                            abi::Allocation::Percentage(8500)
                        },
                    },
                ]),
            }),
        ]
    }
    fn execute(&self, amount: i128, nonce: u8, bindings: &Vec<abi::Binding>) {
        DepositTriggerClient::new(&self.env, &self.root).execute_v1(
            &self.payer,
            &self.asset,
            &amount,
            &BytesN::from_array(&self.env, &[nonce; 32]),
            &100,
            bindings,
            &Vec::new(&self.env),
        );
    }
    fn balance(&self, addr: &Address) -> i128 {
        token::Client::new(&self.env, &self.asset).balance(addr)
    }
    fn authorize(
        &self,
        bindings: &Vec<abi::Binding>,
        changes: &Vec<abi::NodeMutation>,
        children: bool,
    ) {
        let context = abi::MutationContext {
            root: self.root.clone(),
            admin: self.admin.clone(),
            asset: self.asset.clone(),
            bindings: bindings.clone(),
            changes: changes.clone(),
            index: 1,
        };
        let mut terminal = context.clone();
        terminal.index = 2;
        let split_auth = [MockAuthInvoke {
            contract: &self.split,
            fn_name: "mutate_step_v1",
            args: (terminal,).into_val(&self.env),
            sub_invokes: &[],
        }];
        let pay_auth = [MockAuthInvoke {
            contract: &self.pay,
            fn_name: "mutate_step_v1",
            args: (context,).into_val(&self.env),
            sub_invokes: &split_auth,
        }];
        let account: xdr::ScAddress = (&self.admin).into();
        let xdr::ScAddress::Account(account) = account else {
            panic!("wallet")
        };
        self.env.host().set_source_account(account).unwrap();
        self.env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: (&MockAuthInvoke {
                contract: &self.root,
                fn_name: "mutate_v1",
                args: (bindings, changes).into_val(&self.env),
                sub_invokes: if !children {
                    &[]
                } else if changes
                    .iter()
                    .any(|change| matches!(change, abi::NodeMutation::Pay(_)))
                {
                    &pay_auth
                } else {
                    &split_auth
                },
            })
                .into(),
        }]);
    }
}
#[test]
fn exact_admin_tree_is_required_and_initial_evidence_is_immutable() {
    let w = World::new(false, false);
    let bindings = w.bindings();
    let changes = w.changes(false);
    let root = DepositTriggerClient::new(&w.env, &w.root);
    w.env.set_auths(&[]);
    assert!(root.try_mutate_v1(&bindings, &changes).is_err());
    w.authorize(&bindings, &changes, false);
    assert!(root.try_mutate_v1(&bindings, &changes).is_err());
    w.authorize(&bindings, &changes, true);
    root.mutate_v1(&bindings, &changes);
    let auths = w.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, w.admin);
    let p = PayerClient::new(&w.env, &w.pay);
    let split = SplitterClient::new(&w.env, &w.split);
    assert_eq!(p.config_revision(), 1);
    assert_eq!(split.config_revision(), 1);
    assert_eq!(p.field_policy().recipient, Some(w.platform));
    assert_eq!(p.field_policy().payout_rule, pay::PayoutRule::Fixed(10));
    assert_eq!(p.current_config().policy.recipient, Some(w.other.clone()));
    assert_eq!(p.configured_amount(), 20);
    assert_eq!(
        split.initial_config().additional.first().unwrap().recipient,
        w.worker
    );
    assert_eq!(
        split.current_config().additional.first().unwrap().recipient,
        w.other
    );
}
#[test]
fn events_expose_revision_and_constants_survive_group_update() {
    let w = World::new(false, false);
    DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&w.bindings(), &w.changes(false));
    let events = w.env.events().all();
    assert_eq!(events.events().len(), 2);
    for event in events.events() {
        let xdr::ContractEventBody::V0(body) = &event.body;
        assert_eq!(
            body.topics[0],
            xdr::ScVal::Symbol("config_v1".try_into().unwrap())
        );
        let xdr::ScVal::Map(Some(data)) = &body.data else {
            panic!("configuration event map")
        };
        assert!(data.iter().any(|entry| entry.key
            == xdr::ScVal::Symbol("revision".try_into().unwrap())
            && entry.val == xdr::ScVal::U64(1)));
        assert!(data
            .iter()
            .any(|entry| entry.key == xdr::ScVal::Symbol("policy".try_into().unwrap())));
    }
    let split = SplitterClient::new(&w.env, &w.split);
    assert_eq!(
        split.field_policy().rows.first().unwrap().recipient,
        Some(w.platform)
    );
    assert_eq!(split.current_config().revision, 1);
}
#[test]
fn accounted_obligations_block_downstream_and_upstream_updates_even_at_zero_balance() {
    let w = World::new(true, false);
    w.execute(60, 1, &w.bindings());
    assert_eq!(
        SplitterClient::new(&w.env, &w.split).accumulated_balance(),
        50
    );
    w.env.as_contract(&w.split, || {
        token::Client::new(&w.env, &w.asset).transfer(&w.split, &w.other, &50)
    });
    assert_eq!(w.balance(&w.split), 0);
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_mutate_v1(&w.bindings(), &w.changes(true))
        .is_err());
    assert_eq!(PayerClient::new(&w.env, &w.pay).config_revision(), 0);
    assert_eq!(
        SplitterClient::new(&w.env, &w.split).accumulated_balance(),
        50
    );
}
#[test]
fn settled_obligations_allow_update_unsolicited_tokens_stay_and_old_signed_terms_fail() {
    let w = World::new(true, false);
    let old = w.bindings();
    w.execute(60, 1, &old);
    w.execute(60, 2, &old);
    assert_eq!(
        SplitterClient::new(&w.env, &w.split).accumulated_balance(),
        0
    );
    let token = payment_test_token::WideTokenClient::new(&w.env, &w.asset);
    for addr in [&w.root, &w.pay, &w.split] {
        token.mint(addr, &77);
    }
    DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&w.bindings(), &w.changes(true));
    let before = w.balance(&w.payer);
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_execute_v1(
            &w.payer,
            &w.asset,
            &120,
            &BytesN::from_array(&w.env, &[3; 32]),
            &100,
            &old,
            &Vec::new(&w.env)
        )
        .is_err());
    assert_eq!(w.balance(&w.payer), before);
    w.execute(120, 3, &w.bindings());
    for addr in [&w.root, &w.pay, &w.split] {
        assert_eq!(w.balance(addr), 77);
    }
}
#[test]
fn invalid_group_rolls_back_prior_node_and_constant_overrides_fail() {
    let w = World::new(false, false);
    let mut changes = w.changes(false);
    changes.set(
        1,
        abi::NodeMutation::Split(abi::SplitMutation {
            node_id: s(&w.env, "split"),
            expected_revision: 0,
            rows: vec![
                &w.env,
                abi::RowInput {
                    row_id: s(&w.env, "platform"),
                    recipient: Some(w.other.clone()),
                    allocation: abi::MaybeAllocation::Missing,
                },
            ],
            additional: None,
        }),
    );
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_mutate_v1(&w.bindings(), &changes)
        .is_err());
    assert_eq!(PayerClient::new(&w.env, &w.pay).configured_amount(), 10);
    assert_eq!(PayerClient::new(&w.env, &w.pay).config_revision(), 0);
}
#[test]
fn wrong_path_revision_duplicate_and_invalid_total_fail_atomically() {
    let w = World::new(false, false);
    let root = DepositTriggerClient::new(&w.env, &w.root);
    let mut bindings = w.bindings();
    let mut b = bindings.get(1).unwrap();
    b.expected_revision = 1;
    bindings.set(1, b);
    assert!(root.try_mutate_v1(&bindings, &w.changes(false)).is_err());
    let mut bindings = w.bindings();
    bindings.remove(1);
    assert!(root.try_mutate_v1(&bindings, &w.changes(false)).is_err());
    let change = w.changes(false).get(0).unwrap();
    assert!(root
        .try_mutate_v1(&w.bindings(), &vec![&w.env, change.clone(), change])
        .is_err());
    let mut changes = w.changes(false);
    changes.set(
        1,
        abi::NodeMutation::Split(abi::SplitMutation {
            node_id: s(&w.env, "split"),
            expected_revision: 0,
            rows: Vec::new(&w.env),
            additional: Some(Vec::new(&w.env)),
        }),
    );
    assert!(root.try_mutate_v1(&w.bindings(), &changes).is_err());
    assert_eq!(PayerClient::new(&w.env, &w.pay).config_revision(), 0);
}
#[test]
fn direct_child_and_legacy_setters_cannot_bypass_root_gate() {
    let w = World::new(false, false);
    let bindings = w.bindings();
    let changes = w.changes(false);
    w.env.set_auths(&[]);
    let bindingval: Val = bindings.into_val(&w.env);
    let changeval: Val = changes.into_val(&w.env);
    let context = pay::MutationContext {
        root: w.root.clone(),
        admin: w.admin.clone(),
        asset: w.asset.clone(),
        bindings: Vec::try_from_val(&w.env, &bindingval).unwrap(),
        changes: Vec::try_from_val(&w.env, &changeval).unwrap(),
        index: 1,
    };
    assert!(PayerClient::new(&w.env, &w.pay)
        .try_mutate_step_v1(&context)
        .is_err());
    assert!(PayerClient::new(&w.env, &w.pay)
        .try_set_next_steps(&Vec::new(&w.env))
        .is_err());
    assert!(SplitterClient::new(&w.env, &w.split)
        .try_set_next_steps(&Vec::new(&w.env))
        .is_err());
}
#[test]
fn roster_updates_preserve_platform_and_conserve_small_payments() {
    for amount in 21..=40 {
        let w = World::new(false, false);
        DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&w.bindings(), &w.changes(false));
        w.execute(amount, 1, &w.bindings());
        let remainder = amount - 20;
        assert_eq!(w.balance(&w.platform), remainder * 1500 / 10000);
        assert_eq!(w.balance(&w.other), amount - remainder * 1500 / 10000);
        for addr in [&w.root, &w.pay, &w.split] {
            assert_eq!(w.balance(addr), 0);
        }
    }
}
#[test]
fn revision_overflow_rolls_back_before_reassigning_funds() {
    let w = World::new(false, false);
    w.env.as_contract(&w.pay, || {
        w.env
            .storage()
            .instance()
            .set(&pay::PolicyKey::Revision, &u64::MAX)
    });
    let mut changes = w.changes(false);
    let mut p = match changes.get(0).unwrap() {
        abi::NodeMutation::Pay(p) => p,
        _ => panic!(),
    };
    p.expected_revision = u64::MAX;
    changes.set(0, abi::NodeMutation::Pay(p));
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_mutate_v1(&w.bindings(), &changes)
        .is_err());
    assert_eq!(PayerClient::new(&w.env, &w.pay).configured_amount(), 10);
}
#[test]
#[ignore = "requires locally built mutation release WASMs; no network"]
fn wasm_mutation_preserves_admin_auth_and_revision_binding() {
    for bounded in [true, false] {
        let w = World::new(false, true);
        let bindings = w.bindings();
        let changes = w.changes(false);
        w.authorize(&bindings, &changes, true);
        if bounded {
            // Observation only: keep real source-account authorization and default budget.
            // SDK v26 auth snapshot hooks can exhaust the separate debug shadow budget.
            w.env.host().set_invocation_hook(None).unwrap();
            w.env.cost_estimate().budget().reset_default();
        } else {
            w.env.cost_estimate().budget().reset_unlimited();
        }
        DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&bindings, &changes);
        let resources = w.env.cost_estimate().resources();
        std::println!("WASM guarded mutation (bounded={bounded}): {resources:?}");
        assert!(resources.instructions < 100_000_000);
        assert!(resources.mem_bytes < 40_000_000);
        if !bounded {
            assert_eq!(w.env.auths()[0].0, w.admin);
            assert!(resources.write_entries > 0);
        }
        assert_eq!(PayerClient::new(&w.env, &w.pay).config_revision(), 1);
        w.env.mock_all_auths();
        w.env.host().set_invocation_hook(None).unwrap();
        w.env.cost_estimate().budget().reset_default();
        w.execute(120, 1, &w.bindings());
        assert_eq!(w.balance(&w.other), 105);
        assert_eq!(w.balance(&w.platform), 15);
    }
}

#[test]
fn configured_mutable_rows_keep_identity_and_constant_allocations() {
    let w = World::build(false, false, true, false);
    let change = abi::NodeMutation::Split(abi::SplitMutation {
        node_id: s(&w.env, "split"),
        expected_revision: 0,
        rows: vec![
            &w.env,
            abi::RowInput {
                row_id: s(&w.env, "worker"),
                recipient: Some(w.other.clone()),
                allocation: abi::MaybeAllocation::Present(abi::Allocation::Percentage(8500)),
            },
        ],
        additional: None,
    });
    DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&w.bindings(), &vec![&w.env, change]);
    let current = SplitterClient::new(&w.env, &w.split).current_config();
    assert_eq!(
        current.policy.rows.get(0).unwrap().row_id,
        s(&w.env, "platform")
    );
    assert_eq!(
        current.policy.rows.get(1).unwrap().row_id,
        s(&w.env, "worker")
    );
    assert_eq!(
        current.policy.rows.get(1).unwrap().recipient,
        Some(w.other.clone())
    );
    assert!(current.additional.is_empty());
    w.execute(110, 1, &w.bindings());
    assert_eq!(w.balance(&w.other), 85);
    assert_eq!(w.balance(&w.platform), 25);
}
#[test]
fn percentage_pay_changes_same_payout_kind_only_and_uses_checked_rounding() {
    let w = World::build(false, false, false, true);
    let invalid = abi::NodeMutation::Pay(abi::PayMutation {
        node_id: s(&w.env, "fee"),
        expected_revision: 0,
        recipient: None,
        payout_value: abi::MaybeAllocation::Present(abi::Allocation::Fixed(10)),
    });
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_mutate_v1(&w.bindings(), &vec![&w.env, invalid])
        .is_err());
    let change = abi::NodeMutation::Pay(abi::PayMutation {
        node_id: s(&w.env, "fee"),
        expected_revision: 0,
        recipient: Some(w.other.clone()),
        payout_value: abi::MaybeAllocation::Present(abi::Allocation::Percentage(2500)),
    });
    DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&w.bindings(), &vec![&w.env, change]);
    w.execute(100, 1, &w.bindings());
    assert_eq!(w.balance(&w.other), 25);
    assert_eq!(w.balance(&w.platform), 11);
    assert_eq!(w.balance(&w.worker), 64);
}

#[test]
fn maximum_appended_roster_is_bounded_and_cannot_shadow_constant_rows() {
    let w = World::new(false, false);
    let mut additional = Vec::new(&w.env);
    for index in 0..19u8 {
        additional.push_back(abi::AdditionalRow {
            row_id: s(&w.env, &std::format!("w-{index}")),
            recipient: wallet(&w.env, 10 + index),
            allocation: abi::Allocation::Percentage(if index == 18 { 1300 } else { 400 }),
        });
    }
    let change = abi::NodeMutation::Split(abi::SplitMutation {
        node_id: s(&w.env, "split"),
        expected_revision: 0,
        rows: Vec::new(&w.env),
        additional: Some(additional.clone()),
    });
    DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&w.bindings(), &vec![&w.env, change]);
    assert_eq!(
        SplitterClient::new(&w.env, &w.split)
            .current_config()
            .additional
            .len(),
        19
    );
    additional.push_back(abi::AdditionalRow {
        row_id: s(&w.env, "excess"),
        recipient: wallet(&w.env, 40),
        allocation: abi::Allocation::Percentage(1),
    });
    let invalid = abi::NodeMutation::Split(abi::SplitMutation {
        node_id: s(&w.env, "split"),
        expected_revision: 1,
        rows: Vec::new(&w.env),
        additional: Some(additional),
    });
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_mutate_v1(&w.bindings(), &vec![&w.env, invalid])
        .is_err());
    assert_eq!(SplitterClient::new(&w.env, &w.split).config_revision(), 1);
}
#[test]
fn constructor_rejects_full_payout_mutability_and_malformed_wrappers() {
    let env = Env::default();
    let admin = wallet(&env, 1);
    let asset = Address::generate(&env);
    let parent = Address::generate(&env);
    let config: Val = pay::PayConfig {
        version: 1,
        node_id: s(&env, "pay"),
        recipient_mode: pay::FieldMode::Constant,
        payout_value_mode: pay::FieldMode::Mutable,
        recipient: Some(wallet(&env, 2)),
        payout_rule: pay::PayoutRule::Full,
    }
    .into_val(&env);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| env.register(
            Payer,
            (
                &admin,
                &asset,
                config,
                0i128,
                10000u32,
                Vec::<WorkflowTarget>::new(&env),
                &parent
            )
        )))
        .is_err()
    );
    let empty_policy: Val = soroban_sdk::Map::<soroban_sdk::Symbol, Val>::new(&env).into_val(&env);
    let empty_rows: Val = Vec::<Val>::new(&env).into_val(&env);
    let malformed: Val = soroban_sdk::map![
        &env,
        (soroban_sdk::Symbol::new(&env, "policy"), empty_policy),
        (soroban_sdk::Symbol::new(&env, "additional"), empty_rows)
    ]
    .into_val(&env);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| env.register(
            Splitter,
            (
                &admin,
                &asset,
                malformed,
                0i128,
                &parent,
                Vec::<paiflow_splitter::WorkflowTarget>::new(&env)
            )
        )))
        .is_err()
    );
}

#[test]
#[ignore = "manual compiled-WASM maximum roster resource profile; no network"]
fn wasm_maximum_stored_roster_resource_profile() {
    for bounded in [true, false] {
        let w = World::new(false, true);
        let mut additional = Vec::new(&w.env);
        for index in 0..19u8 {
            additional.push_back(abi::AdditionalRow {
                row_id: s(&w.env, &std::format!("w-{index}")),
                recipient: wallet(&w.env, 10 + index),
                allocation: abi::Allocation::Percentage(if index == 18 { 1300 } else { 400 }),
            });
        }
        let changes = vec![
            &w.env,
            abi::NodeMutation::Split(abi::SplitMutation {
                node_id: s(&w.env, "split"),
                expected_revision: 0,
                rows: Vec::new(&w.env),
                additional: Some(additional),
            }),
        ];
        let bindings = w.bindings();
        w.authorize(&bindings, &changes, true);
        if bounded {
            w.env.host().set_invocation_hook(None).unwrap();
            w.env.cost_estimate().budget().reset_default();
        } else {
            w.env.cost_estimate().budget().reset_unlimited();
        }
        DepositTriggerClient::new(&w.env, &w.root).mutate_v1(&bindings, &changes);
        let resources = w.env.cost_estimate().resources();
        std::println!("WASM maximum roster mutation (bounded={bounded}): {resources:?}");
        assert!(resources.instructions < 100_000_000);
        assert!(resources.mem_bytes < 40_000_000);
        if !bounded {
            assert_eq!(w.env.auths()[0].0, w.admin);
        }
        assert_eq!(
            SplitterClient::new(&w.env, &w.split)
                .current_config()
                .additional
                .len(),
            19
        );
    }
}

#[test]
fn legacy_or_unknown_upstream_accounting_is_never_assumed_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = wallet(&env, 1);
    let old = wallet(&env, 2);
    let new = wallet(&env, 3);
    let asset = Address::generate(&env);
    let root = Address::generate(&env);
    let action = Address::generate(&env);
    let legacy: Val = old.clone().into_val(&env);
    env.register_at(
        &action,
        Payer,
        (
            &admin,
            &asset,
            legacy,
            10i128,
            0u32,
            Vec::<WorkflowTarget>::new(&env),
            &root,
        ),
    );
    let config: Val = abi::RootConfig {
        version: 1,
        node_id: s(&env, "root"),
        min_amount: 0,
        next_steps: vec![
            &env,
            abi::Target {
                address: action.clone(),
                data: s(&env, ""),
            },
        ],
    }
    .into_val(&env);
    env.register_at(&root, DepositTrigger, (&admin, &asset, config));
    let bindings = vec![
        &env,
        abi::Binding {
            node_id: s(&env, "root"),
            contract_address: root.clone(),
            expected_revision: 0,
        },
        abi::Binding {
            node_id: s(&env, "legacy"),
            contract_address: action.clone(),
            expected_revision: 0,
        },
    ];
    let change = abi::NodeMutation::Pay(abi::PayMutation {
        node_id: s(&env, "legacy"),
        expected_revision: 0,
        recipient: Some(new),
        payout_value: abi::MaybeAllocation::Missing,
    });
    assert!(DepositTriggerClient::new(&env, &root)
        .try_mutate_v1(&bindings, &vec![&env, change])
        .is_err());
    assert_eq!(PayerClient::new(&env, &action).recipient(), old);
}
