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
    AssetIn,
    AssetOut,
    RateBps,
    NextSteps,
    Version,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    InsufficientOutput = 4,
    BadRate = 5,
}

const VERSION: u32 = 1;
const TOTAL_BPS: u32 = 10_000;

#[contract]
pub struct Swapper;

#[contractimpl]
impl Swapper {
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset_in: Address,
        asset_out: Address,
        rate_bps: u32,
        next_steps: Vec<WorkflowTarget>,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if rate_bps == 0 || rate_bps > TOTAL_BPS {
            panic_with_error!(&env, Error::BadRate);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::AssetIn, &asset_in);
        env.storage().instance().set(&Key::AssetOut, &asset_out);
        env.storage().instance().set(&Key::RateBps, &rate_bps);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::Version, &VERSION);
    }

    /// Admin tops up the contract with asset_out so it can fulfill swaps.
    pub fn top_up(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let asset_out: Address = env.storage().instance().get(&Key::AssetOut).unwrap();
        token::Client::new(&env, &asset_out).transfer(
            &from,
            env.current_contract_address(),
            &amount,
        );

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("topup"), from), amount);
    }

    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        let asset_in: Address = env.storage().instance().get(&Key::AssetIn).unwrap();
        if asset != asset_in {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let asset_out: Address = env.storage().instance().get(&Key::AssetOut).unwrap();
        let rate_bps: u32 = env.storage().instance().get(&Key::RateBps).unwrap();
        let next_steps: Vec<WorkflowTarget> =
            env.storage().instance().get(&Key::NextSteps).unwrap();

        // amount_out = amount * rate_bps / 10_000
        let amount_out = amount
            .checked_mul(rate_bps as i128)
            .and_then(|v| v.checked_div(TOTAL_BPS as i128))
            .unwrap_or(0);
        if amount_out <= 0 {
            panic_with_error!(&env, Error::InsufficientOutput);
        }

        // In a real DEX integration this would call the AMM.
        // Here we simulate: asset_in is absorbed by the contract (or sent to a sink),
        // and asset_out is forwarded from the contract's balance.
        let out_client = token::Client::new(&env, &asset_out);
        let contract_balance = out_client.balance(&env.current_contract_address());
        if contract_balance < amount_out {
            panic_with_error!(&env, Error::InsufficientOutput);
        }

        for step in next_steps.iter() {
            out_client.transfer(
                &env.current_contract_address(),
                &step.address,
                &amount_out,
            );
            invoke_receive_and_forward(
                &env,
                &step.address,
                &env.current_contract_address(),
                &asset_out,
                &amount_out,
            );
        }

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("swap"), asset, asset_out), (amount, amount_out));
    }

    pub fn asset_in(env: Env) -> Address {
        env.storage().instance().get(&Key::AssetIn).unwrap()
    }

    pub fn asset_out(env: Env) -> Address {
        env.storage().instance().get(&Key::AssetOut).unwrap()
    }

    pub fn rate_bps(env: Env) -> u32 {
        env.storage().instance().get(&Key::RateBps).unwrap()
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
    fn swaps_at_fixed_rate() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset_in = env.register_stellar_asset_contract_v2(admin.clone());
        let asset_out = env.register_stellar_asset_contract_v2(admin.clone());
        let sac_in = token::StellarAssetClient::new(&env, &asset_in.address());
        let sac_out = token::StellarAssetClient::new(&env, &asset_out.address());
        let tok_out = token::TokenClient::new(&env, &asset_out.address());

        let predecessor = Address::generate(&env);
        sac_in.mint(&predecessor, &1_000);
        // Contract needs asset_out to fulfill the swap
        sac_out.mint(&admin, &950);

        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Swapper,
            (
                admin.clone(),
                asset_in.address(),
                asset_out.address(),
                9_500_u32, // 0.95 rate
                next_steps,
            ),
        );
        let client = SwapperClient::new(&env, &contract_id);

        // Top up contract with asset_out
        client.top_up(&admin, &950);

        // Predecessor sends asset_in to contract
        let tok_in = token::TokenClient::new(&env, &asset_in.address());
        tok_in.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &predecessor,
            &asset_in.address(),
            &1_000,
            &vec![&env],
        );

        // 1000 * 9500 / 10000 = 950
        assert_eq!(tok_out.balance(&next), 950);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn insufficient_output_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset_in = env.register_stellar_asset_contract_v2(admin.clone());
        let asset_out = env.register_stellar_asset_contract_v2(admin.clone());
        let sac_in = token::StellarAssetClient::new(&env, &asset_in.address());

        let predecessor = Address::generate(&env);
        sac_in.mint(&predecessor, &1_000);

        let contract_id = env.register(
            Swapper,
            (
                admin,
                asset_in.address(),
                asset_out.address(),
                9_500_u32,
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let client = SwapperClient::new(&env, &contract_id);

        let tok_in = token::TokenClient::new(&env, &asset_in.address());
        tok_in.transfer(&predecessor, &contract_id, &1_000);
        // Contract has no asset_out, so it should panic
        client.receive_and_forward(
            &predecessor,
            &asset_in.address(),
            &1_000,
            &vec![&env],
        );
    }
}
