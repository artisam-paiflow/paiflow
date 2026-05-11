#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env,
    String,
};

#[contracttype]
pub enum Key {
    Admin,
    Recipient,
    Asset,
    Amount,
    Condition, // serialized JSON; off-chain validator + on-chain timeout fallback
    Released,
    Version,
}

#[derive(Copy, Clone)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    AlreadyReleased = 2,
    ConditionNotMet = 3,
    Unauthorized = 4,
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
        condition: String,
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

    /// Release funds. For v1 the condition is enforced by `admin.require_auth()`.
    /// Future versions decode the `Condition` payload and check on-chain state
    /// (timeout / oracle / multisig).
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
        let amount: i128 = env.storage().instance().get(&Key::Amount).unwrap();
        let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );
        env.storage().instance().set(&Key::Released, &true);
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
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, Env, String as SorobanString};

    #[test]
    fn admin_releases_funds() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);
        let condition = SorobanString::from_str(&env, "{\"kind\":\"time_after\"}");

        let contract_id = env.register(
            Conditional,
            (admin.clone(), recipient.clone(), asset.address(), 1_000_i128, condition),
        );
        sac.mint(&contract_id, &1_000);
        let client = ConditionalClient::new(&env, &contract_id);
        assert_eq!(client.status(), false);
        client.release();
        assert_eq!(tok.balance(&recipient), 1_000);
        assert_eq!(client.status(), true);
    }

    #[test]
    #[should_panic]
    fn double_release_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let recipient = Address::generate(&env);
        let condition = SorobanString::from_str(&env, "{}");

        let contract_id = env.register(
            Conditional,
            (admin.clone(), recipient.clone(), asset.address(), 100_i128, condition),
        );
        sac.mint(&contract_id, &100);
        let client = ConditionalClient::new(&env, &contract_id);
        client.release();
        client.release();
    }
}
