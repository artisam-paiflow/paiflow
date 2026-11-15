import { z } from "zod";
import { NodeFieldPolicySchema, PolicyIdSchema, REUSABLE_LIMITS } from "@/lib/flows/field-policies";
import { FlowEdgeSchema, FlowNodeSchema, NotifySchema } from "@/lib/flows/schema";

/** Explicit ordinary-flow draft generation, separate from deployed wire evidence
 * and retained v1/template schemas. Incomplete topology stays a draft; deployment
 * requires the strict normalized conditional definition and reviewed artifacts. */
export const ConditionalCanvasSchema = z
  .object({
    generation: z.literal("conditional-v2"),
    nodes: z.array(FlowNodeSchema).max(REUSABLE_LIMITS.nodes),
    edges: z.array(FlowEdgeSchema).max(80),
    conditionalPolicies: z
      .object({
        version: z.literal(2),
        nodes: z.array(NodeFieldPolicySchema).max(REUSABLE_LIMITS.nodes),
        condition: z
          .object({ nodeId: PolicyIdSchema, thresholdMode: z.enum(["constant", "mutable"]) })
          .strict()
          .optional(),
      })
      .strict(),
    fieldPolicies: z.never().optional(),
    notify: NotifySchema.optional(),
    positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() }).strict()).optional(),
  })
  .strict()
  .superRefine((graph, ctx) => {
    if (
      new Set(graph.nodes.map((node) => node.id)).size !== graph.nodes.length ||
      new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length ||
      new Set(graph.conditionalPolicies.nodes.map((node) => node.nodeId)).size !==
        graph.conditionalPolicies.nodes.length
    )
      ctx.addIssue({ code: "custom", message: "Conditional draft identities must be unique" });
    for (const node of graph.nodes) {
      if (
        !["on_receive", "pay", "split", "condition", "return_to_owner"].includes(node.type) ||
        (node.type === "condition" &&
          node.config.kind !== "amount_gt" &&
          node.config.kind !== "amount_lt")
      )
        ctx.addIssue({
          code: "custom",
          message: "This block is outside conditional reusable payments",
        });
    }
    for (const policy of graph.conditionalPolicies.nodes) {
      if (!graph.nodes.some((node) => node.id === policy.nodeId && node.type === policy.kind))
        ctx.addIssue({
          code: "custom",
          message: "Conditional policies require matching Pay/Split nodes",
        });
    }
    if (
      graph.conditionalPolicies.condition &&
      !graph.nodes.some(
        (node) =>
          node.id === graph.conditionalPolicies.condition!.nodeId && node.type === "condition",
      )
    )
      ctx.addIssue({ code: "custom", message: "Threshold mode must name its authored condition" });
  });
export type ConditionalCanvas = z.infer<typeof ConditionalCanvasSchema>;
