#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env,
    IntoVal, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Recipient {
    pub address: Address,
    pub bps: u32,
}

#[contracttype]
pub enum Key {
    Admin,
    Asset,
    Recipients,
    Paused,
    Version,
}

#[derive(Copy, Clone)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    BpsSumInvalid = 2,
    NoRecipients = 3,
    Paused = 4,
    Unauthorized = 5,
    InvalidAmount = 6,
}

const VERSION: u32 = 1;
const TOTAL_BPS: u32 = 10_000;

#[contract]
pub struct Splitter;

#[contractimpl]
impl Splitter {
    pub fn __constructor(env: Env, admin: Address, asset: Address, recipients: Vec<Recipient>) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if recipients.is_empty() {
            panic_with_error!(&env, Error::NoRecipients);
        }
        let mut sum: u32 = 0;
        for r in recipients.iter() {
            sum = sum
                .checked_add(r.bps)
                .unwrap_or_else(|| panic_with_error!(&env, Error::BpsSumInvalid));
        }
        if sum != TOTAL_BPS {
            panic_with_error!(&env, Error::BpsSumInvalid);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Recipients, &recipients);
        env.storage().instance().set(&Key::Paused, &false);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn distribute(env: Env, from: Address, amount: i128) {
        from.require_auth();
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
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();

        let client = token::Client::new(&env, &asset);
        client.transfer(&from, &env.current_contract_address(), &amount);

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

        let topic: Symbol = symbol_short!("distrib");
        env.events()
            .publish((topic, from.clone()), (asset, amount));
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

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
    }
}
