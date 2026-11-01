use deposit_trigger::{execution_v1 as abi, DepositTrigger, DepositTriggerClient};
use paiflow_splitter::{execution_v1 as split, Splitter, SplitterClient};
use payer::{execution_v1 as pay, Payer, PayerClient, WorkflowTarget};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuthInvoke},
    token, vec, xdr, Address, BytesN, Env, IntoVal, String, TryFromVal, Val, Vec,
};
#[path = "../../../payment-test-token.rs"]
mod payment_test_token;

#[soroban_sdk::contract]
struct UnderDeliveringToken;
#[soroban_sdk::contractimpl]
impl UnderDeliveringToken {
    pub fn balance(env: Env, id: Address) -> i128 {
        payment_test_token::WideToken::balance(env, id)
    }
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        payment_test_token::WideToken::transfer(env, from, to, amount - 1);
    }
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
fn s(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}

struct World {
    env: Env,
    root: Address,
    split: Address,
    pay: Option<Address>,
    asset: Address,
    payer: Address,
    platform: Address,
    worker: Address,
    bindings: Vec<abi::Binding>,
}
impl World {
    fn terminal_pay(rule: pay::PayoutRule) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(10);
        let admin = wallet(&env, 1);
        let payer = wallet(&env, 2);
        let root = Address::generate(&env);
        let action = Address::generate(&env);
        let asset = env.register(payment_test_token::WideToken, ());
        payment_test_token::WideTokenClient::new(&env, &asset).mint(&payer, &100_000);
        payment_test_token::WideTokenClient::new(&env, &asset).mint(&action, &99);
        let (amount, bps) = match &rule {
            pay::PayoutRule::Full => (0, 10_000),
            pay::PayoutRule::Fixed(value) => (*value, 0),
            pay::PayoutRule::Percentage(value) => (0, *value),
        };
        let config: Val = pay::PayConfig {
            version: 1,
            node_id: s(&env, "pay"),
            recipient_mode: pay::FieldMode::Execution,
            payout_value_mode: pay::FieldMode::Constant,
            recipient: None,
            payout_rule: rule,
        }
        .into_val(&env);
        env.register_at(
            &action,
            Payer,
            (
                &admin,
                &asset,
                config,
                amount,
                bps,
                Vec::<WorkflowTarget>::new(&env),
                &root,
            ),
        );
        let config: Val = abi::RootConfig {
            version: 1,
            node_id: s(&env, "root"),
            min_amount: 1,
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
                node_id: s(&env, "pay"),
                contract_address: action.clone(),
                expected_revision: 0,
            },
        ];
        let platform = wallet(&env, 3);
        let worker = wallet(&env, 4);
        Self {
            env,
            root,
            split: action,
            pay: None,
            asset,
            payer,
            platform,
            worker,
            bindings,
        }
    }
    fn new(fixed: bool, chain: bool) -> Self {
        Self::new_with_wasm(fixed, chain, false)
    }
    fn new_with_wasm(fixed: bool, chain: bool, wasm: bool) -> Self {
        Self::new_with_rows(fixed, chain, wasm, 0)
    }
    fn new_with_rows(fixed: bool, chain: bool, wasm: bool, configured: u8) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_sequence_number(10);
        let admin = wallet(&env, 1);
        let payer = wallet(&env, 2);
        let platform = wallet(&env, 3);
        let worker = wallet(&env, 4);
        let root = Address::generate(&env);
        let split = Address::generate(&env);
        let pay = chain.then(|| Address::generate(&env));
        let asset = env.register(payment_test_token::WideToken, ());
        payment_test_token::WideTokenClient::new(&env, &asset).mint(&payer, &100_000);
        let mut rows = vec![
            &env,
            split::ConfiguredRow {
                row_id: s(&env, "platform"),
                recipient_mode: split::FieldMode::Constant,
                allocation_mode: split::FieldMode::Constant,
                recipient: Some(platform.clone()),
                allocation: split::MaybeAllocation::Present(if fixed {
                    split::Allocation::Fixed(10)
                } else {
                    split::Allocation::Percentage(1_000)
                }),
            },
        ];
        if configured > 0 {
            rows.push_back(split::ConfiguredRow {
                row_id: s(&env, "worker"),
                recipient_mode: if configured == 3 {
                    split::FieldMode::Constant
                } else {
                    split::FieldMode::Execution
                },
                allocation_mode: if configured == 1 {
                    split::FieldMode::Execution
                } else {
                    split::FieldMode::Constant
                },
                recipient: if configured == 3 {
                    Some(worker.clone())
                } else {
                    None
                },
                allocation: if configured == 1 {
                    split::MaybeAllocation::Missing
                } else {
                    split::MaybeAllocation::Present(if fixed {
                        split::Allocation::Fixed(90)
                    } else {
                        split::Allocation::Percentage(9_000)
                    })
                },
            });
        }
        let config: Val = split::SplitConfig {
            version: 1,
            node_id: s(&env, "split"),
            allocation_mode: if fixed {
                split::AllocationMode::Fixed
            } else {
                split::AllocationMode::Percentage
            },
            additional_mode: if configured == 0 {
                split::FieldMode::Execution
            } else {
                split::FieldMode::Constant
            },
            rows,
        }
        .into_val(&env);
        let args = (
            &admin,
            &asset,
            config,
            0i128,
            pay.as_ref().unwrap_or(&root),
            Vec::<paiflow_splitter::WorkflowTarget>::new(&env),
        );
        if wasm {
            let bytes =
                std::fs::read("../../target/wasm32v1-none/release/paiflow_splitter.wasm").unwrap();
            env.register_at(&split, bytes.as_slice(), args);
        } else {
            env.register_at(&split, Splitter, args);
        }
        if let Some(pay) = &pay {
            let config: Val = pay::PayConfig {
                version: 1,
                node_id: s(&env, "fee"),
                recipient_mode: pay::FieldMode::Constant,
                payout_value_mode: pay::FieldMode::Constant,
                recipient: Some(platform.clone()),
                payout_rule: pay::PayoutRule::Fixed(10),
            }
            .into_val(&env);
            let args = (
                &admin,
                &asset,
                config,
                10i128,
                0u32,
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
                env.register_at(pay, bytes.as_slice(), args);
            } else {
                env.register_at(pay, Payer, args);
            }
        }
        let config: Val = abi::RootConfig {
            version: 1,
            node_id: s(&env, "root"),
            min_amount: 1,
            next_steps: vec![
                &env,
                abi::Target {
                    address: pay.as_ref().unwrap_or(&split).clone(),
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
        let mut bindings = vec![
            &env,
            abi::Binding {
                node_id: s(&env, "root"),
                contract_address: root.clone(),
                expected_revision: 0,
            },
        ];
        if let Some(pay) = &pay {
            bindings.push_back(abi::Binding {
                node_id: s(&env, "fee"),
                contract_address: pay.clone(),
                expected_revision: 0,
            });
        }
        bindings.push_back(abi::Binding {
            node_id: s(&env, "split"),
            contract_address: split.clone(),
            expected_revision: 0,
        });
        // Unsolicited balances are not part of any execution's conserved budget.
        for contract in [&root, &split].into_iter().chain(pay.iter()) {
            payment_test_token::WideTokenClient::new(&env, &asset).mint(contract, &99);
        }
        Self {
            env,
            root,
            split,
            pay,
            asset,
            payer,
            platform,
            worker,
            bindings,
        }
    }
    fn inputs(&self, fixed: Option<i128>) -> Vec<abi::NodeInput> {
        vec![
            &self.env,
            abi::NodeInput::Split(abi::SplitInput {
                node_id: s(&self.env, "split"),
                rows: Vec::new(&self.env),
                additional: Some(vec![
                    &self.env,
                    abi::AdditionalRow {
                        row_id: s(&self.env, "worker"),
                        recipient: self.worker.clone(),
                        allocation: fixed
                            .map(abi::Allocation::Fixed)
                            .unwrap_or(abi::Allocation::Percentage(9_000)),
                    },
                ]),
            }),
        ]
    }
    fn authorize(
        &self,
        amount: i128,
        nonce: &BytesN<32>,
        expires: u32,
        bindings: &Vec<abi::Binding>,
        inputs: &Vec<abi::NodeInput>,
    ) {
        let args: Vec<Val> = (
            &self.payer,
            &self.asset,
            amount,
            nonce,
            expires,
            bindings,
            inputs,
        )
            .into_val(&self.env);
        let transfer: Vec<Val> = (&self.payer, &self.root, amount).into_val(&self.env);
        let account: xdr::ScAddress = (&self.payer).into();
        let xdr::ScAddress::Account(account) = account else {
            panic!("wallet fixture")
        };
        self.env.host().set_source_account(account).unwrap();
        self.env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: (&MockAuthInvoke {
                contract: &self.root,
                fn_name: "execute_v1",
                args,
                sub_invokes: &[MockAuthInvoke {
                    contract: &self.asset,
                    fn_name: "transfer",
                    args: transfer,
                    sub_invokes: &[],
                }],
            })
                .into(),
        }]);
    }
    fn nonce(&self, byte: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[byte; 32])
    }
    fn balance(&self, address: &Address) -> i128 {
        token::Client::new(&self.env, &self.asset).balance(address)
    }
}

