/**
 * #557: `submit-trigger` and `submit-invoke` answered PENDING for a send the
 * RPC refused (TRY_AGAIN_LATER) and wrote the audit row `tx-status` binds its
 * bookkeeping to, so the browser polled a hash that was never queued until it
 * timed out. Mirrors the partner route's cases in `v1/execute.test.ts`.
 *
 * `lib/stellar/trigger.ts` runs for real against a mocked RPC and a really
 * signed envelope, so the route and the send classification are tested as one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionBuilder, Networks, xdr, type Transaction } from "@stellar/stellar-sdk";

const { mockDb, mockRpc, mockLog } = vi.hoisted(() => ({
  mockDb: { deployment: { findFirst: vi.fn() } },
  mockRpc: { getTransaction: vi.fn(), sendTransaction: vi.fn() },
  mockLog: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/log", () => ({ log: mockLog }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => mockRpc,
  withRelayerLock: <T>(fn: () => Promise<T>) => fn(),
}));
vi.mock("@/lib/stellar/invoke", () => ({}));
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  clientIp: vi.fn(() => "203.0.113.9"),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  needsSubmitRow: vi.fn(async (_d: string, _h: string, duplicate?: boolean) => !duplicate),
}));
vi.mock("@/lib/signed-tx", () => ({ recordSignedTransaction: vi.fn(async () => undefined) }));

import { POST as submitTrigger } from "@/app/api/deployments/[id]/submit-trigger/route";
import { POST as submitInvoke } from "@/app/api/deployments/[id]/submit-invoke/route";
import { audit, needsSubmitRow } from "@/lib/audit";
import { recordSignedTransaction } from "@/lib/signed-tx";
import { SEND_NOT_ACCEPTED_MESSAGE } from "@/lib/stellar/send-status";
import {
  DEPLOYMENT_ID,
  OWNER_ID,
  SWAPPER_PIPELINE,
  ctx,
  request,
  signedEnvelope,
  txResult,
} from "./v1/execute-fixtures";

const hashOf = (signed: string) =>
  (TransactionBuilder.fromXDR(signed, Networks.TESTNET) as Transaction).hash().toString("hex");

const routes = [
  ["submit-trigger", submitTrigger, "DEPLOY_TRIGGER"],
  ["submit-invoke", submitInvoke, "DEPLOY_INVOKE"],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.deployment.findFirst.mockResolvedValue({
    id: DEPLOYMENT_ID,
    ownerId: OWNER_ID,
    network: "testnet",
    status: "CONFIRMED",
    pipelineSnapshot: SWAPPER_PIPELINE,
    flow: { templateKind: "SPLITTER" },
  });
});

for (const [name, POST, action] of routes) {
  describe(name, () => {
    const call = (signedXdr: string) =>
      POST(request(`/api/deployments/${DEPLOYMENT_ID}/${name}`, { body: { signedXdr } }), ctx());

    it("502 when the network asks to try again later, and no audit row", async () => {
      const signed = signedEnvelope();
      mockRpc.sendTransaction.mockResolvedValue({
        status: "TRY_AGAIN_LATER",
        hash: hashOf(signed),
      });

      const res = await call(signed);

      expect(res.status).toBe(502);
      expect((await res.json()).error).toEqual({
        code: "UPSTREAM_RPC",
        message: SEND_NOT_ACCEPTED_MESSAGE,
      });
      expect(audit).not.toHaveBeenCalled();
      // The envelope was signed whether or not the network took it.
      expect(recordSignedTransaction).toHaveBeenCalledTimes(1);
    });

    it("a DUPLICATE send (already in the queue) is PENDING and writes no second row", async () => {
      const signed = signedEnvelope();
      mockRpc.sendTransaction.mockResolvedValue({ status: "DUPLICATE", hash: hashOf(signed) });

      const res = await call(signed);

      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ txHash: hashOf(signed), status: "PENDING" });
      expect(audit).not.toHaveBeenCalled();
    });

    it("a DUPLICATE send whose first attempt left no row writes it", async () => {
      const signed = signedEnvelope();
      mockRpc.sendTransaction.mockResolvedValue({ status: "DUPLICATE", hash: hashOf(signed) });
      vi.mocked(needsSubmitRow).mockResolvedValueOnce(true);

      await call(signed);

      expect(needsSubmitRow).toHaveBeenCalledWith(DEPLOYMENT_ID, hashOf(signed), true);
      expect(vi.mocked(audit).mock.calls.map(([a]) => a.action)).toEqual([action]);
    });

    it("a PENDING send writes the one audit row tx-status looks for", async () => {
      const signed = signedEnvelope();
      mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING", hash: hashOf(signed) });

      const res = await call(signed);

      expect((await res.json()).data).toEqual({ txHash: hashOf(signed), status: "PENDING" });
      expect(audit).toHaveBeenCalledTimes(1);
      expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
        action,
        userId: OWNER_ID,
        metadata: { deploymentId: DEPLOYMENT_ID, txHash: hashOf(signed) },
      });
    });

    it("an ERROR send is still a 502 in the shape clients parse, now logged", async () => {
      const signed = signedEnvelope();
      mockRpc.sendTransaction.mockResolvedValue({
        status: "ERROR",
        hash: hashOf(signed),
        errorResult: txResult(xdr.TransactionResultResult.txTooLate()),
      });

      const res = await call(signed);

      expect(res.status).toBe(502);
      const { error } = await res.json();
      expect(error.code).toBe("UPSTREAM_RPC");
      expect(error.message).toContain("sendTransaction error");
      expect(audit).not.toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "UPSTREAM_RPC", status: 502 }),
        "request failed",
      );
    });
  });
}
