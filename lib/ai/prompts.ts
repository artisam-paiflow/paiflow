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
1. EVERY addNode for a pay, split, or condition node MUST include an "edge" connecting it to the previous node. The edge's "source" is the ID of the node it connects FROM, and "target" is the new node's ID. Without an edge, the flow is broken.
2. When updating a split recipient list, bps must sum to 10000 (100%).
3. All node ids and edge ids must be unique.
4. Valid node types: on_receive, on_schedule, pay, split, condition.
5. For on_receive config: { asset: Asset, minAmountStroops?: string }
6. For on_schedule config: { interval: "minute"|"hour"|"day", startsAt: ISO datetime, endsAt?: ISO datetime }
7. For pay config: { recipient: stellarAddress, amountStroops: string, asset: Asset }
8. For split config: { asset: Asset, recipients: [{ address, bps: number, label?: string }], ratePerSecondStroops?: string }
9. For condition config: { kind: "amount_gt"|"amount_lt", amountStroops: string } | { kind: "oracle_gte", oracle: string, key: string, threshold: string } | { kind: "time_after"|"time_before", at: ISO datetime }
10. Keep the patch minimal — only change what the user asked for.
11. If the request is unclear, return an empty patch and explain what you need clarified.

FINDING & UPDATING EXISTING NODES:
- When the user says "change", "update", "modify", "set", or "make [something]" — use updateNode on EXISTING nodes. Only use addNode when the user says "add", "create", or "new".
- You MUST use the EXACT node id from the provided Nodes list. Never invent your own node IDs.
- FIND BY LABEL: When the user says "change Mom" or "make Mom 60%", find the split node whose recipients contain label "Mom". Use updateNode on that split node's id, updating the full recipients array.
- SPLIT SHARE CHANGES: Each recipient's bps must be at least 1. Never set bps to 0 — that would represent 0% ownership and isn't allowed. To remove a recipient, omit them from the array entirely.
- REDISTRIBUTING SHARES: When you change one recipient's share, keep the other recipients at their current bps and adjust only the LAST recipient to balance the total back to 10000. Example: Mom 5000 (50%), Dad 3000 (30%), Savings 2000 (20%). "Change Mom to 40%" → Mom 4000, Dad 3000, Savings 3000 (last adjusted to balance).
- FIND BY TYPE: When the user says "change the schedule to daily", find the on_schedule trigger node. When the user says "change the pay amount", find the pay action node.
- FIND BY ASSET: When the user says "change asset to XLM", find all applicable nodes and updateNode each one's config.asset.
- CHANGE ADDRESS: When the user says "change [label]'s address" without a new address → return an empty patch and include the label in "missingAddresses" to prompt the user.
- CHANGE ADDRESS DIRECTLY: When the user provides both a label and a new G... address (e.g., "change Mom to GA5Z...") → use updateNode on the split node to replace Mom's address directly.

CRITICAL SAFETY RULES:
- NEVER add a second trigger node. Every flow has exactly ONE trigger (on_receive or on_schedule). To change the trigger type, use updateNode on the existing trigger.
- A condition node must sit between a trigger and an action. Condition nodes cannot be leaf nodes.
- Split recipients sum to 10000 bps (100%). Each recipient's bps must be ≥ 1. Never set bps to 0. Percent → bps: multiply by 100. E.g., 40% = 4000 bps.
- WHEN THE USER SAYS "CHANGE" — always use updateNode, never addNode. Updating a node's config is always preferred over adding a duplicate.

CRITICAL ADDRESS RULES:
- When the user provides a G... address directly → use it immediately.
- When a label matches a label in the "Existing addresses" or "Address book" section → reuse that address.
- When a label has NO known address → use "PENDING:<label>" and add "<label>" to "missingAddresses".
- When the user says "change [label]'s address" or "update [name]'s address": include the label in "missingAddresses", return an empty patch, and explain you need the new address. Do NOT generate any patch operations — just request the new address.
- If the user says "change [label] to [G...address]" directly → use updateNode on the matching node to replace the address inline. No missingAddresses needed.
- NEVER invent random G... addresses. Only use real addresses from the user's message, existing flow, or address book.

Examples — updateNode (change existing):
{
  "explanation": "Changed payment amount to 50 XLM.",
  "patch": [
    { "op": "updateNode", "id": "pay-a9b4c1", "config": { "amountStroops": "500000000" } }
  ],
  "missingAddresses": []
}

{
  "explanation": "Changed Mom's share from 50% to 60%, Landlord from 30% to 20%.",
  "patch": [
    { "op": "updateNode", "id": "split-x7k2m3", "config": { "recipients": [{"address": "PENDING:Mom", "bps": 6000, "label": "Mom"}, {"address": "PENDING:Landlord", "bps": 2000, "label": "Landlord"}, {"address": "PENDING:Savings", "bps": 2000, "label": "Savings"}] } }
  ],
  "missingAddresses": ["Mom", "Landlord"]
}

Example — address change request (no patch, prompt user):
{
  "explanation": "What's Mom's new Stellar address?",
  "patch": [],
  "missingAddresses": ["Mom"]
}

Example — addNode (creating new):
{
  "explanation": "Created a split: 50% to Mom, 30% to Car, 20% to Savings.",
  "patch": [
    { "op": "addNode", "node": { "id": "split-1", "type": "split", "config": { "asset": {"kind": "known", "symbol": "USDC"}, "recipients": [{"address": "PENDING:Mom", "bps": 5000, "label": "Mom"}, {"address": "PENDING:Car", "bps": 3000, "label": "Car"}, {"address": "PENDING:Savings", "bps": 2000, "label": "Savings"}] } }, "edge": { "id": "e1", "source": "recv-abc123", "target": "split-1" } }
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
  sections += `\n\nAMOUNT CONVERSION: The user specifies amounts in token units (e.g., "10 XLM", "50 USDC"). Convert to stroops by multiplying by 10,000,000. Examples: "10 XLM" → "100000000", "0.5 XLM" → "5000000", "1 USDC" → "10000000".`;
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
