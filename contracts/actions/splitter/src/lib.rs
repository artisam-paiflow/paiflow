#![no_std]
#[path = "../../../execution-v1.rs"]
pub mod execution_v1;
#[path = "../../../payment-math.rs"]
mod payment_math;
use execution_v1::{
    Allocation, AllocationMode, Capabilities, ExecutionContext, ExecutionError, FieldMode,
    MaybeAllocation, PolicyKey, SplitConfig, SplitState,
};

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, TryFromVal, Val, Vec,
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
    ArithmeticOverflow = 8,
}

const VERSION: u32 = 5;
const TOTAL_BPS: u32 = 10_000;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct Splitter;

#[contractimpl]
impl Splitter {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        recipients: Val,
        min_amount: i128,
        parent: Address,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        let recipients = if let Ok(legacy) = Vec::<Recipient>::try_from_val(&env, &recipients) {
            legacy
        } else {
            let config = SplitConfig::try_from_val(&env, &recipients)
                .unwrap_or_else(|_| execution_v1::fail(&env, ExecutionError::InvalidPolicy));
            execution_v1::validate_split(&env, &config);
            execution_v1::require_contract(&env, &asset);
            execution_v1::require(
                &env,
                next_steps.is_empty() && min_amount >= 0,
                ExecutionError::InvalidPolicy,
            );
            execution_v1::require_contract(&env, &parent);
            let mut configured = Vec::new(&env);
            let mut total_fixed = 0i128;
            for row in config.rows.iter() {
                if let (Some(address), MaybeAllocation::Present(allocation)) =
                    (row.recipient, row.allocation)
                {
                    let (bps, amount) = match allocation {
                        Allocation::Percentage(value) => (value, 0),
                        Allocation::Fixed(value) => (0, value),
                    };
                    total_fixed = total_fixed.checked_add(amount).unwrap_or_else(|| {
                        execution_v1::fail(&env, ExecutionError::ArithmeticOverflow)
                    });
                    configured.push_back(Recipient {
                        address,
                        bps,
                        amount,
                    });
                }
            }
            env.storage().instance().set(&PolicyKey::Split, &config);
            env.storage().instance().set(&Key::Admin, &admin);
            env.storage().instance().set(&Key::Asset, &asset);
            env.storage().instance().set(&Key::Recipients, &configured);
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
            return;
        };
        if recipients.is_empty() {
            panic_with_error!(&env, Error::NoRecipients);
        }
        if min_amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut total_bps: u32 = 0;
        let mut total_fixed: i128 = 0;
        for r in recipients.iter() {
            if r.amount < 0 || (r.bps == 0 && r.amount == 0) {
                panic_with_error!(&env, Error::InvalidAmount);
            }
            if r.bps > TOTAL_BPS {
                panic_with_error!(&env, Error::BpsSumInvalid);
            }
            if r.bps > 0 && r.amount > 0 {
                panic_with_error!(&env, Error::MixedModeNotAllowed);
            }
            total_bps = total_bps
                .checked_add(r.bps)
                .unwrap_or_else(|| panic_with_error!(&env, Error::BpsSumInvalid));
            total_fixed = total_fixed
                .checked_add(r.amount)
                .unwrap_or_else(|| panic_with_error!(&env, Error::ArithmeticOverflow));
        }

        if total_fixed > 0 {
            if total_bps != 0 {
                panic_with_error!(&env, Error::MixedModeNotAllowed);
            }
        } else if total_bps != TOTAL_BPS {
            panic_with_error!(&env, Error::BpsSumInvalid);
        }

        env.storage().instance().set(&Key::Admin, &admin);
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
        execution_v1::require_legacy(&env);
        from.require_auth();
        bump_ttl(&env);
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

    pub fn recipients(env: Env) -> Vec<Recipient> {
        env.storage().instance().get(&Key::Recipients).unwrap()
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
        execution_v1::require_legacy(&env);
        Self::require_admin(&env);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
    }

