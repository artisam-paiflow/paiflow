#![no_std]
// The explicit execute_v2 ABI has eight wire arguments, including the bound route.
#![allow(clippy::too_many_arguments)]
#[path = "../../../conditional-v2.rs"]
pub mod conditional_v2;
#[path = "../../../execution-v1.rs"]
pub mod execution_v1;
use execution_v1::{
    Binding, Capabilities, ExecutionContext, ExecutionError, MutationContext, NodeInput,
    NodeMutation, PolicyKey, RootConfig, RootState,
};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, BytesN, Env, IntoVal, String, TryFromVal, Val, Vec,
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
    NextSteps,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    InvalidAmount = 2,
}

const VERSION: u32 = 1;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct DepositTrigger;

#[contractimpl]
impl DepositTrigger {
    pub fn __constructor(env: Env, admin: Address, asset: Address, next_steps: Val) {
        if env.storage().instance().has(&Key::Admin) || conditional_v2::has_v2(&env) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if let Some(init) = conditional_v2::tagged_init(&env, &next_steps) {
            conditional_v2::install(&env, &init, &admin, &asset, 0);
            return;
        }

        let next_steps = if let Ok(legacy) = Vec::<WorkflowTarget>::try_from_val(&env, &next_steps)
        {
            legacy
        } else {
            let config = RootConfig::try_from_val(&env, &next_steps)
                .unwrap_or_else(|_| execution_v1::fail(&env, ExecutionError::InvalidPolicy));
            execution_v1::require_contract(&env, &asset);
            execution_v1::require(
                &env,
                config.version == 1
                    && execution_v1::id_valid(&config.node_id)
                    && config.next_steps.len() == 1
                    && config.min_amount >= 0,
                ExecutionError::InvalidPolicy,
            );
            execution_v1::require_contract(&env, &config.next_steps.first().unwrap().address);
            execution_v1::require(
                &env,
                config.next_steps.first().unwrap().data.is_empty(),
                ExecutionError::InvalidPolicy,
            );
            let steps_val: Val = config.next_steps.into_val(&env);
            let result = Vec::<WorkflowTarget>::try_from_val(&env, &steps_val).unwrap();
            env.storage().instance().set(&PolicyKey::Root, &config);
            result
        };
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn deposit(env: Env, from: Address, amount: i128) {
        conditional_v2::require_not_v2(&env);
        execution_v1::require_legacy(&env);
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        bump_ttl(&env);

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        token::Client::new(&env, &asset).transfer(&from, env.current_contract_address(), &amount);

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("deposit"), from), amount);

