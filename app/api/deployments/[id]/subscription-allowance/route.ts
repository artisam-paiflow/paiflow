import { NextRequest, NextResponse } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { withErrorHandler, AppError } from "@/lib/errors";
import {
  withInteractiveRpcBudget,
  interactiveRpcBudgetExpired,
} from "@/lib/stellar/interactive-rpc-budget";
import { allowanceRpcCall } from "@/lib/stellar/allowance-rpc";
import { sorobanRpc } from "@/lib/stellar/client";
import { stellarPassphrase } from "@/lib/env";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { prepareTokenApproveInvocation } from "@/lib/stellar/invoke";
import { readTokenAllowance } from "@/lib/stellar/relayer";
import { subscriptionState, requireSubscriber } from "@/lib/subscription/state";
import {
  AllowanceDeploymentIdSchema,
  AllowancePrepareSchema,
  MAX_ALLOWANCE,
} from "@/lib/subscription/schema";
import { createAllowanceIntent } from "@/lib/subscription/intent";

async function GETHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const id = AllowanceDeploymentIdSchema.parse((await ctx.params).id);
    await enforceRateLimit({
      key: `subscription-allowance-read:${clientIp(req)}`,
      limit: 40,
      windowSeconds: 60,
    });
    const state = await subscriptionState(id, { classifyRpcFailures: true });
    const allowance = state.subscriber
      ? await readTokenAllowance({
          tokenContractAddress: state.tokenContractAddress,
          owner: state.subscriber,
          spender: state.contractAddress,
          classifyRpcFailures: true,
        })
      : 0n;
    return NextResponse.json(
      { data: { ...state, allowance: allowance.toString(), setupRequired: !state.subscriber } },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const id = AllowanceDeploymentIdSchema.parse((await ctx.params).id);
    await enforceRateLimit({
      key: `subscription-allowance-prepare:${clientIp(req)}`,
      limit: 20,
      windowSeconds: 60,
    });
    const body = AllowancePrepareSchema.parse(await req.json());
    const state = await subscriptionState(id, { classifyRpcFailures: true });
    const subscriber = requireSubscriber(state, body.userAddress);
    const currentAllowance = await readTokenAllowance({
      tokenContractAddress: state.tokenContractAddress,
      owner: subscriber,
      spender: state.contractAddress,
      classifyRpcFailures: true,
    });
    const amount = currentAllowance + BigInt(body.amount);
    if (currentAllowance < 0n || amount > MAX_ALLOWANCE)
      throw new AppError("VALIDATION", "Cumulative allowance would exceed the maximum i128 value");
    // Capture before the envelope is exposed to the customer. Any possible
    // inclusion must follow this ledger; wall-clock time is not a safe bound.
    const { sequence: preparationLedger } = await allowanceRpcCall("getLatestLedger", () =>
      sorobanRpc().getLatestLedger(),
    );
    if (
      !Number.isInteger(preparationLedger) ||
      preparationLedger <= 0 ||
      preparationLedger > 0xffff_ffff
    )
      throw new AppError("UPSTREAM_RPC", "Cannot establish approval preparation ledger");
    const { xdr } = await prepareTokenApproveInvocation({
      tokenContractAddress: state.tokenContractAddress,
      from: subscriber,
      spender: state.contractAddress,
      amount: amount.toString(),
    });
    if (interactiveRpcBudgetExpired())
      throw new AppError(
        "UPSTREAM_RPC",
        "Approval preparation exceeded its RPC deadline; try preparing again",
      );
    const prepared = createAllowanceIntent(
      xdr,
      {
        preparationLedger,
        deploymentId: id,
        network: state.network,
        subscriber,
        tokenContractAddress: state.tokenContractAddress,
        contractAddress: state.contractAddress,
      },
      amount.toString(),
    );
    return NextResponse.json(
      {
        data: {
          xdr,
          ...prepared,
          networkPassphrase: stellarPassphrase(),
          allowance: amount.toString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export const GET = deploymentServiceRoute(
  (req, ctx) => withInteractiveRpcBudget(() => GETHandler(req, ctx)),
  "public",
);

export const POST = deploymentServiceRoute(
  (req, ctx) => withInteractiveRpcBudget(() => POSTHandler(req, ctx)),
  "public",
);
