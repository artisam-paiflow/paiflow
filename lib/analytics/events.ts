/**
 * The PostHog event catalog for the alpha round. Shared by the browser
 * (`lib/analytics/client.ts`) and the server (`lib/analytics/server.ts`), so an
 * event name or property that isn't declared here is a type error at the call
 * site rather than a silently misspelled series in PostHog.
 *
 * Privacy rules the shapes encode: no usernames, emails, recipient addresses,
 * XDR, or graph JSON. Money is `amount_stroops: string`, never a number
 * (CLAUDE.md §3.3). `sanitizeProps` is the runtime backstop for the same rules.
 */

export type ErrorClass =
  | "user_rejected"
  | "wrong_network"
  | "account_unfunded"
  | "min_balance"
  | "trustline_missing"
  | "slippage"
  | "rate_limited"
  | "network"
  | "timeout"
  | "upstream_rpc"
  | "validation"
  | "unknown";

export type WalletSurface = "deploy_review" | "trigger" | "contract_call" | "payroll";

/** Node types the alpha guide (§5) asks testers to build with. */
export const IN_SCOPE_NODE_TYPES = ["on_receive", "pay", "split", "swap"] as const;

export type OffScriptFeature =
  | "ask_ai_chat"
  | "ask_ai_voice"
  | "api_token_created"
  | "passkey_add"
  | "dev_mode_on"
  | "fiat_payout"
  | `node:${string}`;

type DeployStage = "wallet" | "prepare" | "sign" | "submit" | "finality_timeout";
type TriggerStage = "wallet" | "prepare" | "sign" | "submit" | "onchain" | "status_poll";

export type EventMap = {
  // 1. Setup & access
  login_succeeded: { method: "password" | "ticket" };
  login_failed: { reason: "bad_password" | "locked" };
  wallet_connect_succeeded: { surface: WalletSurface; wallet_id: string };
  error_shown: { error_class: ErrorClass; error_code: string | null; message_key: string };

  // 2. Build
  flow_created: Record<string, never>;
  builder_opened: { flow_id: string; node_count: number; node_types: string[]; dev_mode: boolean };
  node_added: { node_type: string };
  node_removed: { node_type: string; via: "panel" | "keyboard" };
  edge_connected: { from_type: string; to_type: string };
  node_settings_opened: { node_type: string };
  validation_error_appeared: { error_key: string; node_type: string | null; message_key: string };
  validation_error_resolved: {
    error_key: string;
    node_type: string | null;
    time_to_resolve_ms: number;
  };
  errors_modal_opened: { error_count: number };
  swap_quote_loaded: { pair: string; latency_ms: number; always_reverts: boolean };
  swap_quote_failed: { pair: string; reason: "upstream" | "network"; message_key: string };
  flow_autosave_failed: { status: number | null };
  off_script_feature_used: { feature: OffScriptFeature };

  // 3. Deploy
  deploy_review_viewed: { flow_id: string; swap_count: number };
  deploy_started: { flow_id: string };
  deploy_failed: {
    stage: DeployStage;
    error_class: ErrorClass;
    error_code: string | null;
    flow_id?: string;
    deployment_id?: string;
  };
  deploy_confirmed: {
    deployment_id: string;
    flow_id: string;
    template_kinds: string[];
    has_swap: boolean;
    contract_count: number;
    created_to_confirmed_ms: number;
  };

  // 4. Execute
  trigger_page_viewed: { deployment_id: string };
  trigger_started: { deployment_id: string; mode: "trigger" | "allowance"; amount_stroops: string };
  trigger_failed: {
    deployment_id: string;
    stage: TriggerStage;
    error_class: ErrorClass;
    error_code: string | null;
    tx_hash?: string;
  };
  trigger_status_poll_failed: {
    deployment_id: string;
    tx_hash: string;
    reason: "timeout" | "http_error" | "network";
    http_status?: number;
  };
  trigger_succeeded: { deployment_id: string; tx_hash: string; elapsed_ms: number };
  trigger_confirmed: { deployment_id: string; tx_hash: string; has_swap: boolean };
  trigger_failed_onchain: { deployment_id: string; tx_hash: string };

  // 5. Verify
  deployment_page_viewed: { deployment_id: string; status: string };
  live_feed_disconnected: { deployment_id: string; disconnect_count: number };
  live_event_rendered: {
    deployment_id: string;
    event_kind: string;
    is_swap: boolean;
    lag_ms: number | null;
    /** How the row reached the page: pushed over SSE, or read by the fallback poll. */
    source: "sse" | "poll";
  };
};

export type EventName = keyof EventMap;

/** Server-side super properties; the browser registers the same keys on init. */
export type AppEnv = "local" | "staging" | "beta";