        for step in next_steps.iter() {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &step.address,
                &amount,
            );
            invoke_execute_step(&env, &step.address, &asset, &amount);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn execute_v1(
        env: Env,
        payer: Address,
        asset: Address,
        amount: i128,
        nonce: BytesN<32>,
        expires_at_ledger: u32,
        bindings: Vec<Binding>,
        inputs: Vec<NodeInput>,
    ) {
        conditional_v2::require_not_v2(&env);
        let config: RootConfig = env
            .storage()
            .instance()
            .get(&PolicyKey::Root)
            .unwrap_or_else(|| execution_v1::fail(&env, ExecutionError::Unsupported));
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        execution_v1::require(&env, asset == stored_asset, ExecutionError::Unauthorized);
        execution_v1::require(
            &env,
            amount >= config.min_amount,
            ExecutionError::InvalidAmount,
        );
        let context = ExecutionContext {
            payer: payer.clone(),
            root: env.current_contract_address(),
            asset: asset.clone(),
            funded_amount: amount,
            nonce: nonce.clone(),
            expires_at_ledger,
            bindings,
            inputs,
            index: 0,
        };
        execution_v1::validate_context(&env, &context);
        execution_v1::require(
            &env,
            context.bindings.first().unwrap().node_id == config.node_id,
            ExecutionError::InvalidInput,
        );
        // Validate every reviewed revision before pulling the payer's funds.
        for binding in context.bindings.iter() {
            let revision = if binding.contract_address == env.current_contract_address() {
                0
            } else {
                env.invoke_contract::<u64>(
                    &binding.contract_address,
                    &soroban_sdk::Symbol::new(&env, "config_revision"),
                    Vec::new(&env),
                )
            };
            execution_v1::require(
                &env,
                binding.expected_revision == revision,
                ExecutionError::StaleRevision,
            );
        }
        payer.require_auth();
        let key = PolicyKey::Nonce(payer.clone(), nonce);
        execution_v1::require(
            &env,
            !env.storage().temporary().has(&key),
            ExecutionError::Replayed,
        );
        env.storage().temporary().set(&key, &expires_at_ledger);
        let remaining = expires_at_ledger - env.ledger().sequence();
        env.storage()
            .temporary()
            .extend_ttl(&key, remaining, remaining);
        bump_ttl(&env);
        execution_v1::transfer_exact(
            &env,
            &asset,
            &payer,
            &env.current_contract_address(),
            amount,
        );
        execution_v1::forward(
            &env,
            context,
            &config.next_steps.first().unwrap().address,
            amount,
        );
        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("deposit"), payer), amount);
    }

    pub fn capabilities(env: Env) -> Capabilities {
        conditional_v2::require_not_v2(&env);
        execution_v1::capabilities(&env)
    }
    /// One atomic admin-authorized update of the complete conserved path.
    /// Every accepted obligation is checked before any stored term is changed.
    pub fn mutate_v1(env: Env, bindings: Vec<Binding>, changes: Vec<NodeMutation>) {
        conditional_v2::require_not_v2(&env);
        let config = Self::field_policy(env.clone());
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        let context = MutationContext {
            root: env.current_contract_address(),
            admin,
            asset: env.storage().instance().get(&Key::Asset).unwrap(),
            bindings,
            changes,
            index: 0,
        };
        execution_v1::preflight_mutation(
            &env,
            &context,
            &config.node_id,
            &config.next_steps.first().unwrap().address,
        );
        execution_v1::forward_mutation(&env, context, &config.next_steps);
        bump_ttl(&env);
    }
    pub fn config_revision(env: Env) -> u64 {
        conditional_v2::require_not_v2(&env);
        execution_v1::revision(&env)
    }
    pub fn field_policy(env: Env) -> RootConfig {
        conditional_v2::require_not_v2(&env);
        env.storage()
            .instance()
            .get(&PolicyKey::Root)
            .unwrap_or_else(|| execution_v1::fail(&env, ExecutionError::Unsupported))
    }
    pub fn current_config(env: Env) -> RootState {
        conditional_v2::require_not_v2(&env);
        RootState {
            policy: Self::field_policy(env.clone()),
            revision: execution_v1::revision(&env),
            asset: env.storage().instance().get(&Key::Asset).unwrap(),
        }
    }

    pub fn next_steps(env: Env) -> Vec<WorkflowTarget> {
        conditional_v2::require_not_v2(&env);
        env.storage().instance().get(&Key::NextSteps).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        conditional_v2::require_not_v2(&env);
        env.storage().instance().get(&Key::Asset).unwrap()
    }
    pub fn capabilities_v2(env: Env) -> conditional_v2::CapabilitiesV2 {
        conditional_v2::capabilities(&env)
    }
    pub fn graph_manifest_v2(env: Env) -> conditional_v2::GraphManifestV2 {
        conditional_v2::manifest(&env)
    }
    pub fn field_policy_v2(env: Env) -> conditional_v2::NodeStateV2 {
        conditional_v2::initial(&env)
    }
    pub fn initial_config_v2(env: Env) -> conditional_v2::NodeStateV2 {
        conditional_v2::initial(&env)
    }
    pub fn current_config_v2(env: Env) -> conditional_v2::NodeStateV2 {
        conditional_v2::current(&env)
    }
    pub fn config_revision_v2(env: Env) -> u64 {
        conditional_v2::current(&env).revision
    }
    pub fn mutation_status_v2(env: Env) -> conditional_v2::MutationStatusV2 {
        conditional_v2::status(&env)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn execute_v2(
        env: Env,
        payer: Address,
        asset: Address,
        amount: i128,
        nonce: BytesN<32>,
        expires_at_ledger: u32,
        bindings: Vec<conditional_v2::GraphBindingV2>,
        inputs: Vec<NodeInput>,
        route: conditional_v2::RouteV2,
    ) {
        conditional_v2::execute_root(
            &env,
            conditional_v2::ExecutionContextV2 {
                payer,
                root: env.current_contract_address(),
                asset,
                funded_amount: amount,
                nonce,
                expires_at_ledger,
                bindings,
                inputs,
                route,
            },
        );
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

    #[test]
    fn deposit_forwards_to_next() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let user = Address::generate(&env);
        sac.mint(&user, &1_000);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(DepositTrigger, (admin, asset.address(), next_steps));
        let client = DepositTriggerClient::new(&env, &contract_id);

        client.deposit(&user, &500);

        assert_eq!(tok.balance(&user), 500);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&next), 500);
    }
}
