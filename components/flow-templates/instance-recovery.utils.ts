import { z } from "zod";
import { FlowGraphSchema } from "@/lib/flows/schema";
import {
  InstancePrepareSchema,
  InstanceStateSchema,
  type InstanceState,
} from "@/lib/flow-instances/schema";

export const InstanceRecoverySchema = z
  .object({
    ownerId: z.uuid(),
    templateId: z.uuid(),
    versionId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    request: InstancePrepareSchema,
    graph: FlowGraphSchema,
    phase: z.enum(["preparing", "prepared", "held", "signing", "submitted", "final"]),
    receipt: InstanceStateSchema.nullable(),
    attemptId: z.uuid().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.request.bindings.templateVersionId !== r.versionId ||
      (r.receipt &&
        (r.receipt.templateId !== r.templateId ||
          r.receipt.templateVersionId !== r.versionId ||
          r.receipt.network !== r.network ||
          r.receipt.sourceAccount !== r.request.sourceAccount)) ||
      (r.phase !== "preparing" && !r.receipt) ||
      ((r.phase === "signing" || r.phase === "submitted") && !r.attemptId)
    )
      ctx.addIssue({ code: "custom", message: "Instance recovery identity is inconsistent" });
  });
export type InstanceRecovery = z.infer<typeof InstanceRecoverySchema>;
export const instanceRecoveryKey = (ownerId: string, network: string, templateId: string) =>
  `paiflow_instance:${ownerId}:${network}:${templateId}`;
export function readInstanceRecovery(key: string): InstanceRecovery | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const parsed = InstanceRecoverySchema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "Saved instance recovery is invalid. Resolve the original instance before creating another.",
    );
  return parsed.data;
}
export function writeInstanceRecovery(key: string, value: InstanceRecovery) {
  const parsed = InstanceRecoverySchema.parse(value);
  localStorage.setItem(key, JSON.stringify(parsed));
  if (JSON.stringify(readInstanceRecovery(key)) !== JSON.stringify(parsed))
    throw new Error(
      "Instance recovery could not be saved. No new signing or submission will begin.",
    );
  window.dispatchEvent(new Event("paiflow-instance-recovery"));
}
export function assertInstanceReceipt(
  receipt: InstanceState,
  expected: {
    templateId: string;
    versionId: string;
    network: string;
    sourceAccount: string;
    deploymentId?: string;
    txHash?: string | null;
  },
) {
  if (
    receipt.templateId !== expected.templateId ||
    receipt.templateVersionId !== expected.versionId ||
    receipt.network !== expected.network ||
    receipt.sourceAccount !== expected.sourceAccount ||
    (expected.deploymentId && receipt.deploymentId !== expected.deploymentId) ||
    (expected.txHash && receipt.txHash !== expected.txHash)
  )
    throw new Error("Instance receipt does not match the original reviewed identity.");
}
