//! Shared ABI and enforcement for the standard immediate-payment contracts.
//! Included in each contract so the same types are present in its WASM spec.
#![allow(dead_code)] // Each contract uses the subset appropriate to its role.
use soroban_sdk::{
    contracterror, contracttype, panic_with_error, token, vec, Address, BytesN, Env, IntoVal,
    String, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ExecutionError {
    InvalidPolicy = 101,
    InvalidInput = 102,
    InvalidAmount = 103,
    Unauthorized = 104,
    StaleRevision = 105,
    Unsupported = 106,
    Expired = 107,
    Replayed = 108,
    ArithmeticOverflow = 109,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FieldMode {
    Constant,
    Execution,
    Mutable,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AllocationMode {
    Percentage,
    Fixed,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Allocation {
    Percentage(u32),
    Fixed(i128),
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MaybeAllocation {
    Missing,
    Present(Allocation),
}
impl MaybeAllocation {
    pub fn is_some(&self) -> bool {
        matches!(self, Self::Present(_))
    }
    pub fn is_none(&self) -> bool {
        !self.is_some()
    }
    pub fn to_option(&self) -> Option<Allocation> {
        match self {
            Self::Missing => None,
            Self::Present(value) => Some(value.clone()),
        }
    }
    pub fn unwrap(self) -> Allocation {
        match self {
            Self::Present(value) => value,
            Self::Missing => panic!("validated allocation"),
        }
    }
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PayoutRule {
    Full,
    Fixed(i128),
    Percentage(u32),
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Target {
    pub address: Address,
    pub data: String,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RootConfig {
    pub version: u32,
    pub node_id: String,
    pub next_steps: Vec<Target>,
    pub min_amount: i128,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayConfig {
    pub version: u32,
    pub node_id: String,
    pub recipient_mode: FieldMode,
    pub payout_value_mode: FieldMode,
    pub recipient: Option<Address>,
    pub payout_rule: PayoutRule,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfiguredRow {
    pub row_id: String,
    pub recipient_mode: FieldMode,
    pub allocation_mode: FieldMode,
    pub recipient: Option<Address>,
    pub allocation: MaybeAllocation,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SplitConfig {
    pub version: u32,
    pub node_id: String,
    pub allocation_mode: AllocationMode,
    pub rows: Vec<ConfiguredRow>,
    pub additional_mode: FieldMode,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RowInput {
    pub row_id: String,
    pub recipient: Option<Address>,
    pub allocation: MaybeAllocation,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdditionalRow {
    pub row_id: String,
    pub recipient: Address,
    pub allocation: Allocation,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayInput {
    pub node_id: String,
    pub recipient: Address,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SplitInput {
    pub node_id: String,
    pub rows: Vec<RowInput>,
    pub additional: Option<Vec<AdditionalRow>>,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NodeInput {
    Pay(PayInput),
    Split(SplitInput),
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Binding {
    pub node_id: String,
    pub contract_address: Address,
    pub expected_revision: u64,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionContext {
    pub payer: Address,
    pub root: Address,
    pub asset: Address,
    pub funded_amount: i128,
    pub nonce: BytesN<32>,
    pub expires_at_ledger: u32,
    pub bindings: Vec<Binding>,
    pub inputs: Vec<NodeInput>,
    pub index: u32,
}
#[contracttype]
#[derive(Clone)]
pub struct Capabilities {
    pub policy_version: u32,
    pub execution_abi: u32,
    pub execution: bool,
    pub mutation: bool,
    pub immutable_policies: bool,
    pub revision_binding: bool,
}
#[contracttype]
#[derive(Clone)]
pub struct RootState {
    pub policy: RootConfig,
    pub revision: u64,
    pub asset: Address,
}
#[contracttype]
#[derive(Clone)]
pub struct PayState {
    pub policy: PayConfig,
    pub revision: u64,
    pub asset: Address,
    pub parent: Address,
    pub next_steps: Vec<Target>,
    pub amount: i128,
    pub percentage_bps: u32,
}
#[contracttype]
#[derive(Clone)]
pub struct SplitState {
    pub policy: SplitConfig,
    pub revision: u64,
    pub asset: Address,
    pub parent: Address,
    pub min_amount: i128,
}
#[contracttype]
#[derive(Clone)]
pub enum PolicyKey {
    Root,
    Pay,
    Split,
    Revision,
    Nonce(Address, BytesN<32>),
}

pub fn fail(env: &Env, error: ExecutionError) -> ! {
    panic_with_error!(env, error)
}
pub fn require(env: &Env, condition: bool, error: ExecutionError) {
    if !condition {
        fail(env, error);
    }
}
pub fn id_valid(value: &String) -> bool {
    let bytes = value.to_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    for b in bytes.iter() {
        if !(b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return false;
        }
    }
    true
}
pub fn require_wallet(env: &Env, address: &Address) {
    require(
        env,
        address.to_string().to_bytes().get(0) == Some(b'G'),
        ExecutionError::InvalidInput,
    );
}
pub fn require_contract(env: &Env, address: &Address) {
    require(
        env,
        address.to_string().to_bytes().get(0) == Some(b'C'),
        ExecutionError::InvalidPolicy,
    );
}
pub fn has_policy(env: &Env) -> bool {
    env.storage().instance().has(&PolicyKey::Root)
        || env.storage().instance().has(&PolicyKey::Pay)
        || env.storage().instance().has(&PolicyKey::Split)
}
pub fn require_legacy(env: &Env) {
    require(env, !has_policy(env), ExecutionError::Unsupported);
}
pub fn capabilities(env: &Env) -> Capabilities {
    require(env, has_policy(env), ExecutionError::Unsupported);
    Capabilities {
        policy_version: 1,
        execution_abi: 1,
        execution: true,
        mutation: false,
        immutable_policies: true,
        revision_binding: true,
    }
}
pub fn revision(env: &Env) -> u64 {
    require(env, has_policy(env), ExecutionError::Unsupported);
    env.storage()
        .instance()
        .get(&PolicyKey::Revision)
        .unwrap_or(0)
}
pub fn input_id(input: &NodeInput) -> String {
    match input {
        NodeInput::Pay(i) => i.node_id.clone(),
        NodeInput::Split(i) => i.node_id.clone(),
    }
}
pub fn find_input(env: &Env, context: &ExecutionContext, node_id: &String) -> Option<NodeInput> {
    let mut result = None;
    for input in context.inputs.iter() {
        if &input_id(&input) == node_id {
            require(env, result.is_none(), ExecutionError::InvalidInput);
            result = Some(input);
        }
    }
    result
}
pub fn validate_context(env: &Env, context: &ExecutionContext) {
    let now = env.ledger().sequence();
    require(
        env,
        context.expires_at_ledger > now && context.expires_at_ledger - now <= 720,
        ExecutionError::Expired,
    );
    require_wallet(env, &context.payer);
    require(
        env,
        context.funded_amount > 0
            && context.bindings.len() >= 2
            && context.bindings.len() <= 40
            && context.inputs.len() <= 40
            && context.index < context.bindings.len(),
        ExecutionError::InvalidInput,
    );
    require(
        env,
        context.bindings.get(0).unwrap().contract_address == context.root,
        ExecutionError::InvalidInput,
    );
    for (index, binding) in context.bindings.iter().enumerate() {
        require(
            env,
            id_valid(&binding.node_id),
            ExecutionError::InvalidInput,
        );
        require_contract(env, &binding.contract_address);
        for previous in context.bindings.iter().take(index) {
            require(
                env,
                previous.node_id != binding.node_id
                    && previous.contract_address != binding.contract_address,
                ExecutionError::InvalidInput,
            );
        }
    }
    for (index, input) in context.inputs.iter().enumerate() {
        let id = input_id(&input);
        require(
            env,
            context.bindings.iter().skip(1).any(|b| b.node_id == id),
            ExecutionError::InvalidInput,
        );
        for previous in context.inputs.iter().take(index) {
            require(env, input_id(&previous) != id, ExecutionError::InvalidInput);
        }
    }
}
pub fn check_node(
    env: &Env,
    context: &ExecutionContext,
    node_id: &String,
    parent: &Address,
    asset: &Address,
    amount: i128,
) {
    validate_context(env, context);
    require(env, context.index > 0, ExecutionError::Unauthorized);
    require(
        env,
        context.asset == *asset && amount > 0 && amount <= context.funded_amount,
        ExecutionError::InvalidAmount,
    );
    let binding = context.bindings.get(context.index).unwrap();
    require(
        env,
        binding.node_id == *node_id && binding.contract_address == env.current_contract_address(),
        ExecutionError::InvalidInput,
    );
    require(
        env,
        binding.expected_revision == revision(env),
        ExecutionError::StaleRevision,
    );
    require(
        env,
        context
            .bindings
            .get(context.index - 1)
            .unwrap()
            .contract_address
            == *parent,
        ExecutionError::Unauthorized,
    );
    parent.require_auth();
}
pub fn forward(env: &Env, mut context: ExecutionContext, target: &Address, amount: i128) {
    context.index += 1;
    let binding = context
        .bindings
        .get(context.index)
        .unwrap_or_else(|| fail(env, ExecutionError::InvalidInput));
    require(
        env,
        binding.contract_address == *target,
        ExecutionError::InvalidInput,
    );
    transfer_exact(
        env,
        &context.asset,
        &env.current_contract_address(),
        target,
        amount,
    );
    let asset = context.asset.clone();
    env.invoke_contract::<()>(
        target,
        &Symbol::new(env, "execute_step_v1"),
        vec![
            env,
            context.into_val(env),
            asset.into_val(env),
            amount.into_val(env),
        ],
    );
}

/// Reject under-delivery or extra debits instead of subsidizing them from old holdings.
/// Pinned assets use the Stellar asset contract; this also fails closed for nonstandard tokens.
pub fn transfer_exact(env: &Env, asset: &Address, from: &Address, to: &Address, amount: i128) {
    require(env, amount > 0 && from != to, ExecutionError::InvalidAmount);
    let client = token::Client::new(env, asset);
    let from_before = client.balance(from);
    let to_before = client.balance(to);
    let expected_from = from_before
        .checked_sub(amount)
        .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
    let expected_to = to_before
        .checked_add(amount)
        .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow));
    require(env, expected_from >= 0, ExecutionError::InvalidAmount);
    client.transfer(from, to, &amount);
    require(
        env,
        client.balance(from) == expected_from && client.balance(to) == expected_to,
        ExecutionError::InvalidAmount,
    );
}
pub fn validate_allocation(env: &Env, allocation: &Allocation, mode: &AllocationMode) {
    require(
        env,
        match (allocation, mode) {
            (Allocation::Percentage(bps), AllocationMode::Percentage) => *bps > 0 && *bps <= 10_000,
            (Allocation::Fixed(amount), AllocationMode::Fixed) => *amount > 0,
            _ => false,
        },
        ExecutionError::InvalidInput,
    );
}
pub fn validate_pay(env: &Env, config: &PayConfig) {
    require(
        env,
        config.version == 1
            && id_valid(&config.node_id)
            && config.recipient_mode != FieldMode::Mutable
            && config.payout_value_mode == FieldMode::Constant,
        ExecutionError::InvalidPolicy,
    );
    require(
        env,
        config.recipient.is_some() == (config.recipient_mode == FieldMode::Constant),
        ExecutionError::InvalidPolicy,
    );
    if let Some(recipient) = &config.recipient {
        require_wallet(env, recipient);
    }
    require(
        env,
        match config.payout_rule {
            PayoutRule::Full => true,
            PayoutRule::Fixed(value) => value > 0,
            PayoutRule::Percentage(bps) => bps > 0 && bps <= 10_000,
        },
        ExecutionError::InvalidPolicy,
    );
}
pub fn validate_split(env: &Env, config: &SplitConfig) {
    require(
        env,
        config.version == 1
            && id_valid(&config.node_id)
            && config.rows.len() <= 20
            && config.additional_mode != FieldMode::Mutable
            && (!config.rows.is_empty() || config.additional_mode == FieldMode::Execution),
        ExecutionError::InvalidPolicy,
    );
    let mut bps = 0u32;
    let mut all_fixed = 0i128;
    let mut complete = config.additional_mode == FieldMode::Constant;
    for (index, row) in config.rows.iter().enumerate() {
        require(
            env,
            id_valid(&row.row_id)
                && row.recipient_mode != FieldMode::Mutable
                && row.allocation_mode != FieldMode::Mutable
                && row.recipient.is_some() == (row.recipient_mode == FieldMode::Constant)
                && row.allocation.is_some() == (row.allocation_mode == FieldMode::Constant),
            ExecutionError::InvalidPolicy,
        );
        for previous in config.rows.iter().take(index) {
            require(
                env,
                previous.row_id != row.row_id,
                ExecutionError::InvalidPolicy,
            );
            if row.recipient.is_some() {
                require(
                    env,
                    previous.recipient != row.recipient,
                    ExecutionError::InvalidPolicy,
                );
            }
        }
        if let Some(recipient) = &row.recipient {
            require_wallet(env, recipient);
        }
        if let MaybeAllocation::Present(allocation) = &row.allocation {
            validate_allocation(env, allocation, &config.allocation_mode);
            match allocation {
                Allocation::Percentage(value) => {
                    bps = bps
                        .checked_add(*value)
                        .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow))
                }
                Allocation::Fixed(value) => {
                    all_fixed = all_fixed
                        .checked_add(*value)
                        .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow))
                }
            }
        } else {
            complete = false;
        }
    }
    require(
        env,
        bps <= 10_000
            && (!complete || config.allocation_mode != AllocationMode::Percentage || bps == 10_000),
        ExecutionError::InvalidPolicy,
    );
}

pub fn merged_split(
    env: &Env,
    config: &SplitConfig,
    input: Option<NodeInput>,
    amount: i128,
) -> Vec<AdditionalRow> {
    let needs_input = config.additional_mode == FieldMode::Execution
        || config.rows.iter().any(|r| {
            r.recipient_mode == FieldMode::Execution || r.allocation_mode == FieldMode::Execution
        });
    require(
        env,
        input.is_some() == needs_input,
        ExecutionError::InvalidInput,
    );
    let submitted = match input {
        Some(NodeInput::Split(value)) => Some(value),
        Some(_) => fail(env, ExecutionError::InvalidInput),
        None => None,
    };
    let empty = Vec::new(env);
    let rows = submitted.as_ref().map(|s| &s.rows).unwrap_or(&empty);
    require(
        env,
        rows.len()
            == config
                .rows
                .iter()
                .filter(|r| {
                    r.recipient_mode == FieldMode::Execution
                        || r.allocation_mode == FieldMode::Execution
                })
                .count() as u32,
        ExecutionError::InvalidInput,
    );
    let mut merged = Vec::new(env);
    for configured in config.rows.iter() {
        let row_input = rows.iter().find(|r| r.row_id == configured.row_id);
        let recipient = if configured.recipient_mode == FieldMode::Execution {
            row_input
                .as_ref()
                .and_then(|r| r.recipient.clone())
                .unwrap_or_else(|| fail(env, ExecutionError::InvalidInput))
        } else {
            require(
                env,
                row_input.as_ref().is_none_or(|r| r.recipient.is_none()),
                ExecutionError::InvalidInput,
            );
            configured.recipient.unwrap()
        };
        let allocation = if configured.allocation_mode == FieldMode::Execution {
            row_input
                .as_ref()
                .and_then(|r| r.allocation.to_option())
                .unwrap_or_else(|| fail(env, ExecutionError::InvalidInput))
        } else {
            require(
                env,
                row_input.as_ref().is_none_or(|r| r.allocation.is_none()),
                ExecutionError::InvalidInput,
            );
            configured.allocation.unwrap()
        };
        merged.push_back(AdditionalRow {
            row_id: configured.row_id,
            recipient,
            allocation,
        });
    }
    for (index, row) in rows.iter().enumerate() {
        require(
            env,
            config.rows.iter().any(|r| {
                r.row_id == row.row_id
                    && (r.recipient_mode == FieldMode::Execution
                        || r.allocation_mode == FieldMode::Execution)
            }),
            ExecutionError::InvalidInput,
        );
        require(
            env,
            rows.iter().take(index).all(|r| r.row_id != row.row_id),
            ExecutionError::InvalidInput,
        );
    }
    let additional = submitted.as_ref().and_then(|s| s.additional.as_ref());
    require(
        env,
        additional.is_some() == (config.additional_mode == FieldMode::Execution),
        ExecutionError::InvalidInput,
    );
    if let Some(additional) = additional {
        require(env, additional.len() <= 20, ExecutionError::InvalidInput);
        for row in additional.iter() {
            merged.push_back(row);
        }
    }
    require(
        env,
        !merged.is_empty() && merged.len() <= 20,
        ExecutionError::InvalidInput,
    );
    let mut total_bps = 0u32;
    let mut total_fixed = 0i128;
    for (index, row) in merged.iter().enumerate() {
        require(env, id_valid(&row.row_id), ExecutionError::InvalidInput);
        require_wallet(env, &row.recipient);
        validate_allocation(env, &row.allocation, &config.allocation_mode);
        for previous in merged.iter().take(index) {
            require(
                env,
                previous.row_id != row.row_id && previous.recipient != row.recipient,
                ExecutionError::InvalidInput,
            );
        }
        match row.allocation {
            Allocation::Percentage(bps) => {
                total_bps = total_bps
                    .checked_add(bps)
                    .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow))
            }
            Allocation::Fixed(value) => {
                total_fixed = total_fixed
                    .checked_add(value)
                    .unwrap_or_else(|| fail(env, ExecutionError::ArithmeticOverflow))
            }
        }
    }
    require(
        env,
        match config.allocation_mode {
            AllocationMode::Percentage => total_bps == 10_000,
            AllocationMode::Fixed => !needs_input || total_fixed == amount,
        },
        ExecutionError::InvalidAmount,
    );
    merged
}
