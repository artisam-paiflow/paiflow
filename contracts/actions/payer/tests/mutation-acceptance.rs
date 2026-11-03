//! Production TypeScript unsigned constructor/call packets, consumed unchanged.
//! The token is synthetic; guest evidence is not SAC or network qualification.
use deposit_trigger::{execution_v1 as abi, DepositTrigger};
use paiflow_splitter::Splitter;
use payer::Payer;
use soroban_sdk::{
    testutils::{Events as _, Ledger as _, MockAuthInvoke},
    token, vec,
    xdr::{FromXdr, ToXdr},
    Address, Bytes, BytesN, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
};
#[path = "../../../payment-test-token.rs"]
mod payment_test_token;

fn value<T: TryFromVal<Env, Val>>(env: &Env, values: &Vec<Val>, index: u32) -> T {
    T::try_from_val(env, &values.get(index).unwrap())
        .ok()
        .unwrap()
}
fn unhex(raw: &str) -> std::vec::Vec<u8> {
    assert_eq!(raw.trim().len() % 2, 0);
    raw.trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digit = |b| match b {
                b'0'..=b'9' => b - b'0',
                b'a'..=b'f' => b - b'a' + 10,
                _ => panic!("fixture hex"),
            };
            digit(pair[0]) * 16 + digit(pair[1])
        })
        .collect()
}
fn hex(bytes: &[u8]) -> std::string::String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
struct World {
    env: Env,
    packet: Vec<Val>,
    raw_packet: Bytes,
    nodes: Vec<Val>,
    admin: Address,
    payer: Address,
    asset: Address,
    root: Address,
    pay: Address,
    split: Address,
    platform: Address,
    worker: Address,
    replacement: Address,
    hashes: Vec<BytesN<32>>,
}
impl World {
    fn new(name: &str, wasm: bool) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.cost_estimate().budget().reset_unlimited();
        env.ledger().set_sequence_number(10);
        let path = format!("../../../tests/fixtures/mutation-acceptance/{name}.xdr-hex");
        let raw_packet = Bytes::from_slice(&env, &unhex(&std::fs::read_to_string(path).unwrap()));
        let packet: Vec<Val> = Vec::from_xdr(&env, &raw_packet).unwrap();
        assert_eq!(value::<u32>(&env, &packet, 0), 1);
        assert_eq!(
            value::<String>(&env, &packet, 1),
            String::from_str(&env, "testnet")
        );
        let admin = value(&env, &packet, 2);
        let payer = value(&env, &packet, 3);
        let asset = value(&env, &packet, 4);
        let nodes: Vec<Val> = value(&env, &packet, 5);
        let address = |index| {
            let node: Vec<Val> = value(&env, &nodes, index);
            value::<Address>(&env, &node, 1)
        };
        let root = address(0);
        let pay = address(1);
        let split = address(2);
        env.register_at(&asset, payment_test_token::WideToken, ());
        payment_test_token::WideTokenClient::new(&env, &asset).mint(&payer, &100_000);
        let mut hashes = Vec::new(&env);
        for entry in nodes.iter() {
            let node = Vec::<Val>::try_from_val(&env, &entry).unwrap();
            let address: Address = value(&env, &node, 1);
            let kind: String = value(&env, &node, 2);
            let expected_hash: BytesN<32> = value(&env, &node, 3);
            let args: Vec<Val> = value(&env, &node, 4);
            let kind = kind.to_string();
            if wasm {
                let file = match kind.as_str() {
                    "DEPOSIT_TRIGGER" => "deposit_trigger",
                    "PAYER" => "payer",
                    "SPLITTER" => "paiflow_splitter",
                    _ => panic!("kind"),
                };
                let bytes =
                    std::fs::read(format!("../../target/wasm32v1-none/release/{file}.wasm"))
                        .unwrap();
                let actual_hash = env
                    .deployer()
                    .upload_contract_wasm(Bytes::from_slice(&env, &bytes));
                assert_eq!(actual_hash, expected_hash);
                env.register_at(&address, bytes.as_slice(), args);
                hashes.push_back(actual_hash);
            } else {
                match kind.as_str() {
                    "DEPOSIT_TRIGGER" => {
                        env.register_at(&address, DepositTrigger, args);
                    }
                    "PAYER" => {
                        env.register_at(&address, Payer, args);
                    }
                    "SPLITTER" => {
                        env.register_at(&address, Splitter, args);
                    }
                    _ => panic!("kind"),
                }
            }
        }
        let platform = payer::PayerClient::new(&env, &pay)
            .field_policy()
            .recipient
            .unwrap();
        let worker = paiflow_splitter::SplitterClient::new(&env, &split)
            .initial_config()
            .additional
            .first()
            .unwrap()
            .recipient;
        let mutation: Vec<Val> = value(&env, &packet, 6);
        let changes: Vec<abi::NodeMutation> = value(&env, &mutation, 1);
        let abi::NodeMutation::Pay(change) = changes.first().unwrap() else {
            panic!("first Pay change")
        };
        let replacement = change.recipient.unwrap();
        // SDK v26's debug authorization snapshot can exhaust a separate shadow
        // budget. Disable observation, never authorization, for bounded guests.
        if wasm {
            env.host().set_invocation_hook(None).unwrap();
        }
        Self {
            env,
            packet,
            raw_packet,
            nodes,
            admin,
            payer,
            asset,
            root,
            pay,
            split,
            platform,
            worker,
            replacement,
            hashes,
        }
    }
    fn args(&self, index: u32) -> Vec<Val> {
        value(&self.env, &self.packet, index)
    }
    fn invoke<T: TryFromVal<Env, Val>>(
        &self,
        address: &Address,
        method: &str,
        args: Vec<Val>,
    ) -> T {
        self.env.cost_estimate().budget().reset_default();
        self.env
            .invoke_contract(address, &Symbol::new(&self.env, method), args)
    }
    fn fails(&self, method: &str, args: Vec<Val>) {
        self.env.cost_estimate().budget().reset_default();
        assert!(self
            .env
            .try_invoke_contract::<Val, abi::ExecutionError>(
                &self.root,
                &Symbol::new(&self.env, method),
                args
            )
            .is_err());
    }
    fn unsupported(&self, address: &Address, method: &str, args: Vec<Val>) {
        self.env.cost_estimate().budget().reset_default();
        let result = self.env.try_invoke_contract::<Val, abi::ExecutionError>(
            address,
            &Symbol::new(&self.env, method),
            args,
        );
        match result {
            Err(Ok(error)) => assert_eq!(error, abi::ExecutionError::Unsupported),
            _ => panic!("Expected the explicit policy legacy-path refusal"),
        }
    }
    fn balance(&self, address: &Address) -> i128 {
        self.invoke(&self.asset, "balance", (address,).into_val(&self.env))
    }
    fn revision(&self, address: &Address) -> u64 {
        self.invoke(address, "config_revision", Vec::new(&self.env))
    }
    fn obligation(&self) -> i128 {
        self.invoke(&self.split, "accumulated_balance", Vec::new(&self.env))
    }
    fn auth_entry(
        &self,
        args: &Vec<Val>,
        children: bool,
    ) -> soroban_sdk::xdr::SorobanAuthorizationEntry {
        let bindings: Vec<abi::Binding> = value(&self.env, args, 0);
        let changes: Vec<abi::NodeMutation> = value(&self.env, args, 1);
        let context = abi::MutationContext {
            root: self.root.clone(),
            admin: self.admin.clone(),
            asset: self.asset.clone(),
            bindings,
            changes,
            index: 1,
        };
        let mut last = context.clone();
        last.index = 2;
        let split = [MockAuthInvoke {
            contract: &self.split,
            fn_name: "mutate_step_v1",
            args: (last,).into_val(&self.env),
            sub_invokes: &[],
        }];
        let pay = [MockAuthInvoke {
            contract: &self.pay,
            fn_name: "mutate_step_v1",
            args: (context,).into_val(&self.env),
            sub_invokes: &split,
        }];
        soroban_sdk::xdr::SorobanAuthorizationEntry {
            credentials: soroban_sdk::xdr::SorobanCredentials::SourceAccount,
            root_invocation: (&MockAuthInvoke {
                contract: &self.root,
                fn_name: "mutate_v1",
                args: args.clone(),
                sub_invokes: if children { &pay } else { &[] },
            })
                .into(),
        }
    }
    fn auth(&self, args: &Vec<Val>, children: bool) {
        let account: soroban_sdk::xdr::ScAddress = (&self.admin).into();
        let soroban_sdk::xdr::ScAddress::Account(account) = account else {
            panic!("admin account")
        };
        self.env.host().set_source_account(account).unwrap();
        self.env.set_auths(&[self.auth_entry(args, children)]);
    }
    fn observation(&self, events: Vec<Val>) -> Bytes {
        self.env.cost_estimate().budget().reset_unlimited();
        let mut observations = Vec::<Val>::new(&self.env);
        for entry in self.nodes.iter() {
            let node = Vec::<Val>::try_from_val(&self.env, &entry).unwrap();
            let id: String = value(&self.env, &node, 0);
            let address: Address = value(&self.env, &node, 1);
            let config: Val = self.env.invoke_contract(
                &address,
                &Symbol::new(&self.env, "current_config"),
                Vec::new(&self.env),
            );
            let capabilities: Val = self.env.invoke_contract(
                &address,
                &Symbol::new(&self.env, "capabilities"),
                Vec::new(&self.env),
            );
            let status: Val = if address == self.root {
                Val::VOID.into()
            } else {
                self.env.invoke_contract(
                    &address,
                    &Symbol::new(&self.env, "mutation_status"),
                    Vec::new(&self.env),
                )
            };
            observations.push_back(
                vec![
                    &self.env,
                    id.into_val(&self.env),
                    address.into_val(&self.env),
                    config,
                    capabilities,
                    status,
                ]
                .into_val(&self.env),
            );
        }
        let accepted_auth = soroban_sdk::xdr::WriteXdr::to_xdr(
            &self.auth_entry(&self.args(6), true),
            soroban_sdk::xdr::Limits::none(),
        )
        .unwrap();
        let balances = vec![
            &self.env,
            self.balance(&self.root),
            self.balance(&self.pay),
            self.balance(&self.split),
        ];
        self.env.cost_estimate().budget().reset_unlimited();
        let packet: Vec<Val> = vec![
            &self.env,
            self.raw_packet.clone().into_val(&self.env),
            self.hashes.clone().into_val(&self.env),
            observations.into_val(&self.env),
            events.into_val(&self.env),
            Bytes::from_slice(&self.env, &accepted_auth).into_val(&self.env),
            balances.into_val(&self.env),
        ];
        packet.to_xdr(&self.env)
    }
}

