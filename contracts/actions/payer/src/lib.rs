#![no_std]
#![allow(clippy::too_many_arguments)]
#[path = "../../../execution-v1.rs"]
pub mod execution_v1;
#[path = "../../../payment-math.rs"]
mod payment_math;
use execution_v1::{
    Capabilities, ExecutionContext, ExecutionError, FieldMode, MutationContext, MutationStatus,
    NodeInput, NodeMutation, PayConfig, PayState, PayoutRule, PolicyKey, Target,
};

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, TryFromVal, Val, Vec,
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
    Asset,
    Recipient,
    Amount,
    PercentageBps,
    NextSteps,
    ParentNode,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    ArithmeticOverflow = 4,
    InvalidPercentage = 5,
}

const VERSION: u32 = 5;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct Payer;

#[contractimpl]
impl Payer {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        recipient: Val,
        amount: i128,
        percentage_bps: u32,
        next_steps: Vec<WorkflowTarget>,
        parent: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        let recipient = if let Ok(legacy) = Address::try_from_val(&env, &recipient) {
            Some(legacy)
        } else {
            let config = PayConfig::try_from_val(&env, &recipient)
                .unwrap_or_else(|_| execution_v1::fail(&env, ExecutionError::InvalidPolicy));
            execution_v1::validate_pay(&env, &config);
            execution_v1::require_contract(&env, &asset);
            execution_v1::require(&env, next_steps.len() <= 1, ExecutionError::InvalidPolicy);
            execution_v1::require_contract(&env, &parent);
            for step in next_steps.iter() {
                execution_v1::require_contract(&env, &step.address);
                execution_v1::require(&env, step.data.is_empty(), ExecutionError::InvalidPolicy);
            }
            execution_v1::require(
                &env,
                match config.payout_rule {
                    PayoutRule::Full => amount == 0 && percentage_bps == 10_000,
                    PayoutRule::Percentage(bps) => amount == 0 && bps == percentage_bps,
                    PayoutRule::Fixed(value) => amount == value && percentage_bps == 0,
                },
                ExecutionError::InvalidPolicy,
            );
            env.storage().instance().set(&PolicyKey::Pay, &config);
            config.recipient
        };
        if amount < 0 || (amount == 0 && percentage_bps == 0) {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if percentage_bps > 10_000 {
            panic_with_error!(&env, Error::InvalidPercentage);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        if let Some(recipient) = recipient {
            env.storage().instance().set(&Key::Recipient, &recipient);
        }
        env.storage().instance().set(&Key::Amount, &amount);
        env.storage()
            .instance()
            .set(&Key::PercentageBps, &percentage_bps);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        execution_v1::require_legacy(&env);
        require_parent(&env, None);
        execute_payment(&env, &asset, amount);
    }

    pub fn cancel(env: Env) {
        execution_v1::require_legacy(&env);
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let client = token::Client::new(&env, &asset);
        let balance = client.balance(&env.current_contract_address());
        if balance > 0 {
            client.transfer(&env.current_contract_address(), &admin, &balance);
        }
        #[allow(deprecated)]
        env.events().publish((symbol_short!("cancel"),), balance);
    }

    pub fn balance(env: Env) -> i128 {
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).balance(&env.current_contract_address())
    }

    pub fn configured_amount(env: Env) -> i128 {
        env.storage().instance().get(&Key::Amount).unwrap()
    }

