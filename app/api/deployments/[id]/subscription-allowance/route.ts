import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, AppError } from "@/lib/errors";
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const id = AllowanceDeploymentIdSchema.parse((await ctx.params).id);
    await enforceRateLimit({
      key: `subscription-allowance-read:${clientIp(req)}`,
      limit: 40,
      windowSeconds: 60,
    });
    const state = await subscriptionState(id);
    const allowance = state.subscriber
      ? await readTokenAllowance({
          tokenContractAddress: state.tokenContractAddress,
          owner: state.subscriber,
          spender: state.contractAddress,
        })
      : 0n;
    return NextResponse.json(
      { data: { ...state, allowance: allowance.toString(), setupRequired: !state.subscriber } },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const id = AllowanceDeploymentIdSchema.parse((await ctx.params).id);
    await enforceRateLimit({
      key: `subscription-allowance-prepare:${clientIp(req)}`,
      limit: 20,
      windowSeconds: 60,
    });
    const body = AllowancePrepareSchema.parse(await req.json());
    const state = await subscriptionState(id);
    const subscriber = requireSubscriber(state, body.userAddress);
    const currentAllowance = await readTokenAllowance({
      tokenContractAddress: state.tokenContractAddress,
      owner: subscriber,
      spender: state.contractAddress,
    });
    const amount = currentAllowance + BigInt(body.amount);
    if (currentAllowance < 0n || amount > MAX_ALLOWANCE)
      throw new AppError("VALIDATION", "Cumulative allowance would exceed the maximum i128 value");
    const { xdr } = await prepareTokenApproveInvocation({
      tokenContractAddress: state.tokenContractAddress,
      from: subscriber,
      spender: state.contractAddress,
      amount: amount.toString(),
    });
    const prepared = createAllowanceIntent(
      xdr,
      {
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
