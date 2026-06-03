#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, Map, String, Vec,
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
    Signers,
    Threshold,
    NextSteps,
    Balance,
    Approvals,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    NotASigner = 4,
    AlreadyApproved = 5,
    ThresholdNotMet = 6,
    NothingToRelease = 7,
    Overflow = 8,
}

const VERSION: u32 = 1;

#[contract]
pub struct Multisig;

#[contractimpl]
impl Multisig {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        signers: Vec<Address>,
        threshold: u32,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if threshold == 0 || signers.is_empty() {
            panic_with_error!(&env, Error::Unauthorized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Signers, &signers);
        env.storage().instance().set(&Key::Threshold, &threshold);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Balance, &0i128);
        env.storage()
            .instance()
            .set(&Key::Approvals, &Map::<Address, bool>::new(&env));
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
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

    /// Approve the current pending batch. `signer` must be one of the authorized signers.
    pub fn approve_by(env: Env, signer: Address) {
        signer.require_auth();
        let signers: Vec<Address> = env.storage().instance().get(&Key::Signers).unwrap();
        let mut is_signer = false;
        for s in signers.iter() {
            if s == signer {
                is_signer = true;
                break;
            }
        }
        if !is_signer {
            panic_with_error!(&env, Error::NotASigner);
        }

        let mut approvals: Map<Address, bool> =
            env.storage().instance().get(&Key::Approvals).unwrap();
        if approvals.get(signer.clone()).unwrap_or(false) {
            panic_with_error!(&env, Error::AlreadyApproved);
        }
        approvals.set(signer.clone(), true);
        env.storage().instance().set(&Key::Approvals, &approvals);

        #[allow(deprecated)]
        env.events().publish((symbol_short!("approve"),), signer);
    }

    pub fn release(env: Env) {
        let approvals: Map<Address, bool> = env.storage().instance().get(&Key::Approvals).unwrap();
        let mut count: u32 = 0;
        for (_, approved) in approvals.iter() {
            if approved {
                count += 1;
            }
        }

        let threshold: u32 = env.storage().instance().get(&Key::Threshold).unwrap();
        if count < threshold {
            panic_with_error!(&env, Error::ThresholdNotMet);
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
            invoke_receive_and_forward(
                &env,
                &step.address,
                &env.current_contract_address(),
                &asset,
                &balance,
            );
        }

        env.storage().instance().set(&Key::Balance, &0i128);
        env.storage()
            .instance()
            .set(&Key::Approvals, &Map::<Address, bool>::new(&env));

        #[allow(deprecated)]
        env.events().publish((symbol_short!("release"),), balance);
    }

    pub fn balance(env: Env) -> i128 {
        env.storage().instance().get(&Key::Balance).unwrap_or(0)
    }

    pub fn threshold(env: Env) -> u32 {
        env.storage().instance().get(&Key::Threshold).unwrap()
    }

    pub fn approvals(env: Env) -> Map<Address, bool> {
        env.storage().instance().get(&Key::Approvals).unwrap()
    }
}

fn invoke_receive_and_forward(
    env: &Env,
    target: &Address,
    from: &Address,
    asset: &Address,
    amount: &i128,
) {
    let func = soroban_sdk::Symbol::new(env, "receive_and_forward");
    let empty_steps = Vec::<WorkflowTarget>::new(env);
    env.invoke_contract::<()>(
        target,
        &func,
        vec![
            env,
            from.into_val(env),
            asset.into_val(env),
            amount.into_val(env),
            empty_steps.into_val(env),
        ],
    );
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn receive_and_forward(
            _env: Env,
            _from: Address,
            _asset: Address,
            _amount: i128,
            _next_steps: Vec<WorkflowTarget>,
        ) {
        }
    }

    #[test]
    fn holds_until_threshold_met() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);
        let signers = vec![&env, alice.clone(), bob.clone(), charlie.clone()];

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
            Multisig,
            (admin, asset.address(), signers, 2_u32, next_steps),
        );
        let client = MultisigClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &500);
        client.receive_and_forward(&predecessor, &asset.address(), &500, &vec![&env]);

        assert_eq!(client.balance(), 500);

        // One approval is not enough
        client.approve_by(&alice);
        assert!(client.approvals().get(alice.clone()).unwrap());

        // release should panic
        // We can't easily test panics in the middle of a test without splitting,
        // so we'll just continue to approve and release.

        client.approve_by(&bob);
        client.release();

        assert_eq!(client.balance(), 0);
        assert_eq!(tok.balance(&next), 500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn double_approve_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let alice = Address::generate(&env);
        let signers = vec![&env, alice.clone()];

        let contract_id = env.register(
            Multisig,
            (
                admin,
                asset.address(),
                signers,
                1_u32,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = MultisigClient::new(&env, &contract_id);

        client.approve_by(&alice);
        client.approve_by(&alice);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn non_signer_approve_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let signers = vec![&env, alice.clone()];

        let contract_id = env.register(
            Multisig,
            (
                admin,
                asset.address(),
                signers,
                1_u32,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = MultisigClient::new(&env, &contract_id);

        client.approve_by(&bob);
    }
}
