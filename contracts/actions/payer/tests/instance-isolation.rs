//! Local guest evidence from unchanged production TypeScript constructor XDR.
//! These manual tests use a synthetic allowance token, not a live SAC/network.
use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Ledger as _, xdr::FromXdr, Address, Bytes,
    Env, IntoVal, Map, String, Symbol, TryFromVal, Val, Vec,
};

#[contracttype]
#[derive(Clone)]
enum TokenKey {
    Balance(Address),
    Allowance(Address, Address),
}
#[contract]
struct InstanceToken;
#[contractimpl]
impl InstanceToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let old = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&TokenKey::Balance(to), &old.checked_add(amount).unwrap());
    }
    pub fn balance(env: Env, who: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&TokenKey::Balance(who))
            .unwrap_or(0)
    }
    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        assert!(amount >= 0);
        assert!(amount == 0 || expiration_ledger >= env.ledger().sequence());
        env.storage().persistent().set(
            &TokenKey::Allowance(from, spender),
            &(amount, expiration_ledger),
        );
    }
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let (amount, expiration): (i128, u32) = env
            .storage()
            .persistent()
            .get(&TokenKey::Allowance(from, spender))
            .unwrap_or((0, 0));
        if expiration < env.ledger().sequence() {
            0
        } else {
            amount
        }
    }
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::move_balance(&env, from, to, amount);
    }
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        let allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        assert!(amount >= 0 && amount <= allowance);
        let (_, expiry): (i128, u32) = env
            .storage()
            .persistent()
            .get(&TokenKey::Allowance(from.clone(), spender.clone()))
            .unwrap();
        env.storage().persistent().set(
            &TokenKey::Allowance(from.clone(), spender),
            &(allowance - amount, expiry),
        );
        Self::move_balance(&env, from, to, amount);
    }
}
impl InstanceToken {
    fn move_balance(env: &Env, from: Address, to: Address, amount: i128) {
        let balance = Self::balance(env.clone(), from.clone());
        assert!(amount >= 0 && balance >= amount);
        let receiving = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(
            &TokenKey::Balance(from),
            &balance.checked_sub(amount).unwrap(),
        );
        env.storage().persistent().set(
            &TokenKey::Balance(to),
            &receiving.checked_add(amount).unwrap(),
        );
    }
}
fn value<T: TryFromVal<Env, Val>>(env: &Env, values: &Vec<Val>, index: u32) -> T {
    T::try_from_val(env, &values.get(index).unwrap())
        .ok()
        .unwrap()
}
fn hex(value: &str) -> std::vec::Vec<u8> {
    value
        .trim()
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
fn invoke<T: TryFromVal<Env, Val>>(
    env: &Env,
    address: &Address,
    method: &str,
    args: Vec<Val>,
) -> T {
    env.cost_estimate().budget().reset_default();
    env.invoke_contract(address, &Symbol::new(env, method), args)
}
fn root(env: &Env, nodes: &Vec<Val>) -> Address {
    let n: Vec<Val> = value(env, nodes, 0);
    value(env, &n, 1)
}
fn find(env: &Env, nodes: &Vec<Val>, kind: &str) -> Address {
    for node in nodes.iter() {
        let n = Vec::<Val>::try_from_val(env, &node).unwrap();
        if value::<String>(env, &n, 2) == String::from_str(env, kind) {
            return value(env, &n, 1);
        }
    }
    panic!("missing kind")
}
fn wasm_path(kind: &str) -> std::string::String {
    let name = match kind {
        "DEPOSIT_TRIGGER" => "deposit_trigger",
        "PAYER" => "payer",
        "STREAMER" => "paiflow_streamer",
        "SUBSCRIPTION" => "paiflow_subscription",
        "TIMELOCK_BRANCH" => "timelock_branch",
        "MULTISIG" => "paiflow_multisig",
        _ => panic!("kind"),
    };
    format!("../../target/wasm32v1-none/release/{name}.wasm")
}
fn load(env: &Env, kind: &str) -> Vec<Val> {
    let path = format!("../../../tests/fixtures/instance-acceptance/{kind}.xdr-hex");
    Vec::from_xdr(
        env,
        &Bytes::from_slice(env, &hex(&std::fs::read_to_string(path).unwrap())),
    )
    .unwrap()
}
fn register(env: &Env, nodes: &Vec<Val>, adapt_multisig_only_for_standalone_probe: bool) {
    for node in nodes.iter().rev() {
        let n = Vec::<Val>::try_from_val(env, &node).unwrap();
        let address: Address = value(env, &n, 1);
        let kind: String = value(env, &n, 2);
        let mut args: Vec<Val> = value(env, &n, 3);
        let kind = kind.to_string();
        if kind == "MULTISIG" && adapt_multisig_only_for_standalone_probe {
            // Explicitly NOT the production pipeline: probe the existing five-argument
            // contract in isolation after proving its actual production input fails.
            let encoded: Vec<Val> = value(env, &args, 2);
            let mut signers = Vec::<Address>::new(env);
            for entry in encoded.iter() {
                let row = Map::<Symbol, Val>::try_from_val(env, &entry).unwrap();
                signers.push_back(
                    Address::try_from_val(env, &row.get(Symbol::new(env, "address")).unwrap())
                        .unwrap(),
                );
            }
            args = Vec::from_array(
                env,
                [
                    args.get(0).unwrap(),
                    args.get(1).unwrap(),
                    signers.into_val(env),
                    args.get(3).unwrap(),
                    args.get(4).unwrap(),
                ],
            );
        }
        let bytes = std::fs::read(wasm_path(&kind)).unwrap();
        env.register_at(&address, bytes.as_slice(), args);
    }
}
fn auth_is(env: &Env, address: &Address) {
    let auths = env.auths();
    assert!(!auths.is_empty());
    assert!(auths.iter().all(|(who, _)| who == address));
}

fn run(kind: &str) {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().set_sequence_number(10);
    env.mock_all_auths();
    let packet = load(&env, kind);
    let asset: Address = value(&env, &packet, 1);
    let admin: Address = value(&env, &packet, 2);
    let subscriber: Address = value(&env, &packet, 3);
    let instances: Vec<Val> = value(&env, &packet, 4);
    let a: Vec<Val> = value(&env, &instances, 0);
    let b: Vec<Val> = value(&env, &instances, 1);
    let wallets: Vec<Address> = value(&env, &packet, 5);
    let ra = wallets.get(0).unwrap();
    let rb = wallets.get(1).unwrap();
    env.register_at(&asset, InstanceToken, ());
    let token = InstanceTokenClient::new(&env, &asset);
    token.mint(&admin, &1000);
    token.mint(&subscriber, &1000);
    register(&env, &a, false);
    register(&env, &b, false);
    let ar = root(&env, &a);
    let br = root(&env, &b);
    assert_ne!(ar, br);
    match kind {
        "immediate" => {
            token.mint(&br, &77);
            invoke::<()>(&env, &ar, "deposit", (&admin, 100i128).into_val(&env));
            auth_is(&env, &admin);
            assert_eq!(token.balance(&ra), 100);
            assert_eq!(token.balance(&rb), 0);
            assert_eq!(token.balance(&br), 77);
            invoke::<()>(&env, &br, "deposit", (&admin, 50i128).into_val(&env));
            auth_is(&env, &admin);
            assert_eq!(token.balance(&ra), 100);
            assert_eq!(token.balance(&rb), 50);
            assert_eq!(token.balance(&br), 77);
        }
        "schedule" => {
            token.mint(&ar, &1000);
            token.mint(&br, &1000);
            let start: u64 = invoke(&env, &ar, "start_ts", Vec::new(&env));
            let other_start: u64 = invoke(&env, &br, "start_ts", Vec::new(&env));
            assert_eq!(other_start, start + 120);
            env.ledger().set_timestamp(start + 60);
            assert_eq!(invoke::<i128>(&env, &ar, "claim", Vec::new(&env)), 100);
            assert_eq!(token.balance(&ra), 100);
            assert_eq!(token.balance(&rb), 0);
            assert_eq!(invoke::<i128>(&env, &br, "claimed", Vec::new(&env)), 0);
            invoke::<()>(&env, &ar, "pause", Vec::new(&env));
            auth_is(&env, &admin);
            assert!(invoke::<bool>(&env, &ar, "is_paused", Vec::new(&env)));
            assert!(!invoke::<bool>(&env, &br, "is_paused", Vec::new(&env)));
            env.ledger().set_timestamp(start + 180);
            assert_eq!(invoke::<i128>(&env, &br, "claim", Vec::new(&env)), 100);
            assert_eq!(token.balance(&ra), 100);
            assert_eq!(token.balance(&rb), 100);
        }
        "subscription" => {
            token.approve(&subscriber, &ar, &300, &1000);
            auth_is(&env, &subscriber);
            token.approve(&subscriber, &br, &300, &1000);
            auth_is(&env, &subscriber);
            let start: u64 = invoke(&env, &ar, "next_charge_at", Vec::new(&env));
            env.ledger().set_timestamp(start);
            invoke::<()>(&env, &ar, "charge", Vec::new(&env));
            auth_is(&env, &admin);
            assert_eq!(token.allowance(&subscriber, &ar), 200);
            assert_eq!(token.allowance(&subscriber, &br), 300);
            assert_eq!(
                invoke::<u64>(&env, &br, "next_charge_at", Vec::new(&env)),
                start
            );
            invoke::<()>(&env, &ar, "unsubscribe", Vec::new(&env));
            auth_is(&env, &subscriber);
            assert_eq!(token.allowance(&subscriber, &ar), 0);
            assert_eq!(token.allowance(&subscriber, &br), 300);
            assert!(!invoke::<bool>(&env, &br, "is_cancelled", Vec::new(&env)));
            invoke::<()>(&env, &br, "charge", Vec::new(&env));
            auth_is(&env, &admin);
            assert_eq!(token.balance(&ra), 100);
            assert_eq!(token.balance(&rb), 100);
        }
        "time-condition" => {
            let ca = find(&env, &a, "TIMELOCK_BRANCH");
            let cb = find(&env, &b, "TIMELOCK_BRANCH");
            invoke::<()>(&env, &ar, "deposit", (&admin, 100i128).into_val(&env));
            auth_is(&env, &admin);
            invoke::<()>(&env, &br, "deposit", (&admin, 200i128).into_val(&env));
            auth_is(&env, &admin);
            let deadline: u64 = invoke(&env, &ca, "unlock_time", Vec::new(&env));
            assert_eq!(
                invoke::<u64>(&env, &cb, "unlock_time", Vec::new(&env)),
                deadline + 120
            );
            env.ledger().set_timestamp(deadline + 1);
            invoke::<()>(&env, &ca, "release", Vec::new(&env));
            auth_is(&env, &admin);
            assert_eq!(token.balance(&ra), 100);
            assert_eq!(token.balance(&rb), 0);
            assert_eq!(invoke::<i128>(&env, &cb, "balance", Vec::new(&env)), 200);
            env.ledger().set_timestamp(deadline + 121);
            invoke::<()>(&env, &cb, "release", Vec::new(&env));
            auth_is(&env, &admin);
            assert_eq!(token.balance(&ra), 100);
            assert_eq!(token.balance(&rb), 200);
        }
        _ => panic!("unhandled scenario"),
    }
}

#[test]
#[ignore = "requires six local release WASM builds; no network I/O"]
fn compiled_standard_instance_state_isolation() {
    for kind in ["immediate", "schedule", "subscription", "time-condition"] {
        run(kind);
    }
}

#[test]
#[ignore = "documents unresolved MULTISIG ABI/forwarding readiness blockers, not supported pipeline acceptance"]
fn multisig_production_pipeline_is_blocked_and_standalone_approvals_are_isolated() {
    let bad = Env::default();
    bad.cost_estimate().budget().reset_unlimited();
    bad.mock_all_auths();
    let packet = load(&bad, "multisig");
    let instances: Vec<Val> = value(&bad, &packet, 4);
    let a: Vec<Val> = value(&bad, &instances, 0);
    let rejected =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| register(&bad, &a, false)))
            .expect_err("current production constructor must expose the reviewed mismatch");
    let message = rejected
        .downcast_ref::<std::string::String>()
        .map(std::string::String::as_str)
        .or_else(|| rejected.downcast_ref::<&str>().copied())
        .unwrap_or("unexpected panic type");
    assert!(
        message.contains("MismatchingParameterLen"),
        "unrelated constructor failure: {message}"
    );
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();
    let packet = load(&env, "multisig");
    let asset: Address = value(&env, &packet, 1);
    let admin: Address = value(&env, &packet, 2);
    let instances: Vec<Val> = value(&env, &packet, 4);
    let a: Vec<Val> = value(&env, &instances, 0);
    let b: Vec<Val> = value(&env, &instances, 1);
    let wallets: Vec<Address> = value(&env, &packet, 5);
    env.register_at(&asset, InstanceToken, ());
    let token = InstanceTokenClient::new(&env, &asset);
    token.mint(&admin, &1000);
    register(&env, &a, true);
    register(&env, &b, true);
    let ca = find(&env, &a, "MULTISIG");
    let cb = find(&env, &b, "MULTISIG");
    let before = token.balance(&admin);
    assert!(
        env.try_invoke_contract::<(), soroban_sdk::Error>(
            &root(&env, &a),
            &Symbol::new(&env, "deposit"),
            (&admin, 100i128).into_val(&env)
        )
        .is_err(),
        "constructor adaptation must not disguise missing execute_step forwarding"
    );
    assert_eq!(token.balance(&admin), before);
    assert_eq!(token.balance(&ca), 0);
    // Seed standalone contracts explicitly; this is NOT an alternative app funding path.
    for c in [&ca, &cb] {
        token.mint(c, &100);
        invoke::<()>(
            &env,
            c,
            "receive_and_forward",
            (&admin, &asset, 100i128, Vec::<Val>::new(&env)).into_val(&env),
        );
    }
    invoke::<()>(
        &env,
        &ca,
        "approve_by",
        (wallets.get(2).unwrap(),).into_val(&env),
    );
    auth_is(&env, &wallets.get(2).unwrap());
    assert_eq!(
        invoke::<Map<Address, bool>>(&env, &ca, "approvals", Vec::new(&env)).len(),
        1
    );
    assert_eq!(
        invoke::<Map<Address, bool>>(&env, &cb, "approvals", Vec::new(&env)).len(),
        0
    );
    invoke::<()>(
        &env,
        &ca,
        "approve_by",
        (wallets.get(3).unwrap(),).into_val(&env),
    );
    auth_is(&env, &wallets.get(3).unwrap());
    invoke::<()>(&env, &ca, "release", Vec::new(&env));
    assert_eq!(token.balance(&wallets.get(0).unwrap()), 100);
    assert_eq!(token.balance(&cb), 100);
    assert_eq!(
        invoke::<Map<Address, bool>>(&env, &cb, "approvals", Vec::new(&env)).len(),
        0
    );
}
