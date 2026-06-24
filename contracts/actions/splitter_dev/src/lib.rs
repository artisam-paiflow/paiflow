#![no_std]
//! SPLITTER_DEV — the mutable / parameterized variant of the `splitter` action.
//!
//! Same execution interface as `splitter` (`distribute`, `execute_step`,
//! `receive_and_forward`) so it slots into the pipeline, but its recipients can
//! be left blank at deploy time and filled / changed later via the auth-gated
//! `update_recipients` setter (admin OR relayer). Execution before the
//! recipients are configured fails cleanly with `NotConfigured` rather than
//! distributing nothing or panicking on an unwrap.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Recipient {
    pub address: Address,
    pub bps: u32,     // 0 for fixed-amount recipients
    pub amount: i128, // 0 for percentage recipients
}

#[contracttype]
#[derive(Clone)]
pub struct WorkflowTarget {
    pub address: Address,
    pub data: String,
}

#[contracttype]
pub enum Key {
    Admin,
    Relayer,
    Asset,
    Recipients,
    MinAmount,
    Paused,
    NextSteps,
    ParentNode,
    Version,
    TotalFixedAmount,
    AccumulatedBalance,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    BpsSumInvalid = 2,
    NoRecipients = 3,
    Paused = 4,
    Unauthorized = 5,
    InvalidAmount = 6,
    MixedModeNotAllowed = 7,
    /// Execution was triggered before the recipients were filled in.
    NotConfigured = 8,
}

const VERSION: u32 = 1;
const TOTAL_BPS: u32 = 10_000;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct SplitterDev;

