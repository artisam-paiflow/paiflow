use super::*;
extern crate std;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, Events as _, Ledger as _},
    token, vec, IntoVal, Symbol,
};

struct Fixture {
    env: Env,
    id: Address,
    asset: Address,
    admin: Address,
    first: Address,
    last: Address,
}

impl Fixture {
    fn new(start: u64, end: u64, interval: u64, amount: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let first = Address::generate(&env);
        let last = Address::generate(&env);
        let id = env.register(
            Streamer,
            (
                admin.clone(),
                vec![
                    &env,
                    Recipient {
                        address: first.clone(),
                        bps: 6_000,
                        amount: 0,
                    },
                    Recipient {
                        address: last.clone(),
                        bps: 4_000,
                        amount: 0,
                    },
                ],
                asset.clone(),
                amount,
                interval,
                start,
                end,
                Address::generate(&env),
                true,
                true,
            ),
        );
        Self {
            env,
            id,
            asset,
            admin,
            first,
            last,
        }
    }
    fn client(&self) -> StreamerClient<'_> {
        StreamerClient::new(&self.env, &self.id)
    }
    fn fund(&self, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.asset).mint(&self.id, &amount);
    }
    fn balance(&self, address: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.asset).balance(address)
    }
    fn offset(&self) -> u64 {
        self.env.as_contract(&self.id, || {
            self.env
                .storage()
                .instance()
                .get(&Key::PauseOffset)
                .unwrap()
        })
    }
    fn assert_admin_auth(&self, method: &str) {
        let auths = self.env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, self.admin);
        assert_eq!(
            auths[0].1.function,
            AuthorizedFunction::Contract((
                self.id.clone(),
                Symbol::new(&self.env, method),
                ().into_val(&self.env),
            ))
        );
        assert!(auths[0].1.sub_invocations.is_empty());
    }
}

#[test]
fn historical_claim_pause_resume_preserves_earned_funds_across_end() {
    let start = 1_792_393_675;
    let f = Fixture::new(start, start + 600, 60, 1_000_000);
    let client = f.client();
    f.fund(11_000_000);
    f.env.ledger().set_timestamp(start + 540);
    assert_eq!(client.claim(), 9_000_000);
    f.env.ledger().set_timestamp(start + 555);
    client.pause();
    f.env.ledger().set_timestamp(start + 1140);
    assert_eq!(client.available(), 0);
    client.unpause();
    // Previously offset=585 and available=-9_000_000. Only 45 seconds overlap.
    assert_eq!(f.offset(), 45);
    assert_eq!(client.claimed(), 9_000_000);
    assert_eq!(client.available(), 0);
    assert_eq!(f.balance(&f.first), 5_400_000);
    assert_eq!(f.balance(&f.last), 3_600_000);
    assert_eq!(f.balance(&f.id), 2_000_000);
    assert_eq!(client.try_claim(), Err(Ok(Error::NothingToClaim.into())));
    client.pause();
    assert_eq!(client.retrieve_unvested(), 2_000_000);
    assert_eq!(f.balance(&f.admin), 2_000_000);
    assert_eq!(f.balance(&f.id), 0);
}

#[test]
fn pause_overlap_respects_both_window_boundaries_and_exact_timestamps() {
    for (pause_at, resume_at, offset, vested) in [
        (800, 900, 0, 1_000),
        (900, 1_100, 100, 800),
        (1_100, 1_200, 100, 800),
        (1_500, 1_700, 100, 800),
        (1_700, 1_800, 0, 1_000),
        (900, 1_700, 600, 0),
        (1_000, 1_000, 0, 1_000),
        (1_600, 1_600, 0, 1_000),
        (1_000, 1_600, 600, 0),
    ] {
        let f = Fixture::new(1_000, 1_600, 60, 100);
        let client = f.client();
        f.env.ledger().set_timestamp(pause_at);
        client.pause();
        let earned = client.available();
        f.env.ledger().set_timestamp(resume_at);
        assert_eq!(client.available(), earned);
        client.unpause();
        assert_eq!(client.available(), earned);
        assert_eq!(f.offset(), offset);
        f.env.ledger().set_timestamp(resume_at.max(1_600));
        assert_eq!(client.available(), vested);
    }
}

#[test]
fn pause_at_timestamp_zero_freezes_vesting_and_counts_window_overlap() {
    let f = Fixture::new(0, 600, 60, 100);
    let client = f.client();
    client.pause();
    f.env.ledger().set_timestamp(60);
    assert_eq!(client.available(), 0);
    client.unpause();
    assert_eq!(client.available(), 0);
    assert_eq!(f.offset(), 60);
    f.env.ledger().set_timestamp(600);
    assert_eq!(client.available(), 900);
}