    pub fn execute_step_v1(env: Env, context: ExecutionContext, asset: Address, amount: i128) {
        let config: SplitConfig = env
            .storage()
            .instance()
            .get(&PolicyKey::Split)
            .unwrap_or_else(|| execution_v1::fail(&env, ExecutionError::Unsupported));
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        execution_v1::require(&env, stored_asset == asset, ExecutionError::Unauthorized);
        execution_v1::check_node(&env, &context, &config.node_id, &parent, &asset, amount);
        execution_v1::require(
            &env,
            context.index + 1 == context.bindings.len(),
            ExecutionError::InvalidInput,
        );
        execution_v1::require(
            &env,
            !env.storage()
                .instance()
                .get::<_, bool>(&Key::Paused)
                .unwrap_or(false),
            ExecutionError::Unsupported,
        );
        let min_amount: i128 = env.storage().instance().get(&Key::MinAmount).unwrap();
        execution_v1::require(&env, amount >= min_amount, ExecutionError::InvalidAmount);
        let input = execution_v1::find_input(&env, &context, &config.node_id);
        let execution = config.additional_mode == FieldMode::Execution
            || config.rows.iter().any(|r| {
                r.recipient_mode == FieldMode::Execution
                    || r.allocation_mode == FieldMode::Execution
            });
        let rows = execution_v1::merged_split(&env, &config, input, amount);
        let paid_out = if config.allocation_mode == AllocationMode::Fixed && !execution {
            // Constant fixed Split retains its existing accounted accumulation semantics.
            handle_fixed_deposit(&env, &asset, amount)
        } else {
            let mut paid = 0i128;
            for (index, row) in rows.iter().enumerate() {
                let payment = match row.allocation {
                    Allocation::Fixed(value) => value,
                    Allocation::Percentage(bps) => {
                        if index + 1 == rows.len() as usize {
                            amount.checked_sub(paid).unwrap_or_else(|| {
                                execution_v1::fail(&env, ExecutionError::ArithmeticOverflow)
                            })
                        } else {
                            payment_math::percentage_share(amount, bps).unwrap_or_else(|| {
                                execution_v1::fail(&env, ExecutionError::ArithmeticOverflow)
                            })
                        }
                    }
                };
                if payment > 0 {
                    execution_v1::transfer_exact(
                        &env,
                        &asset,
                        &env.current_contract_address(),
                        &row.recipient,
                        payment,
                    );
                }
                paid = paid.checked_add(payment).unwrap_or_else(|| {
                    execution_v1::fail(&env, ExecutionError::ArithmeticOverflow)
                });
            }
            execution_v1::require(&env, paid == amount, ExecutionError::InvalidAmount);
            true
        };
        bump_ttl(&env);
        if paid_out {
            // Preserve the existing event recipient shape for polling/notification consumers.
            let mut recipients = Vec::new(&env);
            for row in rows.iter() {
                let (bps, amount) = match row.allocation {
                    Allocation::Percentage(value) => (value, 0),
                    Allocation::Fixed(value) => (0, value),
                };
                recipients.push_back(Recipient {
                    address: row.recipient,
                    bps,
                    amount,
                });
            }
            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("payout"), context.payer), recipients);
        }
    }
    pub fn capabilities(env: Env) -> Capabilities {
        execution_v1::capabilities(&env)
    }
    pub fn config_revision(env: Env) -> u64 {
        execution_v1::revision(&env)
    }
    pub fn field_policy(env: Env) -> SplitConfig {
        env.storage()
            .instance()
            .get(&PolicyKey::Split)
            .unwrap_or_else(|| execution_v1::fail(&env, ExecutionError::Unsupported))
    }
    pub fn current_config(env: Env) -> SplitState {
        SplitState {
            policy: Self::field_policy(env.clone()),
            revision: execution_v1::revision(&env),
            asset: env.storage().instance().get(&Key::Asset).unwrap(),
            parent: env.storage().instance().get(&Key::ParentNode).unwrap(),
            min_amount: env.storage().instance().get(&Key::MinAmount).unwrap(),
        }
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        env.storage()
            .instance()
            .get(&Key::NextSteps)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        execution_v1::require_legacy(&env);
        let parent = require_parent(&env, None);
        execute_split(&env, &asset, amount, &parent);
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
        execution_v1::require_legacy(&env);
        let parent = require_parent(&env, Some(&from));
        execute_split(&env, &asset, amount, &parent);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
    }
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
            amount
                .checked_sub(distributed)
                .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow))
        } else {
            payment_math::percentage_share(amount, r.bps)
                .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow))
        };
        if share > 0 {
            client.transfer(&env.current_contract_address(), &r.address, &share);
            distributed = distributed
                .checked_add(share)
                .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow));
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
        .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow));
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
        let remaining = new_balance
            .checked_sub(total_fixed)
            .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow));
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
                total_fixed
                    .checked_sub(new_balance)
                    .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow)),
            ),
        );
        false
    }
}

