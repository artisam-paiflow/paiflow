import { NextResponse } from "next/server";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import { AppError } from "@/lib/errors";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { ExecuteSubmitQuerySchema, PayoutSubmitSchema } from "@/lib/api/v1/schema";
import { assertDepositEnvelope, resolveExecutablePipeline } from "@/lib/api/v1/execute";
import { assertPreparedPayout, releasePreparedPayout } from "@/lib/api/v1/payout-lease";
import { payoutTransactionFinished } from "@/lib/stellar/payout-state";
import { submitPreparedDeposit } from "@/lib/stellar/submit-deposit";
import { clientIp } from "@/lib/rate-limit";

export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.payoutsSubmit },
  async ({ req, params, token, deployment }) => {
    const input = PayoutSubmitSchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    const { wait } = ExecuteSubmitQuerySchema.parse({
      wait: new URL(req.url).searchParams.get("wait") ?? undefined,
    });
    const { nodes, triggerAddress } = resolveExecutablePipeline(deployment);
    const tx = assertDepositEnvelope(input.signedXdr, triggerAddress);
    const { record, allowSubmit } = await assertPreparedPayout(
      params.id,
      token.id,
      tx.hash().toString("hex"),
    );
    linkApiTransaction(tx.hash().toString("hex"));
    const data = await submitPreparedDeposit({
      tx,
      wait,
      tokenId: token.id,
      deploymentId: params.id,
      deployment,
      nodes,
      ip: clientIp(req),
      auditKind: "payout",
      allowSubmit,
    });
    // An ERROR from sendTransaction is a refusal now, not proof it cannot land later.
    if (
      data.status !== "PENDING" &&
      record.deposit &&
      (await payoutTransactionFinished(record.deposit))
    )
      await releasePreparedPayout(record);
    return NextResponse.json({ data });
  },
);