#[test]
fn terminal_pay_recipient_is_per_execution_and_refunds_only_its_unused_budget() {
    for (rule, expected) in [
        (pay::PayoutRule::Full, 100),
        (pay::PayoutRule::Fixed(40), 40),
        (pay::PayoutRule::Percentage(3_333), 33),
    ] {
        let w = World::terminal_pay(rule);
        let inputs = vec![
            &w.env,
            abi::NodeInput::Pay(abi::PayInput {
                node_id: s(&w.env, "pay"),
                recipient: w.worker.clone(),
            }),
        ];
        let nonce = w.nonce(1);
        w.authorize(100, &nonce, 100, &w.bindings, &inputs);
        DepositTriggerClient::new(&w.env, &w.root).execute_v1(
            &w.payer,
            &w.asset,
            &100,
            &nonce,
            &100,
            &w.bindings,
            &inputs,
        );
        assert_eq!(w.balance(&w.worker), expected);
        assert_eq!(w.balance(&w.payer), 100_000 - expected);
        assert_eq!(w.balance(&w.split), 99);
        assert!(PayerClient::new(&w.env, &w.split)
            .current_config()
            .policy
            .recipient
            .is_none());
        assert!(PayerClient::new(&w.env, &w.split).try_recipient().is_err());
    }
    let w = World::terminal_pay(pay::PayoutRule::Fixed(101));
    let inputs = vec![
        &w.env,
        abi::NodeInput::Pay(abi::PayInput {
            node_id: s(&w.env, "pay"),
            recipient: w.worker.clone(),
        }),
    ];
    let nonce = w.nonce(1);
    w.authorize(100, &nonce, 100, &w.bindings, &inputs);
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &w.bindings, &inputs)
        .is_err());
    assert_eq!(w.balance(&w.payer), 100_000);
}