#[contractimpl]
impl SplitterDev {
    pub fn __constructor(
        env: Env,
        admin: Address,
        relayer: Address,
        asset: Address,
        recipients: Vec<Recipient>,
        min_amount: i128,
        parent: Address,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        // Blank recipients are allowed at deploy time. When provided they must
        // pass the same invariants the immutable splitter enforces.
        let total_fixed = if recipients.is_empty() {
            0i128
        } else {
            validate_recipients(&env, &recipients)
        };

        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Recipients, &recipients);
        env.storage().instance().set(&Key::MinAmount, &min_amount);
        env.storage().instance().set(&Key::Paused, &false);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
        env.storage()
            .instance()
            .set(&Key::TotalFixedAmount, &total_fixed);
        env.storage()
            .instance()
            .set(&Key::AccumulatedBalance, &0i128);
    }

    pub fn distribute(env: Env, from: Address, amount: i128) {
        from.require_auth();
        bump_ttl(&env);
        require_configured(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let min_amount: i128 = env.storage().instance().get(&Key::MinAmount).unwrap_or(0);
        if min_amount > 0 && amount < min_amount {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if env
            .storage()
            .instance()
            .get::<_, bool>(&Key::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::Paused);
        }
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();

        let client = token::Client::new(&env, &asset);
        client.transfer(&from, env.current_contract_address(), &amount);

        let total_fixed: i128 = env
            .storage()
            .instance()
            .get(&Key::TotalFixedAmount)
            .unwrap_or(0);
        if total_fixed > 0 {
            let distributed = handle_fixed_deposit(&env, &asset, amount);
            if distributed {
                #[allow(deprecated)]
                env.events()
                    .publish((symbol_short!("payout"), from), recipients);
            }
        } else {
            do_split(&env, &asset, &recipients, amount);

            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("payout"), from), recipients);
        }

        forward_remaining(&env, &asset);
    }

    pub fn pause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::Paused, &true);
    }

    pub fn unpause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::Paused, &false);
    }

    /// Fill / change the recipient set. Auth: admin OR relayer. Validates the
    /// new recipients with the same invariants enforced at construction and
    /// resets the fixed-mode accumulator so a mode change cannot strand funds.
    pub fn update_recipients(env: Env, caller: Address, recipients: Vec<Recipient>) {
        require_admin_or_relayer(&env, &caller);
        if recipients.is_empty() {
            panic_with_error!(&env, Error::NoRecipients);
        }
        let total_fixed = validate_recipients(&env, &recipients);
        env.storage().instance().set(&Key::Recipients, &recipients);
        env.storage()
            .instance()
            .set(&Key::TotalFixedAmount, &total_fixed);
        env.storage()
            .instance()
            .set(&Key::AccumulatedBalance, &0i128);
        #[allow(deprecated)]
        env.events().publish(
            (Symbol::new(&env, "recipient_updated"), caller),
            recipients,
        );
    }

    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Relayer, &new_relayer);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_relayer"), admin), new_relayer);
    }

    pub fn is_configured(env: Env) -> bool {
        is_configured(&env)
    }

    pub fn recipients(env: Env) -> Vec<Recipient> {
        env.storage().instance().get(&Key::Recipients).unwrap()
    }

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
    }

    pub fn accumulated_balance(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&Key::AccumulatedBalance)
            .unwrap_or(0)
    }

    pub fn total_fixed_amount(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&Key::TotalFixedAmount)
            .unwrap_or(0)
    }

    pub fn set_next_steps(env: Env, next_steps: Vec<WorkflowTarget>) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage()
            .instance()
            .get(&Key::NextSteps)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();
        require_configured(&env);

        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if env
            .storage()
            .instance()
            .get::<_, bool>(&Key::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::Paused);
        }

        let total_fixed: i128 = env
            .storage()
            .instance()
            .get(&Key::TotalFixedAmount)
            .unwrap_or(0);
        let distributed = if total_fixed > 0 {
            handle_fixed_deposit(&env, &asset, amount)
        } else {
            let recipients: Vec<Recipient> =
                env.storage().instance().get(&Key::Recipients).unwrap();
            do_split(&env, &asset, &recipients, amount);
            true
        };

        if distributed {
            let recipients: Vec<Recipient> =
                env.storage().instance().get(&Key::Recipients).unwrap();
            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("payout"), parent.clone()), recipients);
            forward_remaining(&env, &asset);
        }
    }

    /// Called by receive_and_forward triggers (webhook, oracle, subscription).
    /// Funds are expected to already be held by this contract.
    pub fn receive_and_forward(
        env: Env,
        from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        bump_ttl(&env);
        require_configured(&env);
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if env
            .storage()
            .instance()
            .get::<_, bool>(&Key::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::Paused);
        }

        let total_fixed: i128 = env
            .storage()
            .instance()
            .get(&Key::TotalFixedAmount)
            .unwrap_or(0);
        let distributed = if total_fixed > 0 {
            handle_fixed_deposit(&env, &asset, amount)
        } else {
            let recipients: Vec<Recipient> =
                env.storage().instance().get(&Key::Recipients).unwrap();
            do_split(&env, &asset, &recipients, amount);
            true
        };

        if distributed {
            let recipients: Vec<Recipient> =
                env.storage().instance().get(&Key::Recipients).unwrap();
            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("payout"), from.clone()), recipients);
            forward_remaining(&env, &asset);
        }
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
    }
}

fn require_admin_or_relayer(env: &Env, caller: &Address) {
    caller.require_auth();
    let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
    let relayer: Address = env.storage().instance().get(&Key::Relayer).unwrap();
    if *caller != admin && *caller != relayer {
        panic_with_error!(env, Error::Unauthorized);
    }
}

fn is_configured(env: &Env) -> bool {
    let recipients: Vec<Recipient> = env
        .storage()
        .instance()
        .get(&Key::Recipients)
        .unwrap_or_else(|| Vec::new(env));
    !recipients.is_empty()
}

fn require_configured(env: &Env) {
    if !is_configured(env) {
        panic_with_error!(env, Error::NotConfigured);
    }
}

