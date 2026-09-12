#!/usr/bin/env tsx
/**
 * Extends the time-to-live of Soroban contract *code* entries (uploaded WASM)
 * and contract *instance* entries (a deployed contract's own storage).
 *
 * The two expire independently. A contract's `bump_ttl` extends only its
 * instance; the WASM code entry every instance points at is extended only by an
 * `extendFootprintTtl` operation naming its ledger key, and an instance whose
 * contract never calls `extend_ttl` — the factory, for one — is extended the
 * same way. Either expiry breaks deploys until the entry is restored.
 *
 * Usage:
 *   pnpm contracts:extend-ttl --network=testnet
 *   pnpm contracts:extend-ttl --network=testnet --hash=<64-hex>
 *   pnpm contracts:extend-ttl --network=testnet --contract=<C...>
 *   pnpm contracts:extend-ttl --network=testnet --extend-to=1000000 --dry-run
 *
 * With neither --hash nor --contract, every STELLAR_WASM_HASH_<KIND>_<NETWORK>
 * in the environment is extended, plus STELLAR_FACTORY_ADDRESS_<NETWORK>.
 * --extend-to defaults to the network's maximum entry TTL.
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

dotenvConfig({ path: resolve(".env") });
dotenvConfig({ path: resolve(".env.local"), override: true });

type NetworkName = "testnet" | "mainnet";

type Target = { label: string; key: xdr.LedgerKey; name: string };

const HASH_RE = /^[0-9a-f]{64}$/i;

function parseNetworkFlag(): NetworkName {
  const fromFlag = argValues("--network=")[0];
  const value = fromFlag ?? process.env.STELLAR_NETWORK ?? "testnet";

  if (value !== "testnet" && value !== "mainnet") {
    throw new Error(`Invalid network: ${value}. Only 'testnet' or 'mainnet' are permitted.`);
  }

  return value;
}

function argValues(prefix: string): string[] {
  return process.argv
    .slice(2)
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length));
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function getRpcUrl(network: NetworkName): string {
  if (network === "mainnet") {
    return process.env.STELLAR_SOROBAN_RPC_URL_MAINNET ?? "https://mainnet.sorobanrpc.com";
  }
  return process.env.STELLAR_SOROBAN_RPC_URL_TESTNET ?? "https://soroban-testnet.stellar.org";
}

function getPassphrase(network: NetworkName): string {
  if (network === "mainnet") {
    return process.env.STELLAR_NETWORK_PASSPHRASE_MAINNET ?? Networks.PUBLIC;
  }
  return process.env.STELLAR_NETWORK_PASSPHRASE_TESTNET ?? Networks.TESTNET;
}

function codeKey(wasmHash: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHash, "hex") }),
  );
}

/** A deployed contract's own instance entry, which is persistent storage and
 *  expires on its own schedule regardless of the code entry it points at. */
function instanceKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

function wasmTarget(raw: string, label: string): Target {
  const wasmHash = raw.trim().toLowerCase();
  if (!HASH_RE.test(wasmHash)) {
    throw new Error(`Invalid WASM hash ${raw}: expected 64 hex characters`);
  }
  return { label, key: codeKey(wasmHash), name: `${wasmHash.slice(0, 8)}…` };
}

function contractTarget(raw: string, label: string): Target {
  const contractId = raw.trim();
  if (!StrKey.isValidContract(contractId)) {
    throw new Error(`Invalid contract id ${raw}`);
  }
  return {
    label,
    key: instanceKey(contractId),
    name: `${contractId.slice(0, 8)}…${contractId.slice(-4)}`,
  };
}

function collectTargets(network: NetworkName): Target[] {
  const hashes = argValues("--hash=");
  const contracts = argValues("--contract=");

  if (hashes.length > 0 || contracts.length > 0) {
    return [
      ...hashes.map((h) => wasmTarget(h, "wasm")),
      ...contracts.map((c) => contractTarget(c, "instance")),
    ];
  }

  const suffix = network.toUpperCase();
  const prefix = "STELLAR_WASM_HASH_";
  const targets: Target[] = [];
  const seen = new Set<string>();

  for (const [key, raw] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || !key.endsWith(`_${suffix}`)) continue;
    const value = raw?.trim().toLowerCase();
    if (!value || !HASH_RE.test(value) || seen.has(value)) continue;

    seen.add(value);
    targets.push(wasmTarget(value, key.slice(prefix.length, key.length - suffix.length - 1)));
  }

  targets.sort((a, b) => a.label.localeCompare(b.label));

  // The factory is the one instance the whole app depends on: its contract has
  // no extend_ttl of its own, so nothing bumps it as a side effect of deploying.
  const factory = process.env[`STELLAR_FACTORY_ADDRESS_${suffix}`]?.trim();
  if (factory) targets.push(contractTarget(factory, "FACTORY instance"));

  return targets;
}

