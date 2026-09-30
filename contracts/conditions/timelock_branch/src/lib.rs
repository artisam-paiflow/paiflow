#![no_std]
//! A timelock with two outcomes (#721). It holds the funds it is sent and, on
//! release, pays them to one of two next-step lists chosen by the ledger time:
//! strictly before `unlock_time` the "before" list, at or after it the "after"
//! list. It is a separate crate from `timelock` so contracts already deployed
//! from that one keep their ABI.
//!
//! Who may pick which side:
//! - the admin's `release()` works at any time and the ledger time picks the
//!   side, so an early release (a client approving delivered work, say) pays
//!   the "before" list;
//! - the relayer's `release_by_relayer(side)` names the side it intends, and the
//!   contract checks it against the ledger time: `Before` needs
//!   `now < unlock_time`, `After` needs `now >= unlock_time`. On a mismatch it
//!   reverts with `ConditionNotMet` and moves nothing. So the scheduled
//!   auto-release, which asks for `After`, can never pay the "before" list if
//!   its transaction lands in a ledger closed just before the deadline, and a
//!   "work delivered" signal, which asks for `Before`, can never pay the
//!   "after" list once the deadline has passed.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct WorkflowTarget {
    pub address: Address,
    pub data: String,
}

/// Which list a relayer release intends to pay.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Side {
    Before,
    After,
}

#[contracttype]
pub enum Key {
    Admin,
    Asset,
    UnlockTime,
    BeforeSteps,
    AfterSteps,
    Balance,
    ParentNode,
    Version,
    Relayer,
}

// 3 is `ConditionNotMet` and 4 `NothingToRelease`, as in `timelock`, so the
// auto-release classifier reads both contracts' errors with one table.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    ConditionNotMet = 3,
    NothingToRelease = 4,
    Overflow = 5,
    InvalidBranch = 6,
}

const VERSION: u32 = 1;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct TimelockBranch;

#[contractimpl]
impl TimelockBranch {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        unlock_time: u64,
        before_steps: Vec<WorkflowTarget>,
        after_steps: Vec<WorkflowTarget>,
        parent: Address,
        relayer: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        // Each side takes the whole balance, so it must be exactly one step:
        // an empty side would strand the funds in this contract, and a second
        // step would find nothing left to receive and revert every release.
        if before_steps.len() != 1 || after_steps.len() != 1 {
            panic_with_error!(&env, Error::InvalidBranch);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::UnlockTime, &unlock_time);
        env.storage()
            .instance()
            .set(&Key::BeforeSteps, &before_steps);
        env.storage().instance().set(&Key::AfterSteps, &after_steps);
        env.storage().instance().set(&Key::Balance, &0i128);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();

        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        let current: i128 = env.storage().instance().get(&Key::Balance).unwrap_or(0);
        env.storage().instance().set(
            &Key::Balance,
            &(current
                .checked_add(amount)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow))),
        );

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("receive"), asset), amount);
    }

    /// Admin release, at any time: before `unlock_time` pays the "before"
    /// list, at or after it the "after" list.
    pub fn release(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        perform_release(&env, &admin, None);
    }

    /// Relayer release of the named side, which must be the side the ledger
    /// time is on; otherwise `ConditionNotMet`.
    pub fn release_by_relayer(env: Env, side: Side) {
        let relayer: Address = env.storage().instance().get(&Key::Relayer).unwrap();
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        // When relayer == admin there is no dedicated relayer; only the admin
        // release path is available.
        if relayer == admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        relayer.require_auth();
        perform_release(&env, &admin, Some(side));
    }

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
    }

    pub fn balance(env: Env) -> i128 {
        env.storage().instance().get(&Key::Balance).unwrap_or(0)
    }

    pub fn unlock_time(env: Env) -> u64 {
        env.storage().instance().get(&Key::UnlockTime).unwrap()
    }

    pub fn before_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::BeforeSteps).unwrap()
    }

    pub fn after_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::AfterSteps).unwrap()
    }
}

