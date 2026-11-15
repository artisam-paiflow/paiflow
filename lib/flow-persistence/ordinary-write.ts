import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isConditionalCanvas, type OrdinaryFlowGraph } from "@/lib/flows/ordinary-schema";

/** Update's extended unique WHERE is the atomic write predicate, not a prior
 * check. Compare the captured raw JSON, before migration or Zod normalization.
 * Metadata-only updates intentionally write only their own requested columns. */
export async function writeOrdinaryFlow(input: {
  id: string;
  ownerId: string;
  originalGraph: Prisma.JsonValue;
  replacement?: OrdinaryFlowGraph;
  data: Omit<Prisma.FlowUpdateInput, "graph" | "owner" | "ownerId">;
}) {
  const raw = input.originalGraph;
  if (
    input.replacement !== undefined &&
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    ("generation" in raw || "conditionalPolicies" in raw) &&
    !isConditionalCanvas(input.replacement)
  )
    throw new AppError(
      "CONFLICT",
      "A conditional reusable draft cannot be changed to a legacy flow. Reload the current draft before editing.",
    );
  try {
    return await db.flow.update({
      where: {
        id: input.id,
        ownerId: input.ownerId,
        ...(input.replacement === undefined
          ? {}
          : { graph: { equals: raw === null ? Prisma.JsonNull : (raw as Prisma.InputJsonValue) } }),
      },
      data: {
        ...input.data,
        ...(input.replacement === undefined ? {} : { graph: input.replacement as object }),
      },
    });
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "P2025")
      throw new AppError(
        "CONFLICT",
        "The flow changed before this edit could be saved. Reload the current draft; no stale graph was written.",
      );
    throw error;
  }
}