/// Validate a non-empty recipient set and return the total fixed amount.
/// Mirrors the immutable splitter's constructor invariants.
fn validate_recipients(env: &Env, recipients: &Vec<Recipient>) -> i128 {
    let mut total_bps: u32 = 0;
    let mut total_fixed: i128 = 0;
    for r in recipients.iter() {
        if r.bps > 0 && r.amount > 0 {
            panic_with_error!(env, Error::MixedModeNotAllowed);
        }
        total_bps = total_bps
            .checked_add(r.bps)
            .unwrap_or_else(|| panic_with_error!(env, Error::BpsSumInvalid));
        total_fixed = total_fixed
            .checked_add(r.amount)
            .unwrap_or_else(|| panic_with_error!(env, Error::BpsSumInvalid));
    }

    if total_fixed > 0 {
        if total_bps != 0 {
            panic_with_error!(env, Error::MixedModeNotAllowed);
        }
    } else if total_bps != TOTAL_BPS {
        panic_with_error!(env, Error::BpsSumInvalid);
    }

    total_fixed
}

fn do_split(env: &Env, asset: &Address, recipients: &Vec<Recipient>, amount: i128) {
    let client = token::Client::new(env, asset);
    let len = recipients.len();
    let last_idx = len - 1;
    let mut distributed: i128 = 0;
    let mut i: u32 = 0;
    while i < len {
        let r = recipients.get(i).unwrap();
        let share: i128 = if i == last_idx {
            amount.checked_sub(distributed).unwrap_or(0)
        } else {
            amount
                .checked_mul(r.bps as i128)
                .and_then(|v| v.checked_div(TOTAL_BPS as i128))
                .unwrap_or(0)
        };
        if share > 0 {
            client.transfer(&env.current_contract_address(), &r.address, &share);
            distributed = distributed.checked_add(share).unwrap_or(distributed);
        }
        i += 1;
    }
}

fn handle_fixed_deposit(env: &Env, asset: &Address, amount: i128) -> bool {
    let balance: i128 = env
        .storage()
        .instance()
        .get(&Key::AccumulatedBalance)
        .unwrap_or(0);
    let new_balance = balance
        .checked_add(amount)
        .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount));
    env.storage()
        .instance()
        .set(&Key::AccumulatedBalance, &new_balance);

    let total_fixed: i128 = env
        .storage()
        .instance()
        .get(&Key::TotalFixedAmount)
        .unwrap_or(0);
    if new_balance >= total_fixed {
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();
        do_split_fixed(env, asset, &recipients);
        let remaining = new_balance.checked_sub(total_fixed).unwrap_or(0);
        env.storage()
            .instance()
            .set(&Key::AccumulatedBalance, &remaining);
        true
    } else {
        #[allow(deprecated)]
        env.events().publish(
            (symbol_short!("shortfall"), asset.clone()),
            (
                amount,
                new_balance,
                total_fixed,
                total_fixed.checked_sub(new_balance).unwrap_or(0),
            ),
        );
        false
    }
}

