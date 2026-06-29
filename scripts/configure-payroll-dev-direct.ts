import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import "dotenv/config";

const SUBSCRIPTION_CONTRACT = "CAIUBHKS32BRPYN4U2LXOLA25Z2B5YUPUDBGQNKUXZF5VNNR4TW2LLBA";
const SPLITTER_CONTRACT = "CBYNKRO2M5FTIPFZJ6IEMDKQILKIENQN6HJXL5W6ZOXUEPA7KNL5BIU7";

const SUBSCRIBER = "GAEBH5ZALWM4SFBG3XEE7FBGKNPUVX5JT7URH34XHQ6SVRT6IGY4SXAM";
const RECIPIENT_A = "GAEBH5ZALWM4SFBG3XEE7FBGKNPUVX5JT7URH34XHQ6SVRT6IGY4SXAM";
const RECIPIENT_B = "GA3H23J5NNSYOKHLJXGVVYFMW4PRE6DQ7SBKWRC5Y6MK7I7DPSKLI6CV";

const AMOUNT_PER_PERIOD_STROOPS = (500n * 10n ** 7n).toString();
const RECIPIENT_SHARE_STROOPS = (250n * 10n ** 7n).toString();

const START_TS = 1782387165;
const END_TS = 1784979165;
const INTERVAL_SECONDS = 3600;

const RELAYER_SECRET = process.env.STELLAR_RELAYER_SECRET_KEY;
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE_TESTNET;
const RPC_URL = process.env.STELLAR_SOROBAN_RPC_URL_TESTNET;

if (!RELAYER_SECRET || !NETWORK_PASSPHRASE || !RPC_URL) {
  throw new Error("Missing env vars");
}

const server = new rpc.Server(RPC_URL, { allowHttp: true });
const kp = Keypair.fromSecret(RELAYER_SECRET);
const relayer = kp.publicKey();

function addr(a: string): xdr.ScVal {
  return new Address(a).toScVal();
}

function i128(n: string | bigint): xdr.ScVal {
  return nativeToScVal(typeof n === "bigint" ? n : BigInt(n), { type: "i128" });
}

function u64(n: number | bigint): xdr.ScVal {
  return nativeToScVal(typeof n === "bigint" ? n : BigInt(n), { type: "u64" });
}

function symbol(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "symbol" });
}

function recipientsVec(
  recipients: Array<{ address: string; bps: number; amount: string; isCashOut?: boolean }>,
): xdr.ScVal {
  return xdr.ScVal.scvVec(
    recipients.map((r) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: symbol("address"), val: addr(r.address) }),
        new xdr.ScMapEntry({ key: symbol("amount"), val: i128(r.amount) }),
        new xdr.ScMapEntry({ key: symbol("bps"), val: nativeToScVal(r.bps, { type: "u32" }) }),
        new xdr.ScMapEntry({
          key: symbol("is_cash_out"),
          val: nativeToScVal(r.isCashOut ?? false, { type: "bool" }),
        }),
      ]),
    ),
  );
}

async function invoke(contract: string, fn: string, args: xdr.ScVal[]) {
  const sourceAcct = await server.getAccount(relayer);
  const op = Operation.invokeContractFunction({
    contract,
    function: fn,
    args,
  });
  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`${fn} simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(kp);
  const send = await server.sendTransaction(assembled);
  if (send.status === "ERROR") {
    throw new Error(`${fn} sendTransaction error: ${JSON.stringify(send.errorResult)}`);
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(send.hash);
    if (got.status === "SUCCESS") return send.hash;
    if (got.status === "FAILED") throw new Error(`${fn} transaction failed`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${fn} timeout waiting for finality`);
}

async function main() {
  console.log("Relayer:", relayer);
  console.log("Configuring SUBSCRIPTION_DEV...");

  const tx1 = await invoke(SUBSCRIPTION_CONTRACT, "update_subscriber", [
    addr(relayer),
    addr(SUBSCRIBER),
  ]);
  console.log("update_subscriber tx:", tx1);

  const tx2 = await invoke(SUBSCRIPTION_CONTRACT, "set_amount", [
    addr(relayer),
    i128(AMOUNT_PER_PERIOD_STROOPS),
  ]);
  console.log("set_amount tx:", tx2);

  const tx3 = await invoke(SUBSCRIPTION_CONTRACT, "update_schedule", [
    addr(relayer),
    u64(START_TS),
    u64(INTERVAL_SECONDS),
    u64(END_TS),
  ]);
  console.log("update_schedule tx:", tx3);

  console.log("Configuring SPLITTER_DEV...");
  const tx4 = await invoke(SPLITTER_CONTRACT, "update_recipients", [
    addr(relayer),
    recipientsVec([
      { address: RECIPIENT_A, bps: 0, amount: RECIPIENT_SHARE_STROOPS, isCashOut: false },
      { address: RECIPIENT_B, bps: 0, amount: RECIPIENT_SHARE_STROOPS, isCashOut: false },
    ]),
  ]);
  console.log("update_recipients tx:", tx4);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
