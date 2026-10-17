import { NextResponse } from "next/server";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import { AppError } from "@/lib/errors";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { assertDepositEnvelope, resolveExecutablePipeline } from "@/lib/api/v1/execute";
import { ExecuteSubmitQuerySchema, ExecuteSubmitSchema } from "@/lib/api/v1/schema";
import { clientIp } from "@/lib/rate-limit";
import { submitPreparedDeposit } from "@/lib/stellar/submit-deposit";

export const POST = v1Route(
  { operation: "POST execute/submit", rateLimit: V1_RATE_LIMITS.executeSubmit },
  async ({ req, params, token, tokenType, deployment }) => {
    const input = ExecuteSubmitSchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    const { wait } = ExecuteSubmitQuerySchema.parse({
      wait: new URL(req.url).searchParams.get("wait") ?? undefined,
    });
    const { nodes, triggerAddress } = resolveExecutablePipeline(deployment);
    const tx = assertDepositEnvelope(input.signedXdr, triggerAddress);
    linkApiTransaction(tx.hash().toString("hex"));
    const data = await submitPreparedDeposit({
      tx,
      wait,
      tokenId: token.id,
      tokenType,
      deploymentId: params.id,
      deployment,
      nodes,
      ip: clientIp(req),
    });
    return NextResponse.json({ data });
  },
);
