#![no_std]
//! CASH_OUT_DEV — a terminal "leave the chain" sink for dev-mode flows.
//!
//! Unlike the swapper (which converts at a fixed on-chain rate against pre-funded
//! liquidity and forwards to `next_steps`), cash-out does none of that. It is a
//! stripped-down sink modeled on `splitter_dev`'s `receive_and_forward`:
//!
//!   receive USDC → transfer it to the off-ramp **treasury** (relayer-controlled)
//!                → emit a `cash_out` event `(amount, source)`.
//!
//! The backend cron picks up the event and runs the off-chain PDAX leg
//! (quote → trade → InstaPay withdrawal). The destination **bank details** are
//! mutable: blank at deploy time, filled / changed later via the auth-gated
//! `update_bank` setter (admin OR relayer). Execution before the bank details
//! are configured fails cleanly with `NotConfigured` rather than shipping funds
//! to the treasury with nowhere to send the fiat.
//!
//! There is intentionally **no forwarding** — cash-out is a leaf. Its output
//! leaves the chain, so it can never feed another on-chain node.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct WorkflowTarget {
    pub address: Address,
    pub data: String,
}

/// Snapshot of the mutable bank destination returned by the `bank` getter.
#[contracttype]
#[derive(Clone)]
pub struct BankDetails {
    pub account_name: String,
    pub account_number: String,
    pub bank_code: String,
}

#[contracttype]
pub enum Key {
    Admin,
    Relayer,
    Asset,
    Treasury,
    Parent,
    Paused,
    Version,
    AccountName,
    AccountNumber,
    BankCode,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Paused = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InvalidBank = 5,
    /// Execution was triggered before the bank details were filled in.
    NotConfigured = 6,
}

const VERSION: u32 = 1;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct CashOutDev;

#[contractimpl]
impl CashOutDev {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        relayer: Address,
        asset: Address,
        treasury: Address,
        parent: Address,
        account_name: String,
        account_number: String,
        bank_code: String,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }

        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Relayer, &relayer);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Treasury, &treasury);
        env.storage().instance().set(&Key::Parent, &parent);
        env.storage().instance().set(&Key::Paused, &false);
        env.storage().instance().set(&Key::Version, &VERSION);
        // Blank bank details are allowed at deploy time; the contract reports
        // "not configured" until `update_bank` fills all three fields.
        env.storage().instance().set(&Key::AccountName, &account_name);
        env.storage()
            .instance()
            .set(&Key::AccountNumber, &account_number);
        env.storage().instance().set(&Key::BankCode, &bank_code);
    }

    /// Direct-call entry: pull `amount` from `from` and sink it to the treasury.
    /// Used for a standalone cash-out (no upstream pipeline node).
    pub fn distribute(env: Env, from: Address, amount: i128) {
        from.require_auth();
        bump_ttl(&env);
        require_configured(&env);
        require_not_paused(&env);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let client = token::Client::new(&env, &asset);
        client.transfer(&from, &env.current_contract_address(), &amount);
        sink_to_treasury(&env, &asset, amount, &from);
    }

    /// Pipeline leaf entry: the parent node has already transferred `amount` of
    /// `asset` into this contract before invoking us. Auth: the parent node.
    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::Parent).unwrap();
        parent.require_auth();
        require_configured(&env);
        require_not_paused(&env);
        require_asset(&env, &asset);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        sink_to_treasury(&env, &asset, amount, &parent);
    }

    /// Trigger-driven entry (webhook / oracle / subscription forwarding). Funds
    /// are expected to already be held by this contract. `next_steps` is ignored
    /// — cash-out is terminal.
    pub fn receive_and_forward(
        env: Env,
        from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        bump_ttl(&env);
        require_configured(&env);
        require_not_paused(&env);
        require_asset(&env, &asset);
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        sink_to_treasury(&env, &asset, amount, &from);
    }

    /// Fill / change the destination bank details. Auth: admin OR relayer.
    /// Rejects empty fields so the contract cannot be set back to "configured"
    /// with a blank destination.
    pub fn update_bank(
        env: Env,
        caller: Address,
        account_name: String,
        account_number: String,
        bank_code: String,
    ) {
        require_admin_or_relayer(&env, &caller);
        if account_name.is_empty() || account_number.is_empty() || bank_code.is_empty() {
            panic_with_error!(&env, Error::InvalidBank);
        }
        env.storage().instance().set(&Key::AccountName, &account_name);
        env.storage()
            .instance()
            .set(&Key::AccountNumber, &account_number);
        env.storage().instance().set(&Key::BankCode, &bank_code);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "bank_updated"), caller), bank_code);
    }

    pub fn set_relayer(env: Env, new_relayer: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Relayer, &new_relayer);
        #[allow(deprecated)]
        env.events()
            .publish((Symbol::new(&env, "set_relayer"), admin), new_relayer);
    }

    pub fn set_treasury(env: Env, new_treasury: Address) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&Key::Treasury, &new_treasury);
    }

    pub fn pause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::Paused, &true);
    }

    pub fn unpause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::Paused, &false);
    }

    pub fn is_configured(env: Env) -> bool {
        is_configured(&env)
    }

    pub fn bank(env: Env) -> BankDetails {
        BankDetails {
            account_name: env.storage().instance().get(&Key::AccountName).unwrap(),
            account_number: env.storage().instance().get(&Key::AccountNumber).unwrap(),
            bank_code: env.storage().instance().get(&Key::BankCode).unwrap(),
        }
    }

    pub fn treasury(env: Env) -> Address {
        env.storage().instance().get(&Key::Treasury).unwrap()
    }

    pub fn relayer(env: Env) -> Address {
        env.storage().instance().get(&Key::Relayer).unwrap()
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&Key::Asset).unwrap()
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
    }
}

