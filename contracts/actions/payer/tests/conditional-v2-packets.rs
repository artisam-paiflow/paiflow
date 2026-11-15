//! Production-generated constructor/execution XDR; local host only, no funded wallets.
use deposit_trigger::DepositTrigger;
use paiflow_splitter::Splitter;
use payer::Payer;
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
fn decode_hex(value: &str) -> std::vec::Vec<u8> {
    value
        .trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digit = |b: u8| match b {
                b'0'..=b'9' => b - b'0',
                b'a'..=b'f' => b - b'a' + 10,
                _ => panic!("fixture hex"),
            };
            digit(pair[0]) * 16 + digit(pair[1])
        })
        .collect()
}
fn target() -> std::path::PathBuf {
    std::env::var_os("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target"))
}
fn run(path: &std::path::Path, guest: bool) {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited(); // Decode/register/mint are fixture setup, not execution.
    env.ledger().set_sequence_number(10);
    let bytes = decode_hex(&std::fs::read_to_string(path).unwrap());
    let packet = Vec::<Val>::from_xdr(&env, &Bytes::from_slice(&env, &bytes)).unwrap();
    let asset: Address = value(&env, &packet, 1);
    let nodes: Vec<Val> = value(&env, &packet, 2);
    let calls: Vec<Val> = value(&env, &packet, 3);
    env.register_at(&asset, payment_test_token::WideToken, ());
    let token = payment_test_token::WideTokenClient::new(&env, &asset);
    let mut contracts = std::vec::Vec::new();
    // Root-first order exercises the factory-compatible constructor protocol.
    for node in nodes.iter() {
        let node = Vec::<Val>::try_from_val(&env, &node).unwrap();
        let address: Address = value(&env, &node, 1);
        let kind: String = value(&env, &node, 2);
        let args: Vec<Val> = value(&env, &node, 3);
        let filename = if kind == String::from_str(&env, "DEPOSIT_TRIGGER") {
            if !guest {
                env.register_at(&address, DepositTrigger, args.clone());
            }
            "deposit_trigger"
        } else if kind == String::from_str(&env, "PAYER") {
            if !guest {
                env.register_at(&address, Payer, args.clone());
            }
            "payer"
        } else if kind == String::from_str(&env, "SPLITTER") {
            if !guest {
                env.register_at(&address, Splitter, args.clone());
            }
            "paiflow_splitter"
        } else {
            assert_eq!(kind, String::from_str(&env, "ROUTER"));
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
            let init = payer::conditional_v2::NodeInitV2::try_from_val(&env, &args.get(2).unwrap())
                .unwrap();
            let pinned = init
                .manifest
                .nodes
                .iter()
                .find(|entry| entry.state.contract_address == address)
                .unwrap()
                .wasm_hash;
            assert_eq!(
                pinned,
                env.crypto()
                    .sha256(&Bytes::from_slice(&env, &bytes))
                    .to_bytes(),
                "guest fixture pin matches actual executable"
            );
            env.register_at(&address, bytes.as_slice(), args);
        }
        token.mint(&address, &77);
        contracts.push(address);
    }
    let first: Vec<Val> = value(&env, &nodes, 0);
    let root: Address = value(&env, &first, 1);
    let mut wallets = std::vec::Vec::new();
    let mut payers = std::vec::Vec::new();
    for call in calls.iter() {
        let call = Vec::<Val>::try_from_val(&env, &call).unwrap();
        let args: Vec<Val> = value(&env, &call, 2);
        let payer: Address = value(&env, &args, 0);
        if !payers.contains(&payer) {
            token.mint(&payer, &100000);
            payers.push(payer.clone());
        }
        if !wallets.contains(&payer) {
            wallets.push(payer);
        }
        let payouts: Vec<Val> = value(&env, &call, 3);
        for payout in payouts.iter() {
            let payout = Vec::<Val>::try_from_val(&env, &payout).unwrap();
            let address: Address = value(&env, &payout, 0);
            if !wallets.contains(&address) {
                wallets.push(address);
            }
        }
    }
    // SDK26's diagnostic auth observer can exhaust a separate shadow budget for
    // guests. Disable observation only; real source-account auth stays enforced.
    env.host().set_invocation_hook(None).unwrap();
    for call in calls.iter() {
        let call = Vec::<Val>::try_from_val(&env, &call).unwrap();
        let name: String = value(&env, &call, 0);
        let succeeds: bool = value(&env, &call, 1);
        let args: Vec<Val> = value(&env, &call, 2);
        let payer: Address = value(&env, &args, 0);
        let amount: i128 = value(&env, &args, 2);
        let payouts: Vec<Val> = value(&env, &call, 3);
        let expected_route =
            payer::conditional_v2::RouteV2::try_from_val(&env, &args.get(7).unwrap()).unwrap();
        let before: std::vec::Vec<i128> = wallets
            .iter()
            .map(|address| token.balance(address))
            .collect();
        let xdr::ScAddress::Account(account) = xdr::ScAddress::from(&payer) else {
            panic!("payer account")
        };
        env.host().set_source_account(account).unwrap();
        env.set_auths(&[xdr::SorobanAuthorizationEntry {
            credentials: xdr::SorobanCredentials::SourceAccount,
            root_invocation: (&MockAuthInvoke {
                contract: &root,
                fn_name: "execute_v2",
                args: args.clone(),
                sub_invokes: &[MockAuthInvoke {
                    contract: &asset,
                    fn_name: "transfer",
                    args: (&payer, &root, amount).into_val(&env),
                    sub_invokes: &[],
                }],
            })
                .into(),
        }]);
        env.cost_estimate().budget().reset_default();
        let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
            &root,
            &Symbol::new(&env, "execute_v2"),
            args,
        );
        assert_eq!(
            result.is_ok(),
            succeeds,
            "{} {name:?}: {result:?}",
            path.display()
        );
        let cpu = env.cost_estimate().budget().cpu_instruction_cost();
        let memory = env.cost_estimate().budget().memory_bytes_cost();
        if succeeds {
            let events = env.events().all();
            let event = events
                .events()
                .iter()
                .find(|event| {
                    let xdr::ContractEventBody::V0(body) = &event.body;
                    body.topics[0] == xdr::ScVal::Symbol("route_v2".try_into().unwrap())
                })
                .expect("selected route event");
            let xdr::ContractEventBody::V0(body) = &event.body;
            let observed =
                payer::conditional_v2::RouteEventV2::try_from_val(&env, &body.data).unwrap();
            assert_eq!(observed.selected_branch, expected_route.selected_branch);
            assert_eq!(
                observed.amount_at_condition,
                expected_route.amount_at_condition
            );
            assert_eq!(observed.amount_at_condition, value::<i128>(&env, &call, 4));
        }
        if guest {
            std::println!("{} {name:?}: {cpu} instructions, {memory} metered memory bytes (default local budget; real source auth)",path.file_stem().unwrap().to_string_lossy());
        }
        for (i, wallet) in wallets.iter().enumerate() {
            let mut delta = if succeeds && wallet == &payer {
                -amount
            } else {
                0
            };
            for payout in payouts.iter() {
                let payout = Vec::<Val>::try_from_val(&env, &payout).unwrap();
                let recipient: Address = value(&env, &payout, 0);
                if succeeds && wallet == &recipient {
                    delta += value::<i128>(&env, &payout, 1);
                }
            }
            assert_eq!(
                token.balance(wallet),
                before[i] + delta,
                "{name:?} {wallet:?}"
            );
        }
        for address in &contracts {
            assert_eq!(token.balance(address), 77, "{name:?} surplus");
        }
    }
}
fn fixtures(guest: bool) {
    let directory = if guest {
        target().join("conditional-v2-packets")
    } else {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/conditional-v2-acceptance")
    };
    let mut files: std::vec::Vec<_> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.extension().is_some_and(|v| v == "xdr-hex"))
        .collect();
    files.sort();
    assert_eq!(
        files.len(),
        18,
        "both comparisons and all9 terminal pairings"
    );
    for path in files {
        run(&path, guest);
    }
}
#[test]
fn production_packets_execute_all_comparisons_and_terminal_pairs() {
    fixtures(false);
}
#[test]
#[ignore = "requires local four-family release WASMs and hash-bound packets; run explicitly for candidate acceptance"]
fn production_packets_execute_actual_wasms_at_default_resource_limits() {
    fixtures(true);
}
