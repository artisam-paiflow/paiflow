//! Test-only token for the full i128 domain; classic assets have narrower limits.
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone)]
enum Key {
    Balance(Address),
}

#[contract]
pub struct WideToken;

#[contractimpl]
impl WideToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        assert!(amount >= 0);
        let balance = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&Key::Balance(to), &balance.checked_add(amount).unwrap());
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&Key::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount >= 0);
        let balance = Self::balance(env.clone(), from.clone());
        assert!(balance >= amount);
        env.storage().persistent().set(
            &Key::Balance(from.clone()),
            &balance.checked_sub(amount).unwrap(),
        );
        let receiving = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(
            &Key::Balance(to.clone()),
            &receiving.checked_add(amount).unwrap(),
        );
        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("transfer"), from, to), amount);
    }
}
