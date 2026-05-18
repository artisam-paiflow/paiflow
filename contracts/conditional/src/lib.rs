#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String, Vec,
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
    Recipients,
    Asset,
    Amount,
    Condition, // serialized JSON; off-chain validator + on-chain timeout fallback
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
    BpsSumInvalid = 5,
    NoRecipients = 6,
}

const VERSION: u32 = 2;
const TOTAL_BPS: u32 = 10_000;

#[contract]
pub struct Conditional;

#[contractimpl]
impl Conditional {
    pub fn __constructor(
        env: Env,
        admin: Address,
        recipients: Vec<Recipient>,
        asset: Address,
        amount: i128,
        condition: String,
    ) {
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
        env.storage().instance().set(&Key::Recipients, &recipients);
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
        let recipients: Vec<Recipient> = env.storage().instance().get(&Key::Recipients).unwrap();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();

        let client = token::Client::new(&env, &asset);
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

        env.storage().instance().set(&Key::Released, &true);
        env.events()
            .publish((symbol_short!("release"), recipients), amount);
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
    use soroban_sdk::{token, vec, Env, String as SorobanString};

    fn make_recipients(env: &Env, a: &Address, b: &Address) -> Vec<Recipient> {
        vec![
            env,
            Recipient {
                address: a.clone(),
                bps: 6000,
            },
            Recipient {
                address: b.clone(),
                bps: 4000,
            },
        ]
    }

    #[test]
    fn admin_releases_funds_multi() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let condition = SorobanString::from_str(&env, "{\"kind\":\"time_after\"}");

        let contract_id = env.register(
            Conditional,
            (
                admin.clone(),
                make_recipients(&env, &a, &b),
                asset.address(),
                1_000_i128,
                condition,
            ),
        );
        sac.mint(&contract_id, &1_000);
        let client = ConditionalClient::new(&env, &contract_id);
        assert!(!client.status());
        client.release();
        // 1000 split 60/40 = 600, 400
        assert_eq!(tok.balance(&a), 600);
        assert_eq!(tok.balance(&b), 400);
        assert!(client.status());
    }

    #[test]
    #[should_panic]
    fn double_release_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let a = Address::generate(&env);
        let condition = SorobanString::from_str(&env, "{}");
        let single = vec![
            &env,
            Recipient {
                address: a.clone(),
                bps: 10_000,
            },
        ];

        let contract_id = env.register(
            Conditional,
            (
                admin.clone(),
                single,
                asset.address(),
                100_i128,
                condition,
            ),
        );
        sac.mint(&contract_id, &100);
        let client = ConditionalClient::new(&env, &contract_id);
        client.release();
        client.release();
    }
}
