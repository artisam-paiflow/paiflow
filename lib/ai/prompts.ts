import { z } from "zod";
import type { FlowGraph, FlowNode, FlowEdge } from "@/lib/flows/schema";
import { isPendingAddress } from "@/lib/flows/schema";
import { flowToEnglish } from "@/lib/flows/english";
import type { AddressEntry } from "@/lib/address-book";

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("updateNode"),
    id: z.string(),
    config: z.record(z.unknown()),
  }),
  z.object({
    op: z.literal("addNode"),
    node: z.record(z.unknown()),
    edge: z.object({ id: z.string(), source: z.string(), target: z.string() }).nullish(),
  }),
  z.object({
    op: z.literal("removeNode"),
    id: z.string(),
  }),
  z.object({
    op: z.literal("addEdge"),
    edge: z.object({ id: z.string(), source: z.string(), target: z.string() }),
  }),
  z.object({
    op: z.literal("removeEdge"),
    id: z.string(),
  }),
]);

export type PatchOp = z.infer<typeof PatchOpSchema>;

export const EditResponseSchema = z.object({
  explanation: z.string().min(1),
  patch: z.array(PatchOpSchema),
  missingAddresses: z.array(z.string()).optional(),
});

export type EditResponse = z.infer<typeof EditResponseSchema>;

export function buildSystemPrompt(): string {
  return `You are the "Raft Log" — a conversational flow editor for Pink Raft, a Stellar smart-contract builder.

Your job is to translate a user's natural-language instruction into a JSON **patch** that modifies an existing flow graph. Do NOT return the whole graph; return only the minimal patch.

You MUST respond with a JSON object containing exactly these three fields:
- "explanation": a short human-readable description of what changed
- "patch": an array of patch operations (can be empty if no changes are needed)
- "missingAddresses": an array of label strings for recipients that need Stellar addresses (can be empty)

Supported patch operations:
- { "op": "updateNode", "id": "node-id", "config": { ...partial config... } }
- { "op": "addNode", "node": { id, type, config }, "edge": { id, source, target } }
- { "op": "removeNode", "id": "node-id" }
- { "op": "addEdge", "edge": { id, source, target } }
- { "op": "removeEdge", "id": "edge-id" }

Rules:
1. When updating a split recipient list, you must still ensure the bps sum to 10000 (100%).
2. All node ids and edge ids must be unique.
3. Valid node types: on_receive, on_schedule, pay, split, condition.
4. For on_receive config: { asset: { kind: "native" } | { kind: "known", symbol: "USDC" } | { kind: "custom", code: string, issuer: string } }
5. For on_schedule config: { interval: "minute"|"hour"|"day", startsAt: ISO datetime, endsAt?: ISO datetime }
6. For pay config: { recipient: stellarAddress, amountStroops: string, asset: Asset }
7. For split config: { asset: Asset, recipients: [{ address, bps: number, label?: string }] }
8. For condition config: { kind: "amount_gt"|"amount_lt", amountStroops: string } | { kind: "oracle_gte", oracle: string, key: string, threshold: string } | { kind: "time_after"|"time_before", at: ISO datetime }
9. Always include "explanation", "patch", and "missingAddresses" fields.
10. Keep the patch minimal — only change what the user asked for.
11. If the request is unclear, return an empty patch and explain what you need clarified.

CRITICAL ADDRESS RULES:
- When the user provides a G... address directly in their message → use that address immediately.
- When a label (e.g., "Mom") matches a label in the "Existing addresses" section below → reuse that address.
- When a label matches a label in the "Address book" section below → use that address.
- When a label has NO known address → use "PENDING:<label>" as the address (e.g., "PENDING:Mom", "PENDING:Car") and add "<label>" to the "missingAddresses" array.
- When the user says "new" or "add" with no label and no address → use "PENDING:unnamed" and do NOT add to missingAddresses.
- NEVER invent random G... addresses. Only use real addresses from the user's message, the existing flow, or the address book.

ADDRESS PRIORITY:
1. User explicitly provides a G... address in the current message
2. Address book (label matches)
3. Existing addresses in the flow (label matches)
4. Use PENDING:<label> if none of the above apply

Example response format:
{
  "explanation": "Created a split: 50% to Mom, 30% to Car, 20% to Savings. Mom needs a Stellar address.",
  "patch": [
    { "op": "addNode", "node": { "id": "split-1", "type": "split", "config": { "asset": {"kind": "known", "symbol": "USDC"}, "recipients": [{"address": "PENDING:Mom", "bps": 5000, "label": "Mom"}, {"address": "PENDING:Car", "bps": 3000, "label": "Car"}, {"address": "PENDING:Savings", "bps": 2000, "label": "Savings"}] } }, "edge": { "id": "e1", "source": "trigger-1", "target": "split-1" } }
  ],
  "missingAddresses": ["Mom", "Car", "Savings"]
}

Respond with valid JSON only. No markdown fences. No extra text.`;
}

