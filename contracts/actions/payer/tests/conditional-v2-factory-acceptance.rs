//! Explicit local acceptance only: actual factory/family Wasms and native SAC.
//! Test path environment variables select task-owned capsules/output and Wasms;
//! they are never runtime configuration, registry activation or network commands.
use payer::conditional_v2 as v2;
use soroban_sdk::{
    testutils::{Events as _, Ledger as _, MockAuthInvoke},
    token,
    xdr::{self, FromXdr, ToXdr, WriteXdr},
    Address, Bytes, BytesN, Env, IntoVal, Map, String, Symbol, TryFromVal, Val, Vec,
};
use std::{fs::OpenOptions, io::Write, path::Path, rc::Rc};

const LAYOUTS: [&str; 7] = [
    "minimal-gt",
    "minimal-lt",
    "standard",
    "recipients-20",
    "prefix-8",
    "prefix-12",
    "ceiling-40",
];
fn field<T: TryFromVal<Env, Val>>(env: &Env, values: &Vec<Val>, index: u32) -> T {
    T::try_from_val(env, &values.get(index).expect("capsule field"))
        .unwrap_or_else(|_| panic!("capsule field type"))
}
fn text(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}
fn hex(bytes: &[u8]) -> std::string::String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut result = std::vec::Vec::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize]);
        result.push(DIGITS[(byte & 15) as usize]);
    }
    std::string::String::from_utf8(result).unwrap()
}