#[test]
fn duplicate_controls_keep_freeze_point_and_admin_authorization() {
    let f = Fixture::new(1_000, 1_600, 60, 100);
    let client = f.client();
    f.env.ledger().set_timestamp(1_100);
    client.pause();
    f.assert_admin_auth("pause");
    f.env.ledger().set_timestamp(1_300);
    client.pause();
    f.assert_admin_auth("pause");
    assert!(f.env.events().all().events().is_empty());
    assert_eq!(client.paused_at(), 1_100);
    assert_eq!(client.available(), 100);
    client.unpause();
    f.assert_admin_auth("unpause");
    assert_eq!(f.offset(), 200);
    f.env.ledger().set_timestamp(1_400);
    client.unpause();
    f.assert_admin_auth("unpause");
    assert!(f.env.events().all().events().is_empty());
    assert_eq!(f.offset(), 200);
    assert_eq!(client.available(), 300);
}

#[test]
fn duplicate_controls_do_not_bypass_pause_permission() {
    let f = Fixture::new(1_000, 1_600, 60, 100);
    f.env.as_contract(&f.id, || {
        f.env.storage().instance().set(&Key::PauseAllowed, &false)
    });
    assert_eq!(
        f.client().try_unpause(),
        Err(Ok(Error::PauseNotAllowed.into()))
    );
    f.env.as_contract(&f.id, || {
        f.env.storage().instance().set(&Key::Paused, &true)
    });
    assert_eq!(
        f.client().try_pause(),
        Err(Ok(Error::PauseNotAllowed.into()))
    );
}

#[test]
fn partial_active_intervals_carry_across_pauses() {
    let f = Fixture::new(1_000, 1_600, 60, 100);
    let client = f.client();
    f.env.ledger().set_timestamp(1_025);
    client.pause();
    f.env.ledger().set_timestamp(1_055);
    client.unpause();
    f.env.ledger().set_timestamp(1_089);
    assert_eq!(client.available(), 0);
    f.env.ledger().set_timestamp(1_090);
    assert_eq!(client.available(), 100);
}

#[test]
fn repeated_pauses_claims_and_rounding_match_active_time_model_and_conserve_funds() {
    let f = Fixture::new(100, 700, 60, 7);
    let client = f.client();
    f.fund(1_000);
    let mut active_seconds = 0;
    let mut paused = false;
    let mut previous_vested = 0;
    for now in 0..=950 {
        f.env.ledger().set_timestamp(now);
        if now > 100 && now <= 700 && !paused {
            active_seconds += 1;
        }
        match now {
            120 | 140 | 200 | 650 | 850 => {
                client.pause();
                paused = true;
            }
            175 | 180 | 260 | 800 | 900 => {
                client.unpause();
                paused = false;
            }
            _ => {}
        }
        let vested = client.available() + client.claimed();
        assert_eq!(vested, (active_seconds / 60) * 7);
        assert!(vested >= previous_vested);
        previous_vested = vested;
        if now % 137 == 0 && client.available() > 0 {
            assert!(client.claim() > 0);
            // Payout claims remain public; no user authority is consumed.
            assert!(f.env.auths().is_empty());
        }
        assert_eq!(f.balance(&f.first) + f.balance(&f.last), client.claimed());
        assert_eq!(
            f.balance(&f.id) + f.balance(&f.first) + f.balance(&f.last),
            1_000
        );
    }
    assert_eq!(client.available() + client.claimed(), 49);
}

#[test]
fn retrieval_keeps_earned_unpaid_funds_and_exact_recipient_rounding() {
    let f = Fixture::new(1_000, 1_600, 60, 7);
    let client = f.client();
    f.fund(100);
    f.env.ledger().set_timestamp(1_060);
    client.pause();
    assert_eq!(client.available(), 7);
    assert_eq!(client.retrieve_unvested(), 93);
    f.assert_admin_auth("retrieve_unvested");
    assert_eq!(f.balance(&f.admin), 93);
    assert_eq!(f.balance(&f.id), 7);
    assert_eq!(client.claim(), 7);
    assert_eq!(f.balance(&f.first), 4);
    assert_eq!(f.balance(&f.last), 3);
    assert_eq!(f.balance(&f.id), 0);
    assert_eq!(
        client.try_retrieve_unvested(),
        Err(Ok(Error::NothingToRetrieve.into()))
    );
}

