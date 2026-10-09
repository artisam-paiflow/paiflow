use deposit_trigger::{DepositTrigger, DepositTriggerClient};
use paiflow_splitter::{Recipient, Splitter, SplitterClient};
use paiflow_subscription::{SubscriptionTrigger, SubscriptionTriggerClient};
use paiflow_webhook::{WebhookTrigger, WebhookTriggerClient};
use payer::{Payer, PayerClient, WorkflowTarget};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    token, vec, Address, ConversionError, Env, Error, IntoVal, InvokeError, String, Symbol, Val,
    Vec,
};

type InvocationResult = Result<Result<(), ConversionError>, Result<Error, InvokeError>>;

#[path = "support/terminal-forwarding.rs"]
mod terminal_forwarding;

fn execution_args(
    env: &Env,
    asset: &Address,
    amount: i128,
    from: Option<&Address>,
) -> (Symbol, Vec<Val>) {
    match from {
        Some(from) => (
            Symbol::new(env, "receive_and_forward"),
            (from, asset, amount, Vec::<WorkflowTarget>::new(env)).into_val(env),
        ),
        None => (
            Symbol::new(env, "execute_step"),
            (asset, amount).into_val(env),
        ),
    }
}

#[contract]
struct Parent;

#[contractimpl]
impl Parent {
    // Only a test driver: real trigger authorization is exercised below.
    pub fn send(env: Env, target: Address, asset: Address, amount: i128, from: Option<Address>) {
        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &target,
            &amount,
        );
        Self::call(env, target, asset, amount, from);
    }

    pub fn call(env: Env, target: Address, asset: Address, amount: i128, from: Option<Address>) {
        let (function, args) = execution_args(&env, &asset, amount, from.as_ref());
        env.invoke_contract::<()>(&target, &function, args);
    }
}

#[derive(Clone, Copy, Debug)]
enum Kind {
    PayFixed,
    PayPercentage,
    SplitFixed,
    SplitPercentage,
}

const KINDS: [Kind; 4] = [
    Kind::PayFixed,
    Kind::PayPercentage,
    Kind::SplitFixed,
    Kind::SplitPercentage,
];

impl Kind {
    fn is_split(self) -> bool {
        matches!(self, Self::SplitFixed | Self::SplitPercentage)
    }

    fn unauthorized(self) -> Error {
        Error::from_contract_error(if self.is_split() { 5 } else { 2 })
    }

    fn invalid_amount(self) -> Error {
        Error::from_contract_error(if self.is_split() { 6 } else { 3 })
    }
}

fn register_action(
    env: &Env,
    kind: Kind,
    address: &Address,
    parent: &Address,
    admin: &Address,
    asset: &Address,
    recipients: (&Address, &Address),
) {
    let (a, b) = recipients;
    match kind {
        Kind::PayFixed | Kind::PayPercentage => {
            let (amount, bps) = if matches!(kind, Kind::PayFixed) {
                (100_i128, 0_u32)
            } else {
                (0, 5_000)
            };
            env.register_at(
                address,
                Payer,
                (
                    admin,
                    asset,
                    a,
                    amount,
                    bps,
                    Vec::<WorkflowTarget>::new(env),
                    parent,
                    false,
                ),
            );
        }
        Kind::SplitFixed | Kind::SplitPercentage => {
            let fixed = matches!(kind, Kind::SplitFixed);
            let recipients = vec![
                env,
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
            ];
            env.register_at(
                address,
                Splitter,
                (
                    admin,
                    asset,
                    recipients,
                    0_i128,
                    parent,
                    Vec::<paiflow_splitter::WorkflowTarget>::new(env),
                ),
            );
        }
    }
}

struct World {
    env: Env,
    kind: Kind,
    admin: Address,
    asset: Address,
    parent: Address,
    action: Address,
    a: Address,
    b: Address,
}

