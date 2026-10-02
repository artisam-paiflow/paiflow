#!/usr/bin/env tsx
/**
 * Generates `docs/instawards/evidence/transactions.md`, the validation package's
 * "tx hash list for all settlements on Stellar Expert" (SOW §6.1), from the
 * committed snapshots rather than by hand, so it can be rebuilt after the next
 * `pnpm instawards:metrics`.
 *
 * Settlements are the swap transactions in the swapper-flow snapshots: the
 * archive list (`d1/14-swapper-flows.json`, frozen at the 16 September
 * cutover) and the newest `swapper-flows-live-*.json`. The two are printed as
 * separate tables and never summed (metrics.md, "Counting rules"). A row whose
 * transaction also appears in a deliverable's evidence pack is marked with it.
 *
 * Usage:
 *   pnpm instawards:transactions            # write the page
 *   pnpm instawards:transactions --check    # exit 1 if the page is stale
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";

const EVIDENCE = "docs/instawards/evidence";
const OUT = path.join(EVIDENCE, "transactions.md");
const ARCHIVE = path.join(EVIDENCE, "d1/14-swapper-flows.json");
const PACKS = ["d1", "d2", "d3", "d4"];
const EXPLORER = "https://stellar.expert/explorer/testnet";

type Swap = {
  txHash: string;
  ledger: number;
  occurredAt: string;
  amountInStroops: string;
  amountOutStroops: string;
};
type Flow = {
  n: number;
  deploymentId: string;
  confirmedAt: string;
  owner: string;
  signer: string;
  deployTxHash: string;
  swapper: string;
  swaps: Swap[];
};

function readFlows(file: string): Flow[] {
  return JSON.parse(readFileSync(file, "utf8")) as Flow[];
}

function newestLive(): string {
  const files = readdirSync(EVIDENCE)
    .filter((f) => /^swapper-flows-live-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const last = files.at(-1);
  if (!last) throw new Error(`no swapper-flows-live-*.json in ${EVIDENCE}`);
  return path.join(EVIDENCE, last);
}

/** Values under any `…txHash` key, however deep. */
function txHashes(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => txHashes(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/txhash$/i.test(k) && typeof v === "string" && /^[0-9a-f]{64}$/.test(v)) out.add(v);
      else txHashes(v, out);
    }
  }
  return out;
}

/** Transaction hash → the deliverables whose evidence records it. */
function packMentions(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pack of PACKS) {
    let files: string[];
    try {
      files = readdirSync(path.join(EVIDENCE, pack));
    } catch {
      continue;
    }
    for (const f of files) {
      // The swapper-flow list is the table's source, and an OpenAPI document's
      // examples reuse real hashes without being a record of that run.
      if (!f.endsWith(".json") || /swapper-flows|openapi/.test(f)) continue;
      const json: unknown = JSON.parse(readFileSync(path.join(EVIDENCE, pack, f), "utf8"));
      for (const hash of txHashes(json)) {
        const packs = out.get(hash) ?? [];
        if (!packs.includes(pack)) packs.push(pack);
        out.set(hash, packs);
      }
    }
  }
  return out;
}

const packLinks = (packs: string[] | undefined) =>
  (packs ?? []).map((p) => `[${p.toUpperCase()}](../deliverables/${p}.md)`).join(", ");

/** Stroops as an amount: whole units when exact, otherwise all 7 decimals. */
function units(stroops: string): string {
  const v = BigInt(stroops);
  const whole = v / 10_000_000n;
  const frac = v % 10_000_000n;
  return frac === 0n ? `${whole}` : `${whole}.${frac.toString().padStart(7, "0")}`;
}

const short = (s: string, head = 8, tail = 4) => `${s.slice(0, head)}…${s.slice(-tail)}`;
const txLink = (h: string) => `[\`${h.slice(0, 8)}…\`](${EXPLORER}/tx/${h})`;
const contractLink = (c: string) => `[\`${short(c)}\`](${EXPLORER}/contract/${c})`;
const day = (iso: string) => iso.slice(0, 10);

function settlementsTable(flows: Flow[], mentions: Map<string, string[]>): string {
  const rows = flows.flatMap((f) => f.swaps.map((s) => ({ f, s })));
  rows.sort((a, b) => a.s.occurredAt.localeCompare(b.s.occurredAt));
  const lines = [
    "| #   | Date (UTC) | Deployment | Session | XLM in | USDC out | Transaction | Evidence |",
    "| --- | ---------- | ---------- | ------- | ------ | -------- | ----------- | -------- |",
  ];
  rows.forEach(({ f, s }, i) => {
    const packs = packLinks(mentions.get(s.txHash));
    lines.push(
      `| ${i + 1} | ${day(s.occurredAt)} | \`${f.deploymentId.slice(0, 8)}\` | ${f.owner} | ${units(s.amountInStroops)} | ${units(s.amountOutStroops)} | ${txLink(s.txHash)} | ${packs} |`,
    );
  });
  return lines.join("\n");
}

