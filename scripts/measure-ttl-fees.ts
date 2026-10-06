/**
 * Reconcile public TESTNET TTL transaction results with their charge/refund events.
 * No signing, submission, DB access, or Railway configuration changes.
 * pnpm exec tsx --conditions=react-server scripts/measure-ttl-fees.ts INPUT.json OUTPUT.json
 * Input: { transactions: [{ label, hash }] }, e.g. docs/evidence/ttl-maintenance-testnet.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rpc } from "@stellar/stellar-sdk";
import { config } from "dotenv";
import { env, stellarPassphrase, stellarRpcUrl } from "@/lib/env";

async function main() {
  config({ path: resolve(".env.local") });
  config({ path: resolve(".env") });
  if (env().STELLAR_NETWORK !== "testnet") throw new Error("TESTNET measurements only");
  // Logger/AppError imports parse env at module load; load them after dotenv.
  const { log } = await import("@/lib/log");
  const { measureTtlTransactionFee, TtlFeeInputSchema } =
    await import("@/lib/stellar/ttl-fee-measurements");
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output))
    throw new Error("Distinct input and output files required");
  const parsed = TtlFeeInputSchema.parse(JSON.parse(await readFile(input, "utf8")) as unknown);
  const server = new rpc.Server(stellarRpcUrl());
  server.httpClient.defaults.timeout = 15_000;
  const transactions = [];
  for (const item of parsed.transactions.filter((item) =>
    /TTL extension|restor/i.test(item.label),
  )) {
    transactions.push({
      label: item.label,
      ...(await measureTtlTransactionFee(server, item.hash, stellarPassphrase())),
    });
  }
  if (!transactions.length) throw new Error("No labeled TTL extensions or restorations found");
  await writeFile(
    output,
    `${JSON.stringify({ network: "TESTNET", measuredAt: new Date().toISOString(), transactions }, null, 2)}\n`,
  );
  log.info({ transactions: transactions.length }, "TTL fee measurements saved");
}

main().catch(() => {
  process.stderr.write("TTL fee measurement failed; check input, network and RPC retention.\n");
  process.exitCode = 1;
});
