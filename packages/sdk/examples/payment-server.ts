import { timingSafeEqual } from "node:crypto";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import type { ApiResponse, ExecutePrepared, PaiflowDeployment } from "@paiflow/sdk";

export interface Order {
  id: string;
  userId: string;
  walletAddress: string; // established by your authenticated wallet-linking flow
  amountStroops: string; // trusted catalogue price, never accepted from the browser
  prepared?: ApiResponse<ExecutePrepared>;
  signedXdr?: string;
  txHash?: string;
  paid: boolean;
}
export interface PaymentDependencies {
  deployment: PaiflowDeployment;
  appOrigin: string; // fixed application configuration, not a request header
  paymentDescription: string; // deployed recipient/token rules from trusted configuration
  authenticate(request: Request): Promise<{ userId: string }>;
  // Implement durable cross-process exclusion, persistence and ownership checks.
  // save() must persist BEFORE returning; signed envelopes must be access restricted.
  withOrder<T>(id: string, fn: (order: Order, save: () => Promise<void>) => Promise<T>): Promise<T>;
  // Verify indexed/chain receipt: original hash, deployment/trigger, payer, token,
  // exact catalogue amount, required payout recipients/amounts, and final SUCCESS.
  // Return false if evidence is incomplete; HTTP 200 or a global status is insufficient.
  verifyReceipt(order: Readonly<Order>): Promise<boolean>;
}

/** Bind to the original prepared transaction body; added envelope signatures are allowed. */
export function assertOriginalEnvelope(prepared: ExecutePrepared, signedXdr: string): string {
  try {
    const original = TransactionBuilder.fromXDR(prepared.xdr, prepared.networkPassphrase);
    const signed = TransactionBuilder.fromXDR(signedXdr, prepared.networkPassphrase);
    if (!timingSafeEqual(original.hash(), signed.hash())) throw new Error();
    return original.hash().toString("hex");
  } catch {
    throw new Error("Signed transaction does not match the original preparation");
  }
}

async function body(request: Request, keys: readonly string[]): Promise<Record<string, string>> {
  if (
    request.method !== "POST" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    throw new Error("Expected JSON POST");
  // Enforce on streamed bytes, not just caller-supplied Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 210000) throw new Error("Body too large");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => typeof record[key] !== "string")
  )
    throw new Error("Invalid fields");
  if (typeof record.orderId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(record.orderId))
    throw new Error("Invalid order ID");
  if (
    keys.includes("signedXdr") &&
    (typeof record.signedXdr !== "string" ||
      record.signedXdr.length < 10 ||
      record.signedXdr.length > 200000)
  )
    throw new Error("Invalid envelope bounds");
  return record as Record<string, string>;
}

// Framework-neutral handlers: bind these to your own /checkout/prepare and submit.
// Your framework must rate limit and translate errors to generic HTTP responses.
export function paymentHandlers(deps: PaymentDependencies) {
  async function authorize(request: Request) {
    if (
      request.headers.get("origin") !== deps.appOrigin ||
      new URL(request.url).origin !== deps.appOrigin
    )
      throw new Error("Invalid origin");
    return deps.authenticate(request);
  }
  return {
    async prepare(request: Request) {
      const session = await authorize(request);
      const input = await body(request, ["orderId"]);
      return deps.withOrder(input.orderId!, async (order, save) => {
        if (order.userId !== session.userId || order.paid) throw new Error("Order unavailable");
        // Reload original preparation; local expiry never silently creates a new one.
        if (!order.prepared) {
          order.prepared = await deps.deployment.execute.prepare({
            amount: order.amountStroops,
            from: order.walletAddress,
          });
          await save();
        }
        return {
          preparation: order.prepared,
          walletAddress: order.walletAddress,
          amountStroops: order.amountStroops,
          paymentDescription: deps.paymentDescription,
        };
      });
    },
    async submit(request: Request) {
      const session = await authorize(request);
      const input = await body(request, ["orderId", "signedXdr"]);
      return deps.withOrder(input.orderId!, async (order, save) => {
        if (order.userId !== session.userId || !order.prepared)
          throw new Error("Order unavailable");
        const txHash = assertOriginalEnvelope(order.prepared.data, input.signedXdr!);
        if (order.signedXdr && order.signedXdr !== input.signedXdr)
          throw new Error("Original submission already saved");
        if (order.paid) return { txHash, status: "PAID" as const };
        order.signedXdr = input.signedXdr;
        order.txHash = txHash;
        await save(); // retain hash/envelope even if the HTTP response is lost
        const result = await deps.deployment.execute.submit(
          { signedXdr: order.signedXdr! },
          {
            wait: false,
            preparationRequestId: order.prepared.metadata.historyRequestId,
          },
        );
        if (result.data.txHash !== txHash) throw new Error("Unexpected transaction hash");
        // Never fulfil on HTTP success. Use this same verifier in your recovery worker.
        if (await deps.verifyReceipt(order)) {
          order.paid = true;
          await save();
        }
        return { txHash, status: order.paid ? "PAID" : result.data.status };
      });
    },
  };
}