#[test]
fn combined_roster_limit_and_wallet_types_are_enforced_on_chain() {
    for count in [19u8, 20] {
        let w = World::new(false, false);
        let mut additional = Vec::new(&w.env);
        for index in 0..count {
            additional.push_back(abi::AdditionalRow {
                row_id: s(&w.env, &std::format!("worker{index}")),
                recipient: wallet(&w.env, index + 10),
                allocation: abi::Allocation::Percentage(if index + 1 == count {
                    9_000 - u32::from(count - 1)
                } else {
                    1
                }),
            });
        }
        let inputs = vec![
            &w.env,
            abi::NodeInput::Split(abi::SplitInput {
                node_id: s(&w.env, "split"),
                rows: Vec::new(&w.env),
                additional: Some(additional),
            }),
        ];
        let nonce = w.nonce(1);
        w.authorize(100, &nonce, 100, &w.bindings, &inputs);
        let result = DepositTriggerClient::new(&w.env, &w.root).try_execute_v1(
            &w.payer,
            &w.asset,
            &100,
            &nonce,
            &100,
            &w.bindings,
            &inputs,
        );
        assert_eq!(result.is_ok(), count == 19);
        assert_eq!(w.balance(&w.split), 99);
    }
    let w = World::terminal_pay(pay::PayoutRule::Full);
    let inputs = vec![
        &w.env,
        abi::NodeInput::Pay(abi::PayInput {
            node_id: s(&w.env, "pay"),
            recipient: Address::generate(&w.env),
        }),
    ];
    let nonce = w.nonce(1);
    w.authorize(100, &nonce, 100, &w.bindings, &inputs);
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &w.bindings, &inputs)
        .is_err());
}

