# Metrics

The success metrics from the [Statement of Work](../instawards-phase-1-sow.md), section 6.3,
with the running totals and how each one is counted.

**Counting rules.** Only activity produced from the public application at
[paiflow.xyz](https://paiflow.xyz) on Stellar testnet, during the sprint, counts. Anything
deployed or triggered from a development environment is excluded. The public application is the
project's staging service; there is no other public environment.

| Metric                                   | Target | Current | Met | Source                                                                                                     |
| ---------------------------------------- | ------ | ------- | --- | ---------------------------------------------------------------------------------------------------------- |
| Unique flows deployed                    | ≥ 5    | 26      | Yes | Confirmed deployments since 7 September                                                                    |
| Contract executions / events published   | ≥ 60   | 61      | Yes | Contract events the app recorded for those deployments                                                     |
| Unique swapper flows executed on testnet | ≥ 5    | 16      | Yes | Deployments whose swapper emitted a `swap` event                                                           |
| Distinct wallets deploying               | ≥ 6    | 7       | Yes | Distinct signing wallets across confirmed deployments                                                      |
| Contract WASM uploaded                   | ≥ 1    | 1       | Yes | The swapper binary `e9482ff0…b23d1a` on testnet                                                            |
| Public testnet URL live and accessible   | Yes    | Yes     | Yes | [paiflow.xyz](https://paiflow.xyz) — no account needed                                                     |
| Demo video published                     | Yes    | No      | No  | Week 4 (the D1 screen recording is in the [evidence index](evidence/README.md#screenshots-and-recordings)) |

Every metric except the week-4 demo video is met. Executions cleared the target on 12 September;
the 11 September snapshot had them at 43.

_Last updated: 12 September, from a snapshot of the public app's database
([`evidence/metrics-2026-09-12.json`](evidence/metrics-2026-09-12.json)). Earlier snapshot:
[11 September](evidence/metrics-2026-09-11.json)._

## How the numbers are produced

Each snapshot is a read-only query against the application's own database, run from the
repository with the same definitions every time and saved in the evidence index with the figures.
`pnpm instawards:metrics` is the generator, and every snapshot file carries each metric's target
and whether it is met:

```bash
railway run -p <project> -s Postgres -e staging -- \
  bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm -s tsx scripts/instawards-metrics.ts' \
  > docs/instawards/evidence/metrics-$(date +%F).json
```

The definitions:

- **Unique flows deployed** — confirmed deployments created since 7 September. A flow deployed
  twice counts twice, which is what the SOW's "deployed" measures; the 12 September snapshot also
  records 19 distinct flow definitions behind the 26.
- **Contract executions / events published** — contract events the application decoded and
  published to a deployment's live feed, for deployments in the window. This is a subset of what
  the chain emits: at twelve contract events per swap transaction, the twenty swap transactions
  alone put the on-chain count near 240. The application-recorded figure is the one reported, so
  the number is the conservative one. It reached 61 on 12 September.
- **Unique swapper flows executed** — distinct deployments with at least one `swap` event, each
  listed with its transactions in the [evidence index](evidence/README.md#swapper-flows-executed-on-testnet).
- **Distinct wallets deploying** — distinct signing accounts across confirmed deployments.
  Connecting a wallet is not deploying a flow, so wallet-connection counts are not used as a
  substitute; for reference, 6 distinct wallets connected in the same window.
- **Contract WASM uploaded** — the swapper binary is on testnet, the application's contract-template
  row points at it, and every public-app swap flow instantiates it. The counting rule excludes
  _activity_ from development environments, not the artefact itself, so it counts as 1.

The application's internal submission-proof view reports the same user, deployment and wallet
totals and is used to cross-check each snapshot.
