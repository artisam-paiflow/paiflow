import fs from "node:fs";
import * as sdk from "@stellar/stellar-sdk";

if (process.env.PUBLIC_ALLOWANCE_LOCAL_TEST !== "1")
  throw new Error("Synthetic RPC preload requires explicit disposable local fixture mode");
const database = new URL(process.env.DATABASE_URL ?? "http://missing");
if (
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !database.pathname.startsWith("/public_allowance_")
)
  throw new Error("Synthetic RPC preload requires a disposable local allowance database");
const statePath = process.env.PUBLIC_ALLOWANCE_STATE_PATH;
if (!statePath) throw new Error("Missing synthetic RPC fixture state path");
const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
const submitted = new Map();
const proto = sdk.rpc.Server.prototype;
proto.getAccount = async function (address) {
  return new sdk.Account(address, "1");
};
proto.getLatestLedger = async function () {
  return { sequence: 1000, protocolVersion: 29 };
};
proto.getLedgers = async function () {
  return { ledgers: [{ sequence: 1000, ledgerCloseTime: String(Math.floor(Date.now() / 1000)) }] };
};
proto.getEvents = async function () {
  return { latestLedger: 1000, events: [] };
};
proto.simulateTransaction = async function (tx) {
  const current = state();
  const call = tx.operations[0].func.invokeContract();
  const method = call.functionName().toString();
  const address = sdk.Address.fromScAddress(call.contractAddress()).toString();
  let value = sdk.xdr.ScVal.scvVoid();
  if (method === "subscriber")
    value = current.subscribers[address]
      ? new sdk.Address(current.subscribers[address]).toScVal()
      : sdk.xdr.ScVal.scvVoid();
  if (method === "asset") value = new sdk.Address(current.token).toScVal();
  if (method === "is_cancelled") value = sdk.xdr.ScVal.scvBool(false);
  if (method === "allowance") value = sdk.nativeToScVal(100n, { type: "i128" });
  return {
    _parsed: true,
    id: "1",
    latestLedger: 1000,
    events: [],
    transactionData: new sdk.SorobanDataBuilder(),
    minResourceFee: "1000",
    result: { auth: [], retval: value },
  };
};
proto.sendTransaction = async function (tx) {
  const hash = tx.hash().toString("hex");
  submitted.set(hash, tx);
  return { status: "PENDING", hash };
};
proto.getTransaction = async function (hash) {
  const tx = submitted.get(hash);
  if (!tx) return { status: "NOT_FOUND", latestLedger: 1000, oldestLedger: 1 };
  return {
    status: "SUCCESS",
    txHash: hash,
    ledger: 1000,
    createdAt: Math.floor(Date.now() / 1000),
    envelopeXdr: tx.toEnvelope(),
    latestLedger: 1000,
    oldestLedger: 1,
  };
};