#[test]
fn configured_runtime_rows_preserve_constant_allocations_and_require_every_declared_field() {
    for configured in [1u8, 2] {
        for attack in 0..5 {
            let w = World::new_with_rows(true, false, false, configured);
            let mut row = abi::RowInput {
                row_id: s(&w.env, "worker"),
                recipient: Some(w.worker.clone()),
                allocation: if configured == 1 {
                    abi::MaybeAllocation::Present(abi::Allocation::Fixed(90))
                } else {
                    abi::MaybeAllocation::Missing
                },
            };
            let amount = if attack == 4 { 101 } else { 100 };
            match attack {
                1 => row.recipient = None,
                2 => {
                    row.allocation = if configured == 1 {
                        abi::MaybeAllocation::Missing
                    } else {
                        abi::MaybeAllocation::Present(abi::Allocation::Fixed(90))
                    }
                }
                3 => row.row_id = s(&w.env, "platform"),
                _ => (),
            }
            let inputs = vec![
                &w.env,
                abi::NodeInput::Split(abi::SplitInput {
                    node_id: s(&w.env, "split"),
                    rows: vec![&w.env, row],
                    additional: None,
                }),
            ];
            let nonce = w.nonce(1);
            w.authorize(amount, &nonce, 100, &w.bindings, &inputs);
            let result = DepositTriggerClient::new(&w.env, &w.root).try_execute_v1(
                &w.payer,
                &w.asset,
                &amount,
                &nonce,
                &100,
                &w.bindings,
                &inputs,
            );
            assert_eq!(result.is_ok(), attack == 0);
            assert_eq!(w.balance(&w.worker), if attack == 0 { 90 } else { 0 });
            assert_eq!(w.balance(&w.split), 99);
        }
    }
}

