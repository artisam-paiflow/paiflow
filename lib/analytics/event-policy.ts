import { sanitizeEntry } from "./sanitize";
import type { EventName } from "./events";
const PROPERTIES: Record<EventName, readonly string[]> = {
  api_request_completed: [
    "request_id",
    "preparation_request_id",
    "endpoint",
    "method",
    "http_status",
    "duration_ms",
    "error_code",
    "api_token_id",
    "token_creator_id",
    "deployment_id",
    "tx_hash",
  ],
  login_succeeded: ["method"],
  login_failed: ["reason"],
  wallet_connect_succeeded: ["surface", "wallet_id", "wallet_address", "connection_id"],
  error_shown: ["error_class", "error_code", "message_key"],
  flow_created: [],
  builder_opened: ["flow_id", "node_count", "node_types", "dev_mode"],
  node_added: ["node_type"],
  node_removed: ["node_type", "via"],
  edge_connected: ["from_type", "to_type"],
  node_settings_opened: ["node_type"],
  validation_error_appeared: ["error_key", "node_type", "message_key"],
  validation_error_resolved: ["error_key", "node_type", "time_to_resolve_ms"],
  errors_modal_opened: ["error_count"],
  swap_quote_loaded: ["pair", "latency_ms", "always_reverts"],
  swap_quote_failed: ["pair", "reason", "message_key"],
  flow_autosave_failed: ["status"],
  off_script_feature_used: ["feature"],
  deploy_review_viewed: ["flow_id", "swap_count"],
  deploy_started: ["flow_id"],
  deploy_failed: ["stage", "error_class", "error_code", "flow_id", "deployment_id"],
  deploy_confirmed: [
    "deployment_id",
    "flow_id",
    "tx_hash",
    "signer_address",
    "template_kinds",
    "has_swap",
    "contract_count",
    "created_to_confirmed_ms",
  ],
  trigger_page_viewed: ["deployment_id"],
  trigger_started: ["deployment_id", "mode", "amount_stroops"],
  trigger_failed: ["deployment_id", "stage", "error_class", "error_code", "tx_hash"],
  trigger_status_poll_failed: ["deployment_id", "tx_hash", "reason", "http_status"],
  trigger_succeeded: ["deployment_id", "tx_hash", "signer_address", "elapsed_ms"],
  trigger_confirmed: ["deployment_id", "tx_hash", "signer_address", "has_swap"],
  trigger_failed_onchain: ["deployment_id", "tx_hash", "signer_address"],
  transaction_signed: ["deployment_id", "tx_hash", "signer_address", "kind", "signed_by_source"],
  transaction_outcome: [
    "flow_id",
    "deployment_id",
    "tx_hash",
    "signer_address",
    "kind",
    "outcome",
    "outcome_revision",
    "ledger",
    "failure_code",
  ],
  deployment_page_viewed: ["deployment_id", "status"],
  live_feed_disconnected: ["deployment_id", "disconnect_count"],
  live_event_rendered: ["deployment_id", "event_kind", "is_swap", "lag_ms", "source"],
  exception_captured: ["stage", "error_class", "error_code", "frames"],
};
const NODES = new Set([
  "on_receive",
  "on_schedule",
  "subscription",
  "payroll",
  "web2_webhook",
  "webhook",
  "oracle",
  "pay",
  "split",
  "swap",
  "hold",
  "return_to_owner",
  "condition",
  "yield",
  "cash_out",
  "email_notify",
]);
const KINDS = new Set([
  "CONDITIONAL",
  "DEPOSIT_TRIGGER",
  "ROUTER",
  "FACTORY",
  "MULTISIG",
  "PAYER",
  "PAYER_DEV",
  "TIMELOCK_BRANCH",
  "RECEIVE",
  "PAYOUT",
  "CLAIM",
  "STATUS_CHANGE",
  "CANCEL",
  "SHORTFALL",
  "PAUSE",
  "RESUME",
  "FORWARD",
  "RETRIEVE",
  "RECIPIENT_UPDATED",
  "SPLITTER",
  "SPLITTER_DEV",
  "STREAMER",
  "STREAMER_DEV",
  "SUBSCRIPTION",
  "SUBSCRIPTION_DEV",
  "PAYROLL",
  "PAYROLL_DEV",
  "WEBHOOK",
  "WEB2_WEBHOOK",
  "ORACLE",
  "PAY",
  "PAY_DEV",
  "SWAPPER",
  "CONDITION",
  "TIMELOCK",
  "ESCROW",
  "CASH_OUT",
  "CASH_OUT_DEV",
  "YIELD",
  "ON_RECEIVE",
  "RETURN_TO_OWNER",
  "deposit",
  "split",
  "pay",
  "swap",
  "released",
  "charged",
  "allowance",
  "transfer",
  "DEPOSIT",
  "SPLIT",
  "PAY",
  "SWAP",
  "RELEASED",
  "CHARGED",
  "ALLOWANCE",
  "TRANSFER",
]);
const VALUES = new Set([
  "password",
  "ticket",
  "bad_password",
  "locked",
  "deploy_review",
  "trigger",
  "contract_call",
  "payroll",
  "panel",
  "keyboard",
  "wallet",
  "prepare",
  "sign",
  "submit",
  "finality_timeout",
  "onchain",
  "status_poll",
  "allowance",
  "deploy",
  "invoke",
  "api_execute",
  "user_rejected",
  "wrong_network",
  "account_unfunded",
  "min_balance",
  "trustline_missing",
  "slippage",
  "rate_limited",
  "network",
  "timeout",
  "upstream_rpc",
  "validation",
  "unknown",
  "http_error",
  "upstream",
  "sse",
  "poll",
  "DRAFT",
  "PENDING_SIGNATURE",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
  "RECEIVED",
  "ACCEPTED",
  "UNRESOLVED",
  "REJECTED",
  "render",
  "runtime",
  "unhandled_rejection",
]);
const CODES = new Set([
  "HTTP_ERROR",
  "VALIDATION",
  "UPSTREAM_RPC",
  "RATE_LIMITED",
  "INSUFFICIENT_FUNDS",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "CONFLICT",
  "NOT_FOUND",
  "INTERNAL",
  "RPC_REJECTED",
  "ONCHAIN_FAILED",
  "RPC_UNAVAILABLE",
  "FINALITY_UNKNOWN",
  "CONTROL_EXPIRED",
]);
const WALLETS = new Set([
  "freighter",
  "lobstr",
  "albedo",
  "rabet",
  "xbull",
  "hana",
  "hot",
  "ledger",
  "walletconnect",
  "wallet_connect",
  "wallet-connect",
  "stellar-wallet",
  "creit",
  "stellarwalletskit",
]);
function approvedValue(key: string, value: unknown): unknown {
  if (["request_id", "preparation_request_id", "api_token_id", "token_creator_id"].includes(key))
    return value === null
      ? null
      : typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
        ? value
        : undefined;
  if (key === "endpoint")
    return typeof value === "string" &&
      /^\/api\/v1\/deployments\/:id\/(capabilities|funding(?:\/submit|\/reconcile)?|balances|swap-quote|subscription\/(?:state|(?:cancel|reactivate)\/(?:prepare|submit|reconcile))|schedule\/(?:state|(?:pause|resume|retrieve)(?:\/(?:submit|reconcile))?)|events|execute(?:\/submit)?|payouts(?:\/submit)?|release-early|transactions\/:txHash|:unknown)$/.test(
        value,
      )
      ? value
      : undefined;
  if (key === "method")
    return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(String(value))
      ? value
      : undefined;

  if (value === null) return null;
  if (key.endsWith("_address")) return sanitizeEntry(key, value);
  if (["flow_id", "deployment_id", "connection_id"].includes(key))
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  if (key === "tx_hash")
    return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)
      ? value.toLowerCase()
      : undefined;
  if (key === "amount_stroops")
    return typeof value === "string" && /^\d{1,39}$/.test(value) ? value : undefined;
  if (key === "outcome_revision")
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value
      : undefined;
  if (key === "wallet_id")
    return typeof value === "string" && WALLETS.has(value.toLowerCase())
      ? value.toLowerCase()
      : "other";
  if (["node_type", "from_type", "to_type"].includes(key))
    return NODES.has(String(value)) ? value : undefined;
  if (key === "node_types" || key === "template_kinds")
    return Array.isArray(value)
      ? value.slice(0, 100).filter((v) => (key === "node_types" ? NODES : KINDS).has(v))
      : undefined;
  if (key === "feature")
    return typeof value === "string" &&
      ([
        "ask_ai_chat",
        "ask_ai_voice",
        "api_token_created",
        "passkey_add",
        "dev_mode_on",
        "fiat_payout",
      ].includes(value) ||
        (value.startsWith("node:") && NODES.has(value.slice(5))))
      ? value
      : undefined;
  if (key === "error_code" || key === "failure_code")
    return CODES.has(String(value)) ? value : "UNKNOWN";
  if (key === "message_key") return "structured_error";
  if (key === "error_key")
    return typeof value === "string" &&
      /^(?:edges|graph|node|on_receive|on_schedule|subscription|payroll|webhook|web2_webhook|oracle|pay|split|swap|condition|cash_out|yield|hold|return_to_owner)(?:\.(?:config|recipients|address|amountStroops|bps|asset|assetIn|assetOut|slippageBps|minimumOutput|kind|threshold|deadline|signers|#|startTs|endTs|intervalSeconds))*$/.test(
        value,
      )
      ? value
      : "validation";
  if (key === "pair")
    return typeof value === "string" &&
      /^(?:XLM|USDC|EURC|AQUA|yXLM)[/→-](?:XLM|USDC|EURC|AQUA|yXLM)$/.test(value)
      ? value
      : "other";
  if (key === "frames")
    return Array.isArray(value)
      ? value
          .slice(0, 8)
          .filter(
            (v) =>
              typeof v === "string" &&
              /^\/_next\/static\/chunks\/[a-zA-Z0-9_.-]+\.js:\d+:\d+$/.test(v),
          )
      : undefined;
  if (typeof value === "number")
    return [
      "node_count",
      "error_count",
      "latency_ms",
      "time_to_resolve_ms",
      "status",
      "http_status",
      "swap_count",
      "contract_count",
      "created_to_confirmed_ms",
      "elapsed_ms",
      "duration_ms",
      "disconnect_count",
      "lag_ms",
      "ledger",
    ].includes(key) &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
      ? value
      : undefined;
  if (typeof value === "boolean")
    return ["dev_mode", "always_reverts", "has_swap", "signed_by_source", "is_swap"].includes(key)
      ? value
      : undefined;
  return typeof value === "string" &&
    (VALUES.has(value) || (key === "event_kind" && KINDS.has(value)))
    ? value
    : undefined;
}
export function isEventName(name: string): name is EventName {
  return Object.hasOwn(PROPERTIES, name);
}
export function eventProperties(
  name: string,
  props: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!isEventName(name)) return null;
  const out: Record<string, unknown> = {};
  for (const key of PROPERTIES[name]) {
    if (!Object.hasOwn(props, key)) continue;
    const value =
      name === "login_succeeded" && key === "method"
        ? typeof props[key] === "string" &&
          ["password", "ticket", "google"].includes(props[key] as string)
          ? props[key]
          : undefined
        : approvedValue(key, props[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
