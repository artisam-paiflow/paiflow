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
    Recipient,
    Amount,
    PercentageBps,
    NextSteps,
    ParentNode,
    Version,
    IsCashOut,
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
const TTL_THRESHOLD: u32 = 50_000;
const TTL_EXTEND_TO: u32 = 500_000;

#[contract]
pub struct Payer;

#[contractimpl]
impl Payer {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        asset: Address,
        recipient: Address,
        amount: i128,
        percentage_bps: u32,
        next_steps: Vec<WorkflowTarget>,
        parent: Address,
        is_cash_out: bool,
    ) {
        if env.storage().instance().has(&Key::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        if amount <= 0 && percentage_bps == 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Asset, &asset);
        env.storage().instance().set(&Key::Recipient, &recipient);
        env.storage().instance().set(&Key::Amount, &amount);
        env.storage()
            .instance()
            .set(&Key::PercentageBps, &percentage_bps);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
        env.storage().instance().set(&Key::ParentNode, &parent);
        env.storage().instance().set(&Key::Version, &VERSION);
        env.storage().instance().set(&Key::IsCashOut, &is_cash_out);
    }

    pub fn execute_step(env: Env, asset: Address, amount: i128) {
        bump_ttl(&env);
        let parent: Address = env.storage().instance().get(&Key::ParentNode).unwrap();
        parent.require_auth();

        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let percentage_bps: u32 = env
            .storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0);
        let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
        let payment = if percentage_bps > 0 {
            (amount * i128::from(percentage_bps)) / 10_000
        } else {
            let configured_amount: i128 = env.storage().instance().get(&Key::Amount).unwrap();
            if amount > configured_amount {
                configured_amount
            } else {
                amount
            }
        };

        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &payment,
        );

        let is_cash_out: bool = env
            .storage()
            .instance()
            .get(&Key::IsCashOut)
            .unwrap_or(false);
        if is_cash_out {
            invoke_receive_and_forward(&env, &recipient, &asset, &payment);
        }

        forward_remaining(&env, &asset);

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("pay"), recipient), (asset, payment));
    }

    pub fn cancel(env: Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        let client = token::Client::new(&env, &asset);
        let balance = client.balance(&env.current_contract_address());
        if balance > 0 {
            client.transfer(&env.current_contract_address(), &admin, &balance);
        }
        #[allow(deprecated)]
        env.events().publish((symbol_short!("cancel"),), balance);
    }

    pub fn balance(env: Env) -> i128 {
        let asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        token::Client::new(&env, &asset).balance(&env.current_contract_address())
    }

    pub fn configured_amount(env: Env) -> i128 {
        env.storage().instance().get(&Key::Amount).unwrap()
    }

    pub fn percentage_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0)
    }

    pub fn recipient(env: Env) -> Address {
        env.storage().instance().get(&Key::Recipient).unwrap()
    }

    pub fn is_cash_out(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&Key::IsCashOut)
            .unwrap_or(false)
    }

    pub fn set_next_steps(env: Env, next_steps: Vec<WorkflowTarget>) {
        Self::require_admin(&env);
        env.storage().instance().set(&Key::NextSteps, &next_steps);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&Key::Admin).unwrap();
        admin.require_auth();
    }

    /// Called by receive_and_forward triggers (webhook, oracle, subscription).
    /// Funds are expected to already be held by this contract.
    pub fn receive_and_forward(
        env: Env,
        _from: Address,
        asset: Address,
        amount: i128,
        _next_steps: Vec<WorkflowTarget>,
    ) {
        bump_ttl(&env);
        let stored_asset: Address = env.storage().instance().get(&Key::Asset).unwrap();
        if asset != stored_asset {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        let percentage_bps: u32 = env
            .storage()
            .instance()
            .get(&Key::PercentageBps)
            .unwrap_or(0);
        let recipient: Address = env.storage().instance().get(&Key::Recipient).unwrap();
        let payment = if percentage_bps > 0 {
            (amount * i128::from(percentage_bps)) / 10_000
        } else {
            let configured_amount: i128 = env.storage().instance().get(&Key::Amount).unwrap();
            if amount > configured_amount {
                configured_amount
            } else {
                amount
            }
        };

        token::Client::new(&env, &asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &payment,
        );

        let is_cash_out: bool = env
            .storage()
            .instance()
            .get(&Key::IsCashOut)
            .unwrap_or(false);
        if is_cash_out {
            invoke_receive_and_forward(&env, &recipient, &asset, &payment);
        }

        forward_remaining(&env, &asset);

        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("pay"), recipient), (asset, payment));
    }
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn forward_remaining(env: &Env, asset: &Address) {
    let next_steps: Vec<WorkflowTarget> = env
        .storage()
        .instance()
        .get(&Key::NextSteps)
        .unwrap_or_else(|| Vec::new(env));
    let client = token::Client::new(env, asset);
    let balance = client.balance(&env.current_contract_address());

    let has_steps = !next_steps.is_empty();
    let forward_amount = if has_steps && balance > 0 { balance } else { 0 };

    if forward_amount > 0 {
        if let Some(step) = next_steps.first() {
            client.transfer(
                &env.current_contract_address(),
                &step.address,
                &forward_amount,
            );

            #[allow(deprecated)]
            env.events().publish(
                (
                    symbol_short!("forward"),
                    asset.clone(),
                    step.address.clone(),
                ),
                forward_amount,
            );

            invoke_execute_step(env, &step.address, asset, &forward_amount);
        }
    }
}

