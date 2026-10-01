/** Local-only organiser provisioning. Secrets never enter the Paiflow server. */
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { config as dotenvConfig } from "dotenv";
import {
  Asset,
  BASE_FEE,
  Horizon,
  NotFoundError,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { testerUsernames } from "@/lib/auth/tester-usernames";
import { hackathonOrganiserSecret } from "@/lib/env";
import {
  completeWallet,
  ProvisionError,
  maxSend,
  planShortfall,
  quoteShortfall,
  readWallets,
  renderTeamFile,
  stroops,
  type Balance,
} from "@/lib/hackathon/wallets";
import { TESTNET_USDC_ISSUER } from "@/lib/stellar/assets";

// First-write-wins: shell > .env.local > .env, as in relayer-channels.ts.
dotenvConfig({ path: resolve(".env.local") });
dotenvConfig({ path: resolve(".env") });
const usdcAsset = new Asset("USDC", TESTNET_USDC_ISSUER);
const server = new Horizon.Server("https://horizon-testnet.stellar.org");

async function account(address: string) {
  try {
    return await server.loadAccount(address);
  } catch (error) {
    // Only a confirmed 404 means missing; outages must not generate/fund replacements.
    if (error instanceof NotFoundError) return null;
    throw new ProvisionError("Horizon account lookup failed; retry the same command");
  }
}
async function balance(address: string): Promise<Balance> {
  const a = await account(address);
  const line = a?.balances.find(
    (b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === TESTNET_USDC_ISSUER,
  );
  return {
    exists: a !== null,
    xlm: a?.balances.find((b) => b.asset_type === "native")?.balance ?? "0",
    usdc: line?.balance ?? "0",
    trustline: !!line,
  };
}
async function send(signer: Keypair, operations: xdr.Operation[]) {
  const a = await server.loadAccount(signer.publicKey());
  const builder = new TransactionBuilder(a, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET });
  for (const op of operations) builder.addOperation(op);
  const tx = builder.setTimeout(180).build();
  tx.sign(signer);
  try {
    await server.submitTransaction(tx);
  } catch {
    throw new ProvisionError(
      "Transaction failed or its outcome is unknown; retry the same command to reconcile chain balances",
    );
  }
}
async function friendbot(address: string) {
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok)
    throw new ProvisionError(`Friendbot failed (HTTP ${response.status}); retry the same command`);
}
async function privateFile(path: string): Promise<string> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new ProvisionError("Team file must be a regular file");
    await chmod(path, 0o600);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
