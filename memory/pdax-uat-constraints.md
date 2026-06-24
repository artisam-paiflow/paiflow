---
name: pdax-uat-constraints
description: PDAX UAT asset/network/bank/payout constraints for APAC Stellar Hackathon integration
metadata:
  type: reference
---

PDAX UAT environment constraints for the APAC Stellar Hackathon:

## Supported assets

- `XLM` — Stellar Lumens
- `USDCXLM` — USD Coin (Stellar Network)

## Supported network

- `XLM_USDC_T_CEKS` — Stellar Testnet

## Supported payment / payout channels

- `InstaPay`

## Supported banks for withdrawal

- `BASECPH` — Security Bank Corporation
- `BACTBPH` — CTBC Bank Philippines Corporation

## Application

Default env vars in `lib/env.ts` and `lib/offramp/provider.ts` already match these constraints:

- `OFFRAMP_ASSET_CODE=USDCXLM`
- `OFFRAMP_NETWORK=XLM_USDC_T_CEKS`
- `OFFRAMP_CHANNEL=InstaPay`

For hackathon testing, employee bank details should use bank codes `BASECPH` or `BACTBPH` only.

Related: [[pdax-institution-api]]
