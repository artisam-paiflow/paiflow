//! Identical fixture can run against the pre-policy base for resource comparison.
use deposit_trigger::{DepositTrigger, DepositTriggerClient};
use paiflow_splitter::{Recipient, Splitter};
use payer::{Payer, WorkflowTarget};
use soroban_sdk::{
    testutils::{Address as _, MockAuthInvoke},
    vec, xdr, Address, Env, IntoVal, String, TryFromVal, Val, Vec,
};
#[path = "../../../payment-test-token.rs"]
mod payment_test_token;
fn wallet(env: &Env, byte: u8) -> Address {
    Address::try_from_val(
        env,
        &xdr::ScVal::Address(xdr::ScAddress::Account(xdr::AccountId(
            xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256([byte; 32])),
        ))),
    )
    .unwrap()
}
#[test]
#[ignore = "manual legacy resource comparison; no network"]
fn profile_legacy_root_pay_split() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = wallet(&env, 1);
    let payer = wallet(&env, 2);
    let platform = wallet(&env, 3);
    let worker = wallet(&env, 4);
    let root = Address::generate(&env);
    let pay = Address::generate(&env);
    let split = Address::generate(&env);
    let asset = env.register(payment_test_token::WideToken, ());
    payment_test_token::WideTokenClient::new(&env, &asset).mint(&payer, &100_000);
    env.register_at(
        &split,
        Splitter,
        (
            &admin,
            &asset,
            vec![
                &env,
                Recipient {
                    address: platform.clone(),
                    bps: 1_000,
                    amount: 0,
                },
                Recipient {
                    address: worker.clone(),
                    bps: 9_000,
                    amount: 0,
                },
            ],
            0i128,
            &pay,
            Vec::<paiflow_splitter::WorkflowTarget>::new(&env),
        ),
    );
    env.register_at(
        &pay,
        Payer,
        (
            &admin,
            &asset,
            &platform,
            10i128,
            0u32,
            vec![
                &env,
                WorkflowTarget {
                    address: split.clone(),
                    data: String::from_str(&env, ""),
                },
            ],
            &root,
        ),
    );
    env.register_at(
        &root,
        DepositTrigger,
        (
            &admin,
            &asset,
            vec![
                &env,
                deposit_trigger::WorkflowTarget {
                    address: pay.clone(),
                    data: String::from_str(&env, ""),
                },
            ],
        ),
    );
    env.host()
        .set_source_account(xdr::AccountId(xdr::PublicKey::PublicKeyTypeEd25519(
            xdr::Uint256([2; 32]),
        )))
        .unwrap();
    let args: Vec<Val> = (&payer, 111i128).into_val(&env);
    env.set_auths(&[xdr::SorobanAuthorizationEntry {
        credentials: xdr::SorobanCredentials::SourceAccount,
        root_invocation: (&MockAuthInvoke {
            contract: &root,
            fn_name: "deposit",
            args,
            sub_invokes: &[MockAuthInvoke {
                contract: &asset,
                fn_name: "transfer",
                args: (&payer, &root, 111i128).into_val(&env),
                sub_invokes: &[],
            }],
        })
            .into(),
    }]);
    env.cost_estimate().budget().reset_default();
    DepositTriggerClient::new(&env, &root).deposit(&payer, &111);
    std::println!(
        "legacy root/pay/split: {:?}",
        env.cost_estimate().resources()
    );
    assert_eq!(
        payment_test_token::WideTokenClient::new(&env, &asset).balance(&platform),
        20
    );
    assert_eq!(
        payment_test_token::WideTokenClient::new(&env, &asset).balance(&worker),
        91
    );
}
