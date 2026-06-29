#![no_std]
#![allow(clippy::too_many_arguments)]
//! PAYER_DEV — the mutable / parameterized variant of the `payer` action.
//!
//! Behaves exactly like `payer` at execution time (same `execute_step` /
//! `receive_and_forward` interface so it slots into the pipeline), but its
//! recipient, payment value and asset can be left blank at deploy time and
//! filled / changed later through auth-gated setters. Setters accept the admin
//! OR the relayer so the API backend (holding the relayer key) can configure a
//! deployed flow without the deployer signing each change.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Symbol, Vec,
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
    Relayer,
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
    /// Execution was triggered before the mutable params were filled in.
    NotConfigured = 4,
}

const VERSION: u32 = 1;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct PayerDev;

#[contractimpl]
impl PayerDev {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        relayer: Address,
        asset: Address,
        recipient: Option<Address>,
        amount: i128,
        percentage_bps: u32,
        next_steps: Vec<WorkflowTarget>,
        parent: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Recipient, &recipient);
        env.storage().instance().set(&Key::Amount, &amount);
        env.storage()
            .instance()
            .set(&Key::PercentageBps, &percentage_bps);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();
        do_pay(&env, &asset, amount);
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
        do_pay(&env, &asset, amount);
    }

    /// Fill / change the recipient and payment value. Auth: admin OR relayer.
    /// `caller` declares who is acting and is authenticated; the call is
    /// authorized only if it is the admin or the configured relayer. A non-zero
    /// `percentage_bps` selects percentage mode; otherwise `amount` is the fixed
    /// payout.
    pub fn update_payment(
        env: Env,
        caller: Address,
        recipient: Address,
        amount: i128,
        percentage_bps: u32,
    ) {
        require_admin_or_relayer(&env, &caller);
        if amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if amount == 0 && percentage_bps == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&Key::Recipient, &Some(recipient.clone()));
        env.storage().instance().set(&Key::Amount, &amount);
        env.storage()
            .instance()
            .set(&Key::PercentageBps, &percentage_bps);
        #[allow(deprecated)]
        env.events().publish(
            (Symbol::new(&env, "payment_updated"), caller),
            (recipient, amount, percentage_bps),
        );
    }

    /// Change the asset this payer operates on. Auth: admin OR relayer.
    pub fn set_asset(env: Env, caller: Address, asset: Address) {
        require_admin_or_relayer(&env, &caller);
        env.storage().instance().set(&Key::Asset, &asset);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_asset"), caller), asset);
    }

    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Relayer, &new_relayer);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_relayer"), admin), new_relayer);
    }

    pub fn set_next_steps(env: Env, next_steps: Vec<WorkflowTarget>) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::NextSteps, &next_steps);
    }

    pub fn cancel(env: Env) {
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

    pub fn is_configured(env: Env) -> bool {
        is_configured(&env)
    }

    pub fn configured_amount(env: Env) -> i128 {
        env.storage().instance().get(&Key::Amount).unwrap_or(0)
    }

    pub fn percentage_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0)
    }

    pub fn recipient(env: Env) -> Option<Address> {
        env.storage().instance().get(&Key::Recipient).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
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
    let recipient: Option<Address> = env
        .storage()
        .instance()
        .get(&Key::Recipient)
        .unwrap_or(None);
    if recipient.is_none() {
        return false;
    }
    let amount: i128 = env.storage().instance().get(&Key::Amount).unwrap_or(0);
    let bps: u32 = env
        .storage()
        .instance()
        .get(&Key::PercentageBps)
        .unwrap_or(0);
    amount > 0 || bps > 0
}

fn do_pay(env: &Env, asset: &Address, amount: i128) {
    if !is_configured(env) {
        panic_with_error!(env, Error::NotConfigured);
    }

    let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
    if *asset != stored_asset {
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
    let recipient: Address = env
        .storage()
        .instance()
        .get::<_, Option<Address>>(&Key::Recipient)
        .unwrap()
        .unwrap();
    let payment = if percentage_bps > 0 {
        (amount * i128::from(percentage_bps)) / 10_000
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
    use soroban_sdk::{contract, contractimpl, token, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    fn setup(
        env: &Env,
        recipient: Option<Address>,
        amount: i128,
        percentage_bps: u32,
    ) -> (Address, Address, Address, Address) {
        let admin = Address::generate(env);
        let relayer = Address::generate(env);
        let parent = Address::generate(env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let contract_id = env.register(
            PayerDev,
            (
                admin.clone(),
                relayer.clone(),
                asset.address(),
                recipient,
                amount,
                percentage_bps,
                Vec::<WorkflowTarget>::new(env),
                parent.clone(),
            ),
        );
        (contract_id, asset.address(), admin, relayer)
    }

    #[test]
    fn pays_configured_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let recipient = Address::generate(&env);
        let (contract_id, asset, _admin, _relayer) = setup(&env, Some(recipient.clone()), 100, 0);
        let sac = token::StellarAssetClient::new(&env, &asset);
        let tok = token::TokenClient::new(&env, &asset);
        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let client = PayerDevClient::new(&env, &contract_id);
        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset, &1_000);

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
        assert!(client.is_configured());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn execute_before_configured_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, _admin, _relayer) = setup(&env, None, 0, 0);
        let sac = token::StellarAssetClient::new(&env, &asset);
        let tok = token::TokenClient::new(&env, &asset);
        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let client = PayerDevClient::new(&env, &contract_id);
        assert!(!client.is_configured());
        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset, &1_000);
    }

    #[test]
    fn update_payment_then_pays() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, admin, _relayer) = setup(&env, None, 0, 0);
        let sac = token::StellarAssetClient::new(&env, &asset);
        let tok = token::TokenClient::new(&env, &asset);
        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let client = PayerDevClient::new(&env, &contract_id);
        client.update_payment(&admin, &recipient, &250, &0);
        assert!(client.is_configured());
        assert_eq!(client.recipient(), Some(recipient.clone()));

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset, &1_000);
        assert_eq!(tok.balance(&recipient), 250);
    }

    #[test]
    fn relayer_can_update_payment() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, _admin, relayer) = setup(&env, None, 0, 0);
        let sac = token::StellarAssetClient::new(&env, &asset);
        let tok = token::TokenClient::new(&env, &asset);
        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let client = PayerDevClient::new(&env, &contract_id);
        // Relayer (not admin) fills in the payment.
        client.update_payment(&relayer, &recipient, &150, &0);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset, &1_000);
        assert_eq!(tok.balance(&recipient), 150);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn stranger_cannot_update_payment() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, _asset, _admin, _relayer) = setup(&env, None, 0, 0);
        let stranger = Address::generate(&env);
        let recipient = Address::generate(&env);
        let client = PayerDevClient::new(&env, &contract_id);
        client.update_payment(&stranger, &recipient, &150, &0);
    }

    #[test]
    fn pays_percentage_after_update() {
        let env = Env::default();
        env.mock_all_auths();

        let (contract_id, asset, admin, _relayer) = setup(&env, None, 0, 0);
        let sac = token::StellarAssetClient::new(&env, &asset);
        let tok = token::TokenClient::new(&env, &asset);
        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let client = PayerDevClient::new(&env, &contract_id);
        client.update_payment(&admin, &recipient, &0, &5_000);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset, &1_000);
        assert_eq!(tok.balance(&recipient), 500);
        assert_eq!(client.percentage_bps(), 5_000);
    }
}
