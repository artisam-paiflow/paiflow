import { CreationValueSchema, type CreationValue } from "@/lib/flows/field-policies";
import type { FlowGraph } from "@/lib/flows/schema";
import type { CreationDeclaration, CreationField } from "@/lib/flow-templates/schema";

export type CreationLeaf = Pick<CreationDeclaration, "target" | "type">;
/** UI choices are finite leaves; authoritative compiler validation still runs on save/bind. */
export function creationLeaves(graph: FlowGraph): CreationLeaf[] {
  const leaves: CreationLeaf[] = [];
  for (const node of graph.nodes) {
    const policy = graph.fieldPolicies?.nodes.find((p) => p.nodeId === node.id);
    const add = (field: CreationField, type: CreationValue["type"], index?: number) =>
      leaves.push({
        target: { nodeId: node.id, field, ...(index === undefined ? {} : { index }) },
        type,
      });
    switch (node.type) {
      case "pay":
        if (policy?.kind !== "pay" || policy.recipient !== "execution") add("recipient", "wallet");
        if (!node.config.fullAmount) {
          if (node.config.mode === "fixed") add("amountStroops", "stroops");
          else add("percentageBps", "bps");
        }
        break;
      case "split":
        node.config.recipients.forEach((row, i) => {
          const p = policy?.kind === "split" ? policy.rows[i] : undefined;
          if (p?.recipient !== "execution") add("splitRecipient", "wallet", i);
          if (p?.allocation !== "execution")
            add(
              row.mode === "fixed" ? "splitAmountStroops" : "splitBps",
              row.mode === "fixed" ? "stroops" : "bps",
              i,
            );
        });
        if (
          graph.nodes.some((n) => n.type === "on_schedule") &&
          node.config.recipients.every((r) => r.mode === "percentage")
        )
          add("amountPerIntervalStroops", "stroops");
        break;
      case "on_receive":
        if (graph.fieldPolicies) add("minAmountStroops", "stroops");
        break;
      case "on_schedule":
        add("startsAt", "timestamp");
        add("pauseAllowed", "boolean");
        add("retrieveAllowed", "boolean");
        add("intervalAmount", "integer");
        add("intervalUnit", "text");
        if (!node.config.endsAt) add("occurrences", "integer");
        if (node.config.endsAt || node.config.occurrences === undefined) add("endsAt", "timestamp");
        break;
      case "subscription": {
        add("subscriber", "wallet");
        const child = graph.nodes.find(
          (n) => n.id === graph.edges.find((e) => e.source === node.id)?.target,
        );
        if (
          !(
            child?.type === "split" &&
            child.config.recipients.length &&
            child.config.recipients.every((r) => r.mode === "fixed")
          )
        )
          add("amountPerPeriodStroops", "stroops");
        add("intervalAmount", "integer");
        add("intervalUnit", "text");
        if (!node.config.endsAt) add("occurrences", "integer");
        if (node.config.endsAt || node.config.occurrences === undefined) add("endsAt", "timestamp");
        break;
      }
      case "webhook":
        add("relayer", "wallet");
        break;
      case "oracle":
        add("threshold", "text");
        break;
      case "condition":
        switch (node.config.kind) {
          case "amount_gt":
          case "amount_lt":
            add("amountStroops", "stroops");
            break;
          case "time_after":
          case "time_before":
            add("at", "timestamp");
            break;
          case "multisig":
            node.config.signers.forEach((_, i) => add("signer", "wallet", i));
            add("threshold", "integer");
            break;
          case "oracle_gte":
            add("oracle", "wallet");
            add("oracleKey", "text");
            add("threshold", "text");
            break;
        }
        break;
      case "swap":
        add("slippageBps", "bps");
        add("deadlineSecs", "integer");
        break;
      case "yield":
        add("vault", "wallet");
        break;
      case "web2_webhook":
      case "hold":
      case "return_to_owner":
      case "email_notify":
        break;
      default: {
        const exhaustive: never = node;
        throw new Error(`Unsupported node ${String(exhaustive)}`);
      }
    }
  }
  return leaves;
}
export function leafLabel(leaf: CreationLeaf) {
  return `${leaf.target.nodeId} · ${leaf.target.field}${leaf.target.index === undefined ? "" : ` · row ${leaf.target.index + 1}`} (${leaf.type})`;
}
export function parseCreationValue(type: CreationValue["type"], raw: string): CreationValue {
  if (!raw.length && type !== "text") throw new Error("A value is required");
  const value =
    type === "boolean"
      ? raw === "true"
        ? true
        : raw === "false"
          ? false
          : raw
      : type === "integer" || type === "bps"
        ? /^\d+$/.test(raw)
          ? Number(raw)
          : raw
        : raw;
  return CreationValueSchema.parse({ type, value });
}