function deploymentsTable(flows: Flow[], mentions: Map<string, string[]>): string {
  const lines = [
    "| #   | Confirmed (UTC) | Deployment | Session | Signer | Swapper contract | Deploy transaction | Evidence |",
    "| --- | --------------- | ---------- | ------- | ------ | ---------------- | ------------------ | -------- |",
  ];
  [...flows]
    .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt))
    .forEach((f, i) => {
      const packs = packLinks(mentions.get(f.deployTxHash));
      lines.push(
        `| ${i + 1} | ${day(f.confirmedAt)} | \`${f.deploymentId.slice(0, 8)}\` | ${f.owner} | \`${short(f.signer, 8, 4)}\` | ${contractLink(f.swapper)} | ${txLink(f.deployTxHash)} | ${packs} |`,
      );
    });
  return lines.join("\n");
}

/** Every swap in both lists is XLM → USDC; the snapshots do not record assets, so check. */
function assertXlmToUsdc(flows: Flow[], label: string) {
  for (const f of flows) {
    for (const s of f.swaps) {
      // XLM trades near 0.1 USDC on the testnet pool; the reverse would be ~10x.
      if (BigInt(s.amountOutStroops) * 2n >= BigInt(s.amountInStroops)) {
        throw new Error(`${label}: ${s.txHash} does not look like XLM → USDC`);
      }
    }
  }
}

function render(): string {
  const liveFile = newestLive();
  const archive = readFlows(ARCHIVE);
  const live = readFlows(liveFile);
  assertXlmToUsdc(archive, "archive");
  assertXlmToUsdc(live, "live");

  const archiveTx = new Set(archive.flatMap((f) => f.swaps.map((s) => s.txHash)));
  const overlap = live.flatMap((f) => f.swaps).filter((s) => archiveTx.has(s.txHash));
  if (overlap.length) {
    throw new Error(`a swap is in both lists: ${overlap.map((s) => s.txHash).join(", ")}`);
  }

  const mentions = packMentions();
  const swaps = (fl: Flow[]) => fl.reduce((n, f) => n + f.swaps.length, 0);
  const liveName = path.basename(liveFile);

  return `# Transaction list

<!-- Generated by \`pnpm instawards:transactions\` from ${ARCHIVE.replace(`${EVIDENCE}/`, "")} and ${liveName}. Do not edit by hand. -->

Every swap settlement Paiflow's public application produced on Stellar testnet during the sprint,
and the transaction that deployed each flow, linked on [stellar.expert](${EXPLORER}). This is the
validation package's "tx hash list for all settlements on Stellar Expert" ([Statement of Work](../../instawards-phase-1-sow.md)
§6.1).

A settlement here is one swapper execution: a deposit that the flow swapped from XLM to USDC through
the Soroswap router and paid out, all in one transaction. Each transaction below carries the
router's \`swap\` event; [How to verify the router](README.md#how-to-verify-the-router) shows how to
check one.

The public application's record sits in two databases, so the list does too
([metrics](../metrics.md#counting-rules) explains why). **The two are never added together.**

| Basis                                       | Flows executed | Settlements | Source                                                   |
| ------------------------------------------- | -------------- | ----------- | -------------------------------------------------------- |
| Archive: paiflow.xyz up to 16 September      | ${archive.length}             | ${swaps(archive)}          | [\`d1/14-swapper-flows.json\`](d1/14-swapper-flows.json)     |
| Live: the current database, since 15 September | ${live.length}             | ${swaps(live)}          | [\`${liveName}\`](${liveName}) |

"Session" is the kind of account that ran the flow: \`admin\` is the team, \`judge\` the QA account,
\`sandbox\` a no-account visitor, and \`user\` a registered account. "Evidence" marks a transaction
a deliverable's evidence pack also records, with the full request and response there.

## Settlements

### Archive (to 16 September)

${settlementsTable(archive, mentions)}

### Live (since 15 September)

${settlementsTable(live, mentions)}

## Deployments

The \`deploy_pipeline\` call that created each flow above, through the application's own factory
[\`CBFZTEZZ…ZJNK\`](${EXPLORER}/contract/CBFZTEZZN2M7PV3LHM5TSHO6K45RDKT4ICX2YUNWRX6RXWVIOJ3KZJNK).
Each deployed swapper runs the same uploaded binary,
[WASM \`e9482ff0…b23d1a\`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a).

### Archive

${deploymentsTable(archive, mentions)}

### Live

${deploymentsTable(live, mentions)}

## Rebuilding this page

\`pnpm instawards:transactions\` rewrites it from the snapshots named at the top, and
\`pnpm instawards:transactions --check\` fails when it is out of date. A new
\`swapper-flows-live-*.json\` from \`pnpm instawards:metrics\` is picked up automatically, being the
newest by date.
`;
}

async function main() {
  // Formatted as the pre-commit hook would, so --check compares like with like.
  const page = await format(render(), { ...(await resolveConfig(OUT)), parser: "markdown" });
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "utf8") !== page) {
      console.error(`${OUT} is stale; run pnpm instawards:transactions`);
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, page);
    console.log(`wrote ${OUT}`);
  }
}

void main();