    pub fn percentage_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0)
    }

    pub fn recipient(env: Env) -> Address {
        env.storage().instance().get(&Key::Recipient).unwrap()
    }

    pub fn set_next_steps(env: Env, next_steps: Vec<WorkflowTarget>) {
        execution_v1::require_legacy(&env);
        Self::require_admin(&env);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
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
        execution_v1::require_legacy(&env);
        require_parent(&env, Some(&_from));
        execute_payment(&env, &asset, amount);
    }

    pub fn execute_step_v1(env: Env, context: ExecutionContext, asset: Address, amount: i128) {
        let config = execution_v1::current_pay(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        execution_v1::require(&env, stored_asset == asset, ExecutionError::Unauthorized);
        execution_v1::check_node(&env, &context, &config.node_id, &parent, &asset, amount);
        let input = execution_v1::find_input(&env, &context, &config.node_id);
        let recipient = match config.recipient_mode {
            FieldMode::Constant | FieldMode::Mutable => {
                execution_v1::require(&env, input.is_none(), ExecutionError::InvalidInput);
                config.recipient.unwrap()
            }
            FieldMode::Execution => match input {
                Some(NodeInput::Pay(value)) => value.recipient,
                _ => execution_v1::fail(&env, ExecutionError::InvalidInput),
            },
        };
        execution_v1::require_wallet(&env, &recipient);
        let payment = match config.payout_rule {
            PayoutRule::Full => amount,
            PayoutRule::Fixed(value) => {
                execution_v1::require(&env, amount >= value, ExecutionError::InvalidAmount);
                value
            }
            PayoutRule::Percentage(bps) => payment_math::percentage_share(amount, bps)
                .unwrap_or_else(|| execution_v1::fail(&env, ExecutionError::ArithmeticOverflow)),
        };
        let remaining = amount
            .checked_sub(payment)
            .unwrap_or_else(|| execution_v1::fail(&env, ExecutionError::ArithmeticOverflow));
        let next: Vec<WorkflowTarget> = env.storage().instance().get(&Key::NextSteps).unwrap();
        if let Some(step) = next.first() {
            // A configured payout that exhausts this invocation cannot execute a downstream input.
            execution_v1::require(&env, remaining > 0, ExecutionError::InvalidAmount);
            execution_v1::require(
                &env,
                context.index + 1 < context.bindings.len(),
                ExecutionError::InvalidInput,
            );
            if payment > 0 {
                execution_v1::transfer_exact(
                    &env,
                    &asset,
                    &env.current_contract_address(),
                    &recipient,
                    payment,
                );
            }
            execution_v1::forward(&env, context, &step.address, remaining);
        } else {
            execution_v1::require(
                &env,
                context.index + 1 == context.bindings.len(),
                ExecutionError::InvalidInput,
            );
            if payment > 0 {
                execution_v1::transfer_exact(
                    &env,
                    &asset,
                    &env.current_contract_address(),
                    &recipient,
                    payment,
                );
            }
            // Only this invocation's unused budget returns to its payer; never sweep old holdings.
            if remaining > 0 {
                execution_v1::transfer_exact(
                    &env,
                    &asset,
                    &env.current_contract_address(),
                    &context.payer,
                    remaining,
                );
            }
        }
        bump_ttl(&env);
        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("pay"), recipient), (asset, payment));
    }
    pub fn capabilities(env: Env) -> Capabilities {
        execution_v1::capabilities(&env)
    }
    pub fn mutation_status(env: Env) -> MutationStatus {
        let config = execution_v1::current_pay(&env);
        let next: Vec<WorkflowTarget> = env.storage().instance().get(&Key::NextSteps).unwrap();
        let next_val: Val = next.into_val(&env);
        MutationStatus {
            node_id: config.node_id,
            admin: env.storage().instance().get(&Key::Admin).unwrap(),
            asset: env.storage().instance().get(&Key::Asset).unwrap(),
            parent: env.storage().instance().get(&Key::ParentNode).unwrap(),
            next_steps: Vec::<Target>::try_from_val(&env, &next_val).unwrap(),
            revision: execution_v1::revision(&env),
            obligations: 0, // Policy Pay never retains an accepted per-call budget.
        }
    }
    pub fn mutate_step_v1(env: Env, context: MutationContext) {
        let status = Self::mutation_status(env.clone());
        execution_v1::check_mutation_node(&env, &context, &status);
        if let Some(change) = execution_v1::find_mutation(&env, &context, &status.node_id) {
            status.admin.require_auth();
            let change = match change {
                NodeMutation::Pay(change) => change,
                _ => execution_v1::fail(&env, ExecutionError::InvalidInput),
            };
            let config =
                execution_v1::apply_pay_mutation(&env, execution_v1::current_pay(&env), &change);
            execution_v1::require(
                &env,
                status.next_steps.is_empty()
                    || config.payout_rule != PayoutRule::Percentage(10_000),
                ExecutionError::InvalidInput,
            );
            let (amount, bps) = match config.payout_rule {
                PayoutRule::Full => (0, 10_000),
                PayoutRule::Percentage(value) => (0, value),
                PayoutRule::Fixed(value) => (value, 0),
            };
            if let Some(recipient) = &config.recipient {
                env.storage().instance().set(&Key::Recipient, recipient);
            }
            env.storage().instance().set(&Key::Amount, &amount);
            env.storage().instance().set(&Key::PercentageBps, &bps);
            env.storage()
                .instance()
                .set(&PolicyKey::CurrentPay, &config);
            execution_v1::increment_revision(&env);
            #[allow(deprecated)]
            env.events().publish(
                (symbol_short!("config_v1"), status.node_id),
                Self::current_config(env.clone()),
            );
        }
        bump_ttl(&env);
        execution_v1::forward_mutation(&env, context, &status.next_steps);
    }
    pub fn config_revision(env: Env) -> u64 {
        execution_v1::revision(&env)
    }
    pub fn field_policy(env: Env) -> PayConfig {
        env.storage()
            .instance()
            .get(&PolicyKey::Pay)
            .unwrap_or_else(|| execution_v1::fail(&env, ExecutionError::Unsupported))
    }
    pub fn current_config(env: Env) -> PayState {
        let next: Vec<WorkflowTarget> = env.storage().instance().get(&Key::NextSteps).unwrap();
        let next_val: Val = next.into_val(&env);
        PayState {
            policy: execution_v1::current_pay(&env),
            revision: execution_v1::revision(&env),
            asset: env.storage().instance().get(&Key::Asset).unwrap(),
            parent: env.storage().instance().get(&Key::ParentNode).unwrap(),
            next_steps: Vec::<Target>::try_from_val(&env, &next_val).unwrap(),
            amount: env.storage().instance().get(&Key::Amount).unwrap(),
            percentage_bps: env.storage().instance().get(&Key::PercentageBps).unwrap(),
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

fn execute_payment(env: &Env, asset: &Address, amount: i128) {
    bump_ttl(env);

    let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
    if asset != &stored_asset {
        panic_with_error!(env, Error::Unauthorized);
    }
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }

    let percentage_bps: u32 = env
        .storage()
        .instance()
        .get(&Key::PercentageBps)
        .unwrap_or(0);
    let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
    let payment = if percentage_bps > 0 {
        payment_math::percentage_share(amount, percentage_bps)
            .unwrap_or_else(|| panic_with_error!(env, Error::ArithmeticOverflow))
    } else {
        let configured_amount: i128 = env.storage().instance().get(&Key::Amount).unwrap();
        if amount > configured_amount {
            configured_amount
        } else {
            amount
        }
    };

    token::Client::new(env, asset).transfer(&env.current_contract_address(), &recipient, &payment);

    forward_remaining(env, asset);

    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("pay"), recipient), (asset.clone(), payment));
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
    use paiflow_splitter::{Recipient as SplitterRecipient, Splitter, SplitterClient};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    #[test]
    fn pays_configured_amount_when_incoming_exceeds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
        assert_eq!(client.configured_amount(), 100);
    }

    #[test]
    fn pays_partial_when_incoming_less_than_configured() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &50);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &50);
        client.execute_step(&asset.address(), &50);

        assert_eq!(tok.balance(&recipient), 50);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn cancel_returns_balance_to_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&contract_id), 900);
        client.cancel();
        assert_eq!(tok.balance(&admin), 900);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn pays_percentage_of_incoming_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 500);
        assert_eq!(tok.balance(&contract_id), 500);
        assert_eq!(client.percentage_bps(), 5_000);
    }

    #[test]
    fn pays_full_amount_via_10000_bps() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                10_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 1_000);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn percentage_zero_falls_back_to_fixed_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }

    #[test]
    fn receive_and_forward_pays_configured_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &parent,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }

    #[test]
    fn receive_and_forward_pays_percentage() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &parent,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 500);
        assert_eq!(tok.balance(&contract_id), 500);
        assert_eq!(client.percentage_bps(), 5_000);
    }

    #[test]
    fn receive_and_forward_forwards_to_next_steps() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

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
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                next_steps,
                parent.clone(),
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &parent,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&next), 900);
    }

    #[test]
    fn fixed_payer_forwards_leftover_to_payer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let payer1_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient1.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let payer1_client = PayerClient::new(&env, &payer1_id);

        let payer2_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient2.clone(),
                50_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                payer1_id.clone(),
            ),
        );
        let payer2_client = PayerClient::new(&env, &payer2_id);

        payer1_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: payer2_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&predecessor, &payer1_id, &1_000);
        payer1_client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient1), 100);
        assert_eq!(tok.balance(&recipient2), 50);
        assert_eq!(tok.balance(&payer1_id), 0);
        assert_eq!(tok.balance(&payer2_id), 850);
        assert_eq!(payer1_client.configured_amount(), 100);
        assert_eq!(payer2_client.configured_amount(), 50);
    }

    #[test]
    fn fixed_payer_forwards_leftover_to_splitter() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let payer_recipient = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        sac.mint(&predecessor, &10_000_000);

        let parent = Address::generate(&env);

        let payer_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                payer_recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let payer_client = PayerClient::new(&env, &payer_id);

        let splitter_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                vec![
                    &env,
                    SplitterRecipient {
                        address: a.clone(),
                        bps: 0,
                        amount: 3_000_000,
                    },
                    SplitterRecipient {
                        address: b.clone(),
                        bps: 0,
                        amount: 2_000_000,
                    },
                ],
                0_i128,
                payer_id.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let splitter_client = SplitterClient::new(&env, &splitter_id);

        payer_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: splitter_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&predecessor, &payer_id, &10_000_000);
        payer_client.execute_step(&asset.address(), &10_000_000);

        assert_eq!(tok.balance(&payer_recipient), 100);
        assert_eq!(tok.balance(&a), 3_000_000);
        assert_eq!(tok.balance(&b), 2_000_000);
        assert_eq!(tok.balance(&payer_id), 0);
        assert_eq!(tok.balance(&splitter_id), 4_999_900);
        assert_eq!(splitter_client.accumulated_balance(), 4_999_900);
    }

    #[test]
    fn percentage_payer_forwards_leftover_to_payer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let payer1_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient1.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
            ),
        );
        let payer1_client = PayerClient::new(&env, &payer1_id);

        let payer2_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient2.clone(),
                50_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                payer1_id.clone(),
            ),
        );
        let payer2_client = PayerClient::new(&env, &payer2_id);

        payer1_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: payer2_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&predecessor, &payer1_id, &1_000);
        payer1_client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient1), 500);
        assert_eq!(tok.balance(&recipient2), 50);
        assert_eq!(tok.balance(&payer1_id), 0);
        assert_eq!(tok.balance(&payer2_id), 450);
        assert_eq!(payer1_client.percentage_bps(), 5_000);
        assert_eq!(payer2_client.configured_amount(), 50);
    }
}

#[cfg(test)]
#[path = "arithmetic-tests.rs"]
mod arithmetic_tests;
