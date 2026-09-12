#![no_std]
#![allow(clippy::too_many_arguments)]
//! Swapper action: exchanges `asset_in` for `asset_out` through the Soroswap
//! router and forwards the whole output to exactly one downstream step.
//!
//! Instawards Phase 1, Deliverable 1. Scope of record:
//! `docs/design/2026-09-05-swapper-soroswap-integration.md`.
use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, vec, Address, Env, IntoVal, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct WorkflowTarget {
    pub address: Address,
    pub data: String,
}

#[contracttype]
pub enum Key {
    Admin,
    AssetIn,
    AssetOut,
    SlippageBps,
    Router,
    DeadlineSecs,
    ParentNode,
    NextSteps,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    InsufficientOutput = 4,
    BadSlippage = 5,
    BadDeadline = 6,
    TooManyNextSteps = 7,
    NoNextStep = 8,
}

const VERSION: u32 = 1;
const TOTAL_BPS: u32 = 10_000;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

// Soroswap publishes no client crate (its contracts are cdylib-only), so the
// three interfaces the swapper needs are declared by hand. Signatures were
// checked against soroswap/core on 2026-09-06. The real functions return
// `Result<_, CombinedRouterError>`; declaring the unwrapped type is correct for
// a cross-contract call: on success the host converts the value, on failure
// the router's error propagates and this call traps with it.
#[contractclient(name = "SoroswapRouterClient")]
pub trait SoroswapRouter {
    fn get_factory(env: Env) -> Address;
    fn swap_exact_tokens_for_tokens(
        env: Env,
        amount_in: i128,
        amount_out_min: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128>;
}

#[contractclient(name = "SoroswapFactoryClient")]
pub trait SoroswapFactory {
    fn get_pair(env: Env, token_a: Address, token_b: Address) -> Address;
}

#[contractclient(name = "SoroswapPairClient")]
pub trait SoroswapPair {
    fn get_reserves(env: Env) -> (i128, i128);
    fn token_0(env: Env) -> Address;
}

#[contract]
pub struct Swapper;

#[contractimpl]
impl Swapper {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset_in: Address,
        asset_out: Address,
        slippage_bps: u32,
        router: Address,
        deadline_secs: u64,
        parent: Address,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if slippage_bps > TOTAL_BPS {
            panic_with_error!(&env, Error::BadSlippage);
        }
        // The router rejects `ledger.timestamp() >= deadline`, so a zero
        // window can never pass.
        if deadline_secs == 0 {
            panic_with_error!(&env, Error::BadDeadline);
        }
        // The whole output goes to one step; splitting is the splitter's job.
        // Zero is rejected too: `do_swap` would still execute the trade and
        // then leave `asset_out` sitting here, and this contract has no way to
        // release it: no withdrawal function, and `admin` is stored but never read.
        if next_steps.len() > 1 {
            panic_with_error!(&env, Error::TooManyNextSteps);
        }
        if next_steps.is_empty() {
            panic_with_error!(&env, Error::NoNextStep);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::AssetIn, &asset_in);
        env.storage().instance().set(&Key::AssetOut, &asset_out);
        env.storage()
            .instance()
            .set(&Key::SlippageBps, &slippage_bps);
        env.storage().instance().set(&Key::Router, &router);
        env.storage()
            .instance()
            .set(&Key::DeadlineSecs, &deadline_secs);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    /// Called by the parent node (deposit trigger, splitter, timelock, ...)
    /// after it has transferred `amount` of `asset` to this contract.
    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();
        do_swap(&env, &asset, amount);
    }

    /// Called by receive_and_forward triggers (webhook, oracle, subscription).
    /// Funds are expected to already be held by this contract.
    //
    // Kept as a plain comment, not a doc comment: `#[contractimpl]` embeds doc
    // strings in the contract spec, so editing one changes the WASM hash.
    //
    // `from` is whoever calls, so this is permissionless: any account can
    // authorize as itself and swap `asset_in` sitting idle here. That is
    // acceptable because the output can only reach `next_steps[0]` or stay in
    // this contract, so nothing is divertible; the splitter's version has no
    // auth at all, so this is the stricter of the two. In practice there is no
    // idle balance, because the trigger transfers and calls `execute_step` in
    // one transaction.
    pub fn receive_and_forward(
        env: Env,
        from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        bump_ttl(&env);
        from.require_auth();
        do_swap(&env, &asset, amount);
    }