#[test]
fn real_payer_auth_preserves_constant_fee_and_separates_call_budgets() {
    let w = World::new(false, true);
    let inputs = w.inputs(None);
    let nonce = w.nonce(1);
    w.authorize(111, &nonce, 100, &w.bindings, &inputs);
    DepositTriggerClient::new(&w.env, &w.root).execute_v1(
        &w.payer,
        &w.asset,
        &111,
        &nonce,
        &100,
        &w.bindings,
        &inputs,
    );
    let auths = w.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, w.payer);
    assert_eq!(w.balance(&w.platform), 20); // 10 fixed + floor(101*10%)
    assert_eq!(w.balance(&w.worker), 91); // final row receives rounding remainder
    assert_eq!(w.balance(&w.root), 99);
    assert_eq!(w.balance(w.pay.as_ref().unwrap()), 99);
    assert_eq!(w.balance(&w.split), 99);
    let second = wallet(&w.env, 5);
    let mut inputs2 = inputs.clone();
    if let abi::NodeInput::Split(mut input) = inputs2.get(0).unwrap() {
        let mut row = input.additional.as_ref().unwrap().get(0).unwrap();
        row.recipient = second.clone();
        input.additional = Some(vec![&w.env, row]);
        inputs2.set(0, abi::NodeInput::Split(input));
    }
    let nonce2 = w.nonce(2);
    w.authorize(110, &nonce2, 100, &w.bindings, &inputs2);
    DepositTriggerClient::new(&w.env, &w.root).execute_v1(
        &w.payer,
        &w.asset,
        &110,
        &nonce2,
        &100,
        &w.bindings,
        &inputs2,
    );
    assert_eq!(w.balance(&w.worker), 91);
    assert_eq!(w.balance(&second), 90);
    assert_eq!(w.balance(&w.split), 99);
}

#[test]
fn fixed_runtime_split_requires_exact_incoming_and_rolls_back_everything() {
    for amount in [99i128, 101] {
        let w = World::new(true, false);
        let inputs = w.inputs(Some(90));
        let nonce = w.nonce(1);
        w.authorize(amount, &nonce, 100, &w.bindings, &inputs);
        assert!(DepositTriggerClient::new(&w.env, &w.root)
            .try_execute_v1(
                &w.payer,
                &w.asset,
                &amount,
                &nonce,
                &100,
                &w.bindings,
                &inputs
            )
            .is_err());
        assert_eq!(w.balance(&w.payer), 100_000);
        assert_eq!(w.balance(&w.platform), 0);
        assert_eq!(w.balance(&w.split), 99);
        // Failed invocation did not consume its nonce.
        w.authorize(100, &nonce, 100, &w.bindings, &inputs);
        DepositTriggerClient::new(&w.env, &w.root).execute_v1(
            &w.payer,
            &w.asset,
            &100,
            &nonce,
            &100,
            &w.bindings,
            &inputs,
        );
        assert_eq!(w.balance(&w.worker), 90);
    }
}

#[test]
fn raw_inputs_reject_missing_unknown_duplicate_constant_and_recipient_overrides() {
    for attack in 0..7 {
        let w = World::new(false, false);
        let mut inputs = w.inputs(None);
        match attack {
            0 => inputs = Vec::new(&w.env),
            1 => {
                let value = inputs.get(0).unwrap();
                inputs.push_back(value);
            }
            2 => {
                if let abi::NodeInput::Split(mut value) = inputs.get(0).unwrap() {
                    value.node_id = s(&w.env, "unknown");
                    inputs.set(0, abi::NodeInput::Split(value));
                }
            }
            3 => {
                if let abi::NodeInput::Split(mut value) = inputs.get(0).unwrap() {
                    value.rows.push_back(abi::RowInput {
                        row_id: s(&w.env, "platform"),
                        recipient: Some(w.worker.clone()),
                        allocation: abi::MaybeAllocation::Missing,
                    });
                    inputs.set(0, abi::NodeInput::Split(value));
                }
            }
            4 => {
                if let abi::NodeInput::Split(mut value) = inputs.get(0).unwrap() {
                    value.additional = None;
                    inputs.set(0, abi::NodeInput::Split(value));
                }
            }
            5 => {
                if let abi::NodeInput::Split(mut value) = inputs.get(0).unwrap() {
                    let mut row = value.additional.as_ref().unwrap().get(0).unwrap();
                    row.recipient = w.platform.clone();
                    value.additional = Some(vec![&w.env, row]);
                    inputs.set(0, abi::NodeInput::Split(value));
                }
            }
            _ => {
                if let abi::NodeInput::Split(mut value) = inputs.get(0).unwrap() {
                    let mut row = value.additional.as_ref().unwrap().get(0).unwrap();
                    row.row_id = s(&w.env, "platform");
                    value.additional = Some(vec![&w.env, row]);
                    inputs.set(0, abi::NodeInput::Split(value));
                }
            }
        }
        let nonce = w.nonce(1);
        w.authorize(100, &nonce, 100, &w.bindings, &inputs);
        assert!(
            DepositTriggerClient::new(&w.env, &w.root)
                .try_execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &w.bindings, &inputs)
                .is_err(),
            "attack {attack}"
        );
        assert_eq!(w.balance(&w.payer), 100_000);
        assert_eq!(w.balance(&w.platform), 0);
    }
}