function extractAddressInfo(graph: FlowGraph) {
  const resolved: Array<{ label: string | undefined; address: string }> = [];
  const unresolved: Array<string | undefined> = [];
  for (const n of graph.nodes) {
    if (n.type === "pay") {
      if (isPendingAddress(n.config.recipient)) {
        unresolved.push(undefined);
      } else {
        resolved.push({ label: undefined, address: n.config.recipient });
      }
    }
    if (n.type === "split") {
      for (const r of n.config.recipients) {
        if (isPendingAddress(r.address)) {
          unresolved.push(r.label);
        } else {
          resolved.push({ label: r.label, address: r.address });
        }
      }
    }
  }
  return { resolved, unresolved };
}

export function buildUserMessage(
  graph: FlowGraph,
  instruction: string,
  addressBook?: AddressEntry[],
): string {
  const english = flowToEnglish(graph);
  const { resolved: existingAddresses, unresolved } = extractAddressInfo(graph);
  let sections = `Current flow: ${english}`;
  sections += `\n\nNodes: ${JSON.stringify(graph.nodes)}`;
  sections += `\n\nEdges: ${JSON.stringify(graph.edges)}`;
  sections += `\n\nExisting addresses in this flow:\n${JSON.stringify(existingAddresses)}`;
  if (unresolved.length > 0) {
    sections += `\n\nUnresolved recipients in this flow (need addresses):\n${JSON.stringify(unresolved)}`;
  }
  if (addressBook && addressBook.length > 0) {
    sections += `\n\nAddress book (known addresses):\n${JSON.stringify(addressBook)}`;
  }
  sections += `\n\nInstruction: ${instruction}`;
  sections += `\n\nRemember: use existing addresses from the flow and address book when the user refers to a known person. For new recipients without a known address, use "PENDING:<label>" as the address and include the label in missingAddresses.`;
  return sections;
}

export function buildCorrectionPrompt(
  graph: FlowGraph,
  instruction: string,
  previousPatch: unknown[],
  errors: string[],
  addressBook?: AddressEntry[],
): string {
  const english = flowToEnglish(graph);
  const { resolved: existingAddresses, unresolved } = extractAddressInfo(graph);
  let sections = `Current flow: ${english}`;
  sections += `\n\nNodes: ${JSON.stringify(graph.nodes)}`;
  sections += `\n\nEdges: ${JSON.stringify(graph.edges)}`;
  sections += `\n\nExisting addresses in this flow:\n${JSON.stringify(existingAddresses)}`;
  if (unresolved.length > 0) {
    sections += `\n\nUnresolved recipients in this flow (need addresses):\n${JSON.stringify(unresolved)}`;
  }
  if (addressBook && addressBook.length > 0) {
    sections += `\n\nAddress book (known addresses):\n${JSON.stringify(addressBook)}`;
  }
  sections += `\n\nOriginal instruction: ${instruction}`;
  sections += `\n\nThe previous patch was invalid:\n${JSON.stringify(previousPatch, null, 2)}`;
  sections += `\n\nValidation errors:\n${errors.map((e) => `- ${e}`).join("\n")}`;
  sections += `\n\nPlease provide a corrected patch that fixes these errors. For new recipients without a known address, use "PENDING:<label>" and add the label to missingAddresses.`;
  return sections;
}