fn perform_release(env: &Env, event_source: &Address, required: Option<Side>) {
    bump_ttl(env);

    let now = env.ledger().timestamp();
    let unlock_time: u64 = env.storage().instance().get(&Key::UnlockTime).unwrap();
    let is_after = now >= unlock_time;
    let actual = if is_after { Side::After } else { Side::Before };
    if let Some(side) = required {
        if side != actual {
            panic_with_error!(env, Error::ConditionNotMet);
        }
    }

    let balance: i128 = env.storage().instance().get(&Key::Balance).unwrap_or(0);
    if balance <= 0 {
        panic_with_error!(env, Error::NothingToRelease);
    }

    let (key, branch) = if is_after {
        (Key::AfterSteps, symbol_short!("after"))
    } else {
        (Key::BeforeSteps, symbol_short!("before"))
    };
    let steps: Vec<WorkflowTarget> = env.storage().instance().get(&key).unwrap();
    let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();

    // Zero the balance before the external calls, so a re-entrant release
    // finds nothing to pay. A failing transfer reverts the whole invocation.
    env.storage().instance().set(&Key::Balance, &0i128);

    for step in steps.iter() {
        token::Client::new(env, &asset).transfer(
            &env.current_contract_address(),
            &step.address,
            &balance,
        );
        invoke_execute_step(env, &step.address, &asset, &balance);
    }

    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("release"), event_source.clone(), branch),
        balance,
    );
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn invoke_execute_step(env: &Env, target: &Address, asset: &Address, amount: &i128) {
    let func = soroban_sdk::Symbol::new(env, "execute_step");
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
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    const UNLOCK: u64 = 1000;

    struct Setup {
        env: Env,
        admin: Address,
        relayer: Address,
        asset: Address,
        before: Address,
        after: Address,
        contract: Address,
    }

    impl Setup {
        fn client(&self) -> TimelockBranchClient<'_> {
            TimelockBranchClient::new(&self.env, &self.contract)
        }
        fn tok(&self) -> token::TokenClient<'_> {
            token::TokenClient::new(&self.env, &self.asset)
        }
    }

    fn target(env: &Env, address: &Address) -> Vec<WorkflowTarget> {
        vec![
            env,
            WorkflowTarget {
                address: address.clone(),
                data: String::from_str(env, ""),
            },
        ]
    }

    /// Deploys the contract with a dedicated relayer and funds it with 500.
    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let parent = Address::generate(&env);
        sac.mint(&parent, &1_000);

        let before = env.register(Dummy, ());
        let after = env.register(Dummy, ());

        let contract = env.register(
            TimelockBranch,
            (
                admin.clone(),
                asset.address(),
                UNLOCK,
                target(&env, &before),
                target(&env, &after),
                parent.clone(),
                relayer.clone(),
            ),
        );
        tok.transfer(&parent, &contract, &500);
        TimelockBranchClient::new(&env, &contract).execute_step(&asset.address(), &500);

        Setup {
            env,
            admin,
            relayer,
            asset: asset.address(),
            before,
            after,
            contract,
        }
    }

    /// A contract with no funds and no dedicated relayer (relayer == admin).
    fn empty_without_relayer(env: &Env) -> Address {
        let admin = Address::generate(env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let parent = Address::generate(env);
        let before = env.register(Dummy, ());
        let after = env.register(Dummy, ());
        env.register(
            TimelockBranch,
            (
                admin.clone(),
                asset.address(),
                UNLOCK,
                target(env, &before),
                target(env, &after),
                parent,
                admin,
            ),
        )
    }

    #[test]
    fn admin_release_before_deadline_pays_before_list() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK - 1);
        s.client().release();

        assert_eq!(s.client().balance(), 0);
        assert_eq!(s.tok().balance(&s.before), 500);
        assert_eq!(s.tok().balance(&s.after), 0);
        assert_eq!(s.tok().balance(&s.contract), 0);
    }

    #[test]
    fn admin_release_at_deadline_pays_after_list() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK);
        s.client().release();

        assert_eq!(s.tok().balance(&s.before), 0);
        assert_eq!(s.tok().balance(&s.after), 500);
    }

    #[test]
    fn admin_release_after_deadline_pays_after_list() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK + 5_000);
        s.client().release();

        assert_eq!(s.tok().balance(&s.before), 0);
        assert_eq!(s.tok().balance(&s.after), 500);
    }

    #[test]
    fn relayer_release_after_deadline_pays_after_list() {
        let s = setup();
        assert_eq!(s.client().relayer(), s.relayer);
        s.env.ledger().set_timestamp(UNLOCK + 1);
        s.client().release_by_relayer(&Side::After);

        assert_eq!(s.client().balance(), 0);
        assert_eq!(s.tok().balance(&s.before), 0);
        assert_eq!(s.tok().balance(&s.after), 500);
    }

    #[test]
    fn relayer_release_at_deadline_pays_after_list() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK);
        s.client().release_by_relayer(&Side::After);

        assert_eq!(s.tok().balance(&s.after), 500);
    }

    #[test]
    fn relayer_release_before_side_before_deadline_pays_before_list() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK - 1);
        s.client().release_by_relayer(&Side::Before);

        assert_eq!(s.client().balance(), 0);
        assert_eq!(s.tok().balance(&s.before), 500);
        assert_eq!(s.tok().balance(&s.after), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn relayer_after_side_before_deadline_is_refused() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK - 1);
        s.client().release_by_relayer(&Side::After);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn relayer_before_side_at_the_deadline_is_refused() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK);
        s.client().release_by_relayer(&Side::Before);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn relayer_before_side_after_the_deadline_is_refused() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK + 1);
        s.client().release_by_relayer(&Side::Before);
    }

    #[test]
    fn relayer_side_mismatch_either_way_leaves_the_funds() {
        let s = setup();
        for (now, wrong) in [
            (UNLOCK - 1, Side::After),
            (UNLOCK, Side::Before),
            (UNLOCK + 1, Side::Before),
        ] {
            s.env.ledger().set_timestamp(now);
            assert!(s.client().try_release_by_relayer(&wrong).is_err());
            assert_eq!(s.client().balance(), 500);
            assert_eq!(s.tok().balance(&s.contract), 500);
            assert_eq!(s.tok().balance(&s.before), 0);
            assert_eq!(s.tok().balance(&s.after), 0);
        }
    }

    #[test]
    fn relayer_release_needs_the_relayers_signature() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let parent = Address::generate(&env);
        let before = env.register(Dummy, ());
        let after = env.register(Dummy, ());
        let contract = env.register(
            TimelockBranch,
            (
                admin,
                asset.address(),
                UNLOCK,
                target(&env, &before),
                target(&env, &after),
                parent,
                relayer,
            ),
        );
        // No mock_all_auths: a dedicated relayer exists but has not signed.
        let client = TimelockBranchClient::new(&env, &contract);
        assert!(client.try_release_by_relayer(&Side::Before).is_err());
        assert!(client.try_release_by_relayer(&Side::After).is_err());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn release_by_relayer_refused_without_dedicated_relayer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = empty_without_relayer(&env);
        env.ledger().set_timestamp(UNLOCK);
        TimelockBranchClient::new(&env, &contract).release_by_relayer(&Side::After);
    }

    #[test]
    fn each_release_needs_its_own_signer() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK);

        s.client().release();
        let auths = s.env.auths();
        assert!(auths.iter().any(|(who, _)| *who == s.admin));
        assert!(!auths.iter().any(|(who, _)| *who == s.relayer));

        token::StellarAssetClient::new(&s.env, &s.asset).mint(&s.contract, &10);
        s.client().execute_step(&s.asset, &10);
        s.client().release_by_relayer(&Side::After);
        let auths = s.env.auths();
        assert!(auths.iter().any(|(who, _)| *who == s.relayer));
        assert!(!auths.iter().any(|(who, _)| *who == s.admin));
    }

    #[test]
    fn unauthorized_release_is_refused() {
        let env = Env::default();
        // No mock_all_auths: nobody has authorized anything.
        let contract = empty_without_relayer(&env);
        let client = TimelockBranchClient::new(&env, &contract);
        assert!(client.try_release().is_err());
        assert!(client.try_release_by_relayer(&Side::After).is_err());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn double_release_finds_nothing_to_release() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK - 1);
        s.client().release();
        s.client().release();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn zero_balance_release_is_refused() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = empty_without_relayer(&env);
        TimelockBranchClient::new(&env, &contract).release();
    }

    #[test]
    fn refilled_after_release_can_release_again() {
        let s = setup();
        s.env.ledger().set_timestamp(UNLOCK - 1);
        s.client().release();
        assert_eq!(s.tok().balance(&s.before), 500);

        token::StellarAssetClient::new(&s.env, &s.asset).mint(&s.contract, &200);
        s.client().execute_step(&s.asset, &200);
        s.env.ledger().set_timestamp(UNLOCK);
        s.client().release_by_relayer(&Side::After);

        assert_eq!(s.tok().balance(&s.before), 500);
        assert_eq!(s.tok().balance(&s.after), 200);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn execute_step_rejects_a_different_asset() {
        let s = setup();
        let other = Address::generate(&s.env);
        s.client().execute_step(&other, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn execute_step_overflow_is_an_error() {
        let s = setup();
        s.client().execute_step(&s.asset, &i128::MAX);
    }

    fn deploy_with(env: &Env, before: Vec<WorkflowTarget>, after: Vec<WorkflowTarget>) {
        let admin = Address::generate(env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let parent = Address::generate(env);
        env.register(
            TimelockBranch,
            (
                admin.clone(),
                asset.address(),
                UNLOCK,
                before,
                after,
                parent,
                admin,
            ),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn constructor_rejects_an_empty_before_list() {
        let env = Env::default();
        let after = env.register(Dummy, ());
        deploy_with(&env, Vec::new(&env), target(&env, &after));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn constructor_rejects_an_empty_after_list() {
        let env = Env::default();
        let before = env.register(Dummy, ());
        deploy_with(&env, target(&env, &before), Vec::new(&env));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn constructor_rejects_two_steps_on_one_side() {
        let env = Env::default();
        let a = env.register(Dummy, ());
        let b = env.register(Dummy, ());
        let mut two = target(&env, &a);
        two.push_back(WorkflowTarget {
            address: b,
            data: String::from_str(&env, ""),
        });
        deploy_with(&env, two, target(&env, &a));
    }
}
