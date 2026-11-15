//! Versioned conditional execution ABI. No v2 mutation entry point is provided.
#![allow(dead_code)]
use crate::execution_v1::{self, NodeInput, PayConfig, StoredSplitConfig};
use soroban_sdk::{contracttype, Address, BytesN, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ComparisonV2 {
    AmountGt,
    AmountLt,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StoredModeV2 {
    Constant,
    Mutable,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BranchV2 {
    True,
    False,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiveStateV2 {
    pub min_amount: i128,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConditionStateV2 {
    pub comparison: ComparisonV2,
    pub threshold: i128,
    pub threshold_mode: StoredModeV2,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReturnStateV2 {
    pub recipient: Address,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NodeConfigurationV2 {
    Receive(ReceiveStateV2),
    Pay(PayConfig),
    Split(StoredSplitConfig),
    Condition(ConditionStateV2),
    ReturnToOwner(ReturnStateV2),
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NodeStateV2 {
    pub version: u32,
    pub node_id: String,
    pub contract_address: Address,
    pub revision: u64,
    pub admin: Address,
    pub asset: Address,
    pub parent: Option<Address>,
    pub next_steps: Vec<Address>,
    pub configuration: NodeConfigurationV2,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitialArtifactV2 {
    pub wasm_hash: BytesN<32>,
    pub state: NodeStateV2,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GraphManifestV2 {
    pub version: u32,
    pub root: Address,
    pub admin: Address,
    pub asset: Address,
    pub nodes: Vec<InitialArtifactV2>,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NodeInitV2 {
    pub version: u32,
    pub node_id: String,
    pub manifest: GraphManifestV2,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GraphBindingV2 {
    pub node_id: String,
    pub contract_address: Address,
    pub expected_revision: u64,
    pub wasm_hash: BytesN<32>,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RouteV2 {
    pub selected_branch: BranchV2,
    pub amount_at_condition: i128,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionContextV2 {
    pub payer: Address,
    pub root: Address,
    pub asset: Address,
    pub funded_amount: i128,
    pub nonce: BytesN<32>,
    pub expires_at_ledger: u32,
    pub bindings: Vec<GraphBindingV2>,
    pub inputs: Vec<NodeInput>,
    pub route: RouteV2,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MutationStatusV2 {
    pub state: NodeStateV2,
    pub obligations: i128,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilitiesV2 {
    pub policy_version: u32,
    pub execution_abi: u32,
    pub mutation_abi: u32,
    pub conditional: bool,
    pub execution: bool,
    pub mutation: bool,
    pub immutable_policies: bool,
    pub revision_binding: bool,
}
#[contracttype]
#[derive(Clone)]
pub struct RouteEventV2 {
    pub root: Address,
    pub payer: Address,
    pub nonce: BytesN<32>,
    pub amount_at_condition: i128,
    pub selected_branch: BranchV2,
    pub condition_revision: u64,
    pub bindings: Vec<GraphBindingV2>,
}
#[contracttype]
#[derive(Clone)]
pub enum V2Key {
    Manifest,
    Initial,
    Current,
    Obligations,
    Nonce(Address, BytesN<32>),
}

use crate::execution_v1::{Allocation, AllocationMode, ExecutionError, FieldMode, PayoutRule};
use execution_v1::{fail, require};
use soroban_sdk::{symbol_short, vec, IntoVal, Map, Symbol, TryFromVal, Val};

/// Never speculatively decode a struct of another generation: SDK map unpacking
/// can raise a host error on a different field count before TryFromVal returns.
pub fn tagged_init(env: &Env, raw: &Val) -> Option<NodeInitV2> {
    let Ok(map) = Map::<Symbol, Val>::try_from_val(env, raw) else {
        return None;
    };
    let version_key = Symbol::new(env, "version");
    let manifest_key = Symbol::new(env, "manifest");
    let node_key = Symbol::new(env, "node_id");
    let version = map.get(version_key.clone());
    let declared = map.contains_key(manifest_key.clone())
        || version.is_some_and(|v| u32::try_from_val(env, &v).ok() != Some(1));
    if !declared {
        return None;
    }
    require(
        env,
        map.len() == 3
            && map.contains_key(version_key)
            && map.contains_key(manifest_key)
            && map.contains_key(node_key),
        ExecutionError::InvalidPolicy,
    );
    let init = NodeInitV2::try_from_val(env, raw)
        .unwrap_or_else(|_| fail(env, ExecutionError::InvalidPolicy));
    require(env, init.version == 2, ExecutionError::InvalidPolicy);
    Some(init)
}
pub fn has_v2(env: &Env) -> bool {
    env.storage().instance().has(&V2Key::Manifest)
}
pub fn require_not_v2(env: &Env) {
    require(env, !has_v2(env), ExecutionError::Unsupported);
}
pub fn manifest(env: &Env) -> GraphManifestV2 {
    env.storage()
        .instance()
        .get(&V2Key::Manifest)
        .unwrap_or_else(|| fail(env, ExecutionError::Unsupported))
}
pub fn initial(env: &Env) -> NodeStateV2 {
    env.storage()
        .instance()
        .get(&V2Key::Initial)
        .unwrap_or_else(|| fail(env, ExecutionError::Unsupported))
}
pub fn current(env: &Env) -> NodeStateV2 {
    env.storage()
        .instance()
        .get(&V2Key::Current)
        .unwrap_or_else(|| fail(env, ExecutionError::Unsupported))
}
pub fn status(env: &Env) -> MutationStatusV2 {
    MutationStatusV2 {
        state: current(env),
        obligations: env
            .storage()
            .instance()
            .get(&V2Key::Obligations)
            .unwrap_or(0),
    }
}
pub fn capabilities(env: &Env) -> CapabilitiesV2 {
    require(env, has_v2(env), ExecutionError::Unsupported);
    CapabilitiesV2 {
        policy_version: 2,
        execution_abi: 2,
        mutation_abi: 0,
        conditional: true,
        execution: true,
        mutation: false,
        immutable_policies: true,
        revision_binding: true,
    }
}
pub fn index(env: &Env, manifest: &GraphManifestV2, address: &Address) -> u32 {
    manifest
        .nodes
        .iter()
        .position(|entry| entry.state.contract_address == *address)
        .map(|i| i as u32)
        .unwrap_or_else(|| fail(env, ExecutionError::InvalidPolicy))
}
pub fn condition_index(manifest: &GraphManifestV2) -> u32 {
    manifest.nodes.len() - 3
}
pub fn selected_index(manifest: &GraphManifestV2, branch: &BranchV2) -> u32 {
    condition_index(manifest) + if *branch == BranchV2::True { 1 } else { 2 }
}
pub fn validate_manifest(env: &Env, manifest: &GraphManifestV2) {
    require(
        env,
        manifest.version == 2 && manifest.nodes.len() >= 4 && manifest.nodes.len() <= 40,
        ExecutionError::InvalidPolicy,
    );
    execution_v1::require_wallet(env, &manifest.admin);
    execution_v1::require_contract(env, &manifest.asset);
    let ci = condition_index(manifest);
    require(
        env,
        manifest.nodes.first().unwrap().state.contract_address == manifest.root,
        ExecutionError::InvalidPolicy,
    );
    for (position, entry) in manifest.nodes.iter().enumerate() {
        let i = position as u32;
        let state = &entry.state;
        execution_v1::require_contract(env, &state.contract_address);
        require(
            env,
            state.version == 2
                && state.revision == 0
                && execution_v1::id_valid(&state.node_id)
                && state.admin == manifest.admin
                && state.asset == manifest.asset,
            ExecutionError::InvalidPolicy,
        );
        for previous in manifest.nodes.iter().take(position) {
            require(
                env,
                previous.state.node_id != state.node_id
                    && previous.state.contract_address != state.contract_address,
                ExecutionError::InvalidPolicy,
            );
        }
        let parent = if i == 0 {
            None
        } else {
            Some(
                manifest
                    .nodes
                    .get(if i > ci { ci } else { i - 1 })
                    .unwrap()
                    .state
                    .contract_address,
            )
        };
        let successors = if i < ci {
            vec![
                env,
                manifest.nodes.get(i + 1).unwrap().state.contract_address,
            ]
        } else if i == ci {
            vec![
                env,
                manifest.nodes.get(ci + 1).unwrap().state.contract_address,
                manifest.nodes.get(ci + 2).unwrap().state.contract_address,
            ]
        } else {
            Vec::new(env)
        };
        require(
            env,
            state.parent == parent && state.next_steps == successors,
            ExecutionError::InvalidPolicy,
        );
        match &state.configuration {
            NodeConfigurationV2::Receive(value) => require(
                env,
                i == 0 && value.min_amount >= 0,
                ExecutionError::InvalidPolicy,
            ),
            NodeConfigurationV2::Condition(value) => require(
                env,
                i == ci && value.threshold >= 0,
                ExecutionError::InvalidPolicy,
            ),
            NodeConfigurationV2::Pay(value) => {
                require(
                    env,
                    i > 0 && i != ci && value.node_id == state.node_id,
                    ExecutionError::InvalidPolicy,
                );
                execution_v1::validate_pay(env, value);
                if i < ci {
                    require(
                        env,
                        value.payout_rule != PayoutRule::Full
                            && value.payout_rule != PayoutRule::Percentage(10_000),
                        ExecutionError::InvalidPolicy,
                    );
                }
            }
            NodeConfigurationV2::Split(value) => {
                require(
                    env,
                    i > ci && value.policy.node_id == state.node_id,
                    ExecutionError::InvalidPolicy,
                );
                execution_v1::validate_stored_split(env, &value.policy, &value.additional);
                if value.policy.allocation_mode == AllocationMode::Percentage {
                    // Every configured execution allocation must eventually supply
                    // at least one bps. Optional appended execution rows may be [].
                    let mut minimum_bps = 0u32;
                    for row in value.policy.rows.iter() {
                        let minimum = match row.allocation {
                            execution_v1::MaybeAllocation::Present(Allocation::Percentage(bps)) => {
                                bps
                            }
                            execution_v1::MaybeAllocation::Missing
                                if row.allocation_mode == FieldMode::Execution =>
                            {
                                1
                            }
                            _ => fail(env, ExecutionError::InvalidPolicy),
                        };
                        minimum_bps = minimum_bps
                            .checked_add(minimum)
                            .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
                    }
                    for row in value.additional.iter() {
                        let Allocation::Percentage(bps) = row.allocation else {
                            fail(env, ExecutionError::InvalidPolicy)
                        };
                        minimum_bps = minimum_bps
                            .checked_add(bps)
                            .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
                    }
                    require(env, minimum_bps <= 10_000, ExecutionError::InvalidPolicy);
                }
            }
            NodeConfigurationV2::ReturnToOwner(value) => require(
                env,
                i > ci && value.recipient == manifest.admin,
                ExecutionError::InvalidPolicy,
            ),
        }
        require(
            env,
            (i == 0 && matches!(state.configuration, NodeConfigurationV2::Receive(_)))
                || (i > 0 && i < ci && matches!(state.configuration, NodeConfigurationV2::Pay(_)))
                || (i == ci && matches!(state.configuration, NodeConfigurationV2::Condition(_)))
                || (i > ci
                    && matches!(
                        state.configuration,
                        NodeConfigurationV2::Pay(_)
                            | NodeConfigurationV2::Split(_)
                            | NodeConfigurationV2::ReturnToOwner(_)
                    )),
            ExecutionError::InvalidPolicy,
        );
    }
}
/// Constructor-only installation; callers check their redundant wire slots before this write.
pub fn install(
    env: &Env,
    init: &NodeInitV2,
    admin: &Address,
    asset: &Address,
    family: u32,
) -> NodeStateV2 {
    require(
        env,
        !has_v2(env) && init.version == 2,
        ExecutionError::InvalidPolicy,
    );
    validate_manifest(env, &init.manifest);
    let state = init
        .manifest
        .nodes
        .get(index(env, &init.manifest, &env.current_contract_address()))
        .unwrap()
        .state;
    require(
        env,
        state.node_id == init.node_id
            && state.admin == *admin
            && state.asset == *asset
            && match &state.configuration {
                NodeConfigurationV2::Receive(_) => family == 0,
                NodeConfigurationV2::Pay(_) | NodeConfigurationV2::ReturnToOwner(_) => family == 1,
                NodeConfigurationV2::Split(_) => family == 2,
                NodeConfigurationV2::Condition(_) => family == 3,
            },
        ExecutionError::InvalidPolicy,
    );
    env.storage()
        .instance()
        .set(&V2Key::Manifest, &init.manifest);
    env.storage().instance().set(&V2Key::Initial, &state);
    env.storage().instance().set(&V2Key::Current, &state);
    env.storage().instance().set(&V2Key::Obligations, &0i128);
    state
}
pub fn amount_and_bps(env: &Env, state: &NodeStateV2) -> (i128, u32) {
    match &state.configuration {
        NodeConfigurationV2::ReturnToOwner(_) => (0, 10_000),
        NodeConfigurationV2::Pay(value) => match value.payout_rule {
            PayoutRule::Full => (0, 10_000),
            PayoutRule::Fixed(v) => (v, 0),
            PayoutRule::Percentage(v) => (0, v),
        },
        _ => fail(env, ExecutionError::InvalidPolicy),
    }
}
fn share(env: &Env, amount: i128, bps: u32) -> i128 {
    require(
        env,
        amount >= 0 && bps <= 10_000,
        ExecutionError::InvalidAmount,
    );
    (amount / 10_000)
        .checked_mul(i128::from(bps))
        .and_then(|whole| {
            (amount % 10_000)
                .checked_mul(i128::from(bps))
                .and_then(|v| whole.checked_add(v / 10_000))
        })
        .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow))
}
fn payout(env: &Env, config: &PayConfig, amount: i128) -> i128 {
    match config.payout_rule {
        PayoutRule::Full => amount,
        PayoutRule::Fixed(value) => {
            require(env, amount >= value, ExecutionError::InvalidAmount);
            value
        }
        PayoutRule::Percentage(bps) => share(env, amount, bps),
    }
}
fn needs_input(state: &NodeStateV2) -> bool {
    match &state.configuration {
        NodeConfigurationV2::Pay(v) => v.recipient_mode == FieldMode::Execution,
        NodeConfigurationV2::Split(v) => {
            v.policy.additional_mode == FieldMode::Execution
                || v.policy.rows.iter().any(|r| {
                    r.recipient_mode == FieldMode::Execution
                        || r.allocation_mode == FieldMode::Execution
                })
        }
        _ => false,
    }
}
fn find_input(env: &Env, context: &ExecutionContextV2, state: &NodeStateV2) -> Option<NodeInput> {
    let mut matching = context
        .inputs
        .iter()
        .filter(|input| execution_v1::input_id(input) == state.node_id);
    let value = matching.next();
    require(
        env,
        matching.next().is_none() && value.is_some() == needs_input(state),
        ExecutionError::InvalidInput,
    );
    value
}
fn validate_input(env: &Env, context: &ExecutionContextV2, state: &NodeStateV2, amount: i128) {
    let input = find_input(env, context, state);
    match &state.configuration {
        NodeConfigurationV2::Pay(config) => {
            let recipient = match input {
                Some(NodeInput::Pay(value)) => value.recipient,
                None => config
                    .recipient
                    .clone()
                    .unwrap_or_else(|| fail(env, ExecutionError::InvalidInput)),
                _ => fail(env, ExecutionError::InvalidInput),
            };
            execution_v1::require_wallet(env, &recipient);
            payout(env, config, amount);
        }
        NodeConfigurationV2::Split(config) => {
            if let Some(NodeInput::Split(value)) = &input {
                let mut expected = Vec::new(env);
                for row in config.policy.rows.iter() {
                    if row.recipient_mode == FieldMode::Execution
                        || row.allocation_mode == FieldMode::Execution
                    {
                        expected.push_back(row.row_id);
                    }
                }
                require(
                    env,
                    value.rows.len() == expected.len()
                        && value
                            .rows
                            .iter()
                            .zip(expected.iter())
                            .all(|(row, id)| row.row_id == id),
                    ExecutionError::InvalidInput,
                );
            }
            execution_v1::merged_split_with_stored(
                env,
                &config.policy,
                input,
                amount,
                &config.additional,
            );
        }
        _ => require(env, input.is_none(), ExecutionError::InvalidInput),
    }
}
fn require_state(env: &Env, original: &NodeStateV2, state: &NodeStateV2) {
    // #1224 extends this comparison with declared mutable-field merge enforcement.
    // No v2 mutation method exists in the execution-only generation.
    let mut normalized = state.clone();
    normalized.revision = 0;
    require(env, normalized == *original, ExecutionError::InvalidPolicy);
}
fn validate_field_set(env: &Env, state: &NodeStateV2, input: &NodeInput) {
    match (&state.configuration, input) {
        (NodeConfigurationV2::Pay(config), NodeInput::Pay(value)) => {
            require(
                env,
                config.recipient_mode == FieldMode::Execution && value.node_id == state.node_id,
                ExecutionError::InvalidInput,
            );
            execution_v1::require_wallet(env, &value.recipient);
        }
        (NodeConfigurationV2::Split(stored), NodeInput::Split(value)) => {
            let config = &stored.policy;
            let mut expected = Vec::new(env);
            for row in config.rows.iter() {
                if row.recipient_mode == FieldMode::Execution
                    || row.allocation_mode == FieldMode::Execution
                {
                    expected.push_back(row);
                }
            }
            require(
                env,
                value.node_id == state.node_id
                    && value.rows.len() == expected.len()
                    && value.additional.is_some()
                        == (config.additional_mode == FieldMode::Execution),
                ExecutionError::InvalidInput,
            );
            for (declared, row) in expected.iter().zip(value.rows.iter()) {
                require(
                    env,
                    row.row_id == declared.row_id
                        && row.recipient.is_some()
                            == (declared.recipient_mode == FieldMode::Execution)
                        && row.allocation.is_some()
                            == (declared.allocation_mode == FieldMode::Execution),
                    ExecutionError::InvalidInput,
                );
                if let Some(recipient) = row.recipient {
                    execution_v1::require_wallet(env, &recipient);
                }
                if let Some(allocation) = row.allocation.to_option() {
                    execution_v1::validate_allocation(env, &allocation, &config.allocation_mode);
                }
            }
            if let Some(additional) = &value.additional {
                require(
                    env,
                    config.rows.len() + additional.len() <= 20,
                    ExecutionError::InvalidInput,
                );
                for (i, row) in additional.iter().enumerate() {
                    require(
                        env,
                        execution_v1::id_valid(&row.row_id)
                            && config
                                .rows
                                .iter()
                                .all(|configured| configured.row_id != row.row_id)
                            && additional.iter().take(i).all(|previous| {
                                previous.row_id != row.row_id && previous.recipient != row.recipient
                            }),
                        ExecutionError::InvalidInput,
                    );
                    execution_v1::require_wallet(env, &row.recipient);
                    execution_v1::validate_allocation(
                        env,
                        &row.allocation,
                        &config.allocation_mode,
                    );
                }
            }
        }
        _ => fail(env, ExecutionError::InvalidInput),
    }
}
fn validate_input_roster(env: &Env, manifest: &GraphManifestV2, context: &ExecutionContextV2) {
    let ci = condition_index(manifest);
    let selected = selected_index(manifest, &context.route.selected_branch);
    let mut position = 0;
    for (i, entry) in manifest.nodes.iter().enumerate() {
        let state = &entry.state;
        if (i > 0 && i < ci as usize || i == selected as usize) && needs_input(state) {
            let input = context
                .inputs
                .get(position)
                .unwrap_or_else(|| fail(env, ExecutionError::InvalidInput));
            validate_field_set(env, state, &input);
            position += 1;
        }
    }
    require(
        env,
        position == context.inputs.len(),
        ExecutionError::InvalidInput,
    );
}
fn validate_bindings(env: &Env, manifest: &GraphManifestV2, context: &ExecutionContextV2) {
    validate_input_roster(env, manifest, context);
    let now = env.ledger().sequence();
    require(
        env,
        context.expires_at_ledger > now && context.expires_at_ledger - now <= 720,
        ExecutionError::Expired,
    );
    execution_v1::require_wallet(env, &context.payer);
    require(
        env,
        context.root == manifest.root
            && context.asset == manifest.asset
            && context.funded_amount > 0
            && context.bindings.len() == manifest.nodes.len()
            && context.inputs.len() <= 40,
        ExecutionError::InvalidInput,
    );
    for (entry, binding) in manifest.nodes.iter().zip(context.bindings.iter()) {
        require(
            env,
            entry.state.node_id == binding.node_id
                && entry.state.contract_address == binding.contract_address
                && entry.wasm_hash == binding.wasm_hash,
            ExecutionError::InvalidInput,
        );
    }
}
fn states_and_route(
    env: &Env,
    manifest: &GraphManifestV2,
    context: &ExecutionContextV2,
) -> Vec<NodeStateV2> {
    validate_bindings(env, manifest, context);
    let mut states = Vec::new(env);
    for (entry, binding) in manifest.nodes.iter().zip(context.bindings.iter()) {
        let address = &entry.state.contract_address;
        let state = if *address == env.current_contract_address() {
            current(env)
        } else {
            let declared: GraphManifestV2 = env.invoke_contract(
                address,
                &Symbol::new(env, "graph_manifest_v2"),
                Vec::new(env),
            );
            require(env, declared == *manifest, ExecutionError::InvalidPolicy);
            let observed: CapabilitiesV2 =
                env.invoke_contract(address, &Symbol::new(env, "capabilities_v2"), Vec::new(env));
            require(
                env,
                observed == capabilities(env),
                ExecutionError::Unsupported,
            );
            env.invoke_contract(
                address,
                &Symbol::new(env, "current_config_v2"),
                Vec::new(env),
            )
        };
        require_state(env, &entry.state, &state);
        require(
            env,
            state.revision == binding.expected_revision,
            ExecutionError::StaleRevision,
        );
        states.push_back(state);
    }
    let ci = condition_index(manifest);
    let mut amount = context.funded_amount;
    let minimum = match &states.first().unwrap().configuration {
        NodeConfigurationV2::Receive(v) => v.min_amount,
        _ => fail(env, ExecutionError::InvalidPolicy),
    };
    require(env, amount >= minimum, ExecutionError::InvalidAmount);
    for state in states.iter().take(ci as usize).skip(1) {
        validate_input(env, context, &state, amount);
        if let NodeConfigurationV2::Pay(config) = &state.configuration {
            amount = amount
                .checked_sub(payout(env, config, amount))
                .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
        }
        require(env, amount > 0, ExecutionError::InvalidAmount);
    }
    let condition = match states.get(ci).unwrap().configuration {
        NodeConfigurationV2::Condition(value) => value,
        _ => fail(env, ExecutionError::InvalidPolicy),
    };
    let selected = match condition.comparison {
        ComparisonV2::AmountGt => amount > condition.threshold,
        ComparisonV2::AmountLt => amount < condition.threshold,
    };
    require(
        env,
        context.route.amount_at_condition == amount
            && context.route.selected_branch
                == if selected {
                    BranchV2::True
                } else {
                    BranchV2::False
                },
        ExecutionError::InvalidInput,
    );
    let terminal = states
        .get(selected_index(manifest, &context.route.selected_branch))
        .unwrap();
    validate_input(env, context, &terminal, amount);
    let mut expected = Vec::new(env);
    for state in states.iter().take(ci as usize).skip(1) {
        if needs_input(&state) {
            expected.push_back(state.node_id);
        }
    }
    if needs_input(&terminal) {
        expected.push_back(terminal.node_id);
    }
    require(
        env,
        expected.len() == context.inputs.len()
            && expected
                .iter()
                .zip(context.inputs.iter())
                .all(|(id, input)| id == execution_v1::input_id(&input)),
        ExecutionError::InvalidInput,
    );
    states
}
fn forward(env: &Env, context: &ExecutionContextV2, target: &Address, amount: i128) {
    require(env, amount > 0, ExecutionError::InvalidAmount);
    execution_v1::transfer_exact(
        env,
        &context.asset,
        &env.current_contract_address(),
        target,
        amount,
    );
    env.invoke_contract::<()>(
        target,
        &Symbol::new(env, "execute_step_v2"),
        vec![env, context.into_val(env), amount.into_val(env)],
    );
}
pub fn execute_root(env: &Env, context: ExecutionContextV2) {
    let manifest = manifest(env);
    require(
        env,
        env.current_contract_address() == manifest.root,
        ExecutionError::Unauthorized,
    );
    states_and_route(env, &manifest, &context);
    context.payer.require_auth();
    let key = V2Key::Nonce(context.payer.clone(), context.nonce.clone());
    require(
        env,
        !env.storage().temporary().has(&key),
        ExecutionError::Replayed,
    );
    env.storage()
        .temporary()
        .set(&key, &context.expires_at_ledger);
    let remaining = context.expires_at_ledger - env.ledger().sequence();
    env.storage()
        .temporary()
        .extend_ttl(&key, remaining, remaining);
    execution_v1::transfer_exact(
        env,
        &context.asset,
        &context.payer,
        &manifest.root,
        context.funded_amount,
    );
    let next = current(env).next_steps.first().unwrap();
    forward(env, &context, &next, context.funded_amount);
    #[allow(deprecated)]
    env.events().publish(
        (symbol_short!("deposit"), context.payer),
        context.funded_amount,
    );
    bump_ttl(env);
}
pub fn execute_child(env: &Env, context: ExecutionContextV2, amount: i128) {
    let manifest = manifest(env);
    validate_bindings(env, &manifest, &context);
    let state = current(env);
    let own = index(env, &manifest, &env.current_contract_address());
    let ci = condition_index(&manifest);
    let selected = selected_index(&manifest, &context.route.selected_branch);
    if own > ci {
        require(
            env,
            amount == context.route.amount_at_condition,
            ExecutionError::InvalidAmount,
        );
    }
    require(
        env,
        own > 0 && (own <= ci || own == selected) && amount > 0 && amount <= context.funded_amount,
        ExecutionError::Unauthorized,
    );
    require_state(env, &manifest.nodes.get(own).unwrap().state, &state);
    require(
        env,
        context.bindings.get(own).unwrap().expected_revision == state.revision,
        ExecutionError::StaleRevision,
    );
    state.parent.clone().unwrap().require_auth();
    validate_input(env, &context, &state, amount);
    match &state.configuration {
        NodeConfigurationV2::Pay(config) => {
            let recipient = match find_input(env, &context, &state) {
                Some(NodeInput::Pay(v)) => v.recipient,
                None => config.recipient.clone().unwrap(),
                _ => fail(env, ExecutionError::InvalidInput),
            };
            let payment = payout(env, config, amount);
            let remaining = amount
                .checked_sub(payment)
                .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
            if payment > 0 {
                execution_v1::transfer_exact(
                    env,
                    &state.asset,
                    &state.contract_address,
                    &recipient,
                    payment,
                );
            }
            if let Some(next) = state.next_steps.first() {
                forward(env, &context, &next, remaining);
            } else if remaining > 0 {
                execution_v1::transfer_exact(
                    env,
                    &state.asset,
                    &state.contract_address,
                    &context.payer,
                    remaining,
                );
            }
            #[allow(deprecated)]
            env.events().publish(
                (symbol_short!("pay"), recipient),
                (state.asset.clone(), payment),
            );
        }
        NodeConfigurationV2::ReturnToOwner(value) => {
            execution_v1::transfer_exact(
                env,
                &state.asset,
                &state.contract_address,
                &value.recipient,
                amount,
            );
            #[allow(deprecated)]
            env.events().publish(
                (symbol_short!("pay"), value.recipient.clone()),
                (state.asset.clone(), amount),
            );
        }
        NodeConfigurationV2::Condition(value) => {
            let truth = match value.comparison {
                ComparisonV2::AmountGt => amount > value.threshold,
                ComparisonV2::AmountLt => amount < value.threshold,
            };
            require(
                env,
                amount == context.route.amount_at_condition
                    && context.route.selected_branch
                        == if truth {
                            BranchV2::True
                        } else {
                            BranchV2::False
                        },
                ExecutionError::InvalidInput,
            );
            let next = manifest.nodes.get(selected).unwrap().state.contract_address;
            forward(env, &context, &next, amount);
            #[allow(deprecated)]
            env.events().publish(
                (symbol_short!("route_v2"), state.node_id.clone()),
                RouteEventV2 {
                    root: context.root,
                    payer: context.payer,
                    nonce: context.nonce,
                    amount_at_condition: amount,
                    selected_branch: context.route.selected_branch,
                    condition_revision: state.revision,
                    bindings: context.bindings,
                },
            );
        }
        NodeConfigurationV2::Split(config) => execute_split(env, &state, config, &context, amount),
        NodeConfigurationV2::Receive(_) => fail(env, ExecutionError::Unauthorized),
    }
    bump_ttl(env);
}
#[contracttype]
#[derive(Clone)]
pub struct EventRecipientV2 {
    pub address: Address,
    pub bps: u32,
    pub amount: i128,
}
fn execute_split(
    env: &Env,
    state: &NodeStateV2,
    config: &StoredSplitConfig,
    context: &ExecutionContextV2,
    amount: i128,
) {
    let rows = execution_v1::merged_split_with_stored(
        env,
        &config.policy,
        find_input(env, context, state),
        amount,
        &config.additional,
    );
    let accumulated = config.policy.allocation_mode == AllocationMode::Fixed && !needs_input(state);
    let budget = if accumulated {
        let prior: i128 = env
            .storage()
            .instance()
            .get(&V2Key::Obligations)
            .unwrap_or(0);
        let total = prior
            .checked_add(amount)
            .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
        env.storage().instance().set(&V2Key::Obligations, &total);
        let fixed = rows.iter().fold(0i128, |sum, row| match row.allocation {
            Allocation::Fixed(v) => sum
                .checked_add(v)
                .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow)),
            _ => fail(env, ExecutionError::InvalidPolicy),
        });
        if total < fixed {
            #[allow(deprecated)]
            env.events().publish(
                (symbol_short!("shortfall"), state.asset.clone()),
                (
                    amount,
                    total,
                    fixed,
                    fixed
                        .checked_sub(total)
                        .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow)),
                ),
            );
            return;
        }
        env.storage().instance().set(
            &V2Key::Obligations,
            &total
                .checked_sub(fixed)
                .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow)),
        );
        fixed
    } else {
        amount
    };
    let mut paid = 0i128;
    for (i, row) in rows.iter().enumerate() {
        let payment = match row.allocation {
            Allocation::Fixed(v) => v,
            Allocation::Percentage(bps) => {
                if i + 1 == rows.len() as usize {
                    budget
                        .checked_sub(paid)
                        .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow))
                } else {
                    share(env, budget, bps)
                }
            }
        };
        if payment > 0 {
            execution_v1::transfer_exact(
                env,
                &state.asset,
                &state.contract_address,
                &row.recipient,
                payment,
            );
        }
        paid = paid
            .checked_add(payment)
            .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
    }
    require(env, paid == budget, ExecutionError::InvalidAmount);
    let mut recipients = Vec::new(env);
    for row in rows.iter() {
        let (bps, amount) = match row.allocation {
            Allocation::Percentage(v) => (v, 0),
            Allocation::Fixed(v) => (0, v),
        };
        recipients.push_back(EventRecipientV2 {
            address: row.recipient,
            bps,
            amount,
        });
    }
    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("payout"), context.payer.clone()), recipients);
}
fn bump_ttl(env: &Env) {
    env.storage().instance().extend_ttl(50_000, 500_000);
}
