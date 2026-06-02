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
    Threshold,
    PathA,
    PathB,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
}

const VERSION: u32 = 1;

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        threshold: i128,
        path_a: Vec<WorkflowTarget>,
        path_b: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Threshold, &threshold);
        env.storage().instance().set(&Key::PathA, &path_a);
        env.storage().instance().set(&Key::PathB, &path_b);
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

        let threshold: i128 = env.storage().instance().get(&Key::Threshold).unwrap();
        let path: Vec<WorkflowTarget> = if amount >= threshold {
            env.storage().instance().get(&Key::PathA).unwrap()
        } else {
            env.storage().instance().get(&Key::PathB).unwrap()
        };

        for step in path.iter() {
            token::Client::new(&env, &asset).transfer(
                &env.current_contract_address(),
                &step.address,
                &amount,
            );
            invoke_receive_and_forward(
                &env,
                &step.address,
                &env.current_contract_address(),
                &asset,
                &amount,
            );
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("route"), amount >= threshold), amount);
    }

    pub fn threshold(env: Env) -> i128 {
        env.storage().instance().get(&Key::Threshold).unwrap()
    }

    pub fn path_a(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::PathA).unwrap()
    }

    pub fn path_b(env: Env) -> Vec<WorkflowTarget> {
        env.storage().instance().get(&Key::PathB).unwrap()
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

    fn make_dummy_target(env: &Env) -> WorkflowTarget {
        let id = env.register(Dummy, ());
        WorkflowTarget {
            address: id,
            data: String::from_str(env, ""),
        }
    }

    #[test]
    fn routes_above_threshold_to_path_a() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &2_000);

        let path_a_target = make_dummy_target(&env);
        let path_b_target = make_dummy_target(&env);
        let path_a = vec![&env, path_a_target.clone()];
        let path_b = vec![&env, path_b_target.clone()];

        let contract_id = env.register(
            Router,
            (admin, asset.address(), 1_000_i128, path_a, path_b),
        );
        let client = RouterClient::new(&env, &contract_id);

        // Pre-fund the router
        tok.transfer(&predecessor, &contract_id, &1_500);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &1_500,
            &vec![&env],
        );

        assert_eq!(tok.balance(&path_a_target.address), 1_500);
        assert_eq!(tok.balance(&path_b_target.address), 0);
    }

    #[test]
    fn routes_below_threshold_to_path_b() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        sac.mint(&predecessor, &2_000);

        let path_a_target = make_dummy_target(&env);
        let path_b_target = make_dummy_target(&env);
        let path_a = vec![&env, path_a_target.clone()];
        let path_b = vec![&env, path_b_target.clone()];

        let contract_id = env.register(
            Router,
            (admin, asset.address(), 1_000_i128, path_a, path_b),
        );
        let client = RouterClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &500);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &500,
            &vec![&env],
        );

        assert_eq!(tok.balance(&path_a_target.address), 0);
        assert_eq!(tok.balance(&path_b_target.address), 500);
    }
}