impl World {
    fn new(kind: Kind) -> Self {
        let env = Env::default();
        env.ledger().set_timestamp(100);
        let admin = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let parent = env.register(Parent, ());
        let action = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        register_action(&env, kind, &action, &parent, &admin, &asset, (&a, &b));
        Self {
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

    fn authorize(&self, who: &Address, target: &Address, function: &str, args: Vec<Val>) {
        self.env.mock_auths(&[MockAuth {
            address: who,
            invoke: &MockAuthInvoke {
                contract: target,
                fn_name: function,
                args,
                sub_invokes: &[],
            },
        }]);
    }

    fn mint(&self, to: &Address, amount: i128) {
        self.authorize(
            &self.admin,
            &self.asset,
            "mint",
            (to, amount).into_val(&self.env),
        );
        token::StellarAssetClient::new(&self.env, &self.asset).mint(to, &amount);
        self.env.set_auths(&[]);
    }

    fn balances(&self) -> (i128, i128, i128) {
        let token = token::Client::new(&self.env, &self.asset);
        (
            token.balance(&self.action),
            token.balance(&self.a),
            token.balance(&self.b),
        )
    }

    fn accumulated(&self) -> i128 {
        if self.kind.is_split() {
            SplitterClient::new(&self.env, &self.action).accumulated_balance()
        } else {
            0
        }
    }

    fn try_action(
        &self,
        asset: &Address,
        amount: i128,
        from: Option<&Address>,
    ) -> InvocationResult {
        let (function, args) = execution_args(&self.env, asset, amount, from);
        self.env.try_invoke_contract(&self.action, &function, args)
    }

    fn assert_no_action_events(&self) {
        assert!(self
            .env
            .events()
            .all()
            .filter_by_contract(&self.action)
            .events()
            .is_empty());
    }

    fn assert_payout(&self, incoming: i128) {
        let expected = match self.kind {
            Kind::PayFixed => (incoming - 100, 100, 0),
            Kind::PayPercentage => (incoming - incoming / 2, incoming / 2, 0),
            Kind::SplitFixed => (incoming - 100, 60, 40),
            Kind::SplitPercentage => (
                0,
                incoming * 6_000 / 10_000,
                incoming - incoming * 6_000 / 10_000,
            ),
        };
        assert_eq!(self.balances(), expected, "{:?}", self.kind);
    }
}

#[test]
fn direct_calls_cannot_spend_retained_funds_or_inflate_accounting() {
    for kind in KINDS {
        let w = World::new(kind);
        w.mint(&w.action, 1_000);
        for from in [None, Some(&w.parent)] {
            assert!(w.try_action(&w.asset, 100, from).is_err(), "{kind:?}");
            w.assert_no_action_events();
            assert_eq!(w.balances(), (1_000, 0, 0));
            assert_eq!(w.accumulated(), 0);
        }
    }
}

#[test]
fn unrelated_contract_cannot_impersonate_parent_and_its_transfer_rolls_back() {
    for kind in KINDS {
        let w = World::new(kind);
        w.mint(&w.action, 1_000);
        let stranger = w.env.register(Parent, ());
        w.mint(&stranger, 100);
        let caller = ParentClient::new(&w.env, &stranger);
        for from in [None, Some(w.parent.clone()), Some(stranger.clone())] {
            assert!(caller.try_send(&w.action, &w.asset, &100, &from).is_err());
            w.assert_no_action_events();
            assert_eq!(token::Client::new(&w.env, &w.asset).balance(&stranger), 100);
            assert_eq!(w.balances(), (1_000, 0, 0));
            assert_eq!(w.accumulated(), 0);
        }
    }
}

#[test]
fn authenticated_unrelated_account_is_rejected_with_unauthorized() {
    for kind in KINDS {
        let w = World::new(kind);
        w.mint(&w.action, 1_000);
        let stranger = Address::generate(&w.env);
        let (_, args) = execution_args(&w.env, &w.asset, 100, Some(&stranger));
        w.authorize(&stranger, &w.action, "receive_and_forward", args);
        assert_eq!(
            w.try_action(&w.asset, 100, Some(&stranger)),
            Err(Ok(kind.unauthorized()))
        );
        w.assert_no_action_events();
        assert_eq!(w.balances(), (1_000, 0, 0));
        assert_eq!(w.accumulated(), 0);
    }
}

#[test]
fn real_parent_cannot_supply_forged_sender_attribution() {
    for kind in KINDS {
        let w = World::new(kind);
        w.mint(&w.parent, 100);
        let forged = Address::generate(&w.env);
        assert!(ParentClient::new(&w.env, &w.parent)
            .try_send(&w.action, &w.asset, &100, &Some(forged))
            .is_err());
        w.assert_no_action_events();
        assert_eq!(w.balances(), (0, 0, 0));
        assert_eq!(w.accumulated(), 0);
        assert_eq!(token::Client::new(&w.env, &w.asset).balance(&w.parent), 100);
    }
}

#[test]
fn both_entry_points_preserve_parent_authorized_payouts_and_rounding() {
    for kind in KINDS {
        for receive in [false, true] {
            let w = World::new(kind);
            w.mint(&w.parent, 101);
            let from = receive.then(|| w.parent.clone());
            let recipients = kind
                .is_split()
                .then(|| SplitterClient::new(&w.env, &w.action).recipients());
            ParentClient::new(&w.env, &w.parent).send(&w.action, &w.asset, &101, &from);
            if let Some(recipients) = recipients {
                assert_eq!(
                    w.env.events().all().filter_by_contract(&w.action),
                    vec![
                        &w.env,
                        (
                            w.action.clone(),
                            vec![
                                &w.env,
                                symbol_short!("payout").into_val(&w.env),
                                w.parent.clone().into_val(&w.env)
                            ],
                            recipients.into_val(&w.env)
                        ),
                    ]
                );
            } else {
                assert_eq!(
                    w.env.events().all().filter_by_contract(&w.action),
                    vec![
                        &w.env,
                        (
                            w.action.clone(),
                            vec![
                                &w.env,
                                symbol_short!("pay").into_val(&w.env),
                                w.a.clone().into_val(&w.env)
                            ],
                            (
                                w.asset.clone(),
                                if matches!(kind, Kind::PayFixed) {
                                    100_i128
                                } else {
                                    50_i128
                                }
                            )
                                .into_val(&w.env)
                        ),
                    ]
                );
            }
            w.assert_payout(101);
        }
    }
}

#[test]
fn fixed_split_accumulates_real_deposits_across_both_entry_points() {
    let w = World::new(Kind::SplitFixed);
    w.mint(&w.parent, 110);
    let caller = ParentClient::new(&w.env, &w.parent);
    caller.send(&w.action, &w.asset, &30, &None);
    assert_eq!(w.balances(), (30, 0, 0));
    assert_eq!(w.accumulated(), 30);
    assert!(w.try_action(&w.asset, 70, Some(&w.parent)).is_err());
    assert_eq!(w.accumulated(), 30);
    caller.send(&w.action, &w.asset, &80, &Some(w.parent.clone()));
    assert_eq!(w.balances(), (10, 60, 40));
    assert_eq!(w.accumulated(), 10);
}

#[test]
fn both_entry_points_preserve_asset_amount_and_pause_checks() {
    for kind in KINDS {
        let w = World::new(kind);
        let caller = ParentClient::new(&w.env, &w.parent);
        let wrong_asset = w
            .env
            .register_stellar_asset_contract_v2(w.admin.clone())
            .address();
        for from in [None, Some(w.parent.clone())] {
            // Exact contract errors ensure auth passed and domain checks ran.
            let invoke = |asset: &Address, amount: i128| -> InvocationResult {
                w.env.try_invoke_contract(
                    &w.parent,
                    &Symbol::new(&w.env, "call"),
                    (&w.action, asset, amount, &from).into_val(&w.env),
                )
            };
            assert_eq!(invoke(&wrong_asset, 100), Err(Ok(kind.unauthorized())));
            for amount in [0, -1] {
                assert_eq!(invoke(&w.asset, amount), Err(Ok(kind.invalid_amount())));
                w.assert_no_action_events();
                assert_eq!(w.accumulated(), 0);
            }
        }
        if kind.is_split() {
            w.authorize(&w.admin, &w.action, "pause", ().into_val(&w.env));
            SplitterClient::new(&w.env, &w.action).pause();
            w.env.set_auths(&[]);
            w.mint(&w.parent, 100);
            for from in [None, Some(w.parent.clone())] {
                assert!(caller.try_send(&w.action, &w.asset, &100, &from).is_err());
                w.assert_no_action_events();
                assert_eq!(w.balances(), (0, 0, 0));
                assert_eq!(w.accumulated(), 0);
            }
            assert_eq!(token::Client::new(&w.env, &w.asset).balance(&w.parent), 100);
        }
    }
}

#[test]
fn receive_trigger_executes_real_actions_with_only_depositor_authorization() {
    for kind in KINDS {
        let w = World::new(kind);
        w.env.register_at(
            &w.parent,
            DepositTrigger,
            (
                w.admin.clone(),
                w.asset.clone(),
                vec![
                    &w.env,
                    deposit_trigger::WorkflowTarget {
                        address: w.action.clone(),
                        data: String::from_str(&w.env, ""),
                    },
                ],
            ),
        );
        let depositor = Address::generate(&w.env);
        w.mint(&depositor, 101);
        w.env.mock_auths(&[MockAuth {
            address: &depositor,
            invoke: &MockAuthInvoke {
                contract: &w.parent,
                fn_name: "deposit",
                args: (&depositor, 101_i128).into_val(&w.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &w.asset,
                    fn_name: "transfer",
                    args: (&depositor, &w.parent, 101_i128).into_val(&w.env),
                    sub_invokes: &[],
                }],
            },
        }]);
        DepositTriggerClient::new(&w.env, &w.parent).deposit(&depositor, &101);
        w.assert_payout(101);
    }
}

#[test]
fn subscription_executes_real_actions_with_only_relayer_authorization() {
    for kind in KINDS {
        let w = World::new(kind);
        let subscriber = Address::generate(&w.env);
        let relayer = Address::generate(&w.env);
        w.env.register_at(
            &w.parent,
            SubscriptionTrigger,
            (
                w.admin.clone(),
                w.asset.clone(),
                subscriber.clone(),
                101_i128,
                vec![
                    &w.env,
                    paiflow_subscription::WorkflowTarget {
                        address: w.action.clone(),
                        data: String::from_str(&w.env, ""),
                    },
                ],
                relayer.clone(),
                100_u64,
                60_u64,
                1_000_u64,
            ),
        );
        w.mint(&subscriber, 202);
        w.authorize(
            &subscriber,
            &w.asset,
            "approve",
            (&subscriber, &w.parent, 202_i128, 1_000_u32).into_val(&w.env),
        );
        token::Client::new(&w.env, &w.asset).approve(&subscriber, &w.parent, &202, &1_000);
        w.authorize(
            &relayer,
            &w.parent,
            "charge_by_relayer",
            ().into_val(&w.env),
        );
        let client = SubscriptionTriggerClient::new(&w.env, &w.parent);
        client.charge_by_relayer();
        w.env.set_auths(&[]);
        w.assert_payout(101);
        assert_eq!(client.next_charge_at(), 160);
        assert_eq!(
            token::Client::new(&w.env, &w.asset).balance(&subscriber),
            101
        );
        assert!(client.try_charge_by_relayer().is_err());
        assert_eq!(client.next_charge_at(), 160);
    }
}

#[test]
fn webhook_executes_real_actions_with_exact_relayer_and_sender_authorizations() {
    for kind in KINDS {
        for escrow in [false, true] {
            let w = World::new(kind);
            let relayer = Address::generate(&w.env);
            w.env.register_at(
                &w.parent,
                WebhookTrigger,
                (
                    w.admin.clone(),
                    w.asset.clone(),
                    relayer.clone(),
                    vec![
                        &w.env,
                        paiflow_webhook::WorkflowTarget {
                            address: w.action.clone(),
                            data: String::from_str(&w.env, ""),
                        },
                    ],
                ),
            );
            let client = WebhookTriggerClient::new(&w.env, &w.parent);
            if escrow {
                w.mint(&w.parent, 101);
                w.authorize(
                    &relayer,
                    &w.parent,
                    "execute_escrow",
                    (0_i128,).into_val(&w.env),
                );
                client.execute_escrow(&0);
            } else {
                let sender = Address::generate(&w.env);
                w.mint(&sender, 101);
                let args = (&sender, 101_i128).into_val(&w.env);
                w.env.mock_auths(&[
                    MockAuth {
                        address: &relayer,
                        invoke: &MockAuthInvoke {
                            contract: &w.parent,
                            fn_name: "execute",
                            args,
                            sub_invokes: &[],
                        },
                    },
                    MockAuth {
                        address: &sender,
                        invoke: &MockAuthInvoke {
                            contract: &w.parent,
                            fn_name: "execute",
                            args: (&sender, 101_i128).into_val(&w.env),
                            sub_invokes: &[MockAuthInvoke {
                                contract: &w.asset,
                                fn_name: "transfer",
                                args: (&sender, &w.parent, 101_i128).into_val(&w.env),
                                sub_invokes: &[],
                            }],
                        },
                    },
                ]);
                client.execute(&sender, &101);
            }
            w.env.set_auths(&[]);
            w.assert_payout(101);
            assert_eq!(token::Client::new(&w.env, &w.asset).balance(&w.parent), 0);
        }
    }
}

#[test]
fn real_payer_and_splitter_forward_into_each_other_without_extra_signatures() {
    for (upstream, downstream) in [
        (Kind::PayFixed, Kind::SplitPercentage),
        (Kind::SplitFixed, Kind::PayPercentage),
    ] {
        let w = World::new(upstream);
        let next = Address::generate(&w.env);
        let next_a = Address::generate(&w.env);
        let next_b = Address::generate(&w.env);
        register_action(
            &w.env,
            downstream,
            &next,
            &w.action,
            &w.admin,
            &w.asset,
            (&next_a, &next_b),
        );
        w.authorize(
            &w.admin,
            &w.action,
            "set_next_steps",
            (vec![
                &w.env,
                WorkflowTarget {
                    address: next.clone(),
                    data: String::from_str(&w.env, ""),
                },
            ],)
                .into_val(&w.env),
        );
        if upstream.is_split() {
            SplitterClient::new(&w.env, &w.action).set_next_steps(&vec![
                &w.env,
                paiflow_splitter::WorkflowTarget {
                    address: next.clone(),
                    data: String::from_str(&w.env, ""),
                },
            ]);
        } else {
            PayerClient::new(&w.env, &w.action).set_next_steps(&vec![
                &w.env,
                WorkflowTarget {
                    address: next.clone(),
                    data: String::from_str(&w.env, ""),
                },
            ]);
        }
        w.env.set_auths(&[]);
        w.mint(&w.parent, 1_100);
        ParentClient::new(&w.env, &w.parent).send(
            &w.action,
            &w.asset,
            &1_100,
            &Some(w.parent.clone()),
        );
        let tok = token::Client::new(&w.env, &w.asset);
        assert_eq!(tok.balance(&w.action), 0);
        match downstream {
            Kind::SplitPercentage => {
                assert_eq!(tok.balance(&next_a), 600);
                assert_eq!(tok.balance(&next_b), 400);
                assert_eq!(tok.balance(&next), 0);
            }
            Kind::PayPercentage => {
                assert_eq!(tok.balance(&next_a), 500);
                assert_eq!(tok.balance(&next), 500);
                assert_eq!(w.accumulated(), 0);
            }
            _ => unreachable!(),
        }
    }
}

#[test]
fn downstream_failure_rolls_back_payments_accounting_and_incoming_transfers() {
    for kind in [Kind::PayFixed, Kind::SplitFixed] {
        let w = World::new(kind);
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
        let steps = vec![
            &w.env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&w.env, ""),
            },
        ];
        w.authorize(
            &w.admin,
            &w.action,
            "set_next_steps",
            (&steps,).into_val(&w.env),
        );
        if kind.is_split() {
            SplitterClient::new(&w.env, &w.action).set_next_steps(&vec![
                &w.env,
                paiflow_splitter::WorkflowTarget {
                    address: next.clone(),
                    data: String::from_str(&w.env, ""),
                },
            ]);
        } else {
            PayerClient::new(&w.env, &w.action).set_next_steps(&steps);
        }
        w.env.set_auths(&[]);
        w.mint(&w.parent, 1_100);
        for from in [None, Some(w.parent.clone())] {
            assert!(ParentClient::new(&w.env, &w.parent)
                .try_send(&w.action, &w.asset, &1_100, &from)
                .is_err());
            w.assert_no_action_events();
            assert_eq!(w.balances(), (0, 0, 0));
            assert_eq!(w.accumulated(), 0);
            let token = token::Client::new(&w.env, &w.asset);
            assert_eq!(token.balance(&w.parent), 1_100);
            assert_eq!(token.balance(&next), 0);
        }
    }
}
