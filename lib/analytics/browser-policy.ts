import type { CaptureResult } from "posthog-js";
import { analyticsRoute, APPROVED_CONTROLS, AUDIENCES, TRACKING_VERSION } from "./policy";
import { eventProperties } from "./event-policy";
import { sanitizeEntry } from "./sanitize";
export type BrowserContext = {
  account_id: string;
  caller_type: string;
  audience: string;
  stellar_network: string;
  app_env: string;
  app_version: string;
  app_host: string;
  tracking_version: string;
};
const BASE_KEYS = [
  "distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$insert_id",
  "$lib",
  "$lib_version",
];
const PERSON_KEYS = ["wallet_address", "wallet_address_first", "role"];
function personUnset(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value
        .slice(0, 100)
        .filter((key): key is string => typeof key === "string" && PERSON_KEYS.includes(key))
    : undefined;
}
export function personProperties(props: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of ["wallet_address", "wallet_address_first"]) {
    const value = sanitizeEntry(key, props[key]);
    if (value !== undefined) out[key] = value;
  }
  if (typeof props.role === "string" && ["USER", "ADMIN", "SANDBOX"].includes(props.role))
    out.role = props.role;
  return out;
}
export function validateBrowserContext(value: unknown): BrowserContext | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    !AUDIENCES.includes(v.audience as (typeof AUDIENCES)[number]) ||
    !["testnet", "mainnet"].includes(String(v.stellar_network)) ||
    !["local", "staging", "beta"].includes(String(v.app_env)) ||
    v.tracking_version !== TRACKING_VERSION ||
    typeof v.app_version !== "string" ||
    !/^(?:dev|[a-f0-9]{7,64})$/.test(v.app_version) ||
    typeof v.app_host !== "string" ||
    !/^[a-zA-Z0-9.:-]{1,253}$/.test(v.app_host)
  )
    return null;
  return {
    account_id:
      typeof v.account_id === "string" && /^[0-9a-f-]{36}$/i.test(v.account_id) ? v.account_id : "",
    caller_type: v.caller_type === "session" ? "session" : "wallet",
    audience: String(v.audience),
    stellar_network: String(v.stellar_network),
    app_env: String(v.app_env),
    app_version: v.app_version,
    app_host: v.app_host,
    tracking_version: TRACKING_VERSION,
  };
}
/** Read only a bounded SDK element-chain prefix. Quoted values are parsed
 * before delimiters, so text/ancestor attributes cannot spoof a control marker. */
function chainElements(value: unknown): Record<string, unknown>[] {
  if (typeof value !== "string" || value.length > 20_000) return [];
  const elements: Record<string, unknown>[] = [];
  let rest = value;
  for (let i = 0; i < 3 && rest; i++) {
    const head = /^(span|svg|path|button|a)(?:\.[^"\s;]*)?:(?=[A-Za-z0-9_-]+=")/.exec(rest);
    if (!head) return [];
    const element: Record<string, unknown> = { tag_name: head[1] };
    rest = rest.slice(head[0].length);
    let attributes = 0;
    while (rest && !rest.startsWith(";")) {
      const attribute = /^([A-Za-z0-9_-]+)="((?:\\.|[^"\\])*)"/.exec(rest);
      if (!attribute || ++attributes > 100) return [];
      if (attribute[1] === "attr__data-analytics-control") element[attribute[1]] = attribute[2];
      rest = rest.slice(attribute[0].length);
    }
    elements.push(element);
    if (head[1] === "button" || head[1] === "a") return elements;
    if (rest.startsWith(";")) rest = rest.slice(1);
  }
  return elements;
}

/** Last gate for every SDK event, including remote-config enabled extensions. */
export function browserProperties(
  name: string,
  input: Record<string, unknown>,
  pathname: string,
  context: BrowserContext | null,
): Record<string, unknown> | null {
  const route = analyticsRoute(pathname);
  if (!context) return null;
  let props: Record<string, unknown> | null;
  if (["$autocapture", "$rageclick", "$dead_click"].includes(name)) {
    if (!route) return null;
    const elements = Array.isArray(input.$elements)
      ? input.$elements
      : chainElements(input.$elements_chain);
    if (!elements.length) return null;
    // Only the clicked control or its icon descendant may opt in. Never accept
    // a marker on a panel/ancestor containing account data.
    let control: unknown;
    for (const element of elements.slice(0, 3)) {
      if (!element || typeof element !== "object") return null;
      const e = element as Record<string, unknown>;
      if (["button", "a"].includes(String(e.tag_name))) {
        control = e["attr__data-analytics-control"];
        break;
      }
      if (!["svg", "path", "span"].includes(String(e.tag_name))) return null;
    }
    if (!APPROVED_CONTROLS.includes(control as (typeof APPROVED_CONTROLS)[number])) return null;
    props = { control_id: control };
    if (name === "$autocapture" && input.$event_type !== "click") return null;
  } else if (name === "$pageview" || name === "$pageleave") {
    if (!route) return null;
    props = {};
  } else if (name === "$identify" || name === "$set") {
    props = {};
    for (const key of ["$set", "$set_once"]) {
      const value = input[key];
      if (value && typeof value === "object" && !Array.isArray(value))
        props[key] = personProperties(value as Record<string, unknown>);
    }
    const unset = personUnset(input.$unset);
    if (unset) props.$unset = unset;
    if (
      typeof input.$anon_distinct_id === "string" &&
      /^[a-zA-Z0-9_.:-]{1,128}$/.test(input.$anon_distinct_id)
    )
      props.$anon_distinct_id = input.$anon_distinct_id;
  } else {
    // Authoritative outcomes and wallet connections are delivered by the DB
    // outbox, never by an optimistic browser event.
    if (
      [
        "wallet_connect_succeeded",
        "transaction_signed",
        "transaction_outcome",
        "deploy_confirmed",
        "trigger_confirmed",
        "trigger_failed_onchain",
        "trigger_succeeded",
      ].includes(name)
    )
      return null;
    props = eventProperties(name, input);
    if (!props) return null;
  }
  for (const key of BASE_KEYS) {
    const value = input[key];
    if (typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) props[key] = value;
  }
  return {
    ...props,
    ...context,
    ...(route ? { route } : {}),
    source: "browser",
    $process_person_profile: Boolean(context.account_id && context.caller_type === "session"),
    $geoip_disable: true,
    $ip: null,
  };
}

/** Rebuild the entire SDK envelope; person updates also live outside properties. */
export function browserEvent(
  event: CaptureResult,
  pathname: string,
  context: BrowserContext | null,
  projectKey: string,
): CaptureResult | null {
  const properties = browserProperties(event.event, event.properties ?? {}, pathname, context);
  if (!properties) return null;
  // The SDK requires the public project key for ingestion. Take it from our
  // initialization config rather than copying an arbitrary event property.
  properties.token = projectKey;
  const clean: CaptureResult = { event: event.event, uuid: event.uuid, properties };
  if (event.timestamp instanceof Date && Number.isFinite(event.timestamp.getTime()))
    clean.timestamp = event.timestamp;
  if (properties.$process_person_profile) {
    for (const key of ["$set", "$set_once"] as const) {
      const value = event[key];
      if (value && typeof value === "object" && !Array.isArray(value))
        clean[key] = personProperties(value);
    }
    const unset = personUnset(event.$unset);
    if (unset) clean.$unset = unset;
  }
  return clean;
}