#[test]
fn revision_expiry_replay_asset_and_exact_payer_authorization_are_enforced() {
    let w = World::new(false, false);
    let inputs = w.inputs(None);
    let nonce = w.nonce(1);
    let root = DepositTriggerClient::new(&w.env, &w.root);
    w.env.mock_auths(&[]);
    assert!(root
        .try_execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &w.bindings, &inputs)
        .is_err());
    let mut stale = w.bindings.clone();
    let mut binding = stale.get(1).unwrap();
    binding.expected_revision = 1;
    stale.set(1, binding);
    w.authorize(100, &nonce, 100, &stale, &inputs);
    assert!(root
        .try_execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &stale, &inputs)
        .is_err());
    for expiry in [10u32, 731] {
        w.authorize(100, &nonce, expiry, &w.bindings, &inputs);
        assert!(root
            .try_execute_v1(
                &w.payer,
                &w.asset,
                &100,
                &nonce,
                &expiry,
                &w.bindings,
                &inputs
            )
            .is_err());
    }
    w.authorize(100, &nonce, 100, &w.bindings, &inputs);
    assert!(root
        .try_execute_v1(
            &w.payer,
            &Address::generate(&w.env),
            &100,
            &nonce,
            &100,
            &w.bindings,
            &inputs
        )
        .is_err());
    // Authorization for original inputs cannot authorize a changed worker.
    let mut changed = inputs.clone();
    if let abi::NodeInput::Split(mut value) = changed.get(0).unwrap() {
        let mut row = value.additional.as_ref().unwrap().get(0).unwrap();
        row.recipient = wallet(&w.env, 9);
        value.additional = Some(vec![&w.env, row]);
        changed.set(0, abi::NodeInput::Split(value));
    }
    assert!(root
        .try_execute_v1(
            &w.payer,
            &w.asset,
            &100,
            &nonce,
            &100,
            &w.bindings,
            &changed
        )
        .is_err());
    w.authorize(100, &nonce, 100, &w.bindings, &inputs);
    root.execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &w.bindings, &inputs);
    w.authorize(100, &nonce, 100, &w.bindings, &inputs);
    assert!(root
        .try_execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &w.bindings, &inputs)
        .is_err());
    assert_eq!(w.balance(&w.payer), 99_900);
}

#[test]
fn legacy_entrypoints_and_admin_routing_cannot_bypass_policy() {
    let w = World::new(false, true);
    w.env.mock_all_auths();
    let split = SplitterClient::new(&w.env, &w.split);
    assert!(split.try_distribute(&w.payer, &100).is_err());
    assert!(split.try_execute_step(&w.asset, &100).is_err());
    assert!(split.try_set_next_steps(&Vec::new(&w.env)).is_err());
    let pay = PayerClient::new(&w.env, w.pay.as_ref().unwrap());
    assert!(pay.try_execute_step(&w.asset, &100).is_err());
    assert!(pay.try_cancel().is_err());
    assert!(pay.try_set_next_steps(&Vec::new(&w.env)).is_err());
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_deposit(&w.payer, &100)
        .is_err());
}

