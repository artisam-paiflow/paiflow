import type { FlowNode } from "./schema";

/**
 * User-facing node-type labels. This is the single source of truth for the
 * simple names shown in the builder palette, node cards, minimap, and config
 * panel headers so internal type names like `web2_webhook` never leak into the
 * UI.
 */
export const NODE_TYPE_LABELS: Record<FlowNode["type"], string> = {
  on_receive: "On Receive",
  on_schedule: "On Schedule",
  webhook: "Webhook",
  web2_webhook: "HTTP Webhook",
  subscription: "Subscription",
  payroll: "Payroll",
  oracle: "Oracle",
  pay: "Pay",
  split: "Split",
  swap: "Swap",
  yield: "Yield",
  cash_out: "Cash Out",
  email_notify: "Email",
  condition: "Condition",
};
