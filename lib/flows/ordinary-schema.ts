import { z } from "zod";
import { FlowGraphSchema, FlowSaveSchema } from "@/lib/flows/schema";
import { ConditionalCanvasSchema, type ConditionalCanvas } from "./conditional-canvas-schema";

/** Ordinary flows opt in explicitly. Template input schemas remain v1-only. */
export const OrdinaryFlowGraphSchema = z.union([ConditionalCanvasSchema, FlowGraphSchema]);
export type OrdinaryFlowGraph = z.infer<typeof OrdinaryFlowGraphSchema>;
export const OrdinaryFlowSaveSchema = FlowSaveSchema.extend({ graph: OrdinaryFlowGraphSchema });
export type OrdinaryFlowSaveInput = z.infer<typeof OrdinaryFlowSaveSchema>;
export const OrdinaryFlowPatchSchema = OrdinaryFlowSaveSchema.partial();
export type OrdinaryFlowPatchInput = z.infer<typeof OrdinaryFlowPatchSchema>;
export function isConditionalCanvas(graph: OrdinaryFlowGraph): graph is ConditionalCanvas {
  return "generation" in graph && graph.generation === "conditional-v2";
}
