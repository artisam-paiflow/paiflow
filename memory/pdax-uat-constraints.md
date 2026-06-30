---
name: pdax-uat-constraints
description: PDAX UAT asset/network/bank/payout constraints for fiat off-ramp
metadata:
  type: reference
---

PDAX UAT environment constraints for the APAC Stellar Hackathon:

## Supported assets

- `XLM` — Stellar Lumens
- `USDC` — USD Coin (the PDAX UAT institutional wallet asset, **not** Stellar USDC / USDCXLM)

> `USDCXLM` is **disabled** in PDAX UAT. The on-chain treasury holds Stellar
> USDC (USDCXLM), but it cannot be deposited into PDAX UAT. For hackathon/UAT
> demos the PDAX institutional balance must be **pre-funded with USDC** off-chain.
> The on-chain sink to the treasury is kept as the bookkeeping proof of the
> intended off-ramp amount.

## Supported network

- `XLM_USDC_T_CEKS` — Stellar Testnet

## Supported payment / payout channels

- `InstaPay`

## Supported banks for withdrawal

- `BASECPH` — Security Bank Corporation
- `BACTBPH` — CTBC Bank Philippines Corporation

## UAT test beneficiary bank accounts

Use these valid sandbox account numbers, or the bank rail rejects with ISO 20022
reason `AC01` (incorrect account number) — the withdraw request is accepted but
the bank bounces it:

- `BASECPH` → `0000042001461`
- `BACTBPH` → `001700062270`

## Application

Default env vars in `lib/env.ts` and `lib/offramp/provider.ts` should match
these constraints:

- `OFFRAMP_ASSET_CODE=USDC`
- `OFFRAMP_NETWORK=XLM_USDC_T_CEKS`
- `OFFRAMP_CHANNEL=InstaPay`

For hackathon testing, employee bank details should use bank codes `BASECPH` or
`BACTBPH` only, and the PDAX institutional account must be pre-funded with USDC
before any off-ramp jobs run.

Related: [[pdax-institution-api]]