/// Move `amount` of `asset` held by this contract to the off-ramp treasury and
/// emit the `cash_out` intent event the backend cron consumes. `source` is the
/// address the on-chain funds came from — recorded for the refund path.
fn sink_to_treasury(env: &Env, asset: &Address, amount: i128, source: &Address) {
    let treasury: Address = env.storage().instance().get(&Key::Treasury).unwrap();
    let client = token::Client::new(env, asset);
    client.transfer(&env.current_contract_address(), &treasury, &amount);

    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("cash_out"), source.clone()), amount);
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
    let name: String = env
        .storage()
        .instance()
        .get(&Key::AccountName)
        .unwrap_or_else(|| String::from_str(env, ""));
    let number: String = env
        .storage()
        .instance()
        .get(&Key::AccountNumber)
        .unwrap_or_else(|| String::from_str(env, ""));
    let code: String = env
        .storage()
        .instance()
        .get(&Key::BankCode)
        .unwrap_or_else(|| String::from_str(env, ""));
    !name.is_empty() && !number.is_empty() && !code.is_empty()
}

fn require_configured(env: &Env) {
    if !is_configured(env) {
        panic_with_error!(env, Error::NotConfigured);
    }
}

fn require_not_paused(env: &Env) {
    if env
        .storage()
        .instance()
        .get::<_, bool>(&Key::Paused)
        .unwrap_or(false)
    {
        panic_with_error!(env, Error::Paused);
    }
}

