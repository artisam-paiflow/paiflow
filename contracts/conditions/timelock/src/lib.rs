#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Vec,
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
    UnlockTime,
    NextSteps,
    Balance,
    ParentNode,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    ConditionNotMet = 3,
    NothingToRelease = 4,
    Overflow = 5,
}

const VERSION: u32 = 1;
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct Timelock;

#[contractimpl]
impl Timelock {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        unlock_time: u64,
        next_steps: Vec<WorkflowTarget>,
        parent: Address,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::UnlockTime, &unlock_time);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Balance, &0i128);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();

        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        let current: i128 = env.storage().instance().get(&Key::Balance).unwrap_or(0);
        env.storage().instance().set(
            &Key::Balance,
            &(current
                .checked_add(amount)
                .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow))),
        );

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("receive"), asset), amount);
    }

    pub fn release(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        bump_ttl(&env);

        let now = env.ledger().timestamp();
        let unlock_time: u64 = env.storage().instance().get(&Key::UnlockTime).unwrap();
        if now < unlock_time {
            panic_with_error!(&env, Error::ConditionNotMet);
        }

        let balance: i128 = env.storage().instance().get(&Key::Balance).unwrap_or(0);
        if balance <= 0 {
            panic_with_error!(&env, Error::NothingToRelease);
        }

        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        for step in next_steps.iter() {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &step.address,
                &balance,
            );
            invoke_execute_step(&env, &step.address, &asset, &balance);
        }

        env.storage().instance().set(&Key::Balance, &0i128);

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("release"), admin), balance);
    }

    pub fn balance(env: Env) -> i128 {
        env.storage().instance().get(&Key::Balance).unwrap_or(0)
    }

    pub fn unlock_time(env: Env) -> u64 {
        env.storage().instance().get(&Key::UnlockTime).unwrap()
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
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    #[test]
    fn holds_funds_until_unlock() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Timelock,
            (
                admin.clone(),
                asset.address(),
                1000_u64,
                next_steps,
                predecessor.clone(),
            ),
        );
        let client = TimelockClient::new(&env, &contract_id);

        // Simulate predecessor sending funds
        tok.transfer(&predecessor, &contract_id, &500);
        client.execute_step(&asset.address(), &500);

        assert_eq!(client.balance(), 500);

        env.ledger().set_timestamp(999);
        assert_eq!(client.unlock_time(), 1000);

        env.ledger().set_timestamp(1000);
        client.release();

        assert_eq!(client.balance(), 0);
        assert_eq!(tok.balance(&next), 500);
    }
}
