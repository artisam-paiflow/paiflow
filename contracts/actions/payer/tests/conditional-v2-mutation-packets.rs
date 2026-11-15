//! Production constructor/mutation/payment packets, with real admin/payer auth.
use deposit_trigger::DepositTrigger;
use paiflow_splitter::Splitter;
use payer::{conditional_v2 as v2, Payer};
use router::Router;
use soroban_sdk::{
    testutils::{Events as _, Ledger as _, MockAuthInvoke},
    xdr::{self, FromXdr},
    Address, Bytes, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
};
#[path = "../../../payment-test-token.rs"]
mod payment_test_token;
fn value<T: TryFromVal<Env, Val>>(env: &Env, values: &Vec<Val>, index: u32) -> T {
    T::try_from_val(env, &values.get(index).unwrap())
        .ok()
        .unwrap()
}
fn target() -> std::path::PathBuf {
    std::env::var_os("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target"))
}
fn decode_hex(value: &str) -> std::vec::Vec<u8> {
    value
        .trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digit = |b| match b {
                b'0'..=b'9' => b - b'0',
                b'a'..=b'f' => b - b'a' + 10,
                _ => panic!("hex"),
            };
            digit(pair[0]) * 16 + digit(pair[1])
        })
        .collect()
}
fn changed_id(change: &v2::NodeChangeV2) -> String {
    match change {
        v2::NodeChangeV2::Pay(v) => v.node_id.clone(),
        v2::NodeChangeV2::Split(v) => v.node_id.clone(),
        v2::NodeChangeV2::Condition(v) => v.node_id.clone(),
    }
}
fn admin_invocations(
    env: &Env,
    graph: &v2::GraphManifestV2,
    address: &Address,
    context: &v2::MutationContextV2,
) -> std::vec::Vec<xdr::SorobanAuthorizedInvocation> {
    let state = graph
        .nodes
        .get(v2::index(env, graph, address))
        .unwrap()
        .state;
    let children = state
        .next_steps
        .iter()
        .flat_map(|child| admin_invocations(env, graph, &child, context))
        .collect::<std::vec::Vec<_>>();
    if *address != graph.root
        && !context
            .changes
            .iter()
            .any(|change| changed_id(&change) == state.node_id)
    {
        return children;
    }
    let root = *address == graph.root;
    let args = if root {
        (&context.bindings, &context.changes).into_val(env)
    } else {
        (context,).into_val(env)
    };
    let mut invocation: xdr::SorobanAuthorizedInvocation = (&MockAuthInvoke {
        contract: address,
        fn_name: if root { "mutate_v2" } else { "mutate_step_v2" },
        args,
        sub_invokes: &[],
    })
        .into();
    invocation.sub_invocations = children.try_into().unwrap();
    std::vec![invocation]
}
struct World {
    env: Env,
    graph: v2::GraphManifestV2,
    mutation: Vec<Val>,
    wallets: std::vec::Vec<Address>,
    asset: Address,
    guest: bool,
}
impl World {
    fn token(&self) -> payment_test_token::WideTokenClient<'_> {
        payment_test_token::WideTokenClient::new(&self.env, &self.asset)
    }
    fn balance(&self, address: &Address) -> i128 {
        self.token().balance(address)
    }
    fn status(&self, address: &Address) -> v2::MutationStatusV2 {
        self.env.invoke_contract(
            address,
            &Symbol::new(&self.env, "mutation_status_v2"),
            Vec::new(&self.env),
        )
    }
    fn addresses(&self) -> std::vec::Vec<Address> {
        self.wallets
            .iter()
            .cloned()
            .chain(
                self.graph
                    .nodes
                    .iter()
                    .map(|node| node.state.contract_address),
            )
            .collect()
    }
    fn mutate(&self, succeeds: bool) {
        let before = self
            .addresses()
            .iter()
            .map(|address| self.balance(address))
            .collect::<std::vec::Vec<_>>();
        let context = v2::MutationContextV2 {
            root: self.graph.root.clone(),
            admin: self.graph.admin.clone(),
            bindings: value(&self.env, &self.mutation, 0),
            changes: value(&self.env, &self.mutation, 1),
        };
        let xdr::ScAddress::Account(account) = xdr::ScAddress::from(&self.graph.admin) else {
            panic!()
        };
        self.env.host().set_source_account(account).unwrap();
        self.env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: admin_invocations(&self.env, &self.graph, &self.graph.root, &context)
                .remove(0),
        }]);
        self.env.cost_estimate().budget().reset_default();
        let result = self.env.try_invoke_contract::<(), soroban_sdk::Error>(
            &self.graph.root,
            &Symbol::new(&self.env, "mutate_v2"),
            self.mutation.clone(),
        );
        assert_eq!(result.is_ok(), succeeds, "mutation {result:?}");
        let cpu = self.env.cost_estimate().budget().cpu_instruction_cost();
        let memory = self.env.cost_estimate().budget().memory_bytes_cost();
        if succeeds {
            let events = self.env.events().all();
            assert_eq!(events.events().len(), context.changes.len() as usize);
            for event in events.events() {
                let xdr::ContractEventBody::V0(body) = &event.body;
                assert_eq!(
                    body.topics[0],
                    xdr::ScVal::Symbol("config_v2".try_into().unwrap())
                );
                let state = v2::NodeStateV2::try_from_val(&self.env, &body.data).unwrap();
                assert_eq!(state.revision, 1);
                let xdr::ScAddress::Contract(id) = xdr::ScAddress::from(&state.contract_address)
                else {
                    panic!()
                };
                assert_eq!(event.contract_id, Some(id));
                assert_eq!(self.status(&state.contract_address).state, state);
            }
            for entry in self.graph.nodes.iter() {
                let state = self.status(&entry.state.contract_address).state;
                assert_eq!(
                    state.revision,
                    if context
                        .changes
                        .iter()
                        .any(|change| changed_id(&change) == state.node_id)
                    {
                        1
                    } else {
                        0
                    }
                );
                let initial: v2::NodeStateV2 = self.env.invoke_contract(
                    &state.contract_address,
                    &Symbol::new(&self.env, "initial_config_v2"),
                    Vec::new(&self.env),
                );
                assert_eq!(initial, entry.state);
            }
        }
        for (address, balance) in self.addresses().iter().zip(before) {
            assert_eq!(
                self.balance(address),
                balance,
                "mutation transfers no funds"
            );
        }
        if self.guest {
            std::println!("mutation success={succeeds}: {cpu} instructions, {memory} metered memory bytes (default actual budget; real admin auth)");
        }
    }
    fn execute(&self, call: &Vec<Val>) {
        let name: String = value(&self.env, call, 0);
        let args: Vec<Val> = value(&self.env, call, 1);
        let succeeds: bool = value(&self.env, call, 2);
        let payouts: Vec<Val> = value(&self.env, call, 3);
        let payer: Address = value(&self.env, &args, 0);
        let amount: i128 = value(&self.env, &args, 2);
        let before = self
            .wallets
            .iter()
            .map(|address| self.balance(address))
            .collect::<std::vec::Vec<_>>();
        let xdr::ScAddress::Account(account) = xdr::ScAddress::from(&payer) else {
            panic!()
        };
        self.env.host().set_source_account(account).unwrap();
        self.env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: (&MockAuthInvoke {
                contract: &self.graph.root,
                fn_name: "execute_v2",
                args: args.clone(),
                sub_invokes: &[MockAuthInvoke {
                    contract: &self.asset,
                    fn_name: "transfer",
                    args: (&payer, &self.graph.root, amount).into_val(&self.env),
                    sub_invokes: &[],
                }],
            })
                .into(),
        }]);
        self.env.cost_estimate().budget().reset_default();
        let result = self.env.try_invoke_contract::<(), soroban_sdk::Error>(
            &self.graph.root,
            &Symbol::new(&self.env, "execute_v2"),
            args,
        );
        assert_eq!(result.is_ok(), succeeds, "{name:?} {result:?}");
        let cpu = self.env.cost_estimate().budget().cpu_instruction_cost();
        let memory = self.env.cost_estimate().budget().memory_bytes_cost();
        for (address, balance) in self.wallets.iter().zip(before) {
            let mut delta = if succeeds && *address == payer {
                -amount
            } else {
                0
            };
            for payout in payouts.iter() {
                let payout = Vec::<Val>::try_from_val(&self.env, &payout).unwrap();
                if succeeds && *address == value::<Address>(&self.env, &payout, 0) {
                    delta += value::<i128>(&self.env, &payout, 1);
                }
            }
            assert_eq!(
                self.balance(address),
                balance + delta,
                "{name:?} {address:?}"
            );
        }
        for entry in self.graph.nodes.iter() {
            let state = &entry.state;
            let obligations = self.status(&state.contract_address).obligations;
            assert_eq!(
                self.balance(&state.contract_address),
                77 + obligations,
                "{name:?} untouched surplus and exact debt"
            );
        }
        if self.guest {
            std::println!("{name:?}: {cpu} instructions, {memory} metered memory bytes (default actual budget; real payer auth)");
        }
    }
}
fn run(path: &std::path::Path, guest: bool) {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_sequence_number(10);
    env.host().set_invocation_hook(None).unwrap();
    let packet = Vec::<Val>::from_xdr(
        &env,
        &Bytes::from_slice(&env, &decode_hex(&std::fs::read_to_string(path).unwrap())),
    )
    .unwrap();
    let admin: Address = value(&env, &packet, 0);
    let asset: Address = value(&env, &packet, 1);
    let nodes: Vec<Val> = value(&env, &packet, 2);
    let mutation: Vec<Val> = value(&env, &packet, 3);
    let calls: Vec<Val> = value(&env, &packet, 4);
    env.register_at(&asset, payment_test_token::WideToken, ());
    let token = payment_test_token::WideTokenClient::new(&env, &asset);
    let mut graph = None;
    for node in nodes.iter() {
        let node = Vec::<Val>::try_from_val(&env, &node).unwrap();
        let address: Address = value(&env, &node, 1);
        let family: String = value(&env, &node, 2);
        let args: Vec<Val> = value(&env, &node, 3);
        let init = v2::NodeInitV2::try_from_val(&env, &args.get(2).unwrap()).unwrap();
        if graph.is_none() {
            graph = Some(init.manifest.clone());
        }
        let filename = if family == String::from_str(&env, "DEPOSIT_TRIGGER") {
            if !guest {
                env.register_at(&address, DepositTrigger, args.clone());
            }
            "deposit_trigger"
        } else if family == String::from_str(&env, "PAYER") {
            if !guest {
                env.register_at(&address, Payer, args.clone());
            }
            "payer"
        } else if family == String::from_str(&env, "SPLITTER") {
            if !guest {
                env.register_at(&address, Splitter, args.clone());
            }
            "paiflow_splitter"
        } else {
            assert_eq!(family, String::from_str(&env, "ROUTER"));
            if !guest {
                env.register_at(&address, Router, args.clone());
            }
            "router"
        };
        if guest {
            let bytes = std::fs::read(
                target()
                    .join("wasm32v1-none/release")
                    .join(format!("{filename}.wasm")),
            )
            .unwrap();
            let pin = init
                .manifest
                .nodes
                .iter()
                .find(|entry| entry.state.contract_address == address)
                .unwrap()
                .wasm_hash;
            assert_eq!(
                pin,
                env.crypto()
                    .sha256(&Bytes::from_slice(&env, &bytes))
                    .to_bytes()
            );
            env.register_at(&address, bytes.as_slice(), args);
        }
        token.mint(&address, &77);
    }
    let mut wallets = std::vec![admin];
    for call in calls.iter() {
        let call = Vec::<Val>::try_from_val(&env, &call).unwrap();
        let args: Vec<Val> = value(&env, &call, 1);
        let payer: Address = value(&env, &args, 0);
        if !wallets.contains(&payer) {
            token.mint(&payer, &100000);
            wallets.push(payer);
        }
        for payout in value::<Vec<Val>>(&env, &call, 3).iter() {
            let payout = Vec::<Val>::try_from_val(&env, &payout).unwrap();
            let recipient: Address = value(&env, &payout, 0);
            if !wallets.contains(&recipient) {
                wallets.push(recipient);
            }
        }
    }
    let w = World {
        env,
        graph: graph.unwrap(),
        mutation,
        wallets,
        asset,
        guest,
    };
    let accumulation = path.file_stem().unwrap() == "accumulation";
    for (i, call) in calls.iter().enumerate() {
        let call = Vec::<Val>::try_from_val(&w.env, &call).unwrap();
        w.execute(&call);
        if !accumulation && i == 0 {
            w.mutate(true);
            w.mutate(false);
        }
        if accumulation && i == 0 {
            w.mutate(false);
            let yes = w
                .graph
                .nodes
                .get(v2::condition_index(&w.graph) + 1)
                .unwrap()
                .state
                .contract_address;
            let amount = w.balance(&yes);
            w.env.mock_all_auths();
            soroban_sdk::token::Client::new(&w.env, &w.asset).transfer(
                &yes,
                &w.graph.admin,
                &amount,
            );
            assert_eq!(w.balance(&yes), 0);
            assert_eq!(w.status(&yes).obligations, 40);
            w.mutate(false);
            w.token().mint(&yes, &amount);
            assert_eq!(w.status(&yes).obligations, 40);
            w.mutate(false);
        }
        if accumulation && i == 1 {
            w.mutate(false);
        }
        if accumulation && i == 2 {
            w.mutate(true);
            w.mutate(false);
        }
    }
}
fn fixtures(guest: bool) {
    let directory = if guest {
        target().join("conditional-v2-mutation-packets")
    } else {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/conditional-v2-mutation-acceptance")
    };
    let mut files = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.extension().is_some_and(|v| v == "xdr-hex"))
        .collect::<std::vec::Vec<_>>();
    files.sort();
    assert_eq!(files.len(), 3);
    for path in files {
        run(&path, guest);
    }
}
#[test]
fn production_mutation_packets_execute_native_contracts() {
    fixtures(false);
}
#[test]
#[ignore = "requires release Wasms and separately generated exact-hash mutation packets"]
fn production_mutation_packets_execute_actual_wasms_at_default_resource_limits() {
    fixtures(true);
}