fn unhex(value: &str) -> std::vec::Vec<u8> {
    let value = value.trim();
    assert_eq!(value.len() % 2, 0);
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digit = |byte| match byte {
                b'0'..=b'9' => byte - b'0',
                b'a'..=b'f' => byte - b'a' + 10,
                _ => panic!("capsule hex"),
            };
            digit(pair[0]) * 16 + digit(pair[1])
        })
        .collect()
}
fn save(path: &Path, env: &Env, value: &Vec<Val>) {
    let encoded = value.to_xdr(env);
    let mut bytes = std::vec![0u8;encoded.len() as usize];
    encoded.copy_into_slice(&mut bytes);
    let encoded = hex(&bytes);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .expect("new task-owned output only");
    writeln!(file, "{encoded}").unwrap();
}
fn source_account(env: &Env, source: &Address, invocation: xdr::SorobanAuthorizedInvocation) {
    let xdr::ScAddress::Account(account) = xdr::ScAddress::from(source) else {
        panic!("wallet source")
    };
    env.host().set_source_account(account).unwrap();
    env.set_auths(&[xdr::SorobanAuthorizationEntry {
        credentials: xdr::SorobanCredentials::SourceAccount,
        root_invocation: invocation,
    }]);
}
fn native_asset(env: &Env, expected: &Address, wallets: &Vec<Address>) {
    // Synthetic classic ledger entries are SETUP. Native SAC itself is the real
    // built-in implementation; baseReserve0 is not a live-account funding claim.
    env.ledger().with_mut(|info| info.base_reserve = 0);
    for address in wallets.iter() {
        let xdr::ScAddress::Account(account_id) = xdr::ScAddress::from(&address) else {
            continue;
        };
        let key = Rc::new(xdr::LedgerKey::Account(xdr::LedgerKeyAccount {
            account_id: account_id.clone(),
        }));
        if env.host().get_ledger_entry(&key).unwrap().is_some() {
            continue;
        }
        let entry = Rc::new(xdr::LedgerEntry {
            last_modified_ledger_seq: 10,
            ext: xdr::LedgerEntryExt::V0,
            data: xdr::LedgerEntryData::Account(xdr::AccountEntry {
                account_id,
                balance: 1_000_000_000,
                seq_num: xdr::SequenceNumber(0),
                num_sub_entries: 0,
                inflation_dest: None,
                flags: 0,
                home_domain: Default::default(),
                thresholds: xdr::Thresholds([1; 4]),
                signers: Default::default(),
                ext: xdr::AccountEntryExt::V0,
            }),
        });
        env.host().add_ledger_entry(&key, &entry, None).unwrap();
    }
    let create = xdr::HostFunction::CreateContract(xdr::CreateContractArgs {
        contract_id_preimage: xdr::ContractIdPreimage::Asset(xdr::Asset::Native),
        executable: xdr::ContractExecutable::StellarAsset,
    });
    let actual = env.host().invoke_function(create).unwrap();
    assert_eq!(
        Address::try_from_val(env, &actual).unwrap(),
        *expected,
        "native SAC network identity"
    );
}
fn factory_authorization(
    env: &Env,
    factory: &Address,
    source: &Address,
    args: &Vec<Val>,
) -> xdr::SorobanAuthorizedInvocation {
    let mut invocation: xdr::SorobanAuthorizedInvocation = (&MockAuthInvoke {
        contract: factory,
        fn_name: "deploy_pipeline",
        args: args.clone(),
        sub_invokes: &[],
    })
        .into();
    let blueprints: Vec<Val> = field(env, args, 1);
    invocation.sub_invocations = blueprints
        .iter()
        .map(|raw| {
            let blueprint = Map::<Symbol, Val>::try_from_val(env, &raw).unwrap();
            let salt =
                BytesN::<32>::try_from_val(env, &blueprint.get(Symbol::new(env, "salt")).unwrap())
                    .unwrap();
            let hash = BytesN::<32>::try_from_val(
                env,
                &blueprint.get(Symbol::new(env, "wasm_hash")).unwrap(),
            )
            .unwrap();
            let constructor = Vec::<Val>::try_from_val(
                env,
                &blueprint.get(Symbol::new(env, "constructor_args")).unwrap(),
            )
            .unwrap();
            let constructor_args = constructor
                .iter()
                .map(|value| xdr::ScVal::try_from_val(env, &value).unwrap())
                .collect::<std::vec::Vec<_>>()
                .try_into()
                .unwrap();
            xdr::SorobanAuthorizedInvocation {
                function: xdr::SorobanAuthorizedFunction::CreateContractV2HostFn(
                    xdr::CreateContractArgsV2 {
                        contract_id_preimage: xdr::ContractIdPreimage::Address(
                            xdr::ContractIdPreimageFromAddress {
                                address: source.into(),
                                salt: xdr::Uint256(salt.to_array()),
                            },
                        ),
                        executable: xdr::ContractExecutable::Wasm(xdr::Hash(hash.to_array())),
                        constructor_args,
                    },
                ),
                sub_invocations: Default::default(),
            }
        })
        .collect::<std::vec::Vec<_>>()
        .try_into()
        .unwrap();
    invocation
}
fn changed(change: &v2::NodeChangeV2) -> String {
    match change {
        v2::NodeChangeV2::Pay(value) => value.node_id.clone(),
        v2::NodeChangeV2::Split(value) => value.node_id.clone(),
        v2::NodeChangeV2::Condition(value) => value.node_id.clone(),
    }
}
fn admin_tree(
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
        .flat_map(|next| admin_tree(env, graph, &next, context))
        .collect::<std::vec::Vec<_>>();
    if *address != graph.root
        && !context
            .changes
            .iter()
            .any(|change| changed(&change) == state.node_id)
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
struct Captured {
    outcome: &'static str,
    value: Option<Val>,
    contract_error: Option<u32>,
    cpu: u64,
    memory: u64,
    fee: std::string::String,
    events: Vec<Val>,
}
impl Captured {
    fn metrics(&self, env: &Env) -> Vec<Val> {
        soroban_sdk::vec![
            env,
            self.cpu.into_val(env),
            self.memory.into_val(env),
            text(env, &self.fee).into_val(env)
        ]
    }
}
fn measured(
    env: &Env,
    address: &Address,
    method: &str,
    args: Vec<Val>,
    expected: bool,
) -> Captured {
    env.cost_estimate().budget().reset_default();
    let budget = env.host().budget_cloned();
    assert_eq!(budget.get_cpu_insns_remaining().unwrap(), 100_000_000);
    assert_eq!(budget.get_mem_bytes_remaining().unwrap(), 40 * 1024 * 1024);
    // Instrumentation-only headroom for SDK best-effort debug snapshots.
    // Neither actual execution budget nor SDK post-invocation fence is raised.
    env.host()
        .set_shadow_budget_limits(1_000_000_000, 512 * 1024 * 1024)
        .unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.try_invoke_contract::<Val, soroban_sdk::Error>(address, &Symbol::new(env, method), args)
    }));
    // Capture these BEFORE observer/getter/token/export invocations replace them.
    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let memory = env.cost_estimate().budget().memory_bytes_cost();
    let resources = env.host().get_last_invocation_resources();
    let fee = if resources.is_some() {
        format!("SDK26 Pubnet2024-12-11+p23 MODEL ONLY; debug-shadow1Bcpu/512MiB; NOT current RPC/network fee; {:?}; resources={resources:?}",env.cost_estimate().fee())
    } else {
        "SDK26 fee/resource snapshot unavailable; budget counters only".into()
    };
    let contract_error = match &result {
        Ok(Err(Ok(error))) if error.is_type(xdr::ScErrorType::Contract) => Some(error.get_code()),
        _ => None,
    };
    let (outcome, value) = match result {
        Ok(Ok(Ok(value))) => ("success", Some(value)),
        Ok(result) => {
            std::println!("{method} host refusal {result:?}");
            (
                if expected {
                    "host-error"
                } else {
                    "expected-refusal"
                },
                None,
            )
        }
        Err(payload) => {
            let message = payload
                .downcast_ref::<std::string::String>()
                .map(|s| s.as_str())
                .or_else(|| payload.downcast_ref::<&str>().copied())
                .unwrap_or("unknown panic");
            (
                if message.contains("HostError: Error(Budget, ExceededLimit)") {
                    "host-error"
                } else if message.contains("resource limits")
                    || message.contains("Resource limits")
                    || message.contains("exceeded")
                {
                    "sdk-post-fence"
                } else {
                    "unexpected-panic"
                },
                None,
            )
        }
    };
    std::println!("{method}: {outcome}; cpu={cpu}; memory={memory}; {fee}");
    // Only observations/serialization use this separate unlimited budget. Actual
    // calls above always retain the unchanged default100mCPU/40MiB budget.
    env.cost_estimate().budget().reset_unlimited();
    let mut events = Vec::<Val>::new(env);
    if outcome == "success" {
        for event in env.events().all().events() {
            let Some(id) = &event.contract_id else {
                continue;
            };
            let contract = Address::try_from_val(
                env,
                &xdr::ScVal::Address(xdr::ScAddress::Contract(id.clone())),
            )
            .unwrap();
            let xdr::ContractEventBody::V0(body) = &event.body;
            let mut topics = Vec::<Val>::new(env);
            for topic in body.topics.iter() {
                topics.push_back(Val::try_from_val(env, topic).unwrap());
            }
            let data = Val::try_from_val(env, &body.data).unwrap();
            events.push_back(
                soroban_sdk::vec![env, contract.into_val(env), topics.into_val(env), data]
                    .into_val(env),
            );
        }
    }
    Captured {
        outcome,
        value,
        contract_error,
        cpu,
        memory,
        fee,
        events,
    }
}
struct Observations {
    getters: Vec<Val>,
    instances: Vec<Val>,
}
fn observe(env: &Env, phase: &str, nodes: &Vec<Val>, observations: &mut Observations) -> Vec<Val> {
    let mut states = Vec::<Val>::new(env);
    for raw in nodes.iter() {
        let node = Vec::<Val>::try_from_val(env, &raw).unwrap();
        let id: String = field(env, &node, 0);
        let address: Address = field(env, &node, 1);
        let mut status = None;
        for method in [
            "capabilities_v2",
            "graph_manifest_v2",
            "initial_config_v2",
            "mutation_status_v2",
        ] {
            let result =
                env.invoke_contract::<Val>(&address, &Symbol::new(env, method), Vec::new(env));
            if method == "mutation_status_v2" {
                status = Some(result);
            }
            observations.getters.push_back(
                soroban_sdk::vec![
                    env,
                    text(env, phase).into_val(env),
                    id.clone().into_val(env),
                    text(env, method).into_val(env),
                    result
                ]
                .into_val(env),
            );
        }
        let status = status.unwrap();
        let map = Map::<Symbol, Val>::try_from_val(env, &status).unwrap();
        let state = map.get(Symbol::new(env, "state")).unwrap();
        states.push_back(soroban_sdk::vec![env, id.into_val(env), state, status].into_val(env));
    }
    for (key, (entry, live_until)) in env.to_ledger_snapshot().ledger_entries {
        let include = match key.as_ref() {
            xdr::LedgerKey::ContractCode(_) => true,
            xdr::LedgerKey::ContractData(data) => {
                matches!(data.key, xdr::ScVal::LedgerKeyContractInstance)
            }
            _ => false,
        };
        if !include {
            continue;
        }
        let key = Bytes::from_slice(env, &key.to_xdr(xdr::Limits::none()).unwrap());
        let entry = Bytes::from_slice(env, &entry.to_xdr(xdr::Limits::none()).unwrap());
        let live_until: Val = live_until
            .map(|value| value.into_val(env))
            .unwrap_or(Val::VOID.into());
        observations.instances.push_back(
            soroban_sdk::vec![
                env,
                text(env, phase).into_val(env),
                key.into_val(env),
                entry.into_val(env),
                live_until
            ]
            .into_val(env),
        );
    }
    states
}
fn hydrated(mut env: Env, bytes: &[u8]) -> (Env, Vec<Val>) {
    env.set_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.host().set_invocation_hook(None).unwrap();
    env.cost_estimate().budget().reset_unlimited();
    // Populate the public test-host module cache in SETUP, before the default
    // measured budget is reset. A fresh snapshot host lazily reads code entries;
    // this mirrors the host's prepopulated network module cache without changing
    // the measured invocation's actual CPU/memory limits or ledger footprint.
    for (key, _) in env.to_ledger_snapshot().ledger_entries {
        // The SDK meter snapshots the in-memory storage map, not its lazy
        // backing SnapshotSource. Load every actual entry before its snapshot;
        // the top-level meter resets the footprint before the measured call.
        env.host().get_ledger_entry(&Rc::new(*key)).unwrap();
    }
    env.host()
        .ensure_module_cache_contains_host_storage_contracts()
        .unwrap();
    let packet = Vec::<Val>::from_xdr(&env, &Bytes::from_slice(&env, bytes)).unwrap();
    assert_eq!(packet.len(), 9);
    (env, packet)
}
fn relay(source: &Env, target: &Env, value: Val) -> Val {
    Val::try_from_val(target, &xdr::ScVal::try_from_val(source, &value).unwrap()).unwrap()
}
fn append_observations(source: &Env, target: &Env, local: Observations, all: &mut Observations) {
    for row in local.getters.iter() {
        all.getters.push_back(relay(source, target, row));
    }
    for row in local.instances.iter() {
        all.instances.push_back(relay(source, target, row));
    }
}
fn original_graph(env: &Env, packet: &Vec<Val>) -> v2::GraphManifestV2 {
    let args: Vec<Val> = field(env, packet, 2);
    let blueprints: Vec<Val> = field(env, &args, 1);
    let root = Map::<Symbol, Val>::try_from_val(env, &blueprints.first().unwrap()).unwrap();
    let constructors = Vec::<Val>::try_from_val(
        env,
        &root.get(Symbol::new(env, "constructor_args")).unwrap(),
    )
    .unwrap();
    v2::NodeInitV2::try_from_val(env, &constructors.get(2).unwrap())
        .unwrap()
        .manifest
}
fn absent_children(env: &Env, nodes: &Vec<Val>) {
    for raw in nodes.iter() {
        let node = Vec::<Val>::try_from_val(env, &raw).unwrap();
        let address: Address = field(env, &node, 1);
        let key = Rc::new(xdr::LedgerKey::ContractData(xdr::LedgerKeyContractData {
            contract: address.into(),
            key: xdr::ScVal::LedgerKeyContractInstance,
            durability: xdr::ContractDataDurability::Persistent,
        }));
        assert!(
            env.host().get_ledger_entry(&key).unwrap().is_none(),
            "failed factory leaves no partial child instance"
        );
    }
}
fn run(layout: &str, input: &Path, output: &Path, wasms: &Path) {
    let bytes = unhex(&std::fs::read_to_string(input.join(format!("{layout}.xdr-hex"))).unwrap());
    let baseline = {
        let (env, packet) = hydrated(Env::default(), &bytes);
        env.ledger().set_sequence_number(10);
        let network: BytesN<32> = field(&env, &packet, 0);
        env.ledger().set_network_id(network.to_array());
        let factory: Address = field(&env, &packet, 1);
        let factory_args: Vec<Val> = field(&env, &packet, 2);
        let owner: Address = field(&env, &packet, 3);
        let asset: Address = field(&env, &packet, 4);
        let payer: Address = field(&env, &packet, 5);
        let nodes: Vec<Val> = field(&env, &packet, 6);
        let wallets: Vec<Address> = field(&env, &packet, 8);
        assert_eq!(field::<Address>(&env, &factory_args, 0), owner);
        assert_ne!(owner, payer);
        native_asset(&env, &asset, &wallets);
        for family in ["deposit_trigger", "payer", "paiflow_splitter", "router"] {
            let code = std::fs::read(wasms.join(format!("{family}.wasm"))).unwrap();
            let actual = env
                .deployer()
                .upload_contract_wasm(Bytes::from_slice(&env, &code));
            let kind = match family {
                "deposit_trigger" => "DEPOSIT_TRIGGER",
                "payer" => "PAYER",
                "paiflow_splitter" => "SPLITTER",
                _ => "ROUTER",
            };
            for raw in nodes.iter() {
                let node = Vec::<Val>::try_from_val(&env, &raw).unwrap();
                if field::<String>(&env, &node, 2) == text(&env, kind) {
                    assert_eq!(
                        actual,
                        field::<BytesN<32>>(&env, &node, 3),
                        "exact reviewed family bytes"
                    );
                }
            }
        }
        let factory_code = std::fs::read(wasms.join("paiflow_factory.wasm")).unwrap();
        env.register_at(&factory, factory_code.as_slice(), ());
        env.to_ledger_snapshot()
    };
    // Each measured invocation starts from an actual preserved ledger snapshot
    // and a fresh recording footprint, so setup/prior observers cannot make the
    // SDK resource/fee estimate omit already-accessed classic/contract entries.
    if layout == "minimal-gt" {
        for late_constructor in [false, true] {
            let (env, packet) = hydrated(Env::from_ledger_snapshot(baseline.clone()), &bytes);
            let factory: Address = field(&env, &packet, 1);
            let owner: Address = field(&env, &packet, 3);
            let mut args: Vec<Val> = field(&env, &packet, 2);
            let nodes: Vec<Val> = field(&env, &packet, 6);
            if late_constructor {
                let mut blueprints: Vec<Val> = field(&env, &args, 1);
                let i = blueprints.len() - 1;
                let mut blueprint =
                    Map::<Symbol, Val>::try_from_val(&env, &blueprints.get(i).unwrap()).unwrap();
                let mut ctor = Vec::<Val>::try_from_val(
                    &env,
                    &blueprint
                        .get(Symbol::new(&env, "constructor_args"))
                        .unwrap(),
                )
                .unwrap();
                let wrong: Address = field(&env, &packet, 5);
                ctor.set(0, wrong.into_val(&env));
                blueprint.set(Symbol::new(&env, "constructor_args"), ctor.into_val(&env));
                blueprints.set(i, blueprint.into_val(&env));
                args.set(1, blueprints.into_val(&env));
            }
            let mut auth = factory_authorization(&env, &factory, &owner, &args);
            if !late_constructor {
                auth.sub_invocations = Default::default();
            }
            source_account(&env, &owner, auth);
            let refused = measured(&env, &factory, "deploy_pipeline", args, false);
            assert_eq!(
                refused.outcome, "expected-refusal",
                "negative factory probe must actually refuse, not hit a post-fence panic"
            );
            absent_children(&env, &nodes);
            std::println!("factory negative probe late_constructor={late_constructor}: rejected; no child instances");
        }
    }
    let (collector, _) = hydrated(Env::default(), &bytes);
    let mut observations = Observations {
        getters: Vec::new(&collector),
        instances: Vec::new(&collector),
    };
    let mut outcomes = Vec::<Val>::new(&collector);
    let mut returned = Vec::<Address>::new(&collector);
    let mut snapshot = baseline;
    let factory_outcome;
    let factory_metrics;
    let operation_count;
    {
        let (env, packet) = hydrated(Env::from_ledger_snapshot(snapshot.clone()), &bytes);
        let factory: Address = field(&env, &packet, 1);
        let owner: Address = field(&env, &packet, 3);
        let args: Vec<Val> = field(&env, &packet, 2);
        let nodes: Vec<Val> = field(&env, &packet, 6);
        let operations: Vec<Val> = field(&env, &packet, 7);
        operation_count = operations.len();
        source_account(
            &env,
            &owner,
            factory_authorization(&env, &factory, &owner, &args),
        );
        let deployed = measured(&env, &factory, "deploy_pipeline", args, true);
        factory_outcome = deployed.outcome;
        factory_metrics = relay(&env, &collector, deployed.metrics(&env).into_val(&env));
        if deployed.outcome == "success" {
            let addresses = Vec::<Address>::try_from_val(&env, &deployed.value.unwrap()).unwrap();
            assert_eq!(addresses.len(), nodes.len());
            for (raw, address) in nodes.iter().zip(addresses.iter()) {
                let node = Vec::<Val>::try_from_val(&env, &raw).unwrap();
                assert_eq!(
                    address,
                    field::<Address>(&env, &node, 1),
                    "factory CAP46 address/order"
                );
            }
            returned = Vec::<Address>::try_from_val(
                &collector,
                &relay(&env, &collector, addresses.into_val(&env)),
            )
            .unwrap();
            let mut local = Observations {
                getters: Vec::new(&env),
                instances: Vec::new(&env),
            };
            observe(&env, "post-deploy", &nodes, &mut local);
            append_observations(&env, &collector, local, &mut observations);
            snapshot = env.to_ledger_snapshot();
        }
    }
    if factory_outcome == "success" {
        for index in 0..operation_count {
            let (env, packet) = hydrated(Env::from_ledger_snapshot(snapshot.clone()), &bytes);
            let owner: Address = field(&env, &packet, 3);
            let asset: Address = field(&env, &packet, 4);
            let payer: Address = field(&env, &packet, 5);
            let nodes: Vec<Val> = field(&env, &packet, 6);
            let operations: Vec<Val> = field(&env, &packet, 7);
            let wallets: Vec<Address> = field(&env, &packet, 8);
            let graph = original_graph(&env, &packet);
            let root = graph.root.clone();
            let operation =
                Vec::<Val>::try_from_val(&env, &operations.get(index).unwrap()).unwrap();
            let id: String = field(&env, &operation, 0);
            let method: String = field(&env, &operation, 1);
            let args: Vec<Val> = field(&env, &operation, 2);
            let expected: bool = field(&env, &operation, 3);
            let method = if method == text(&env, "execute_v2") {
                "execute_v2"
            } else {
                assert_eq!(method, text(&env, "mutate_v2"));
                "mutate_v2"
            };
            if method == "execute_v2" {
                let source: Address = field(&env, &args, 0);
                assert_eq!(source, payer);
                let amount: i128 = field(&env, &args, 2);
                let auth = (&MockAuthInvoke {
                    contract: &root,
                    fn_name: method,
                    args: args.clone(),
                    sub_invokes: &[MockAuthInvoke {
                        contract: &asset,
                        fn_name: "transfer",
                        args: (&source, &root, amount).into_val(&env),
                        sub_invokes: &[],
                    }],
                })
                    .into();
                source_account(&env, &source, auth);
            } else {
                let context = v2::MutationContextV2 {
                    root: root.clone(),
                    admin: owner.clone(),
                    bindings: field(&env, &args, 0),
                    changes: field(&env, &args, 1),
                };
                source_account(
                    &env,
                    &owner,
                    admin_tree(&env, &graph, &root, &context).remove(0),
                );
            }
            let call = measured(&env, &root, method, args, expected);
            if id == text(&env, "stale") {
                assert_eq!(
                    call.contract_error,
                    Some(105),
                    "unused nonce with old graph must fail specifically StaleRevision"
                );
                std::println!("stale sanitized contractErrorCode=105");
            }
            if matches!(layout, "minimal-gt" | "minimal-lt" | "standard") {
                assert_eq!(
                    call.outcome,
                    if expected {
                        "success"
                    } else {
                        "expected-refusal"
                    },
                    "required operation {id}"
                );
            }
            let mut balances = Vec::<Val>::new(&env);
            let mut states = Vec::<Val>::new(&env);
            if !matches!(call.outcome, "sdk-post-fence" | "unexpected-panic") {
                for address in wallets.iter() {
                    let amount = token::Client::new(&env, &asset).balance(&address);
                    let row: Vec<Val> =
                        soroban_sdk::vec![&env, address.into_val(&env), amount.into_val(&env)];
                    balances.push_back(row.into_val(&env));
                }
                let mut local = Observations {
                    getters: Vec::new(&env),
                    instances: Vec::new(&env),
                };
                states = observe(&env, &id.to_string(), &nodes, &mut local);
                append_observations(&env, &collector, local, &mut observations);
                snapshot = env.to_ledger_snapshot();
            }
            let outcome: Vec<Val> = soroban_sdk::vec![
                &env,
                id.into_val(&env),
                text(&env, method).into_val(&env),
                text(&env, call.outcome).into_val(&env),
                call.metrics(&env).into_val(&env),
                balances.into_val(&env),
                states.into_val(&env),
                call.events.into_val(&env)
            ];
            outcomes.push_back(relay(&env, &collector, outcome.into_val(&env)));
            if matches!(call.outcome, "sdk-post-fence" | "unexpected-panic") {
                break;
            }
        }
    }
    let result = soroban_sdk::vec![
        &collector,
        text(&collector, "paiflow.conditional.local-result.v1").into_val(&collector),
        text(&collector, layout).into_val(&collector),
        text(&collector, factory_outcome).into_val(&collector),
        factory_metrics,
        returned.into_val(&collector),
        outcomes.into_val(&collector),
        text(&collector, "native-sac").into_val(&collector)
    ];
    save(
        &output.join(format!("{layout}.result.xdr-hex")),
        &collector,
        &result,
    );
    save(
        &output.join(format!("{layout}.getters.xdr-hex")),
        &collector,
        &observations.getters,
    );
    save(
        &output.join(format!("{layout}.instances.xdr-hex")),
        &collector,
        &observations.instances,
    );
    if matches!(layout, "minimal-gt" | "minimal-lt" | "standard") {
        assert_eq!(
            factory_outcome, "success",
            "minimal/standard actual factory usability is required"
        );
    }
}

#[test]
#[ignore = "requires production joined capsules and actual factory/family Wasms; explicitly run for local acceptance"]
fn actual_factory_resources_and_joined_xdr() {
    let input =
        std::env::var_os("PAIFLOW_CONDITIONAL_INPUT_DIRECTORY").expect("task input directory");
    let output = std::env::var_os("PAIFLOW_CONDITIONAL_OUTPUT_DIRECTORY")
        .expect("new task output directory");
    let wasm = std::env::var_os("PAIFLOW_CONDITIONAL_WASM_DIRECTORY")
        .unwrap_or_else(|| "/var/tmp/paiflow-1229-resource-target/wasm32v1-none/release".into());
    let input = Path::new(&input);
    let output = Path::new(&output);
    let wasm = Path::new(&wasm);
    assert!(input.is_dir() && output.is_dir());
    for layout in LAYOUTS {
        run(layout, input, output, wasm);
    }
}
