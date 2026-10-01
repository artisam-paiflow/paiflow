import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { FlowGraphSchema, migrateFlowGraph } from "@/lib/flows/schema";
import { assetsEqual } from "@/lib/flows/validate";
import { conditionBranchTargets, routerPathBranch } from "@/lib/flows/branches";
import { findPipelineNode } from "@/lib/flows/pipeline-snapshot";
import { assetContractId } from "@/lib/stellar/assets";
import { fetchTokenBalance } from "@/lib/stellar/balance";
import { readPayoutState } from "@/lib/stellar/payout-state";
import { resolveExecutablePipeline } from "./execute";
import { requirePayConsumesAll, splitPayoutRemainder } from "./payout-money";
import type { PayoutPrepare } from "./schema";

const Money = z
  .union([z.bigint(), z.string().regex(/^\d+$/)])
  .transform(String)
  .refine((s) => BigInt(s) >= 0n);
const Targets = z.array(z.object({ address: z.string().refine(StrKey.isValidContract) }));
const Recipients = z.array(
  z.object({
    address: z.string(),
    amount: Money,
    bps: z.number().int().min(0).max(10000),
    is_cash_out: z.boolean(),
  }),
);
const invalid = (message: string) => new AppError("VALIDATION", message);

export async function payoutEligibility(
  deployment: Pick<Deployment, "status" | "pipelineSnapshot" | "graphSnapshot">,
  input: PayoutPrepare,
) {
  const { nodes, triggerAddress } = resolveExecutablePipeline(deployment);
  const graph = FlowGraphSchema.parse(migrateFlowGraph(deployment.graphSnapshot));
  const selected = findPipelineNode(deployment.pipelineSnapshot, "PAYER_DEV", input.nodeId);
  const pay = graph.nodes.find((n) => n.id === selected.nodeId);
  const trigger = graph.nodes.find((n) => n.id === nodes[0]?.nodeId);
  if (
    pay?.type !== "pay" ||
    trigger?.type !== "on_receive" ||
    !graph.devMode ||
    pay.config.payoutMode === "fiat"
  )
    throw invalid("Payouts require a deposit-triggered dev flow and a crypto Pay");
  const asset = trigger.config.asset;
  if (!assetsEqual(asset, pay.config.asset)) throw invalid("Pay must receive the deposit asset");
  const tokenAddress = assetContractId(asset);
  const read = (address: string, method: string) => readPayoutState(address, method, input.from);
  if ((await read(triggerAddress, "asset")) !== tokenAddress)
    throw invalid("The deployed trigger asset does not match its graph");
  let incoming = input.amount;
  let cursor = nodes[0]!;
  const seen = new Set<string>();
  while (cursor.nodeId !== selected.nodeId) {
    if (seen.has(cursor.nodeId)) throw invalid("Payout path contains a cycle");
    seen.add(cursor.nodeId);
    const node = graph.nodes.find((n) => n.id === cursor.nodeId);
    let targets: string[];
    let expectedIds: string[];
    if (cursor.templateKind === "DEPOSIT_TRIGGER" && node?.type === "on_receive") {
      targets = Targets.parse(await read(cursor.contractAddress, "next_steps")).map(
        (t) => t.address,
      );
      expectedIds = graph.edges
        .filter(
          (e) =>
            e.source === node.id &&
            graph.nodes.find((n) => n.id === e.target)?.type !== "email_notify",
        )
        .map((e) => e.target);
    } else if (
      cursor.templateKind === "ROUTER" &&
      node?.type === "condition" &&
      (node.config.kind === "amount_gt" || node.config.kind === "amount_lt")
    ) {
      const threshold = Money.parse(await read(cursor.contractAddress, "threshold"));
      const path = BigInt(incoming) >= BigInt(threshold) ? "A" : "B";
      targets = Targets.parse(
        await read(cursor.contractAddress, path === "A" ? "path_a" : "path_b"),
      ).map((t) => t.address);
      expectedIds = conditionBranchTargets(graph, node.id)[
        routerPathBranch(node.config.kind, path)
      ];
    } else if (
      (cursor.templateKind === "SPLITTER" || cursor.templateKind === "SPLITTER_DEV") &&
      node?.type === "split"
    ) {
      if (!assetsEqual(asset, node.config.asset))
        throw invalid("Upstream Split must use the deposit asset");
      const total = Money.parse(await read(cursor.contractAddress, "total_fixed_amount"));
      const accumulated = Money.parse(await read(cursor.contractAddress, "accumulated_balance"));
      const balance = await fetchTokenBalance({
        tokenAddress,
        holderAddress: cursor.contractAddress,
        sourceAccount: input.from,
      });
      const recipients = Recipients.parse(await read(cursor.contractAddress, "recipients"));
      if (
        !recipients.length ||
        recipients.some(
          (r) =>
            !StrKey.isValidEd25519PublicKey(r.address) ||
            r.is_cash_out ||
            r.bps !== 0 ||
            BigInt(r.amount) <= 0n,
        ) ||
        recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n) !== BigInt(total)
      )
        throw invalid(
          "Upstream Split must have a configured fixed crypto roster with no contract recipients",
        );
      if (BigInt(incoming) < BigInt(trigger.config.minAmountStroops ?? "0"))
        throw invalid("Deposit is below the Split minimum");
      incoming = splitPayoutRemainder(incoming, total, accumulated, balance.toString());
      targets = Targets.parse(await read(cursor.contractAddress, "next_steps")).map(
        (t) => t.address,
      );
      expectedIds = graph.edges
        .filter(
          (e) =>
            e.source === node.id &&
            graph.nodes.find((n) => n.id === e.target)?.type !== "email_notify",
        )
        .map((e) => e.target);
    } else
      throw invalid(
        "Payouts allow only immediate Split and amount-condition paths before the selected Pay; delayed and other paths are unsupported",
      );
    if (targets.length !== 1 || expectedIds.length !== 1)
      throw invalid("Payouts require exactly one immediate destination at each executed step");
    const next = nodes.find((n) => n.contractAddress === targets[0]);
    if (!next || next.nodeId !== expectedIds[0])
      throw invalid(
        "On-chain connectivity differs from the deployed graph or this deposit does not reach the selected Pay",
      );
    cursor = next;
  }
  if ((await read(selected.contractAddress, "asset")) !== tokenAddress)
    throw invalid("The selected Pay asset differs from the deposit");
  const balance = await fetchTokenBalance({
    tokenAddress,
    holderAddress: selected.contractAddress,
    sourceAccount: input.from,
  });
  if (balance !== 0n)
    throw invalid(
      "Selected Pay has an existing balance; per-payment payouts require no pooled funds",
    );
  const current = {
    recipient: z
      .string()
      .nullable()
      .optional()
      .parse(await read(selected.contractAddress, "recipient")),
    amountStroops: Money.parse(await read(selected.contractAddress, "configured_amount")),
    percentageBps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(await read(selected.contractAddress, "percentage_bps")),
    isCashOut: z.boolean().parse(await read(selected.contractAddress, "is_cash_out")),
  };
  if (current.isCashOut) throw invalid("Fiat Pay is not eligible for per-payment payouts");
  const required = pay.config.fillValueViaApi
    ? { amountStroops: "0", percentageBps: 10000 }
    : { amountStroops: current.amountStroops, percentageBps: current.percentageBps };
  requirePayConsumesAll(incoming, required);
  return { nodes, triggerAddress, selected, asset, incoming, current, required };
}
