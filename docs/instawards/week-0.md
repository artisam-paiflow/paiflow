# Week 0 — before the sprint

**Window:** 1–6 September 2026 · **Status:** preparation, not counted toward the sprint

## Summary

The approved Statement of Work was committed to the repository and the documentation was
audited and corrected against the code. The Deliverable 1 plan was then validated by building
it end to end in a throwaway copy of the repository, which found five requirements the SOW did
not describe and eleven smaller corrections — all folded into the plan before development
started. **None of the on-chain activity from that trial counts toward the success metrics**;
the sprint repeats every deployment from the real application.

## Changelog

| Date       | Change                                                                    | Issues | Commit                                                                                                  |
| ---------- | ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-06 | fix: guard the WalletConnect project id instead of asserting it           | #383   | [`aca26db`](https://github.com/artisam-paiflow/paiflow/commit/aca26db2c87effac87667212784f0cac22f8996f) |
| 2026-09-06 | docs: stop calling the contract templates pre-audited                     | #382   | [`1039189`](https://github.com/artisam-paiflow/paiflow/commit/103918959a520d5ecb2d518f6fe14bb0bf7acddb) |
| 2026-09-06 | docs: approved Instawards Phase 1 SOW and the swapper design record       | #393   | [`40d4274`](https://github.com/artisam-paiflow/paiflow/commit/40d42741a09c6351afc405eab3f1a7194fbd8fdd) |
| 2026-09-05 | docs: audit and repair the documentation, and the code it was wrong about | #384   | [`0edb9a7`](https://github.com/artisam-paiflow/paiflow/commit/0edb9a72d9e4c5c2c25ca4c53fbdd5502e041bf7) |

## What the validation trial found

The SOW's description of Deliverable 1 was accurate about the problem and incomplete about the
solution. Five things decide whether a swap actually succeeds, and none were in the original
scope:

1. **Contract-as-payer authorization.** The Soroswap router transfers the input token _from
   the caller_ one call frame deeper than the caller's own authorization reaches. The swapper
   has to pre-authorize that transfer, naming the exact pool address and amount. This was
   settled with a standalone test crate before any production code was written.
2. **The router address changes.** Soroswap has redeployed its testnet router four times. The
   address is therefore read from configuration, not hardcoded and not typed by the user, so a
   future reset is a settings change rather than a code change.
3. **Forwarding had to be rewritten** to send the swap output to a single downstream step.
4. **The swap entry point had no authentication**, so anyone could have triggered a swap of
   whatever the contract held.
5. **A missing entry point** meant a swapper placed after a splitter or timelock would fail.

Three items the SOW lists turned out to be smaller than they read: the Swapper configuration
panel, the event decoding, and the live event feed already existed and needed changing rather
than building.

## Trial run result — not counted

Deliverable 1 was implemented in full in an isolated copy of the repository and proven on
testnet on 6 September:

- A flow built as **XLM in → swap → pay USDC out** deployed through the factory, and a 10 XLM
  deposit was swapped on the real Soroswap router and paid out as USDC. The recipient's
  balance moved from 0 to **1.0562836 USDC**.
- The slippage protection behaved as designed: at a 0% setting the swap correctly reverted on
  the pool fee alone, and the failure surfaced as a plain-English message rather than a raw
  error code.
- All checks green: Rust formatting, linting and tests; TypeScript typecheck and lint; 538 unit
  tests; production build; and browser tests.

{% hint style="warning" %}
That trial used throwaway keys and its own factory contract, and it was not run from the public
application. Under SOW §6.3 it counts for **nothing** — no flows, no executions, no wallets. The
sprint redeploys and re-triggers everything from [paiflow.xyz](https://paiflow.xyz), and only
those transactions appear in the [metrics](metrics.md).
{% endhint %}

## Ready for week 1

The plan is corrected, the work is broken into five tracked issues, and the pool that the
swapper will trade against has been confirmed live. Development starts Monday 7 September.