#[test]
fn two_payers_with_the_same_nonce_cannot_exchange_their_signed_destinations() {
    let mut w = World::new(false, false);
    let first_payer = w.payer.clone();
    let inputs = w.inputs(None);
    let nonce = w.nonce(7);
    w.authorize(100, &nonce, 100, &w.bindings, &inputs);
    DepositTriggerClient::new(&w.env, &w.root).execute_v1(
        &w.payer,
        &w.asset,
        &100,
        &nonce,
        &100,
        &w.bindings,
        &inputs,
    );
    w.payer = wallet(&w.env, 8);
    payment_test_token::WideTokenClient::new(&w.env, &w.asset).mint(&w.payer, &200);
    let mut changed = w.inputs(None);
    if let abi::NodeInput::Split(mut input) = changed.get(0).unwrap() {
        let mut row = input.additional.as_ref().unwrap().get(0).unwrap();
        row.recipient = wallet(&w.env, 9);
        input.additional = Some(vec![&w.env, row]);
        changed.set(0, abi::NodeInput::Split(input));
    }
    w.authorize(100, &nonce, 100, &w.bindings, &changed);
    let root = DepositTriggerClient::new(&w.env, &w.root);
    assert!(root
        .try_execute_v1(&w.payer, &w.asset, &100, &nonce, &100, &w.bindings, &inputs)
        .is_err());
    w.authorize(100, &nonce, 100, &w.bindings, &changed);
    root.execute_v1(
        &w.payer,
        &w.asset,
        &100,
        &nonce,
        &100,
        &w.bindings,
        &changed,
    );
    assert_eq!(w.balance(&first_payer), 99_900);
    assert_eq!(w.balance(&w.payer), 100);
    assert_eq!(w.balance(&w.worker), 90);
    assert_eq!(w.balance(&wallet(&w.env, 9)), 90);
    assert_eq!(w.balance(&w.split), 99);
}

#[test]
fn raw_child_calls_require_the_stored_parent_for_the_exact_forwarded_context() {
    let w = World::new(false, false);
    let context: Val = abi::ExecutionContext {
        payer: w.payer.clone(),
        root: w.root.clone(),
        asset: w.asset.clone(),
        funded_amount: 100,
        nonce: w.nonce(1),
        expires_at_ledger: 100,
        bindings: w.bindings.clone(),
        inputs: w.inputs(None),
        index: 1,
    }
    .into_val(&w.env);
    let mut context = split::ExecutionContext::try_from_val(&w.env, &context).unwrap();
    w.env.set_auths(&[]);
    let client = SplitterClient::new(&w.env, &w.split);
    assert!(client
        .try_execute_step_v1(&context, &w.asset, &100)
        .is_err());
    let mut root_binding = context.bindings.get(0).unwrap();
    root_binding.contract_address = Address::generate(&w.env);
    context.root = root_binding.contract_address.clone();
    context.bindings.set(0, root_binding);
    assert!(client
        .try_execute_step_v1(&context, &w.asset, &100)
        .is_err());
    assert_eq!(w.balance(&w.split), 99);
}

#[test]
fn nonstandard_token_cannot_subsidize_a_short_transfer_from_unrelated_holdings() {
    let w = World::new(false, true);
    // Use the same token storage with deliberately nonconforming transfer behavior.
    w.env.register_at(&w.asset, UnderDeliveringToken, ());
    let inputs = w.inputs(None);
    let nonce = w.nonce(1);
    w.authorize(111, &nonce, 100, &w.bindings, &inputs);
    assert!(DepositTriggerClient::new(&w.env, &w.root)
        .try_execute_v1(&w.payer, &w.asset, &111, &nonce, &100, &w.bindings, &inputs)
        .is_err());
    assert_eq!(w.balance(&w.payer), 100_000);
    assert_eq!(w.balance(&w.root), 99);
    assert_eq!(w.balance(w.pay.as_ref().unwrap()), 99);
    assert_eq!(w.balance(&w.split), 99);
}

