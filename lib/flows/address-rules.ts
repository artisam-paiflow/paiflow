import { StrKey } from "@stellar/stellar-sdk";
import type { ValidationIssue } from "./issue";
import { isPendingAddress, type FlowGraph, type FlowNode } from "./schema";

// Pure and client-safe, like swap-rules.ts. The shape schema lets any string
// sit in an address field, because the builder autosaves the whole graph on
// every keystroke and a half-typed or cleared address used to 422 every save,
// losing unrelated edits with it (#588). This is where an address is actually
// checked: validateFlow runs it, so /api/deployments/prepare refuses the flow
// before anything is built or signed.
//
// Nothing here repairs a value. An address is where money goes, so a string
// that is not already a complete strkey is reported as typed, never trimmed,
// upper-cased or otherwise turned into a different, valid address.

/** Which strkeys a field takes. Unchanged from what the schema used to enforce. */
export type AddressAccepts = "account" | "account_or_contract";

export function isAcceptedFlowAddress(value: string, accepts: AddressAccepts): boolean {
  if (isPendingAddress(value)) return true;
  if (StrKey.isValidEd25519PublicKey(value)) return true;
  return accepts === "account_or_contract" && StrKey.isValidContract(value);
}

type AddressField = {
  /** Under `nodes.<id>.config`, as the panel's `fieldError` keys it. */
  field: string;
  value: string;
  accepts: AddressAccepts;
  /** How the message names the field, e.g. "the Pay step's recipient". */
  what: string;
};

/** Every address a node's config holds, with what each accepts. */
export function addressFields(node: FlowNode): AddressField[] {
  switch (node.type) {
    case "pay":
      return [
        {
          field: "recipient",
          value: node.config.recipient,
          accepts: "account",
          what: "the Pay step's recipient",
        },
      ];
    case "split":
      return node.config.recipients.map((r, i) => ({
        field: `recipients.${i}.address`,
        value: r.address,
        accepts: "account_or_contract" as const,
        what: `split recipient ${r.label?.trim() ? `"${r.label.trim()}"` : `#${i + 1}`}`,
      }));
    case "webhook":
      return [
        {
          field: "relayer",
          value: node.config.relayer,
          accepts: "account",
          what: "the Webhook trigger's relayer",
        },
      ];
    case "subscription":
      return [
        {
          field: "subscriber",
          value: node.config.subscriber,
          accepts: "account",
          what: "the Subscription trigger's subscriber",
        },
      ];
    case "payroll":
      return [
        {
          field: "employer",
          value: node.config.employer,
          accepts: "account",
          what: "the Payroll trigger's employer",
        },
      ];
    case "yield":
      return [
        {
          field: "vault",
          value: node.config.vault,
          accepts: "account",
          what: "the Yield step's vault",
        },
      ];
    case "condition":
      if (node.config.kind === "oracle_gte") {
        return [
          {
            field: "oracle",
            value: node.config.oracle,
            accepts: "account",
            what: "the condition's oracle",
          },
        ];
      }
      if (node.config.kind === "multisig") {
        return node.config.signers.map((s, i) => ({
          field: `signers.${i}`,
          value: s,
          accepts: "account" as const,
          what: `signer #${i + 1}`,
        }));
      }
      return [];
    case "on_receive":
    case "on_schedule":
    case "web2_webhook":
    case "oracle":
    case "swap":
    case "email_notify":
    case "cash_out":
      return [];
    default: {
      const never: never = node;
      return never;
    }
  }
}

// Cap the echoed value just past a full strkey, so a pasted blob can't flood
// the error panel.
function showValue(v: string): string {
  return v.length > 60 ? `${v.slice(0, 57)}...` : v;
}

function expected(accepts: AddressAccepts): string {
  return accepts === "account"
    ? "a Stellar wallet address (G…, 56 characters)"
    : "a Stellar wallet (G…) or contract (C…) address, 56 characters";
}

export function addressFriendlyMessage(
  value: string,
  accepts: AddressAccepts,
  what: string,
): string {
  const pending = "or PENDING:<name> to fill it in when you deploy";
  if (value.trim() === "") {
    return `Enter ${what}: ${expected(accepts)}, ${pending}.`;
  }
  const shown = `"${showValue(value)}"`;
  if (accepts === "account" && StrKey.isValidContract(value)) {
    return `${what[0]!.toUpperCase()}${what.slice(1)} must be a wallet address (G…), and ${shown} is a contract address. Enter a wallet address, ${pending}.`;
  }
  if (value !== value.trim() && isAcceptedFlowAddress(value.trim(), accepts)) {
    return `${shown} for ${what} has spaces around it. Remove them.`;
  }
  // Said, not done: a lower-case strkey is a different string, and the user
  // should see the address they will be paying.
  if (value !== value.toUpperCase() && isAcceptedFlowAddress(value.toUpperCase(), accepts)) {
    return `${shown} for ${what} is in lower case. Stellar addresses are upper case; paste the address exactly as your wallet shows it.`;
  }
  return `${shown} is not a complete Stellar address for ${what}. Enter ${expected(accepts)}, ${pending}.`;
}

/** One issue per address field that is neither a complete strkey it accepts nor a PENDING: placeholder. */
export function addressIssues(graph: FlowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    for (const f of addressFields(node)) {
      if (isAcceptedFlowAddress(f.value, f.accepts)) continue;
      issues.push({
        path: `nodes.${node.id}.config.${f.field}`,
        message: f.value === "" ? "Missing Stellar address" : "Invalid Stellar address",
        friendlyMessage: addressFriendlyMessage(f.value, f.accepts, f.what),
        nodeId: node.id,
        field: f.field,
      });
    }
  }
  return issues;
}
