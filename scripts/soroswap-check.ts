/**
 * Prints the Soroswap router, factory, pair and reserves for XLM / USDC on the
 * configured network. Re-run after any Soroswap testnet reset (Instawards D1,
 * #390). Standalone on purpose: lib/stellar/* is server-only and cannot be
 * imported from a script.
 *
 *   pnpm exec tsx scripts/soroswap-check.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

config({ path: resolve(".env") });
config({ path: resolve(".env.local"), override: true });

const network = process.env.STELLAR_NETWORK ?? "testnet";
const suffix = network.toUpperCase();
const rpcUrl =
  process.env[`STELLAR_SOROBAN_RPC_URL_${suffix}`] ??
  (network === "mainnet"
    ? "https://mainnet.sorobanrpc.com"
    : "https://soroban-testnet.stellar.org");
const passphrase =
  process.env[`STELLAR_NETWORK_PASSPHRASE_${suffix}`] ??
  (network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET);
const router = process.env[`STELLAR_SOROSWAP_ROUTER_${suffix}`];
const USDC_ISSUER =
  network === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

async function main() {
  if (!router) throw new Error(`STELLAR_SOROSWAP_ROUTER_${suffix} is not set`);
  const server = new rpc.Server(rpcUrl, { allowHttp: false });
  // Any funded account works as the simulation source; the relayer is always there.
  const sourceKey =
    process.env.STELLAR_RELAYER_ADDRESS ??
    (process.env.UPLOADER_SECRET
      ? Keypair.fromSecret(process.env.UPLOADER_SECRET).publicKey()
      : undefined);
  if (!sourceKey) throw new Error("Set STELLAR_RELAYER_ADDRESS or UPLOADER_SECRET");
  const source = await server.getAccount(sourceKey);

  const xlm = Asset.native().contractId(passphrase);
  const usdc = new Asset("USDC", USDC_ISSUER).contractId(passphrase);

  async function read(contract: string, fn: string, args: xdr.ScVal[] = []): Promise<unknown> {
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: new Address(contract).toScAddress(),
              functionName: fn,
              args,
            }),
          ),
        }),
      )
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn} failed: ${sim.error}`);
    return scValToNative(sim.result!.retval);
  }

  const factory = String(await read(router, "get_factory"));
  const pair = String(
    await read(factory, "get_pair", [new Address(xlm).toScVal(), new Address(usdc).toScVal()]),
  );
  const [r0, r1] = (await read(pair, "get_reserves")) as [bigint, bigint];
  const token0 = String(await read(pair, "token_0"));
  const quote = (await read(router, "router_get_amounts_out", [
    nativeToScVal(100_000_000n, { type: "i128" }),
    xdr.ScVal.scvVec([new Address(xlm).toScVal(), new Address(usdc).toScVal()]),
  ])) as bigint[];
  const xlmIsToken0 = token0 === xlm;
  const [reserveXlm, reserveUsdc] = xlmIsToken0 ? [r0, r1] : [r1, r0];
  const units = (n: bigint) =>
    (Number(n) / 1e7).toLocaleString("en-US", { maximumFractionDigits: 2 });

  console.log(`[soroswap-check] network=${network} rpc=${rpcUrl}`);
  console.log(`[soroswap-check] router   ${router}`);
  console.log(`[soroswap-check] factory  ${factory}`);
  console.log(`[soroswap-check] pair     ${pair} (token_0 = ${xlmIsToken0 ? "XLM" : "USDC"})`);
  console.log(`[soroswap-check] reserves ${units(reserveXlm)} XLM / ${units(reserveUsdc)} USDC`);
  console.log(
    `[soroswap-check] 10 XLM → ${units(quote[quote.length - 1] ?? 0n)} USDC (router quote)`,
  );
  console.log(
    `[soroswap-check] spot     10 XLM → ${units((100_000_000n * reserveUsdc) / reserveXlm)} USDC`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
