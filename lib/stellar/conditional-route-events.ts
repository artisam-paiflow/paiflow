import "server-only";
import type { ContractEvent, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { conditionalObservationEvidence } from "@/lib/mutations/conditional-history";
import { conditionalBindingsSchema } from "@/lib/flows/conditional-v2";
import { ConditionalNodeStateSchema } from "@/lib/flows/conditional-v2-state";
import {
  ConfigurationRevisionSchema,
  ContractAddressSchema,
  StroopsSchema,
  WalletAddressSchema,
} from "@/lib/flows/field-policies";

const decimal = z.preprocess(
  (value) =>
    typeof value === "string" && /^(0|[1-9]\d{0,38})$/.test(value) ? BigInt(value) : value,
  z.bigint().nonnegative().transform(String),
);
/** convertBigInts persists native byte vectors as indexed JSON objects. Decode
 * only exact32byte positions, never arbitrary objects elsewhere in the payload. */
const bytes = z.preprocess(
  (raw) => {
    if (raw instanceof Uint8Array) return raw;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      if (
        Object.keys(record).length === 32 &&
        Array.from({ length: 32 }, (_, i) => String(i)).every((key) =>
          Object.hasOwn(record, key),
        ) &&
        Object.values(record).every(
          (value) =>
            typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255,
        )
      )
        return Uint8Array.from(Array.from({ length: 32 }, (_, i) => record[String(i)] as number));
    }
    return raw;
  },
  z
    .instanceof(Uint8Array)
    .refine((value) => value.length === 32)
    .transform((value) => Buffer.from(value).toString("hex")),
);
const rawRouteSchema = z
  .object({
    root: ContractAddressSchema,
    payer: WalletAddressSchema,
    nonce: bytes,
    amount_at_condition: decimal.pipe(StroopsSchema),
    selected_branch: z.union([z.tuple([z.literal("True")]), z.tuple([z.literal("False")])]),
    condition_revision: decimal.pipe(ConfigurationRevisionSchema),
    bindings: z
      .array(
        z
          .object({
            node_id: z.string(),
            contract_address: ContractAddressSchema,
            expected_revision: decimal.pipe(ConfigurationRevisionSchema),
            wasm_hash: bytes,
          })
          .strict(),
      )
      .min(4)
      .max(40),
  })
  .strict();

export async function projectConditionalRouteEvent(
  event: Pick<ContractEvent, "deploymentId" | "eventId" | "payload" | "ledger" | "txHash">,
) {
  const payload = z
    .object({
      topics: z.tuple([z.literal("route_v2"), z.string()]),
      value: z.unknown(),
      contractAddress: z.string(),
      inSuccessfulContractCall: z.boolean().optional(),
    })
    .passthrough()
    .parse(event.payload);
  if (payload.inSuccessfulContractCall === false) return;
  const deployment = await db.deployment.findUniqueOrThrow({ where: { id: event.deploymentId } });
  const original = conditionalObservationEvidence(deployment);
  const ci = original.manifest.nodes.length - 3;
  const condition = original.manifest.nodes[ci]!.state;
  if (
    condition.nodeId !== payload.topics[1] ||
    condition.contractAddress !== payload.contractAddress
  )
    throw new Error("Conditional route must originate from its immutable condition");
  const value = rawRouteSchema.parse(payload.value);
  const nodes = conditionalBindingsSchema(original.definition).parse(
    value.bindings.map((node) => ({
      nodeId: node.node_id,
      contractAddress: node.contract_address,
      expectedRevision: node.expected_revision,
      wasmHash: node.wasm_hash,
    })),
  );
  if (
    value.root !== original.manifest.rootContract ||
    value.condition_revision !== nodes[ci]!.expectedRevision ||
    nodes.some(
      (node, index) =>
        node.wasmHash !== original.manifest.nodes[index]!.wasmHash ||
        node.contractAddress !== original.manifest.nodes[index]!.state.contractAddress,
    )
  )
    throw new Error("Conditional route differs from immutable graph bindings");
  nodes.forEach((node, index) =>
    ConditionalNodeStateSchema.parse({
      ...original.manifest.nodes[index]!.state,
      revision: node.expectedRevision,
    }),
  );
  const route = {
    version: 2 as const,
    nodeId: condition.nodeId,
    rootContract: value.root,
    payer: value.payer,
    nonce: value.nonce,
    amountAtConditionStroops: value.amount_at_condition,
    selectedBranch: value.selected_branch[0] === "True" ? ("true" as const) : ("false" as const),
    conditionRevision: value.condition_revision,
    nodes,
  };
  // Route reports are status evidence, never configuration history or payouts.
  // In particular, do not test historical selection against today's threshold.
  await db.contractEvent.update({
    where: { eventId: event.eventId },
    data: { kind: "STATUS_CHANGE", decodedData: { route } as unknown as Prisma.InputJsonValue },
  });
  return route;
}