fn do_split_fixed(env: &Env, asset: &Address, recipients: &Vec<Recipient>) {
    let client = token::Client::new(env, asset);
    for r in recipients.iter() {
        if r.amount > 0 {
            if execution_v1::has_policy(env) {
                execution_v1::transfer_exact(
                    env,
                    asset,
                    &env.current_contract_address(),
                    &r.address,
                    r.amount,
                );
            } else {
                client.transfer(&env.current_contract_address(), &r.address, &r.amount);
            }
        }
    }
}

fn require_parent(env: &Env, from: Option<&Address>) -> Address {
    let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
    if let Some(from) = from {
        if from != &parent {
            panic_with_error!(env, Error::Unauthorized);
        }
    }
    parent.require_auth();
    parent
}

fn execute_split(env: &Env, asset: &Address, amount: i128, parent: &Address) {
    bump_ttl(env);

    let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
    if asset != &stored_asset {
        panic_with_error!(env, Error::Unauthorized);
    }
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
    if env
        .storage()
        .instance()
        .get::<_, bool>(&Key::Paused)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::Paused);
    }

    let total_fixed: i128 = env
        .storage()
        .instance()
        .get(&Key::TotalFixedAmount)
        .unwrap_or(0);
    let distributed = if total_fixed > 0 {
        handle_fixed_deposit(env, asset, amount)
    } else {
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();
        do_split(env, asset, &recipients, amount);
        true
    };

    if distributed {
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();
        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("payout"), parent.clone()), recipients);
        forward_remaining(env, asset);
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
    if next_steps.is_empty() {
        return;
    }

    let client = token::Client::new(env, asset);
    let forward_amount = client.balance(&env.current_contract_address());

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
    use payer::{Payer, PayerClient};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    fn make_recipients(env: &Env, a: &Address, b: &Address, c: &Address) -> Vec<Recipient> {
        vec![
            env,
            Recipient {
                address: a.clone(),
                bps: 6000,
                amount: 0,
            },
            Recipient {
                address: b.clone(),
                bps: 3000,
                amount: 0,
            },
            Recipient {
                address: c.clone(),
                bps: 1000,
                amount: 0,
            },
        ]
    }

    #[test]
    fn distribute_splits_60_30_10() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_recipients(&env, &a, &b, &c),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);
        client.distribute(&payer, &10_000_000);

        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 3_000_000);
        assert_eq!(tok.balance(&c), 1_000_000);
        assert_eq!(tok.balance(&payer), 0);
    }

    #[test]
    fn execute_step_splits_and_passes_leftover() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let parent = Address::generate(&env);
        let next = env.register(Dummy, ());
        sac.mint(&parent, &10_000_000);

        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 3_000_000, 2_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);
        client.set_next_steps(&next_steps);

        tok.transfer(&parent, &contract_id, &10_000_000);
        client.execute_step(&asset.address(), &10_000_000);

        assert_eq!(tok.balance(&a), 3_000_000);
        assert_eq!(tok.balance(&b), 2_000_000);
        assert_eq!(tok.balance(&next), 5_000_000);
        assert_eq!(client.accumulated_balance(), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn bad_bps_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let bad = vec![
            &env,
            Recipient {
                address: a.clone(),
                bps: 6000,
                amount: 0,
            },
            Recipient {
                address: b.clone(),
                bps: 3000,
                amount: 0,
            },
        ];
        let parent = Address::generate(&env);
        env.register(
            Splitter,
            (
                admin,
                asset.address(),
                bad,
                0_i128,
                parent,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
    }

    #[test]
    fn receive_and_forward_splits_60_30_10() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &10_000_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_recipients(&env, &a, &b, &c),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &10_000_000);
        client.receive_and_forward(
            &parent,
            &asset.address(),
            &10_000_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 3_000_000);
        assert_eq!(tok.balance(&c), 1_000_000);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn receive_and_forward_respects_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &10_000_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_recipients(&env, &a, &b, &c),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        client.pause();
        tok.transfer(&predecessor, &contract_id, &10_000_000);
        client.receive_and_forward(
            &parent,
            &asset.address(),
            &10_000_000,
            &Vec::<WorkflowTarget>::new(&env),
        );
    }

    #[test]
    fn receive_and_forward_forwards_leftover() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &10_000_000);

        let parent = Address::generate(&env);
        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 3_000_000, 2_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);
        client.set_next_steps(&next_steps);

        tok.transfer(&predecessor, &contract_id, &10_000_000);
        client.receive_and_forward(
            &parent,
            &asset.address(),
            &10_000_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&a), 3_000_000);
        assert_eq!(tok.balance(&b), 2_000_000);
        assert_eq!(tok.balance(&next), 5_000_000);
        assert_eq!(client.accumulated_balance(), 0);
    }

    fn make_fixed_recipients(
        env: &Env,
        a: &Address,
        b: &Address,
        amount_a: i128,
        amount_b: i128,
    ) -> Vec<Recipient> {
        vec![
            env,
            Recipient {
                address: a.clone(),
                bps: 0,
                amount: amount_a,
            },
            Recipient {
                address: b.clone(),
                bps: 0,
                amount: amount_b,
            },
        ]
    }

    #[test]
    fn distribute_fixed_accumulates_until_total() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);

        let parent = Address::generate(&env);
        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 6_000_000, 4_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        client.distribute(&payer, &3_000_000);
        assert_eq!(tok.balance(&a), 0);
        assert_eq!(tok.balance(&b), 0);
        assert_eq!(client.accumulated_balance(), 3_000_000);

        client.distribute(&payer, &7_000_000);
        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 4_000_000);
        assert_eq!(client.accumulated_balance(), 0);
    }

    #[test]
    fn distribute_fixed_emits_shortfall() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);

        let parent = Address::generate(&env);
        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 6_000_000, 4_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        client.distribute(&payer, &3_000_000);

        // No payout yet; funds accumulate in the contract.
        assert_eq!(tok.balance(&a), 0);
        assert_eq!(tok.balance(&b), 0);
        assert_eq!(client.accumulated_balance(), 3_000_000);
        assert_eq!(tok.balance(&contract_id), 3_000_000);
    }

    #[test]
    fn execute_step_fixed_accumulates() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let parent = Address::generate(&env);
        sac.mint(&parent, &10_000_000);

        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 6_000_000, 4_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        tok.transfer(&parent, &contract_id, &3_000_000);
        client.execute_step(&asset.address(), &3_000_000);
        assert_eq!(tok.balance(&a), 0);
        assert_eq!(tok.balance(&b), 0);
        assert_eq!(client.accumulated_balance(), 3_000_000);

        tok.transfer(&parent, &contract_id, &7_000_000);
        client.execute_step(&asset.address(), &7_000_000);
        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 4_000_000);
        assert_eq!(client.accumulated_balance(), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn constructor_rejects_mixed_mode() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let mixed = vec![
            &env,
            Recipient {
                address: a.clone(),
                bps: 5000,
                amount: 0,
            },
            Recipient {
                address: b.clone(),
                bps: 0,
                amount: 1_000_000,
            },
        ];
        let parent = Address::generate(&env);
        env.register(
            Splitter,
            (
                admin,
                asset.address(),
                mixed,
                0_i128,
                parent,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn constructor_rejects_all_fixed_zero_total() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let a = Address::generate(&env);
        let zero = vec![
            &env,
            Recipient {
                address: a.clone(),
                bps: 0,
                amount: 0,
            },
        ];
        let parent = Address::generate(&env);
        env.register(
            Splitter,
            (
                admin,
                asset.address(),
                zero,
                0_i128,
                parent,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
    }

    #[test]
    fn distribute_fixed_forwards_leftover() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let payer = Address::generate(&env);
        let next = env.register(Dummy, ());
        sac.mint(&payer, &10_000_000);

        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let parent = Address::generate(&env);
        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 3_000_000, 2_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);
        client.set_next_steps(&next_steps);

        client.distribute(&payer, &10_000_000);

        assert_eq!(tok.balance(&a), 3_000_000);
        assert_eq!(tok.balance(&b), 2_000_000);
        assert_eq!(tok.balance(&next), 5_000_000);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(client.accumulated_balance(), 0);
    }

    #[test]
    fn fixed_splitter_forwards_leftover_to_payer() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let payer_recipient = Address::generate(&env);
        let parent = Address::generate(&env);
        sac.mint(&parent, &10_000_000);

        let splitter_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 3_000_000, 2_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let splitter_client = SplitterClient::new(&env, &splitter_id);

        let payer_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                payer_recipient.clone(),
                1_000_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                splitter_id.clone(),
            ),
        );
        let payer_client = PayerClient::new(&env, &payer_id);

        splitter_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: payer_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&parent, &splitter_id, &10_000_000);
        splitter_client.execute_step(&asset.address(), &10_000_000);

        assert_eq!(tok.balance(&a), 3_000_000);
        assert_eq!(tok.balance(&b), 2_000_000);
        assert_eq!(tok.balance(&payer_recipient), 1_000);
        assert_eq!(tok.balance(&payer_id), 4_999_000);
        assert_eq!(tok.balance(&splitter_id), 0);
        assert_eq!(splitter_client.accumulated_balance(), 0);
        assert_eq!(payer_client.configured_amount(), 1_000);
    }

    #[test]
    fn fixed_splitter_forwards_leftover_to_splitter() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let d = Address::generate(&env);
        let parent = Address::generate(&env);
        sac.mint(&parent, &10_000_000);

        let splitter1_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 3_000_000, 2_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let splitter1_client = SplitterClient::new(&env, &splitter1_id);

        let splitter2_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &c, &d, 1_000_000, 1_000_000),
                0_i128,
                splitter1_id.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let splitter2_client = SplitterClient::new(&env, &splitter2_id);

        splitter1_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: splitter2_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&parent, &splitter1_id, &10_000_000);
        splitter1_client.execute_step(&asset.address(), &10_000_000);

        assert_eq!(tok.balance(&a), 3_000_000);
        assert_eq!(tok.balance(&b), 2_000_000);
        assert_eq!(tok.balance(&c), 1_000_000);
        assert_eq!(tok.balance(&d), 1_000_000);
        assert_eq!(tok.balance(&splitter1_id), 0);
        assert_eq!(tok.balance(&splitter2_id), 3_000_000);
        assert_eq!(splitter1_client.accumulated_balance(), 0);
        assert_eq!(splitter2_client.accumulated_balance(), 3_000_000);
    }

    #[test]
    fn percentage_splitter_does_not_forward_without_leftover() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let payer_recipient = Address::generate(&env);
        let parent = Address::generate(&env);
        sac.mint(&parent, &10_000_000);

        let splitter_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_recipients(&env, &a, &b, &c),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let splitter_client = SplitterClient::new(&env, &splitter_id);

        let payer_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                payer_recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                splitter_id.clone(),
            ),
        );
        let _payer_client = PayerClient::new(&env, &payer_id);

        splitter_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: payer_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&parent, &splitter_id, &10_000_000);
        splitter_client.execute_step(&asset.address(), &10_000_000);

        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 3_000_000);
        assert_eq!(tok.balance(&c), 1_000_000);
        assert_eq!(tok.balance(&payer_id), 0);
        assert_eq!(tok.balance(&payer_recipient), 0);
        assert_eq!(tok.balance(&splitter_id), 0);
    }

    #[test]
    fn fixed_splitter_below_threshold_does_not_forward() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let payer_recipient = Address::generate(&env);
        let parent = Address::generate(&env);
        sac.mint(&parent, &3_000_000);

        let splitter_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_fixed_recipients(&env, &a, &b, 3_000_000, 2_000_000),
                0_i128,
                parent.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let splitter_client = SplitterClient::new(&env, &splitter_id);

        let payer_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                payer_recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                splitter_id.clone(),
            ),
        );

        splitter_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: payer_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&parent, &splitter_id, &3_000_000);
        splitter_client.execute_step(&asset.address(), &3_000_000);

        assert_eq!(tok.balance(&a), 0);
        assert_eq!(tok.balance(&b), 0);
        assert_eq!(tok.balance(&payer_id), 0);
        assert_eq!(tok.balance(&payer_recipient), 0);
        assert_eq!(tok.balance(&splitter_id), 3_000_000);
        assert_eq!(splitter_client.accumulated_balance(), 3_000_000);
    }
}

#[cfg(test)]
#[path = "arithmetic-tests.rs"]
mod arithmetic_tests;