#[test]
fn underfunded_claim_rolls_back_and_retrieval_cannot_take_owed_funds() {
    let f = Fixture::new(1_000, 1_600, 60, 100);
    let client = f.client();
    f.fund(100);
    f.env.ledger().set_timestamp(1_300);
    assert_eq!(client.available(), 500);
    assert!(client.try_claim().is_err());
    assert_eq!(client.claimed(), 0);
    assert_eq!(f.balance(&f.first), 0);
    assert_eq!(f.balance(&f.last), 0);
    client.pause();
    assert_eq!(
        client.try_retrieve_unvested(),
        Err(Ok(Error::NothingToRetrieve.into()))
    );
    assert_eq!(f.balance(&f.id), 100);
    f.fund(400);
    assert_eq!(client.claim(), 500);
    assert_eq!(client.claimed(), 500);
    assert_eq!(f.balance(&f.first), 300);
    assert_eq!(f.balance(&f.last), 200);
    assert_eq!(f.balance(&f.id), 0);
}

#[test]
fn corrupted_accounting_fails_reads_claims_retrieval_and_resume_without_moving_funds() {
    for (offset, claimed, now) in [
        (585u64, 9_000_000i128, 2_000u64), // Reported invalid state, with an equivalent 600s window.
        (601, 0, 1_600),
        (0, -1, 1_600),
        (0, 10_000_001, 1_600),
        (1, 0, 900),
        (0, 1, 900),
    ] {
        let f = Fixture::new(1_000, 1_600, 60, 1_000_000);
        let client = f.client();
        f.fund(2_000_000);
        f.env.as_contract(&f.id, || {
            f.env.storage().instance().set(&Key::PauseOffset, &offset);
            f.env.storage().instance().set(&Key::Claimed, &claimed);
        });
        f.env.ledger().set_timestamp(now);
        assert_eq!(
            client.try_available(),
            Err(Ok(Error::InvalidAccountingState.into()))
        );
        assert_eq!(
            client.try_claim(),
            Err(Ok(Error::InvalidAccountingState.into()))
        );
        client.pause();
        assert_eq!(
            client.try_retrieve_unvested(),
            Err(Ok(Error::InvalidAccountingState.into()))
        );
        assert_eq!(f.balance(&f.id), 2_000_000);
        assert_eq!(f.balance(&f.admin), 0);
        assert_eq!(f.balance(&f.first), 0);
        assert_eq!(f.balance(&f.last), 0);
        assert_eq!(client.claimed(), claimed);
        assert_eq!(
            client.try_unpause(),
            Err(Ok(Error::InvalidAccountingState.into()))
        );
        assert!(client.is_paused());
        assert_eq!(client.paused_at(), now);
        assert_eq!(f.offset(), offset);
    }
}

#[test]
fn impossible_pause_time_and_offset_addition_fail_explicitly() {
    let f = Fixture::new(1_000, 1_600, 60, 100);
    let client = f.client();
    f.env.ledger().set_timestamp(1_100);
    client.pause();
    f.env.ledger().set_timestamp(1_000);
    assert_eq!(
        client.try_available(),
        Err(Ok(Error::InvalidAccountingState.into()))
    );
    assert_eq!(
        client.try_unpause(),
        Err(Ok(Error::InvalidAccountingState.into()))
    );
    f.env.ledger().set_timestamp(1_200);
    f.env.as_contract(&f.id, || {
        f.env.storage().instance().set(&Key::PauseOffset, &u64::MAX)
    });
    assert_eq!(
        client.try_unpause(),
        Err(Ok(Error::ArithmeticOverflow.into()))
    );
    assert!(client.is_paused());
    assert_eq!(f.offset(), u64::MAX);
}

#[test]
fn exact_reported_storage_is_rejected_before_any_retrieval_token_lookup() {
    let start = 1_792_393_675;
    let f = Fixture::new(start, start + 600, 60, 1_000_000);
    let client = f.client();
    f.env.as_contract(&f.id, || {
        f.env.storage().instance().set(&Key::PauseOffset, &585u64);
        f.env
            .storage()
            .instance()
            .set(&Key::Claimed, &9_000_000i128);
        // There is no contract here. If retrieval tries even a token balance
        // read before checking accounting, it fails with a different host error.
        f.env
            .storage()
            .instance()
            .set(&Key::Asset, &Address::generate(&f.env));
        assert_eq!(
            f.env.storage().instance().get::<_, u32>(&Key::Version),
            Some(6)
        );
    });
    f.env.ledger().set_timestamp(start + 1_140);
    assert_eq!(
        client.try_available(),
        Err(Ok(Error::InvalidAccountingState.into()))
    );
    client.pause();
    assert_eq!(
        client.try_retrieve_unvested(),
        Err(Ok(Error::InvalidAccountingState.into()))
    );
    assert!(f.env.events().all().events().is_empty());
    assert_eq!(client.claimed(), 9_000_000);
    assert_eq!(f.offset(), 585);
}