async function save(path: string, content: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
function integer(raw: string, name: string, min: number, max: number) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ProvisionError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

async function main() {
  let organiser: Keypair;
  try {
    organiser = Keypair.fromSecret(hackathonOrganiserSecret());
  } catch {
    throw new ProvisionError(
      "Set STELLAR_NETWORK=testnet and a valid HACKATHON_ORGANISER_SECRET before running",
    );
  }
  const { values } = parseArgs({
    options: Object.fromEntries(
      [
        "prefix",
        "from",
        "to",
        "pad",
        "wallets-per-team",
        "usdc",
        "out-dir",
        "friendbot-topups",
      ].map((name) => [name, { type: "string" as const }]),
    ),
  });
  const names = testerUsernames(
    integer(values.from ?? "1", "--from", 1, 1000),
    integer(values.to ?? "12", "--to", 1, 1000),
    values.prefix ?? "team",
    integer(values.pad ?? "2", "--pad", 0, 32),
  );
  const count = integer(values["wallets-per-team"] ?? "3", "--wallets-per-team", 1, 100);
  const target = values.usdc ?? "1000";
  if (stroops(target) === 0n) throw new ProvisionError("--usdc must be positive");
  const topups = integer(values["friendbot-topups"] ?? "0", "--friendbot-topups", 0, 100);
  const dir = resolve(values["out-dir"] ?? "hackathon-teams");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (!(await lstat(dir)).isDirectory() || (await lstat(dir)).isSymbolicLink())
    throw new ProvisionError("Output directory must be a real directory");
  await chmod(dir, 0o700);
  const lock = join(dir, ".wallets-lock");
  await mkdir(lock); // Fail closed if another run is active.
  try {
    const teams = [];
    const seen = new Set<string>([organiser.publicKey()]);
    for (const name of names) {
      const path = join(dir, `${name}.md`);
      const content = await privateFile(path);
      const wallets = readWallets(content);
      // Never discard saved keys if the requested count is reduced.
      if (wallets.length > count)
        throw new ProvisionError("Saved wallet count exceeds --wallets-per-team");
      while (wallets.length < count) {
        const key = Keypair.random();
        wallets.push({
          number: wallets.length + 1,
          publicKey: key.publicKey(),
          secretKey: key.secret(),
        });
      }
      for (const w of wallets) {
        if (seen.has(w.publicKey)) throw new ProvisionError("Duplicate wallet across team files");
        seen.add(w.publicKey);
      }
      teams.push({ name, path, content, wallets });
    }
    const organiserBalance = await balance(organiser.publicKey());
    if (!organiserBalance.exists)
      throw new ProvisionError("Create and Friendbot-fund the organiser wallet first");
    const wallets = teams.flatMap((t) => t.wallets);
    const balances = await Promise.all(wallets.map((w) => balance(w.publicKey)));
    const plan = planShortfall(balances, target, organiserBalance.usdc);
    const quote = await quoteShortfall(plan.shortfall, async (amount) => {
      try {
        return (await server.strictReceivePaths([Asset.native()], usdcAsset, amount).call())
          .records;
      } catch {
        throw new ProvisionError("Horizon quote failed; nobody funded");
      }
    });
    const sendMax = quote ? maxSend(quote.source_amount) : "0";
    // A conservative 10 XLM fee cushion in addition to reserve and selling liabilities.
    const a = (await account(organiser.publicKey()))!;
    const reserve =
      BigInt(2 + a.subentry_count + (a.num_sponsoring ?? 0) - (a.num_sponsored ?? 0)) * 5_000_000n;
    const liabilities =
      a.balances.find((b) => b.asset_type === "native")?.selling_liabilities ?? "0";
    const needed = stroops(sendMax) + reserve + stroops(liabilities) + stroops("10");
    console.error(
      `Plan: ${plan.total} USDC needed; buy ${plan.shortfall} USDC. Quote: ${quote?.source_amount ?? "0"} XLM; max-send (5% cap): ${sendMax} XLM.`,
    );
    if (stroops(organiserBalance.xlm) + BigInt(topups) * stroops("9999.9999900") < needed)
      throw new ProvisionError(
        "Insufficient XLM including requested topups; increase --friendbot-topups before funding anyone",
      );
    // Persist all keys before Friendbot/trustline/payment writes.
    for (const team of teams)
      await save(team.path, renderTeamFile(team.content || `# ${team.name}\n`, team.wallets));
    for (
      let i = 0;
      i < topups && stroops((await balance(organiser.publicKey())).xlm) < needed;
      i++
    ) {
      const throwaway = Keypair.random();
      await friendbot(throwaway.publicKey());
      await send(throwaway, [Operation.accountMerge({ destination: organiser.publicKey() })]);
    }
    if (stroops((await balance(organiser.publicKey())).xlm) < needed)
      throw new ProvisionError("Organiser still lacks XLM; nobody funded");
    if (quote) {
      const ops = [];
      if (!organiserBalance.trustline) ops.push(Operation.changeTrust({ asset: usdcAsset }));
      ops.push(
        Operation.pathPaymentStrictReceive({
          sendAsset: Asset.native(),
          sendMax,
          destination: organiser.publicKey(),
          destAsset: usdcAsset,
          destAmount: plan.shortfall,
          path: quote.path.map((p) =>
            p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!),
          ),
        }),
      );
      await send(organiser, ops); // Atomic full purchase; failure prevents all team funding.
    }
    if (stroops((await balance(organiser.publicKey())).usdc) < stroops(plan.total))
      throw new ProvisionError("Organiser lacks the full USDC budget; nobody funded");
    const rows = ["team\twallet\tpublic key\tXLM\tUSDC\ttrustline"];
    for (const team of teams)
      for (const wallet of team.wallets) {
        const b = await completeWallet(wallet, target, {
          balance,
          friendbot,
          trust: (w) =>
            send(Keypair.fromSecret(w.secretKey), [Operation.changeTrust({ asset: usdcAsset })]),
          pay: (destination, amount) =>
            send(organiser, [Operation.payment({ destination, asset: usdcAsset, amount })]),
        });
        rows.push(
          `${team.name}\t${wallet.number}\t${wallet.publicKey}\t${b.xlm}\t${b.usdc}\t${b.trustline ? "yes" : "no"}`,
        );
      }
    process.stdout.write(`${rows.join("\n")}\n`);
  } finally {
    await rm(lock, { recursive: true });
  }
}
main().catch((error: unknown) => {
  // SDK/network errors may carry request envelopes. Never serialize them.
  if (error instanceof ProvisionError) console.error(error.message);
  else
    console.error(
      "Provisioning stopped: network, arguments or file operation failed. Check saved handouts and retry; raw error payloads are suppressed.",
    );
  process.exitCode = 1;
});