#[test]
fn constant_only_policy_split_retains_accounted_accumulation_without_a_false_payout() {
    use soroban_sdk::testutils::Events as _;
    let w = World::new_with_rows(true, false, false, 3);
    let inputs = Vec::new(&w.env);
    let nonce = w.nonce(1);
    w.authorize(50, &nonce, 100, &w.bindings, &inputs);
    DepositTriggerClient::new(&w.env, &w.root).execute_v1(
        &w.payer,
        &w.asset,
        &50,
        &nonce,
        &100,
        &w.bindings,
        &inputs,
    );
    assert_eq!(
        w.env
            .events()
            .all()
            .filter_by_contract(&w.split)
            .events()
            .len(),
        1
    ); // shortfall only
    assert_eq!(
        SplitterClient::new(&w.env, &w.split).accumulated_balance(),
        50
    );
    assert_eq!(w.balance(&w.worker), 0);
    let nonce = w.nonce(2);
    w.authorize(50, &nonce, 100, &w.bindings, &inputs);
    DepositTriggerClient::new(&w.env, &w.root).execute_v1(
        &w.payer,
        &w.asset,
        &50,
        &nonce,
        &100,
        &w.bindings,
        &inputs,
    );
    assert_eq!(
        SplitterClient::new(&w.env, &w.split).accumulated_balance(),
        0
    );
    assert_eq!(w.balance(&w.worker), 90);
    assert_eq!(w.balance(&w.platform), 10);
    assert_eq!(w.balance(&w.split), 99);
}

#[test]
#[ignore = "manual representative execution-v1 resource report"]
fn profile_execution_v1() {
    let w = World::new(false, true);
    let inputs = w.inputs(None);
    let nonce = w.nonce(1);
    w.authorize(111, &nonce, 100, &w.bindings, &inputs);
    w.env.cost_estimate().budget().reset_default();
    DepositTriggerClient::new(&w.env, &w.root).execute_v1(
        &w.payer,
        &w.asset,
        &111,
        &nonce,
        &100,
        &w.bindings,
        &inputs,
    );
    std::println!(
        "execution-v1 root/pay/split: {:?}",
        w.env.cost_estimate().resources()
    );
}

#[test]
#[ignore = "requires locally built release WASMs; no network or funded wallets"]
fn wasm_execution_uses_identical_binding_abi() {
    for bounded in [true, false] {
        let w = World::new_with_wasm(false, true, true);
        let inputs = w.inputs(None);
        let nonce = w.nonce(1);
        w.authorize(111, &nonce, 100, &w.bindings, &inputs);
        if bounded {
            // SDK v26 debug auth snapshots exhaust their separate shadow budget.
            // Disable observation only; real source-account authorization stays enforced.
            // IO resource snapshots may be unavailable in this bounded diagnostic run.
            w.env.host().set_invocation_hook(None).unwrap();
            w.env.cost_estimate().budget().reset_default();
        } else {
            // Profiling only: retain debug/auth/IO observations without shadow-budget truncation.
            // This is not proof of network resource suitability.
            w.env.cost_estimate().budget().reset_unlimited();
        }
        DepositTriggerClient::new(&w.env, &w.root).execute_v1(
            &w.payer,
            &w.asset,
            &111,
            &nonce,
            &100,
            &w.bindings,
            &inputs,
        );
        let resources = w.env.cost_estimate().resources();
        std::println!("WASM execution-v1 (bounded={bounded}): {resources:?}");
        assert!(resources.instructions < 100_000_000);
        assert!(resources.mem_bytes < 40_000_000);
        if !bounded {
            assert!(resources.write_entries > 0);
            assert_eq!(w.env.auths()[0].0, w.payer);
        }
        assert_eq!(w.balance(&w.platform), 20);
        assert_eq!(w.balance(&w.worker), 91);
        assert_eq!(w.balance(&w.root), 99);
        assert_eq!(w.balance(w.pay.as_ref().unwrap()), 99);
        assert_eq!(w.balance(&w.split), 99);
    }
}