fn invoke_execute_step(env: &Env, target: &Address, asset: &Address, amount: &i128) {
    let func = soroban_sdk::Symbol::new(env, "execute_step");
    env.invoke_contract::<()>(
        target,
        &func,
        vec![env, asset.into_val(env), amount.into_val(env)],
    );
}

fn invoke_receive_and_forward(env: &Env, target: &Address, asset: &Address, amount: &i128) {
    let func = soroban_sdk::Symbol::new(env, "receive_and_forward");
    let empty_steps = Vec::<WorkflowTarget>::new(env);
    let source = env.current_contract_address();
    env.invoke_contract::<()>(
        target,
        &func,
        vec![
            env,
            source.into_val(env),
            asset.into_val(env),
            amount.into_val(env),
            empty_steps.into_val(env),
        ],
    );
}

#[cfg(test)]
mod test {
    use super::*;
    use paiflow_splitter::{Recipient as SplitterRecipient, Splitter, SplitterClient};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, token, vec, Env};

    #[contract]
    pub struct Dummy;

    #[contractimpl]
    impl Dummy {
        pub fn __constructor(_env: Env) {}
        pub fn execute_step(_env: Env, _asset: Address, _amount: i128) {}
    }

    #[contract]
    pub struct MockCashOut;

    #[contractimpl]
    impl MockCashOut {
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
    fn pays_configured_amount_when_incoming_exceeds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
        assert_eq!(client.configured_amount(), 100);
    }

    #[test]
    fn pays_partial_when_incoming_less_than_configured() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &50);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &50);
        client.execute_step(&asset.address(), &50);

        assert_eq!(tok.balance(&recipient), 50);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn cancel_returns_balance_to_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&contract_id), 900);
        client.cancel();
        assert_eq!(tok.balance(&admin), 900);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn pays_percentage_of_incoming_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 500);
        assert_eq!(tok.balance(&contract_id), 500);
        assert_eq!(client.percentage_bps(), 5_000);
    }

    #[test]
    fn pays_full_amount_via_10000_bps() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                10_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 1_000);
        assert_eq!(tok.balance(&contract_id), 0);
    }

    #[test]
    fn percentage_zero_falls_back_to_fixed_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }

    #[test]
    fn receive_and_forward_pays_configured_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }

    #[test]
    fn receive_and_forward_pays_percentage() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 500);
        assert_eq!(tok.balance(&contract_id), 500);
        assert_eq!(client.percentage_bps(), 5_000);
    }

    #[test]
    fn receive_and_forward_forwards_to_next_steps() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);
        let next = env.register(Dummy, ());
        let next_steps = vec![
            &env,
            WorkflowTarget {
                address: next.clone(),
                data: String::from_str(&env, ""),
            },
        ];

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient.clone(),
                100_i128,
                0_u32,
                next_steps,
                parent.clone(),
                false,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.receive_and_forward(
            &predecessor,
            &asset.address(),
            &1_000,
            &Vec::<WorkflowTarget>::new(&env),
        );

        assert_eq!(tok.balance(&recipient), 100);
        assert_eq!(tok.balance(&contract_id), 0);
        assert_eq!(tok.balance(&next), 900);
    }

    #[test]
    fn fixed_payer_forwards_leftover_to_payer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let payer1_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient1.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let payer1_client = PayerClient::new(&env, &payer1_id);

        let payer2_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient2.clone(),
                50_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                payer1_id.clone(),
                false,
            ),
        );
        let payer2_client = PayerClient::new(&env, &payer2_id);

        payer1_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: payer2_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&predecessor, &payer1_id, &1_000);
        payer1_client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient1), 100);
        assert_eq!(tok.balance(&recipient2), 50);
        assert_eq!(tok.balance(&payer1_id), 0);
        assert_eq!(tok.balance(&payer2_id), 850);
        assert_eq!(payer1_client.configured_amount(), 100);
        assert_eq!(payer2_client.configured_amount(), 50);
    }

    #[test]
    fn fixed_payer_forwards_leftover_to_splitter() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let payer_recipient = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        sac.mint(&predecessor, &10_000_000);

        let parent = Address::generate(&env);

        let payer_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                payer_recipient.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let payer_client = PayerClient::new(&env, &payer_id);

        let splitter_id = env.register(
            Splitter,
            (
                admin.clone(),
                asset.address(),
                vec![
                    &env,
                    SplitterRecipient {
                        address: a.clone(),
                        bps: 0,
                        amount: 3_000_000,
                    },
                    SplitterRecipient {
                        address: b.clone(),
                        bps: 0,
                        amount: 2_000_000,
                    },
                ],
                0_i128,
                payer_id.clone(),
                Vec::<WorkflowTarget>::new(&env),
            ),
        );
        let splitter_client = SplitterClient::new(&env, &splitter_id);

        payer_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: splitter_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&predecessor, &payer_id, &10_000_000);
        payer_client.execute_step(&asset.address(), &10_000_000);

        assert_eq!(tok.balance(&payer_recipient), 100);
        assert_eq!(tok.balance(&a), 3_000_000);
        assert_eq!(tok.balance(&b), 2_000_000);
        assert_eq!(tok.balance(&payer_id), 0);
        assert_eq!(tok.balance(&splitter_id), 4_999_900);
        assert_eq!(splitter_client.accumulated_balance(), 4_999_900);
    }

    #[test]
    fn percentage_payer_forwards_leftover_to_payer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let recipient1 = Address::generate(&env);
        let recipient2 = Address::generate(&env);
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let payer1_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient1.clone(),
                0_i128,
                5_000_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                false,
            ),
        );
        let payer1_client = PayerClient::new(&env, &payer1_id);

        let payer2_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                recipient2.clone(),
                50_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                payer1_id.clone(),
                false,
            ),
        );
        let payer2_client = PayerClient::new(&env, &payer2_id);

        payer1_client.set_next_steps(&vec![
            &env,
            WorkflowTarget {
                address: payer2_id.clone(),
                data: String::from_str(&env, ""),
            },
        ]);

        tok.transfer(&predecessor, &payer1_id, &1_000);
        payer1_client.execute_step(&asset.address(), &1_000);

        assert_eq!(tok.balance(&recipient1), 500);
        assert_eq!(tok.balance(&recipient2), 50);
        assert_eq!(tok.balance(&payer1_id), 0);
        assert_eq!(tok.balance(&payer2_id), 450);
        assert_eq!(payer1_client.percentage_bps(), 5_000);
        assert_eq!(payer2_client.configured_amount(), 50);
    }

    #[test]
    fn cash_out_recipient_receives_payment_via_receive_and_forward() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = token::StellarAssetClient::new(&env, &asset.address());
        let tok = token::TokenClient::new(&env, &asset.address());

        let predecessor = Address::generate(&env);
        let cash_out_contract = env.register(MockCashOut, ());
        sac.mint(&predecessor, &1_000);

        let parent = Address::generate(&env);

        let contract_id = env.register(
            Payer,
            (
                admin.clone(),
                asset.address(),
                cash_out_contract.clone(),
                100_i128,
                0_u32,
                Vec::<WorkflowTarget>::new(&env),
                parent.clone(),
                true,
            ),
        );
        let client = PayerClient::new(&env, &contract_id);
        assert!(client.is_cash_out());

        tok.transfer(&predecessor, &contract_id, &1_000);
        client.execute_step(&asset.address(), &1_000);

        // The cash-out contract holds the payment (its mock receive_and_forward
        // keeps the funds rather than sinking them to a treasury).
        assert_eq!(tok.balance(&cash_out_contract), 100);
        assert_eq!(tok.balance(&contract_id), 900);
    }
}
