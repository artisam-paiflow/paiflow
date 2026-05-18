#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String,
};

#[contracttype]
#[derive(Clone)]
pub enum ConditionKind {
    Timeout(u64),
    OracleGte(String),
    Multisig(u32),
}

#[contracttype]
pub enum Key {
    Admin,
    Recipient,
    Asset,
    Amount,
    Condition,
    Released,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    AlreadyReleased = 2,
    ConditionNotMet = 3,
    Unauthorized = 4,
    OracleNotSupported = 5,
}

const VERSION: u32 = 1;

#[contract]
pub struct Conditional;

#[contractimpl]
impl Conditional {
    pub fn __constructor(
        env: Env,
        admin: Address,
        recipient: Address,
        asset: Address,
        amount: i128,
        condition: ConditionKind,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Recipient, &recipient);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Amount, &amount);
        env.storage().instance().set(&Key::Condition, &condition);
        env.storage().instance().set(&Key::Released, &false);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn release(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        if env
            .storage()
            .instance()
            .get::<_, bool>(&Key::Released)
            .unwrap_or(false)
        {
            panic_with_error!(&env, Error::AlreadyReleased);
        }
        let condition: ConditionKind = env.storage().instance().get(&Key::Condition).unwrap();
        let now = env.ledger().timestamp();
        let can_release = match condition {
            ConditionKind::Timeout(ts) => now >= ts,
            ConditionKind::OracleGte(_) => {
                panic_with_error!(&env, Error::OracleNotSupported);
            }
            ConditionKind::Multisig(_threshold) => true,
        };
        if !can_release {
            panic_with_error!(&env, Error::ConditionNotMet);
        }
        let amount: i128 = env.storage().instance().get(&Key::Amount).unwrap();
        let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );
        env.storage().instance().set(&Key::Released, &true);
        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("release"), recipient), amount);
    }

    pub fn cancel(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let client = token::Client::new(&env, &asset);
        let bal = client.balance(&env.current_contract_address());
        if bal > 0 {
            client.transfer(&env.current_contract_address(), &admin, &bal);
        }
        #[allow(deprecated)]
        env.events().publish((symbol_short!("cancel"),), bal);
    }

    pub fn status(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&Key::Released)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Env};

    #[test]
    fn admin_releases_funds_with_timeout() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);
        let condition = ConditionKind::Timeout(1000);

        let contract_id = env.register(
            Conditional,
            (
                admin.clone(),
                recipient.clone(),
                asset.address(),
                1_000_i128,
                condition,
            ),
        );
        sac.mint(&contract_id, &1_000);
        let client = ConditionalClient::new(&env, &contract_id);
        assert!(!client.status());

        env.ledger().set_timestamp(999);
        assert!(!client.status());

        env.ledger().set_timestamp(1000);
        client.release();
        assert_eq!(tok.balance(&recipient), 1_000);
        assert!(client.status());
    }

    #[test]
    fn multisig_condition_allows_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);
        let condition = ConditionKind::Multisig(1);

        let contract_id = env.register(
            Conditional,
            (
                admin.clone(),
                recipient.clone(),
                asset.address(),
                1_000_i128,
                condition,
            ),
        );
        sac.mint(&contract_id, &1_000);
        let client = ConditionalClient::new(&env, &contract_id);

        client.release();
        assert_eq!(tok.balance(&recipient), 1_000);
        assert!(client.status());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn double_release_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);
        let condition = ConditionKind::Timeout(1000);

        let contract_id = env.register(
            Conditional,
            (
                admin.clone(),
                recipient.clone(),
                asset.address(),
                100_i128,
                condition,
            ),
        );
        sac.mint(&contract_id, &100);
        let client = ConditionalClient::new(&env, &contract_id);
        env.ledger().set_timestamp(1000);
        client.release();
        client.release();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn condition_not_met_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);
        let condition = ConditionKind::Timeout(2000);

        let contract_id = env.register(
            Conditional,
            (
                admin.clone(),
                recipient.clone(),
                asset.address(),
                1_000_i128,
                condition,
            ),
        );
        sac.mint(&contract_id, &1_000);
        let client = ConditionalClient::new(&env, &contract_id);

        env.ledger().set_timestamp(500);
        client.release();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn oracle_gte_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);
        let _oracle = Address::generate(&env);
        let condition = ConditionKind::OracleGte(String::from_str(&env, "BTC/USD"));

        let contract_id = env.register(
            Conditional,
            (
                admin.clone(),
                recipient.clone(),
                asset.address(),
                1_000_i128,
                condition,
            ),
        );
        sac.mint(&contract_id, &1_000);
        let client = ConditionalClient::new(&env, &contract_id);

        env.ledger().set_timestamp(1000);
        client.release();
    }
}
