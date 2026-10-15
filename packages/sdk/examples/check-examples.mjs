import assert from "node:assert/strict";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { Paiflow } from "@paiflow/sdk";
import { paymentHandlers } from "./compiled/payment-server.js";
import { ingestEvents } from "./compiled/workflows.js";

// Local fixtures only. No accounts funded and no network/financial submissions.
const wallet = Keypair.random();
const destination = Keypair.random().publicKey();
const make = (amount) =>
  new TransactionBuilder(new Account(wallet.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount }))
    .setTimeout(180)
    .build();
const original = make("1");
const modified = make("2");
const unsignedXdr = original.toXDR();
original.sign(wallet);
modified.sign(wallet);
let submissions = 0;
const saves = [];
const order = {
  id: "order-1",
  userId: "alice",
  walletAddress: wallet.publicKey(),
  amountStroops: "10000000",
  paid: false,
  prepared: {
    data: {
      xdr: unsignedXdr,
      networkPassphrase: Networks.TESTNET,
      network: "testnet",
      expiresAt: new Date(Date.now() + 180000).toISOString(),
    },
    metadata: { status: 200 },
  },
};
const deployment = new Paiflow({
  baseUrl: "https://paiflow.example",
  token: "pfk_fixture",
  fetch: async () => {
    submissions++;
    assert.ok(order.signedXdr, "Signed envelope persisted before API submit");
    return new Response(
      JSON.stringify({
        data: { txHash: original.hash().toString("hex"), status: "SUCCESS", ledger: 1 },
      }),
    );
  },
}).deployment("11111111-1111-4111-8111-111111111111");
let userId = "alice";
let evidenceVerified = false;
const handlers = paymentHandlers({
  deployment,
  appOrigin: "https://shop.example",
  paymentDescription: "Fixed Testnet XLM recipients: shop 90%, community 10%",
  authenticate: async () => ({ userId }),
  withOrder: async (id, fn) => {
    assert.equal(id, order.id);
    return fn(order, async () => {
      saves.push(structuredClone(order));
    });
  },
  verifyReceipt: async () => evidenceVerified,
});
const request = (signedXdr, origin = "https://shop.example") =>
  new Request("https://shop.example/checkout/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ orderId: "order-1", signedXdr }),
  });
await assert.rejects(handlers.submit(request(modified.toXDR())), /original preparation/);
assert.equal(submissions, 0, "Modified amount never reaches SDK submit");
userId = "bob";
await assert.rejects(handlers.submit(request(original.toXDR())), /Order unavailable/);
assert.equal(submissions, 0, "Deployment credential does not grant application order ownership");
userId = "alice";
await assert.rejects(
  handlers.submit(request(original.toXDR(), "https://attacker.example")),
  /Invalid origin/,
);
assert.equal(submissions, 0);
const result = await handlers.submit(request(original.toXDR()));
assert.equal(result.status, "SUCCESS");
assert.equal(order.paid, false, "API SUCCESS alone cannot fulfil an order");
assert.ok(saves[0].signedXdr);
evidenceVerified = true;
const verified = await handlers.submit(request(original.toXDR()));
assert.equal(verified.status, "PAID");
assert.equal(order.paid, true);

let pages = 0;
const reads = new Paiflow({
  baseUrl: "https://paiflow.example",
  token: "pfk_fixture",
  fetch: async (_url) => {
    pages++;
    return new Response(
      JSON.stringify({
        data: { items: [], nextCursor: pages === 1 ? "checkpoint" : null, hasMore: pages === 1 },
      }),
    );
  },
}).deployment(deployment.deploymentId);
const commits = [];
await ingestEvents(reads, undefined, undefined, async (events, checkpoint) => {
  commits.push({ events, checkpoint });
});
assert.deepEqual(
  commits.map((c) => c.checkpoint),
  [
    { cursor: "checkpoint", hasMore: true },
    { cursor: null, hasMore: false },
  ],
);
process.stdout.write(
  "SDK examples: packed imports/types, tampered-envelope rejection, app ownership/origin, receipt gating and pagination passed.\n",
);
