#![allow(dead_code)]
use deposit_trigger::DepositTrigger;
use paiflow_splitter::Splitter;
use payer::{conditional_v2 as v2, execution_v1 as v1, Payer};
use router::Router;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuthInvoke},
    token, vec, xdr, Address, BytesN, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
};
#[path = "payment-test-token.rs"]
pub mod payment_test_token;

pub fn s(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}
pub fn wallet(env: &Env, byte: u8) -> Address {
    Address::try_from_val(
        env,
        &xdr::ScVal::Address(xdr::ScAddress::Account(xdr::AccountId(
            xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256([byte; 32])),
        ))),
    )
    .unwrap()
}
#[derive(Clone, Copy)]
pub enum Terminal {
    Pay,
    FixedPay,
    PercentPay,
    Split,
    FixedSplit,
    RuntimeSplit,
    Return,
}
pub struct World {
    pub env: Env,
    pub root: Address,
    pub prefix: Option<Address>,
    pub condition: Address,
    pub yes: Address,
    pub no: Address,
    pub asset: Address,
    pub admin: Address,
    pub payer: Address,
    pub platform: Address,
    pub worker: Address,
    pub manifest: v2::GraphManifestV2,
}
impl World {
    pub fn new(
        yes: Terminal,
        no: Terminal,
        comparison: v2::ComparisonV2,
        threshold: i128,
        prefix: Option<v1::PayoutRule>,
    ) -> Self {
        Self::new_with_mutable(yes, no, comparison, threshold, prefix, false)
    }
    pub fn new_with_mutable(
        yes: Terminal,
        no: Terminal,
        comparison: v2::ComparisonV2,
        threshold: i128,
        prefix: Option<v1::PayoutRule>,
        mutable: bool,
    ) -> Self {
        Self::new_configured(yes, no, comparison, threshold, prefix, mutable, |_, _| {})
    }
    #[allow(clippy::too_many_arguments)]
    pub fn new_configured(
        yes: Terminal,
        no: Terminal,
        comparison: v2::ComparisonV2,
        threshold: i128,
        prefix: Option<v1::PayoutRule>,
        mutable: bool,
        configure: impl FnOnce(&Env, &mut v2::GraphManifestV2),
    ) -> Self {
        let env = Env::default();
        // SDK26's diagnostic auth snapshots exceed their separate shadow budget
        // for complete manifests. Actual source-account auth remains enforced.
        env.host().set_invocation_hook(None).unwrap();
        env.ledger().set_sequence_number(10);
        let admin = wallet(&env, 1);
        let payer = wallet(&env, 2);
        let platform = wallet(&env, 3);
        let worker = wallet(&env, 4);
        let root = Address::generate(&env);
        let condition = Address::generate(&env);
        let yes_address = Address::generate(&env);
        let no_address = Address::generate(&env);
        let prefix_address = prefix.as_ref().map(|_| Address::generate(&env));
        let asset = env.register(payment_test_token::WideToken, ());
        payment_test_token::WideTokenClient::new(&env, &asset).mint(&payer, &i128::MAX);
        let mut nodes = Vec::new(&env);
        let state = |id: &str,
                     address: &Address,
                     parent: Option<Address>,
                     next_steps: Vec<Address>,
                     configuration| v2::NodeStateV2 {
            version: 2,
            node_id: s(&env, id),
            contract_address: address.clone(),
            revision: 0,
            admin: admin.clone(),
            asset: asset.clone(),
            parent,
            next_steps,
            configuration,
        };
        nodes.push_back(v2::InitialArtifactV2 {
            wasm_hash: BytesN::from_array(&env, &[1; 32]),
            state: state(
                "root",
                &root,
                None,
                vec![&env, prefix_address.clone().unwrap_or(condition.clone())],
                v2::NodeConfigurationV2::Receive(v2::ReceiveStateV2 { min_amount: 0 }),
            ),
        });
        if let (Some(rule), Some(address)) = (prefix, &prefix_address) {
            nodes.push_back(v2::InitialArtifactV2 {
                wasm_hash: BytesN::from_array(&env, &[2; 32]),
                state: state(
                    "prefix",
                    address,
                    Some(root.clone()),
                    vec![&env, condition.clone()],
                    v2::NodeConfigurationV2::Pay(v1::PayConfig {
                        version: 1,
                        node_id: s(&env, "prefix"),
                        recipient_mode: v1::FieldMode::Constant,
                        payout_value_mode: v1::FieldMode::Constant,
                        recipient: Some(platform.clone()),
                        payout_rule: rule,
                    }),
                ),
            });
        }
        nodes.push_back(v2::InitialArtifactV2 {
            wasm_hash: BytesN::from_array(&env, &[3; 32]),
            state: state(
                "condition",
                &condition,
                Some(prefix_address.clone().unwrap_or(root.clone())),
                vec![&env, yes_address.clone(), no_address.clone()],
                v2::NodeConfigurationV2::Condition(v2::ConditionStateV2 {
                    comparison,
                    threshold,
                    threshold_mode: v2::StoredModeV2::Mutable,
                }),
            ),
        });
        for (id, address, kind) in [("yes", &yes_address, yes), ("no", &no_address, no)] {
            let config = match kind {
                Terminal::Return => v2::NodeConfigurationV2::ReturnToOwner(v2::ReturnStateV2 {
                    recipient: admin.clone(),
                }),
                Terminal::Pay | Terminal::FixedPay | Terminal::PercentPay => {
                    v2::NodeConfigurationV2::Pay(v1::PayConfig {
                        version: 1,
                        node_id: s(&env, id),
                        recipient_mode: v1::FieldMode::Execution,
                        payout_value_mode: v1::FieldMode::Constant,
                        recipient: None,
                        payout_rule: match kind {
                            Terminal::FixedPay => v1::PayoutRule::Fixed(40),
                            Terminal::PercentPay => v1::PayoutRule::Percentage(3333),
                            _ => v1::PayoutRule::Full,
                        },
                    })
                }
                _ => {
                    let fixed = matches!(kind, Terminal::FixedSplit | Terminal::RuntimeSplit);
                    let execution = matches!(kind, Terminal::RuntimeSplit);
                    v2::NodeConfigurationV2::Split(v1::StoredSplitConfig {
                        policy: v1::SplitConfig {
                            version: 1,
                            node_id: s(&env, id),
                            allocation_mode: if fixed {
                                v1::AllocationMode::Fixed
                            } else {
                                v1::AllocationMode::Percentage
                            },
                            additional_mode: v1::FieldMode::Constant,
                            rows: vec![
                                &env,
                                v1::ConfiguredRow {
                                    row_id: s(&env, "platform"),
                                    recipient_mode: v1::FieldMode::Constant,
                                    allocation_mode: v1::FieldMode::Constant,
                                    recipient: Some(platform.clone()),
                                    allocation: v1::MaybeAllocation::Present(if fixed {
                                        v1::Allocation::Fixed(10)
                                    } else {
                                        v1::Allocation::Percentage(1000)
                                    }),
                                },
                                v1::ConfiguredRow {
                                    row_id: s(&env, "worker"),
                                    recipient_mode: if execution {
                                        v1::FieldMode::Execution
                                    } else {
                                        v1::FieldMode::Constant
                                    },
                                    allocation_mode: v1::FieldMode::Constant,
                                    recipient: if execution {
                                        None
                                    } else {
                                        Some(worker.clone())
                                    },
                                    allocation: v1::MaybeAllocation::Present(if fixed {
                                        v1::Allocation::Fixed(90)
                                    } else {
                                        v1::Allocation::Percentage(9000)
                                    }),
                                },
                            ],
                        },
                        additional: Vec::new(&env),
                    })
                }
            };
            nodes.push_back(v2::InitialArtifactV2 {
                wasm_hash: BytesN::from_array(&env, &[if id == "yes" { 4 } else { 5 }; 32]),
                state: state(id, address, Some(condition.clone()), Vec::new(&env), config),
            });
        }
        if mutable {
            for i in 0..nodes.len() {
                let mut entry = nodes.get(i).unwrap();
                match &mut entry.state.configuration {
                    v2::NodeConfigurationV2::Condition(value) => {
                        value.threshold_mode = v2::StoredModeV2::Mutable
                    }
                    v2::NodeConfigurationV2::Pay(value) => {
                        if value.recipient_mode != v1::FieldMode::Execution {
                            value.recipient_mode = v1::FieldMode::Mutable;
                        }
                        if value.payout_rule != v1::PayoutRule::Full {
                            value.payout_value_mode = v1::FieldMode::Mutable;
                        }
                    }
                    v2::NodeConfigurationV2::Split(value) => {
                        value.policy.additional_mode = v1::FieldMode::Mutable;
                        for j in 0..value.policy.rows.len() {
                            let mut row = value.policy.rows.get(j).unwrap();
                            if row.recipient_mode != v1::FieldMode::Execution {
                                row.recipient_mode = v1::FieldMode::Mutable;
                            }
                            if row.allocation_mode != v1::FieldMode::Execution {
                                row.allocation_mode = v1::FieldMode::Mutable;
                            }
                            value.policy.rows.set(j, row);
                        }
                    }
                    _ => (),
                }
                nodes.set(i, entry);
            }
        }
        let mut manifest = v2::GraphManifestV2 {
            version: 2,
            root: root.clone(),
            admin: admin.clone(),
            asset: asset.clone(),
            nodes,
        };
        configure(&env, &mut manifest);
        // Root-first registration proves constructors don't query not-yet-created children.
        for entry in manifest.nodes.iter() {
            let state = &entry.state;
            let init: Val = v2::NodeInitV2 {
                version: 2,
                node_id: state.node_id.clone(),
                manifest: manifest.clone(),
            }
            .into_val(&env);
            match &state.configuration {
                v2::NodeConfigurationV2::Receive(_) => {
                    env.register_at(
                        &state.contract_address,
                        DepositTrigger,
                        (&admin, &asset, init),
                    );
                }
                v2::NodeConfigurationV2::Pay(_) | v2::NodeConfigurationV2::ReturnToOwner(_) => {
                    let (amount, bps) = v2::amount_and_bps(&env, state);
                    let mut steps = Vec::new(&env);
                    for address in state.next_steps.iter() {
                        steps.push_back(payer::WorkflowTarget {
                            address,
                            data: s(&env, ""),
                        });
                    }
                    env.register_at(
                        &state.contract_address,
                        Payer,
                        (
                            &admin,
                            &asset,
                            init,
                            amount,
                            bps,
                            steps,
                            state.parent.clone().unwrap(),
                        ),
                    );
                }
                v2::NodeConfigurationV2::Split(_) => {
                    env.register_at(
                        &state.contract_address,
                        Splitter,
                        (
                            &admin,
                            &asset,
                            init,
                            0i128,
                            state.parent.clone().unwrap(),
                            Vec::<paiflow_splitter::WorkflowTarget>::new(&env),
                        ),
                    );
                }
                v2::NodeConfigurationV2::Condition(_) => {
                    env.register_at(
                        &state.contract_address,
                        Router,
                        (
                            &admin,
                            &asset,
                            init,
                            vec![
                                &env,
                                router::WorkflowTarget {
                                    address: yes_address.clone(),
                                    data: s(&env, ""),
                                },
                            ],
                            vec![
                                &env,
                                router::WorkflowTarget {
                                    address: no_address.clone(),
                                    data: s(&env, ""),
                                },
                            ],
                            state.parent.clone().unwrap(),
                        ),
                    );
                }
            }
        }
        Self {
            env,
            root,
            prefix: prefix_address,
            condition,
            yes: yes_address,
            no: no_address,
            asset,
            admin,
            payer,
            platform,
            worker,
            manifest,
        }
    }
    pub fn bindings(&self) -> Vec<v2::GraphBindingV2> {
        let mut result = Vec::new(&self.env);
        for entry in self.manifest.nodes.iter() {
            result.push_back(v2::GraphBindingV2 {
                node_id: entry.state.node_id,
                contract_address: entry.state.contract_address,
                expected_revision: 0,
                wasm_hash: entry.wasm_hash,
            });
        }
        result
    }
    pub fn route(&self, amount: i128) -> v2::RouteV2 {
        let mut remaining = amount;
        for entry in self.manifest.nodes.iter() {
            if !entry.state.next_steps.is_empty() {
                if let v2::NodeConfigurationV2::Pay(config) = entry.state.configuration {
                    remaining -= match config.payout_rule {
                        v1::PayoutRule::Fixed(v) => v,
                        v1::PayoutRule::Percentage(v) => {
                            (remaining / 10000) * i128::from(v)
                                + ((remaining % 10000) * i128::from(v)) / 10000
                        }
                        v1::PayoutRule::Full => remaining,
                    };
                }
            }
        }
        let condition = match self
            .manifest
            .nodes
            .get(v2::condition_index(&self.manifest))
            .unwrap()
            .state
            .configuration
        {
            v2::NodeConfigurationV2::Condition(v) => v,
            _ => panic!(),
        };
        let truth = match condition.comparison {
            v2::ComparisonV2::AmountGt => remaining > condition.threshold,
            v2::ComparisonV2::AmountLt => remaining < condition.threshold,
        };
        v2::RouteV2 {
            selected_branch: if truth {
                v2::BranchV2::True
            } else {
                v2::BranchV2::False
            },
            amount_at_condition: remaining,
        }
    }
    pub fn inputs(&self, route: &v2::RouteV2) -> Vec<v1::NodeInput> {
        let state = self
            .manifest
            .nodes
            .get(v2::selected_index(&self.manifest, &route.selected_branch))
            .unwrap()
            .state;
        match state.configuration {
            v2::NodeConfigurationV2::Pay(_) => vec![
                &self.env,
                v1::NodeInput::Pay(v1::PayInput {
                    node_id: state.node_id,
                    recipient: self.worker.clone(),
                }),
            ],
            v2::NodeConfigurationV2::Split(v)
                if v.policy
                    .rows
                    .iter()
                    .any(|r| r.recipient_mode == v1::FieldMode::Execution) =>
            {
                vec![
                    &self.env,
                    v1::NodeInput::Split(v1::SplitInput {
                        node_id: state.node_id,
                        rows: vec![
                            &self.env,
                            v1::RowInput {
                                row_id: s(&self.env, "worker"),
                                recipient: Some(self.worker.clone()),
                                allocation: v1::MaybeAllocation::Missing,
                            },
                        ],
                        additional: None,
                    }),
                ]
            }
            _ => Vec::new(&self.env),
        }
    }
    pub fn args(
        &self,
        amount: i128,
        nonce: u8,
        expiry: u32,
        bindings: &Vec<v2::GraphBindingV2>,
        inputs: &Vec<v1::NodeInput>,
        route: &v2::RouteV2,
    ) -> Vec<Val> {
        (
            &self.payer,
            &self.asset,
            amount,
            BytesN::from_array(&self.env, &[nonce; 32]),
            expiry,
            bindings,
            inputs,
            route,
        )
            .into_val(&self.env)
    }
    pub fn authorize(&self, amount: i128, args: Vec<Val>) {
        self.authorize_for(&self.payer, amount, args);
    }
    pub fn authorize_for(&self, payer: &Address, amount: i128, args: Vec<Val>) {
        let account: xdr::ScAddress = payer.into();
        let xdr::ScAddress::Account(account) = account else {
            panic!()
        };
        self.env.host().set_source_account(account).unwrap();
        self.env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: (&MockAuthInvoke {
                contract: &self.root,
                fn_name: "execute_v2",
                args,
                sub_invokes: &[MockAuthInvoke {
                    contract: &self.asset,
                    fn_name: "transfer",
                    args: (payer, &self.root, amount).into_val(&self.env),
                    sub_invokes: &[],
                }],
            })
                .into(),
        }]);
    }
    pub fn try_args(&self, args: Vec<Val>) -> bool {
        self.env.cost_estimate().budget().reset_default();
        self.env
            .try_invoke_contract::<(), soroban_sdk::Error>(
                &self.root,
                &Symbol::new(&self.env, "execute_v2"),
                args,
            )
            .is_ok()
    }
    pub fn execute(&self, amount: i128, nonce: u8) -> bool {
        let route = self.route(amount);
        let args = self.args(
            amount,
            nonce,
            100,
            &self.bindings(),
            &self.inputs(&route),
            &route,
        );
        self.authorize(amount, args.clone());
        self.try_args(args)
    }
    pub fn balance(&self, address: &Address) -> i128 {
        token::Client::new(&self.env, &self.asset).balance(address)
    }
    pub fn mint(&self, address: &Address, amount: i128) {
        payment_test_token::WideTokenClient::new(&self.env, &self.asset).mint(address, &amount);
    }
    pub fn status(&self, address: &Address) -> v2::MutationStatusV2 {
        self.env.invoke_contract(
            address,
            &Symbol::new(&self.env, "mutation_status_v2"),
            Vec::new(&self.env),
        )
    }
}