fn do_split_fixed(env: &Env, asset: &Address, recipients: &Vec<Recipient>) {
    let client = token::Client::new(env, asset);
    for r in recipients.iter() {
        if r.amount > 0 {
            client.transfer(&env.current_contract_address(), &r.address, &r.amount);
        }
    }
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn forward_remaining(env: &Env, asset: &Address) {
    let next_steps: Vec<WorkflowTarget> = env
        .storage()
        .instance()
        .get(&Key::NextSteps)
        .unwrap_or_else(|| Vec::new(env));
    let client = token::Client::new(env, asset);
    let balance = client.balance(&env.current_contract_address());

    let has_steps = !next_steps.is_empty();
    let forward_amount = if has_steps && balance > 0 { balance } else { 0 };

    if forward_amount > 0 {
        if let Some(step) = next_steps.first() {
            client.transfer(
                &env.current_contract_address(),
                &step.address,
                &forward_amount,
            );

            #[allow(deprecated)]
            env.events().publish(
                (
                    symbol_short!("forward"),
                    asset.clone(),
                    step.address.clone(),
                ),
                forward_amount,
            );

            invoke_execute_step(env, &step.address, asset, &forward_amount);

            let total_fixed: i128 = env
                .storage()
                .instance()
                .get(&Key::TotalFixedAmount)
                .unwrap_or(0);
            if total_fixed > 0 {
                env.storage()
                    .instance()
                    .set(&Key::AccumulatedBalance, &0i128);
            }
        }
    }
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
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, vec, Env};

    fn pct_recipients(env: &Env, a: &Address, b: &Address) -> Vec<Recipient> {
        vec![
            env,
            Recipient {
                address: a.clone(),
                bps: 6000,
                amount: 0,
            },
            Recipient {
                address: b.clone(),
                bps: 4000,
                amount: 0,
            },
        ]
    }

    fn deploy(
        env: &Env,
        recipients: Vec<Recipient>,
    ) -> (Address, Address, Address, Address, Address) {
        let admin = Address::generate(env);
        let relayer = Address::generate(env);
        let parent = Address::generate(env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let contract_id = env.register(
            SplitterDev,
            (
                admin.clone(),
                relayer.clone(),
                asset.address(),
                recipients,
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(env),
            ),
        );
        (contract_id, asset.address(), admin, relayer, parent)
    }

    #[test]
    fn blank_construction_then_configure_and_split() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, admin, _relayer, _parent) =
            deploy(&env, Vec::<Recipient>::new(&env));
        let client = SplitterDevClient::new(&env, &contract_id);
        assert!(!client.is_configured());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        client.update_recipients(&admin, &pct_recipients(&env, &a, &b));
        assert!(client.is_configured());

        let sac = token::StellarAssetClient::new(&env, &asset);
        let tok = token::TokenClient::new(&env, &asset);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);

        client.distribute(&payer, &10_000_000);
        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 4_000_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn distribute_before_configured_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, _admin, _relayer, _parent) =
            deploy(&env, Vec::<Recipient>::new(&env));
        let sac = token::StellarAssetClient::new(&env, &asset);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);

        let client = SplitterDevClient::new(&env, &contract_id);
        client.distribute(&payer, &10_000_000);
    }

    #[test]
    fn relayer_can_update_recipients() {
        let env = Env::default();
        env.mock_all_auths();

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let (contract_id, asset, _admin, relayer, _parent) =
            deploy(&env, pct_recipients(&env, &a, &b));
        let client = SplitterDevClient::new(&env, &contract_id);

        let c = Address::generate(&env);
        let d = Address::generate(&env);
        client.update_recipients(&relayer, &pct_recipients(&env, &c, &d));

        let sac = token::StellarAssetClient::new(&env, &asset);
        let tok = token::TokenClient::new(&env, &asset);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);
        client.distribute(&payer, &10_000_000);

        assert_eq!(tok.balance(&c), 6_000_000);
        assert_eq!(tok.balance(&d), 4_000_000);
        assert_eq!(tok.balance(&a), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn stranger_cannot_update_recipients() {
        let env = Env::default();
        env.mock_all_auths();

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let (contract_id, _asset, _admin, _relayer, _parent) =
            deploy(&env, pct_recipients(&env, &a, &b));
        let stranger = Address::generate(&env);
        let client = SplitterDevClient::new(&env, &contract_id);
        client.update_recipients(&stranger, &pct_recipients(&env, &a, &b));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn constructor_rejects_bad_bps() {
        let env = Env::default();
        env.mock_all_auths();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let bad = vec![
            &env,
            Recipient {
                address: a,
                bps: 6000,
                amount: 0,
            },
            Recipient {
                address: b,
                bps: 3000,
                amount: 0,
            },
        ];
        deploy(&env, bad);
    }
}