    pub fn asset_in(env: Env) -> Address {
        env.storage().instance().get(&Key::AssetIn).unwrap()
    }

    pub fn asset_out(env: Env) -> Address {
        env.storage().instance().get(&Key::AssetOut).unwrap()
    }

    pub fn slippage_bps(env: Env) -> u32 {
        env.storage().instance().get(&Key::SlippageBps).unwrap()
    }

    pub fn router(env: Env) -> Address {
        env.storage().instance().get(&Key::Router).unwrap()
    }

    pub fn deadline_secs(env: Env) -> u64 {
        env.storage().instance().get(&Key::DeadlineSecs).unwrap()
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::NextSteps).unwrap()
    }
}

fn do_swap(env: &Env, asset: &Address, amount: i128) {
    let asset_in: Address = env.storage().instance().get(&Key::AssetIn).unwrap();
    if *asset != asset_in {
        panic_with_error!(env, Error::Unauthorized);
    }
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    let asset_out: Address = env.storage().instance().get(&Key::AssetOut).unwrap();
    let slippage_bps: u32 = env.storage().instance().get(&Key::SlippageBps).unwrap();
    let router_addr: Address = env.storage().instance().get(&Key::Router).unwrap();
    let deadline_secs: u64 = env.storage().instance().get(&Key::DeadlineSecs).unwrap();
    let next_steps: Vec<WorkflowTarget> = env.storage().instance().get(&Key::NextSteps).unwrap();

    let me = env.current_contract_address();
    let router = SoroswapRouterClient::new(env, &router_addr);
    let factory = SoroswapFactoryClient::new(env, &router.get_factory());
    let pair_addr = factory.get_pair(&asset_in, &asset_out);
    let pair = SoroswapPairClient::new(env, &pair_addr);

    // The minimum output is the pool's spot price less `slippage_bps`, so the
    // bound covers the pool fee plus price impact. It must not be derived from
    // the router's own quote in this transaction: the router computes its
    // actual output with that same call on the same reserves, so such a check
    // could never fail.
    //
    // The limit of that: these reserves are the same pool state the router
    // swaps against, so the bound caps the 0.3% fee plus *this* swap's price
    // impact. It cannot detect a pool whose reserves were already pushed
    // off-market before this transaction, because the spot price moves with
    // them.
    let (reserve_0, reserve_1) = pair.get_reserves();
    let (reserve_in, reserve_out) = if pair.token_0() == asset_in {
        (reserve_0, reserve_1)
    } else {
        (reserve_1, reserve_0)
    };
    if reserve_in <= 0 || reserve_out <= 0 {
        panic_with_error!(env, Error::InsufficientOutput);
    }
    let spot_out = amount
        .checked_mul(reserve_out)
        .and_then(|v| v.checked_div(reserve_in))
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidAmount));
    let amount_out_min = spot_out
        .checked_mul((TOTAL_BPS - slippage_bps) as i128)
        .and_then(|v| v.checked_div(TOTAL_BPS as i128))
        .unwrap_or_else(|| panic_with_error!(env, Error::InvalidAmount));

    // The router calls `to.require_auth()` (satisfied because this contract is
    // the invoker) and then, one frame deeper, `asset_in.transfer(to, pair,
    // amount_in)`. Invoker auth does not reach that nested call, so it is
    // pre-authorized here. The entry must name the exact pair and amount.
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: asset_in.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: (me.clone(), pair_addr.clone(), amount).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);

    let path = vec![env, asset_in.clone(), asset_out.clone()];
    let deadline = env
        .ledger()
        .timestamp()
        .checked_add(deadline_secs)
        .unwrap_or_else(|| panic_with_error!(env, Error::BadDeadline));
    let amounts =
        router.swap_exact_tokens_for_tokens(&amount, &amount_out_min, &path, &me, &deadline);

    // The router already enforced `amount_out_min`; this is the swapper's own
    // backstop so the guarantee is verifiable here and survives a router change.
    let amount_out = amounts.last().unwrap_or(0);
    if amount_out <= 0 || amount_out < amount_out_min {
        panic_with_error!(env, Error::InsufficientOutput);
    }

    // The constructor guarantees exactly one, so this never falls through.
    // Kept as `if let` rather than an `unwrap` so a stored empty vec could only
    // ever strand the output, not trap after the swap has already moved funds.
    if let Some(step) = next_steps.first() {
        token::Client::new(env, &asset_out).transfer(&me, &step.address, &amount_out);
        invoke_execute_step(env, &step.address, &asset_out, &amount_out);
    }

    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("swap"), asset_in, asset_out),
        (amount, amount_out),
    );
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn invoke_execute_step(env: &Env, target: &Address, asset: &Address, amount: &i128) {
    let func = Symbol::new(env, "execute_step");
    env.invoke_contract::<()>(
        target,
        &func,
        vec![env, asset.into_val(env), amount.into_val(env)],
    );
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{contract, contracterror, contractimpl, token, vec, Env};

    // ---------------------------------------------------------------------
    // Mocks. The router reproduces the auth-relevant lines of Soroswap's
    // `swap_exact_tokens_for_tokens` (`to.require_auth()`, the inclusive
    // deadline check, `transfer(to -> pair)`), its constant-product output with
    // the 0.3% fee, and its error codes (CombinedRouterError). It also answers
    // `get_factory` / `get_pair` itself. The pair holds the reserves as token
    // balances, like the real one.
    // ---------------------------------------------------------------------

    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum RouterError {
        RouterDeadlineExpired = 503,
        RouterInsufficientOutputAmount = 507,
    }

    #[contracttype]
    pub enum PairKey {
        Token0,
        Token1,
    }

    #[contract]
    pub struct MockPair;

    #[contractimpl]
    impl MockPair {
        pub fn __constructor(env: Env, token_0: Address, token_1: Address) {
            env.storage().instance().set(&PairKey::Token0, &token_0);
            env.storage().instance().set(&PairKey::Token1, &token_1);
        }
        pub fn token_0(env: Env) -> Address {
            env.storage().instance().get(&PairKey::Token0).unwrap()
        }
        pub fn token_1(env: Env) -> Address {
            env.storage().instance().get(&PairKey::Token1).unwrap()
        }
        pub fn get_reserves(env: Env) -> (i128, i128) {
            let me = env.current_contract_address();
            let t0: Address = env.storage().instance().get(&PairKey::Token0).unwrap();
            let t1: Address = env.storage().instance().get(&PairKey::Token1).unwrap();
            (
                token::Client::new(&env, &t0).balance(&me),
                token::Client::new(&env, &t1).balance(&me),
            )
        }
        /// Test-only: the real pair pays out inside its own `swap`.
        pub fn pay_out(env: Env, token: Address, to: Address, amount: i128) {
            token::Client::new(&env, &token).transfer(
                &env.current_contract_address(),
                &to,
                &amount,
            );
        }
    }

    #[contracttype]
    pub enum RouterKey {
        Pair,
        Skew,
        Underdeliver,
    }

    #[contract]
    pub struct MockRouter;

    #[contractimpl]
    impl MockRouter {
        pub fn __constructor(env: Env, pair: Address) {
            env.storage().instance().set(&RouterKey::Pair, &pair);
            env.storage().instance().set(&RouterKey::Skew, &0u64);
            env.storage()
                .instance()
                .set(&RouterKey::Underdeliver, &false);
        }
        /// Test-only: seconds added to the router's view of the clock.
        pub fn set_skew(env: Env, secs: u64) {
            env.storage().instance().set(&RouterKey::Skew, &secs);
        }
        /// Test-only: pay `amount_out_min - 1` and skip the router's own check.
        pub fn set_underdeliver(env: Env, on: bool) {
            env.storage().instance().set(&RouterKey::Underdeliver, &on);
        }
        pub fn get_factory(env: Env) -> Address {
            env.current_contract_address()
        }
        pub fn get_pair(env: Env, _token_a: Address, _token_b: Address) -> Address {
            env.storage().instance().get(&RouterKey::Pair).unwrap()
        }
        pub fn swap_exact_tokens_for_tokens(
            env: Env,
            amount_in: i128,
            amount_out_min: i128,
            path: Vec<Address>,
            to: Address,
            deadline: u64,
        ) -> Vec<i128> {
            to.require_auth();
            let skew: u64 = env.storage().instance().get(&RouterKey::Skew).unwrap();
            if env.ledger().timestamp() + skew >= deadline {
                panic_with_error!(&env, RouterError::RouterDeadlineExpired);
            }
            let pair_addr: Address = env.storage().instance().get(&RouterKey::Pair).unwrap();
            let pair = MockPairClient::new(&env, &pair_addr);
            let token_in = path.get(0).unwrap();
            let token_out = path.get(1).unwrap();
            let (r0, r1) = pair.get_reserves();
            let (reserve_in, reserve_out) = if pair.token_0() == token_in {
                (r0, r1)
            } else {
                (r1, r0)
            };
            // Soroswap library get_amount_out: 0.3% fee, constant product.
            let with_fee = amount_in * 997;
            let mut out = with_fee * reserve_out / (reserve_in * 1000 + with_fee);
            let underdeliver: bool = env
                .storage()
                .instance()
                .get(&RouterKey::Underdeliver)
                .unwrap();
            if underdeliver {
                out = amount_out_min - 1;
            } else if out < amount_out_min {
                panic_with_error!(&env, RouterError::RouterInsufficientOutputAmount);
            }
            token::Client::new(&env, &token_in).transfer(&to, &pair_addr, &amount_in);
            pair.pay_out(&token_out, &to, &out);
            vec![&env, amount_in, out]
        }
    }

    /// Stands in for the deposit trigger: holds funds, hands them to the
    /// swapper, then invokes it. Being the invoker satisfies
    /// `parent.require_auth()` exactly as the real trigger does.
    #[contract]
    pub struct MockParent;

    #[contractimpl]
    impl MockParent {
        pub fn __constructor(_env: Env) {}
        pub fn run(env: Env, swapper: Address, asset: Address, amount: i128) {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &swapper,
                &amount,
            );
            env.invoke_contract::<()>(
                &swapper,
                &Symbol::new(&env, "execute_step"),
                vec![&env, asset.into_val(&env), amount.into_val(&env)],
            );
        }
        pub fn run_rf(env: Env, swapper: Address, asset: Address, amount: i128) {
            let none = Vec::<WorkflowTarget>::new(&env);
            Self::run_rf_to(env, swapper, asset, amount, none);
        }
        /// Same as `run_rf` but passes a caller-chosen `next_steps`, which the
        /// swapper must ignore in favour of the one it was constructed with.
        pub fn run_rf_to(
            env: Env,
            swapper: Address,
            asset: Address,
            amount: i128,
            next_steps: Vec<WorkflowTarget>,
        ) {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &swapper,
                &amount,
            );
            env.invoke_contract::<()>(
                &swapper,
                &Symbol::new(&env, "receive_and_forward"),
                vec![
                    &env,
                    env.current_contract_address().into_val(&env),
                    asset.into_val(&env),
                    amount.into_val(&env),
                    next_steps.into_val(&env),
                ],
            );
        }
    }

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    struct World {
        env: Env,
        tok_in: token::TokenClient<'static>,
        tok_out: token::TokenClient<'static>,
        router: Address,
        pair: Address,
        parent: Address,
        next: Address,
    }

    /// Auth is NOT mocked globally: the point of these tests is that the
    /// swapper's `authorize_as_current_contract` entry is what lets the
    /// router's nested transfer through. Only SAC minting is mocked, per call.
    /// `in_is_token_0` controls which side of the pair `asset_in` sits on.
    fn world(reserve_in: i128, reserve_out: i128, in_is_token_0: bool) -> World {
        let env = Env::default();
        env.ledger().set_timestamp(1_800_000_000);
        let admin = Address::generate(&env);
        let asset_in = env.register_stellar_asset_contract_v2(admin.clone());
        let asset_out = env.register_stellar_asset_contract_v2(admin.clone());
        let pair = if in_is_token_0 {
            env.register(MockPair, (asset_in.address(), asset_out.address()))
        } else {
            env.register(MockPair, (asset_out.address(), asset_in.address()))
        };
        let router = env.register(MockRouter, (pair.clone(),));
        let parent = env.register(MockParent, ());
        let next = env.register(Dummy, ());

        let sac_in = token::StellarAssetClient::new(&env, &asset_in.address());
        let sac_out = token::StellarAssetClient::new(&env, &asset_out.address());
        sac_in.mock_all_auths().mint(&pair, &reserve_in);
        sac_out.mock_all_auths().mint(&pair, &reserve_out);
        sac_in.mock_all_auths().mint(&parent, &10_000_000_000_000);

        let env2 = env.clone();
        World {
            tok_in: token::TokenClient::new(&env2, &asset_in.address()),
            tok_out: token::TokenClient::new(&env2, &asset_out.address()),
            env,
            router,
            pair,
            parent,
            next,
        }
    }

    fn deploy(w: &World, slippage_bps: u32, deadline_secs: u64, with_next: bool) -> Address {
        let next_steps = if with_next {
            vec![
                &w.env,
                WorkflowTarget {
                    address: w.next.clone(),
                    data: String::from_str(&w.env, ""),
                },
            ]
        } else {
            Vec::<WorkflowTarget>::new(&w.env)
        };
        w.env.register(
            Swapper,
            (
                Address::generate(&w.env),
                w.tok_in.address.clone(),
                w.tok_out.address.clone(),
                slippage_bps,
                w.router.clone(),
                deadline_secs,
                w.parent.clone(),
                next_steps,
            ),
        )
    }

    const XLM: i128 = 10_000_000; // 1 unit in stroops

    #[test]
    fn happy_path_swaps_and_forwards_to_the_single_next_step() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &(10 * XLM));

        // out = 10 * 0.997 * 100000 / (100000 + 9.97) ≈ 9.969 units
        let out = w.tok_out.balance(&w.next);
        assert!(out > 99_600_000 && out < 99_700_000, "out = {out}");
        assert_eq!(w.tok_in.balance(&swapper), 0);
        assert_eq!(w.tok_out.balance(&swapper), 0);
        assert_eq!(w.tok_in.balance(&w.pair), 100_000 * XLM + 10 * XLM);
        assert_eq!(w.tok_out.balance(&w.pair), 100_000 * XLM - out);
        let client = SwapperClient::new(&w.env, &swapper);
        assert_eq!(client.slippage_bps(), 100);
        assert_eq!(client.deadline_secs(), 300);
    }

    #[test]
    fn receive_and_forward_path_swaps_too() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        MockParentClient::new(&w.env, &w.parent).run_rf(&swapper, &w.tok_in.address, &(10 * XLM));
        assert!(w.tok_out.balance(&w.next) > 99_600_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn without_a_next_step_construction_is_rejected() {
        // Constructing with no next step used to succeed, and the swap then
        // ran to completion and left `asset_out` in a contract with no
        // withdrawal path. Rejected here so the funds never arrive.
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        deploy(&w, 100, 300, false);
    }

    #[test]
    fn reserves_are_oriented_by_token_0_when_asset_in_is_token_1() {
        // reserve_in > reserve_out: only the correct orientation yields a
        // minimum the 0.3% fee can clear. Reversed, the minimum would be ~4x
        // the real output and the router would reject.
        let w = world(200_000 * XLM, 100_000 * XLM, false);
        let swapper = deploy(&w, 100, 300, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &(10 * XLM));
        let out = w.tok_out.balance(&w.next);
        assert!(out > 49_800_000 && out < 50_000_000, "out = {out}");
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #507)")]
    fn zero_slippage_reverts_on_the_pool_fee_alone() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 0, 300, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &(10 * XLM));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #507)")]
    fn large_trade_reverts_on_price_impact() {
        let w = world(1_000 * XLM, 1_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &(500 * XLM));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn router_under_delivery_is_caught_by_the_swapper_backstop() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        MockRouterClient::new(&w.env, &w.router).set_underdeliver(&true);
        let swapper = deploy(&w, 100, 300, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &(10 * XLM));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn zero_output_is_rejected() {
        // 1 stroop against a pool where out is worth far more than in.
        let w = world(1_000_000 * XLM, XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #503)")]
    fn deadline_expiry_is_the_routers_inclusive_check() {
        // Only reachable with a skewed clock: on-chain the deadline is computed
        // in the same transaction the router checks it in.
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        MockRouterClient::new(&w.env, &w.router).set_skew(&5);
        let swapper = deploy(&w, 100, 1, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &(10 * XLM));
    }

    #[test]
    fn unauthenticated_caller_cannot_execute_step() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        w.tok_in
            .mock_all_auths()
            .transfer(&w.parent, &swapper, &(10 * XLM));
        let client = SwapperClient::new(&w.env, &swapper);
        assert!(client
            .try_execute_step(&w.tok_in.address, &(10 * XLM))
            .is_err());
        assert_eq!(w.tok_in.balance(&swapper), 10 * XLM, "nothing moved");
    }

    #[test]
    fn receive_and_forward_requires_the_callers_auth() {
        // `from.require_auth()` is the only gate on this entry point: with no
        // auth mocked for `from`, the call must fail before do_swap runs, and
        // the asset_in it would have traded stays put.
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        w.tok_in
            .mock_all_auths()
            .transfer(&w.parent, &swapper, &(10 * XLM));
        let stranger = Address::generate(&w.env);
        let client = SwapperClient::new(&w.env, &swapper);
        assert!(client
            .try_receive_and_forward(
                &stranger,
                &w.tok_in.address,
                &(10 * XLM),
                &Vec::<WorkflowTarget>::new(&w.env),
            )
            .is_err());
        assert_eq!(w.tok_in.balance(&swapper), 10 * XLM, "nothing moved");
        assert_eq!(w.tok_out.balance(&w.next), 0);
    }

    #[test]
    fn receive_and_forward_ignores_caller_supplied_next_steps() {
        // The output destination is the stored next step, never the argument:
        // an authenticated caller naming a different contract still sees the
        // swap land on the one the pipeline was deployed with.
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        let decoy = w.env.register(Dummy, ());
        let forged = vec![
            &w.env,
            WorkflowTarget {
                address: decoy.clone(),
                data: String::from_str(&w.env, ""),
            },
        ];
        MockParentClient::new(&w.env, &w.parent).run_rf_to(
            &swapper,
            &w.tok_in.address,
            &(10 * XLM),
            &forged,
        );
        assert!(
            w.tok_out.balance(&w.next) > 99_600_000,
            "stored next step paid"
        );
        assert_eq!(w.tok_out.balance(&decoy), 0, "forged next step got nothing");
        assert_eq!(w.tok_out.balance(&swapper), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn wrong_asset_is_rejected() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        let sac_out = token::StellarAssetClient::new(&w.env, &w.tok_out.address);
        sac_out.mock_all_auths().mint(&w.parent, &(10 * XLM));
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_out.address, &(10 * XLM));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn non_positive_amount_is_rejected() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let swapper = deploy(&w, 100, 300, true);
        MockParentClient::new(&w.env, &w.parent).run(&swapper, &w.tok_in.address, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn more_than_one_next_step_is_rejected_at_construction() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        let step = WorkflowTarget {
            address: w.next.clone(),
            data: String::from_str(&w.env, ""),
        };
        w.env.register(
            Swapper,
            (
                Address::generate(&w.env),
                w.tok_in.address.clone(),
                w.tok_out.address.clone(),
                100u32,
                w.router.clone(),
                300u64,
                w.parent.clone(),
                vec![&w.env, step.clone(), step],
            ),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn slippage_above_100_percent_is_rejected_at_construction() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        deploy(&w, 10_001, 300, true);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn zero_deadline_is_rejected_at_construction() {
        let w = world(100_000 * XLM, 100_000 * XLM, true);
        deploy(&w, 100, 0, true);
    }
}
