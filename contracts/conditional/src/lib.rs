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
