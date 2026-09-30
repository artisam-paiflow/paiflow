/**
 * Print the relayer's derived channel accounts and their balances, and on
 * testnet fund the unfunded ones through Friendbot.
 *
 *   pnpm relayer:channels                 # uses STELLAR_RELAYER_CHANNELS
 *   pnpm relayer:channels --count=8
 *
 * Channels are derived from STELLAR_RELAYER_SECRET_KEY (lib/stellar/
 * relayer-channel-keys.ts). Only public addresses are printed; no secret or
 * derived key ever is. On mainnet nothing is created: send each printed
 * address enough XLM for fees, then set STELLAR_RELAYER_CHANNELS.
 */
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { deriveChannelKeypair } from "../lib/stellar/relayer-channel-keys";

// Neither call overrides, so first-write-wins gives shell > .env.local > .env.
dotenvConfig({ path: resolve(".env.local") });
dotenvConfig({ path: resolve(".env") });

const secret = process.env.STELLAR_RELAYER_SECRET_KEY;
const network = process.env.STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
const horizonUrl =
  network === "mainnet"
    ? (process.env.STELLAR_HORIZON_URL_MAINNET ?? "https://horizon.stellar.org")
    : (process.env.STELLAR_HORIZON_URL_TESTNET ?? "https://horizon-testnet.stellar.org");
const FRIENDBOT = "https://friendbot.stellar.org";
const LOW_XLM = 5;

function channelCount(): number {
  const flag = process.argv.find((a) => a.startsWith("--count="))?.slice("--count=".length);
  const raw = flag ?? process.env.STELLAR_RELAYER_CHANNELS ?? "0";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error(
      `Channel count must be an integer from 1 to 50 (got "${raw}"). Set STELLAR_RELAYER_CHANNELS or pass --count=N.`,
    );
  }
  return n;
}

async function balanceOf(server: Horizon.Server, address: string): Promise<string | null> {
  try {
    const acct = await server.loadAccount(address);
    return acct.balances.find((b) => b.asset_type === "native")?.balance ?? "0";
  } catch {
    return null;
  }
}

(async () => {
  if (!secret) throw new Error("STELLAR_RELAYER_SECRET_KEY is not set");
  const count = channelCount();
  const server = new Horizon.Server(horizonUrl);

  console.log(`Network: ${network}`);
  console.log(`Relayer: ${Keypair.fromSecret(secret).publicKey()}`);
  console.log(`Channels: ${count}\n`);

  let unfunded = 0;
  for (let i = 0; i < count; i++) {
    const address = deriveChannelKeypair(secret, i).publicKey();
    let balance = await balanceOf(server, address);
    let note = "";
    if (balance === null && network === "testnet") {
      const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
      note = res.ok ? " (funded via Friendbot)" : ` (Friendbot refused: HTTP ${res.status})`;
      balance = await balanceOf(server, address);
    }
    if (balance === null) unfunded++;
    else if (Number(balance) < LOW_XLM) note += " (LOW)";
    console.log(`  ${i}  ${address}  ${balance === null ? "UNFUNDED" : `${balance} XLM`}${note}`);
  }

  if (unfunded > 0) {
    console.log(
      `\n${unfunded} channel(s) unfunded. The app skips them with a warning until they are.` +
        (network === "mainnet" ? " Send each address enough XLM for fees." : ""),
    );
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