fn require_asset(env: &Env, asset: &Address) {
    let stored: Address = env.storage().instance().get(&Key::Asset).unwrap();
    if *asset != stored {
        panic_with_error!(env, Error::Unauthorized);
    }
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, Env};

    struct Fixture {
        contract: Address,
        asset: Address,
        admin: Address,
        relayer: Address,
        treasury: Address,
        #[allow(dead_code)]
        parent: Address,
    }

    fn blank(env: &Env) -> String {
        String::from_str(env, "")
    }

    fn deploy(env: &Env, configured: bool) -> Fixture {
        let admin = Address::generate(env);
        let relayer = Address::generate(env);
        let treasury = Address::generate(env);
        let parent = Address::generate(env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());

        let (name, number, code) = if configured {
            (
                String::from_str(env, "Juan Dela Cruz"),
                String::from_str(env, "1234567890"),
                String::from_str(env, "BASECPH"),
            )
        } else {
            (blank(env), blank(env), blank(env))
        };

        let contract = env.register(
            CashOutDev,
            (
                admin.clone(),
                relayer.clone(),
                asset.address(),
                treasury.clone(),
                parent.clone(),
                name,
                number,
                code,
            ),
        );

        Fixture {
            contract,
            asset: asset.address(),
            admin,
            relayer,
            treasury,
            parent,
        }
    }

    #[test]
    fn blank_construction_then_configure_and_sink() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, false);
        let client = CashOutDevClient::new(&env, &f.contract);
        assert!(!client.is_configured());

        client.update_bank(
            &f.relayer,
            &String::from_str(&env, "Juan Dela Cruz"),
            &String::from_str(&env, "1234567890"),
            &String::from_str(&env, "BASECPH"),
        );
        assert!(client.is_configured());

        let sac = token::StellarAssetClient::new(&env, &f.asset);
        let tok = token::TokenClient::new(&env, &f.asset);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);

        client.distribute(&payer, &10_000_000);
        // Funds left the payer and landed in the treasury — the chain boundary.
        assert_eq!(tok.balance(&f.treasury), 10_000_000);
        assert_eq!(tok.balance(&f.contract), 0);
        assert_eq!(tok.balance(&payer), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn distribute_before_configured_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, false);
        let sac = token::StellarAssetClient::new(&env, &f.asset);
        let payer = Address::generate(&env);
        sac.mint(&payer, &10_000_000);

        let client = CashOutDevClient::new(&env, &f.contract);
        client.distribute(&payer, &10_000_000);
    }

    #[test]
    fn execute_step_sinks_prefunded_balance() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, true);
        let sac = token::StellarAssetClient::new(&env, &f.asset);
        let tok = token::TokenClient::new(&env, &f.asset);
        // Simulate the parent pipeline node having forwarded funds in already.
        sac.mint(&f.contract, &5_000_000);

        let client = CashOutDevClient::new(&env, &f.contract);
        client.execute_step(&f.asset, &5_000_000);

        assert_eq!(tok.balance(&f.treasury), 5_000_000);
        assert_eq!(tok.balance(&f.contract), 0);
    }

    #[test]
    fn relayer_can_update_bank() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, true);
        let client = CashOutDevClient::new(&env, &f.contract);
        client.update_bank(
            &f.relayer,
            &String::from_str(&env, "New Name"),
            &String::from_str(&env, "9999999999"),
            &String::from_str(&env, "BACTBPH"),
        );
        let bank = client.bank();
        assert_eq!(bank.bank_code, String::from_str(&env, "BACTBPH"));
        assert_eq!(bank.account_number, String::from_str(&env, "9999999999"));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn stranger_cannot_update_bank() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, true);
        let stranger = Address::generate(&env);
        let client = CashOutDevClient::new(&env, &f.contract);
        client.update_bank(
            &stranger,
            &String::from_str(&env, "Mallory"),
            &String::from_str(&env, "0000000000"),
            &String::from_str(&env, "BASECPH"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn update_bank_rejects_blank_field() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, true);
        let client = CashOutDevClient::new(&env, &f.contract);
        client.update_bank(
            &f.admin,
            &String::from_str(&env, "Juan"),
            &blank(&env),
            &String::from_str(&env, "BASECPH"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn execute_step_rejects_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, true);
        let client = CashOutDevClient::new(&env, &f.contract);
        client.execute_step(&f.asset, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn execute_step_rejects_wrong_asset() {
        let env = Env::default();
        env.mock_all_auths();

        let f = deploy(&env, true);
        let other = env.register_stellar_asset_contract_v2(f.admin.clone());
        let sac = token::StellarAssetClient::new(&env, &f.asset);
        sac.mint(&f.contract, &1_000_000);
        let client = CashOutDevClient::new(&env, &f.contract);
        client.execute_step(&other.address(), &1_000_000);
    }
}
