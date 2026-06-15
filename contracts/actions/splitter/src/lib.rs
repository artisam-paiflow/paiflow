#![no_std]
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
}

const VERSION: u32 = 1;
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
        recipients: Vec<Recipient>,
        min_amount: i128,
        parent: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if recipients.is_empty() {
            panic_with_error!(&env, Error::NoRecipients);
        }
        let mut total_bps: u32 = 0;
        let mut total_fixed: i128 = 0;
        for r in recipients.iter() {
            if r.bps > 0 && r.amount > 0 {
                panic_with_error!(&env, Error::MixedModeNotAllowed);
            }
            total_bps = total_bps
                .checked_add(r.bps)
                .unwrap_or_else(|| panic_with_error!(&env, Error::BpsSumInvalid));
            total_fixed = total_fixed
                .checked_add(r.amount)
                .unwrap_or_else(|| panic_with_error!(&env, Error::BpsSumInvalid));
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
        env.storage()
            .instance()
            .set(&Key::NextSteps, &Vec::<WorkflowTarget>::new(&env));
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
                let topic: Symbol = symbol_short!("distrib");
                #[allow(deprecated)]
                env.events()
                    .publish((topic, from.clone()), (asset.clone(), total_fixed));
                #[allow(deprecated)]
                env.events()
                    .publish((symbol_short!("payout"), from), recipients);
            }
        } else {
            do_split(&env, &asset, &recipients, amount);

            let topic: Symbol = symbol_short!("distrib");
            #[allow(deprecated)]
            env.events()
                .publish((topic, from.clone()), (asset.clone(), amount));
            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("payout"), from), recipients);
        }
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
            let next_steps: Vec<WorkflowTarget> = env
                .storage()
                .instance()
                .get(&Key::NextSteps)
                .unwrap_or_else(|| Vec::new(&env));
            for step in next_steps.iter() {
                invoke_execute_step(&env, &step.address, &asset, &0);
            }

            let emit_amount = if total_fixed > 0 { total_fixed } else { amount };
            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("distrib"), asset), emit_amount);
        }
    }

    /// Called by receive_and_forward triggers (webhook, oracle, subscription).
    /// Funds are expected to already be held by this contract.
    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        bump_ttl(&env);
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
            let next_steps: Vec<WorkflowTarget> = env
                .storage()
                .instance()
                .get(&Key::NextSteps)
                .unwrap_or_else(|| Vec::new(&env));
            for step in next_steps.iter() {
                invoke_execute_step(&env, &step.address, &asset, &0);
            }

            let emit_amount = if total_fixed > 0 { total_fixed } else { amount };
            #[allow(deprecated)]
            env.events()
                .publish((symbol_short!("distrib"), asset), emit_amount);
        }
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
            #[allow(deprecated)]
            env.events().publish(
                (symbol_short!("pay"), r.address.clone()),
                (asset.clone(), r.amount),
            );
        }
    }
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
    fn execute_step_splits_and_passes_control() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        let parent = Address::generate(&env);
        sac.mint(&parent, &10_000_000);

        let contract_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                make_recipients(&env, &a, &b, &c),
                0_i128,
                parent.clone(),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        tok.transfer(&parent, &contract_id, &10_000_000);
        client.execute_step(&asset.address(), &10_000_000);

        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 3_000_000);
        assert_eq!(tok.balance(&c), 1_000_000);
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
        env.register(Splitter, (admin, asset.address(), bad, 0_i128, parent));
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
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &10_000_000);
        client.receive_and_forward(
            &predecessor,
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
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);

        client.pause();
        tok.transfer(&predecessor, &contract_id, &10_000_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &10_000_000,
            &Vec::<WorkflowTarget>::new(&env),
        );
    }

    #[test]
    fn receive_and_forward_forwards_to_next_steps() {
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
                make_recipients(&env, &a, &b, &c),
                0_i128,
                parent.clone(),
            ),
        );
        let client = SplitterClient::new(&env, &contract_id);
        client.set_next_steps(&next_steps);

        tok.transfer(&predecessor, &contract_id, &10_000_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &10_000_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&a), 6_000_000);
        assert_eq!(tok.balance(&b), 3_000_000);
        assert_eq!(tok.balance(&c), 1_000_000);
        assert_eq!(tok.balance(&contract_id), 0);
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
        env.register(Splitter, (admin, asset.address(), mixed, 0_i128, parent));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
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
        env.register(Splitter, (admin, asset.address(), zero, 0_i128, parent));
    }
}