async function maxEntryTtl(server: rpc.Server): Promise<number> {
  const key = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({
      configSettingId: xdr.ConfigSettingId.configSettingStateArchival(),
    }),
  );

  const { entries } = await server.getLedgerEntries(key);
  const entry = entries[0];
  if (!entry) throw new Error("could not read the network's state-archival settings");

  return entry.val.configSetting().stateArchivalSettings().maxEntryTtl();
}

async function liveUntil(server: rpc.Server, key: xdr.LedgerKey): Promise<number | null> {
  const { entries } = await server.getLedgerEntries(key);
  const entry = entries[0];
  return entry?.liveUntilLedgerSeq ?? null;
}

async function submit(
  server: rpc.Server,
  kp: Keypair,
  passphrase: string,
  key: xdr.LedgerKey,
  extendTo: number,
): Promise<string> {
  const account = await server.getAccount(kp.publicKey());

  const sorobanData = new SorobanDataBuilder().setReadOnly([key]).build();

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.extendFootprintTtl({ extendTo }))
    .setSorobanData(sorobanData)
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate failed: ${sim.error}`);

  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);

  const send = await server.sendTransaction(prepared);
  if (send.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(send)}`);

  for (let attempt = 0; attempt < 20; attempt++) {
    const got = await server.getTransaction(send.hash);

    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return send.hash;

    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`transaction failed: ${JSON.stringify(got)}`);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error(`transaction polling timed out after 20 attempts (hash ${send.hash})`);
}

async function main() {
  const network = parseNetworkFlag();
  const rpcUrl = getRpcUrl(network);
  const passphrase = getPassphrase(network);
  const dryRun = hasFlag("--dry-run");
  const uploaderSecret = process.env.UPLOADER_SECRET;

  if (!uploaderSecret && !dryRun) throw new Error("UPLOADER_SECRET env var is required");

  const server = new rpc.Server(rpcUrl, { allowHttp: false });
  const targets = collectTargets(network);

  if (targets.length === 0) {
    console.error(`[ttl] nothing found for ${network} — pass --hash=<64-hex> or --contract=<C...>`);
    process.exit(1);
  }

  // The host counts the current ledger inside the entry's total TTL, so it
  // rejects extendTo == maxEntryTtl ("TTL extension is too large") and the
  // largest value it will accept is one ledger short of the configured maximum.
  const networkMax = (await maxEntryTtl(server)) - 1;
  const requested = argValues("--extend-to=")[0];
  const extendTo = requested ? Number(requested) : networkMax;

  if (!Number.isInteger(extendTo) || extendTo <= 0 || extendTo > networkMax) {
    throw new Error(
      `Invalid --extend-to=${requested}: expected 1..${networkMax} (network maximum)`,
    );
  }

  const latest = (await server.getLatestLedger()).sequence;
  const floor = latest + extendTo;

  console.log(`[ttl] network=${network} rpc=${rpcUrl}`);
  console.log(`[ttl] latest ledger ${latest}; extending to ${extendTo} ledgers ahead (${floor})`);
  if (dryRun) console.log("[ttl] dry run — nothing will be submitted");

  let extended = 0;
  let failed = 0;

  for (const { label, key, name } of targets) {
    const before = await liveUntil(server, key);

    if (before === null) {
      console.warn(`[ttl] ${label} ${name} NOT FOUND on ${network} (archived?)`);
      failed++;
      continue;
    }

    const daysLeft = (((before - latest) * 5) / 86400).toFixed(1);
    console.log(`[ttl] ${label} ${name} liveUntil=${before} (~${daysLeft}d left)`);

    if (before >= floor) {
      console.log(`[ttl] ${label} already at or beyond the target, skipping`);
      continue;
    }

    if (dryRun) {
      extended++;
      continue;
    }

    try {
      const txHash = await submit(
        server,
        Keypair.fromSecret(uploaderSecret!),
        passphrase,
        key,
        extendTo,
      );
      const after = await liveUntil(server, key);
      console.log(`[ttl] ${label} ${name} extended ${before} -> ${after} in tx ${txHash}`);
      extended++;
    } catch (err) {
      console.error(`[ttl] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`[ttl] done — ${extended} extended, ${failed} failed, ${targets.length} inspected`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