fn scenario(name: &str, fixed: bool, wasm: bool) {
    let w = World::new(name, wasm);
    let initial = w.observation(Vec::new(&w.env));
    let valid = w.args(6);
    let invalid = w.args(7);
    let mut blocked = None;
    // Exact source authorization must include each changed child's nested invocation.
    w.env.set_auths(&[]);
    w.fails("mutate_v1", valid.clone());
    w.auth(&valid, false);
    w.fails("mutate_v1", valid.clone());
    w.auth(&invalid, true);
    w.fails("mutate_v1", invalid);
    assert_eq!(w.revision(&w.pay), 0);
    assert_eq!(w.revision(&w.split), 0);
    assert_eq!(w.observation(Vec::new(&w.env)), initial);
    if fixed {
        w.env.mock_all_auths();
        w.invoke::<()>(&w.root, "execute_v1", w.args(8));
        if !wasm {
            let auths = w.env.auths();
            assert!(!auths.is_empty());
            assert!(auths.iter().all(|(address, _)| address == &w.payer));
        }
        assert_eq!(w.obligation(), 50);
        w.env.mock_all_auths();
        w.invoke::<()>(&w.split, "pause", Vec::new(&w.env));
        w.auth(&valid, true);
        w.fails("mutate_v1", valid.clone());
        assert_eq!(w.obligation(), 50);
        w.env.mock_all_auths();
        w.invoke::<()>(&w.split, "unpause", Vec::new(&w.env));
        // Simulate asset loss while retaining the accepted accounting obligation.
        w.env.mock_all_auths();
        w.env.as_contract(&w.split, || {
            token::Client::new(&w.env, &w.asset).transfer(&w.split, &w.admin, &50)
        });
        assert_eq!(w.balance(&w.split), 0);
        assert_eq!(w.obligation(), 50);
        w.auth(&valid, true);
        w.fails("mutate_v1", valid.clone());
        let upstream_only = w.args(12);
        w.auth(&upstream_only, true);
        w.fails("mutate_v1", upstream_only);
        assert_eq!(w.revision(&w.pay), 0);
        assert_eq!(w.revision(&w.split), 0);
        blocked = Some(w.observation(Vec::new(&w.env)));
        // Repair funding does not erase debt. Only settlement under original terms does.
        w.env.mock_all_auths();
        payment_test_token::WideTokenClient::new(&w.env, &w.asset).mint(&w.split, &50);
        assert_eq!(w.obligation(), 50);
        w.invoke::<()>(&w.root, "execute_v1", w.args(9));
        assert_eq!(w.obligation(), 0);
    }
    w.env.mock_all_auths();
    for address in [&w.root, &w.pay, &w.split] {
        payment_test_token::WideTokenClient::new(&w.env, &w.asset).mint(address, &77);
    }
    let before_controls = w.observation(Vec::new(&w.env));
    let empty = Vec::<Val>::new(&w.env);
    w.unsupported(&w.root, "deposit", (&w.payer, 120i128).into_val(&w.env));
    w.unsupported(&w.pay, "cancel", Vec::new(&w.env));
    w.unsupported(&w.pay, "execute_step", (&w.asset, 77i128).into_val(&w.env));
    w.unsupported(&w.pay, "set_next_steps", (empty.clone(),).into_val(&w.env));
    w.unsupported(
        &w.pay,
        "receive_and_forward",
        (&w.root, &w.asset, 77i128, empty.clone()).into_val(&w.env),
    );
    w.unsupported(&w.split, "distribute", (&w.payer, 100i128).into_val(&w.env));
    w.unsupported(
        &w.split,
        "execute_step",
        (&w.asset, 77i128).into_val(&w.env),
    );
    w.unsupported(
        &w.split,
        "set_next_steps",
        (empty.clone(),).into_val(&w.env),
    );
    w.unsupported(
        &w.split,
        "receive_and_forward",
        (&w.pay, &w.asset, 77i128, empty).into_val(&w.env),
    );
    assert_eq!(w.observation(Vec::new(&w.env)), before_controls);
    w.auth(&valid, true);
    // Observation hook is disabled only for bounded guest execution; real source auth remains.
    if wasm {
        w.env.host().set_invocation_hook(None).unwrap();
    }
    w.invoke::<()>(&w.root, "mutate_v1", valid);
    if wasm {
        let resources = w.env.cost_estimate().resources();
        assert!(resources.instructions < 100_000_000);
        assert!(resources.mem_bytes < 41_943_040);
        std::println!("MUTATION_RESOURCES_{name}:{resources:?}");
    }
    let emitted = w.env.events().all();
    let mut events = Vec::<Val>::new(&w.env);
    for event in emitted.events() {
        let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
        if body.topics.first()
            != Some(&soroban_sdk::xdr::ScVal::Symbol(
                "config_v1".try_into().unwrap(),
            ))
        {
            continue;
        }
        let address = Address::try_from_val(
            &w.env,
            &soroban_sdk::xdr::ScVal::Address(soroban_sdk::xdr::ScAddress::Contract(
                event.contract_id.clone().unwrap(),
            )),
        )
        .unwrap();
        let topics = Vec::<Val>::try_from_val(
            &w.env,
            &soroban_sdk::xdr::ScVal::Vec(Some(body.topics.clone().into())),
        )
        .unwrap();
        let data = Val::try_from_val(&w.env, &body.data).unwrap();
        events.push_back(
            vec![
                &w.env,
                address.into_val(&w.env),
                topics.into_val(&w.env),
                data,
            ]
            .into_val(&w.env),
        );
    }
    assert_eq!(events.len(), 2);
    if !wasm {
        let auths = w.env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, w.admin);
    }
    let changed = w.observation(events);
    assert_eq!(w.revision(&w.pay), 1);
    assert_eq!(w.revision(&w.split), 1);
    let original_pay = payer::PayerClient::new(&w.env, &w.pay).field_policy();
    assert_eq!(original_pay.recipient, Some(w.platform.clone()));
    assert_eq!(
        original_pay.payout_rule,
        payer::execution_v1::PayoutRule::Fixed(10)
    );
    assert_eq!(
        paiflow_splitter::SplitterClient::new(&w.env, &w.split)
            .initial_config()
            .additional
            .first()
            .unwrap()
            .recipient,
        w.worker
    );
    for address in [&w.root, &w.pay, &w.split] {
        assert_eq!(w.balance(address), 77);
    }
    w.env.mock_all_auths();
    let payer_before = w.balance(&w.payer);
    let old_nonce: BytesN<32> = value(&w.env, &w.args(10), 3);
    let new_nonce: BytesN<32> = value(&w.env, &w.args(11), 3);
    assert_eq!(old_nonce, new_nonce);
    w.fails("execute_v1", w.args(10));
    assert_eq!(w.balance(&w.payer), payer_before);
    let platform_before = w.balance(&w.platform);
    let replacement_before = w.balance(&w.replacement);
    let worker_before = w.balance(&w.worker);
    // The production new-revision packet reuses the rejected stale call's nonce.
    // Success therefore also proves the stale call consumed neither funds nor nonce.
    w.invoke::<()>(&w.root, "execute_v1", w.args(11));
    assert_eq!(w.balance(&w.payer), payer_before - 120);
    for address in [&w.root, &w.pay, &w.split] {
        assert_eq!(w.balance(address), 77);
    }
    assert_eq!(w.balance(&w.platform), platform_before + 15);
    assert_eq!(w.balance(&w.replacement), replacement_before + 105);
    assert_eq!(w.balance(&w.worker), worker_before);
    if wasm {
        // Serializing diagnostic evidence is harness work, outside bounded calls.
        w.env.cost_estimate().budget().reset_unlimited();
        let mut both: Vec<Val> = vec![&w.env, initial.into_val(&w.env), changed.into_val(&w.env)];
        if let Some(blocked) = blocked {
            both.push_back(blocked.into_val(&w.env));
        }
        let both = both.to_xdr(&w.env);
        std::println!(
            "MUTATION_EVIDENCE_{name}:{}",
            hex(&both.iter().collect::<std::vec::Vec<u8>>())
        );
    }
}

fn upstream_only_without_obligations(wasm: bool) {
    for name in ["percentage-grouped-update", "fixed-accounted-obligations"] {
        let w = World::new(name, wasm);
        let change = w.args(12);
        w.auth(&change, true);
        w.invoke::<()>(&w.root, "mutate_v1", change);
        assert_eq!(w.revision(&w.pay), 1);
        assert_eq!(w.revision(&w.split), 0);
    }
}

#[test]
fn production_packets_enforce_atomic_revisions_auth_and_accounted_obligations() {
    scenario("percentage-grouped-update", false, false);
    scenario("fixed-accounted-obligations", true, false);
    upstream_only_without_obligations(false);
}

#[test]
#[ignore = "requires three locally rebuilt mutation WASMs; exports deterministic local observations; no network"]
fn compiled_packets_export_real_getter_and_configuration_event_observations() {
    scenario("percentage-grouped-update", false, true);
    scenario("fixed-accounted-obligations", true, true);
    upstream_only_without_obligations(true);
}
