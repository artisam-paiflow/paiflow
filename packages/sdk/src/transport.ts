export interface PaiflowOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  requestId?: string;
  preparationRequestId?: string;
}
export interface ResponseMetadata {
  status: number;
  requestId?: string;
  historyRequestId?: string;
  retryAfter?: string;
}
export interface ApiResponse<T> {
  data: T;
  metadata: ResponseMetadata;
}
export type RequestAuth =
  | { kind: "public" }
  | { kind: "token" }
  | { kind: "webhook"; secret: string; idempotencyKey?: string };
export interface JsonRequest<T> {
  path: string;
  method: "GET" | "POST";
  auth: RequestAuth;
  body?: unknown;
  query?: Readonly<Record<string, string>>;
  raw?: boolean;
  parse: (value: unknown) => T;
}
export class PaiflowTransportError extends Error {
  constructor(message = "Paiflow request failed") {
    super(message);
    this.name = "PaiflowTransportError";
  }
}
export class PaiflowTimeoutError extends PaiflowTransportError {
  constructor() {
    super("Paiflow request timed out; transaction outcome may be uncertain");
    this.name = "PaiflowTimeoutError";
  }
}
export class PaiflowAbortError extends PaiflowTransportError {
  constructor() {
    super("Paiflow request cancelled; transaction outcome may be uncertain");
    this.name = "PaiflowAbortError";
  }
}
export class PaiflowMalformedResponseError extends PaiflowTransportError {
  constructor(readonly metadata: ResponseMetadata) {
    super("Invalid Paiflow response");
    this.name = "PaiflowMalformedResponseError";
  }
}
export class PaiflowApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: unknown,
    readonly details: unknown,
    readonly metadata: ResponseMetadata,
  ) {
    super(message);
    this.name = "PaiflowApiError";
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const headerValue = (value: string) => value.length > 0 && !/[\r\n\x00-\x1f\x7f]/.test(value);
const duration = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    throw new TypeError("Invalid timeoutMs");
  return value;
};
/** Shared JSON foundation. Workflow methods are added in subsequent issues. No retries. */
export class PaiflowTransport {
  readonly origin: string;
  #token: string | undefined;
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  constructor(options: PaiflowOptions) {
    const base = new URL(options.baseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if (
      (base.protocol !== "https:" && !(base.protocol === "http:" && local)) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    )
      throw new TypeError(
        "baseUrl must be a trusted HTTPS origin (HTTP loopback allowed for development)",
      );
    this.origin = base.origin;
    if (
      options.token !== undefined &&
      (!headerValue(options.token) || !/^pfk_[A-Za-z0-9_-]+$/.test(options.token))
    )
      throw new TypeError("Invalid deployment token");
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = duration(options.timeoutMs ?? 30000);
  }
  async request<T>(request: JsonRequest<T>, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    // Restrict paths to canonical API routes: no absolute URL, traversal or encoded separators.
    if (
      !/^\/api\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(request.path) ||
      request.path.split("/").some((segment) => segment === "." || segment === "..")
    )
      throw new TypeError("Invalid API path");
    if (
      request.auth.kind === "token" &&
      !/^\/api\/v1\/deployments\/[A-Za-z0-9_-]+\//.test(request.path)
    )
      throw new TypeError("Token authentication requires a partner deployment route");
    if (request.auth.kind === "webhook" && !/^\/api\/webhooks\/[A-Za-z0-9_-]+$/.test(request.path))
      throw new TypeError("Webhook authentication requires a webhook route");
    const url = new URL(request.path, this.origin);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (
        /(?:token|secret|signedxdr)/i.test(key) ||
        (/intent/i.test(key) &&
          !/^\/api\/deployments\/[A-Za-z0-9_-]+\/subscription-allowance\/status$/.test(
            request.path,
          ))
      )
        throw new TypeError("Credentials and sensitive payloads cannot be URL parameters");
      url.searchParams.set(key, value);
    }
    const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
    if (request.auth.kind === "token") {
      if (!this.#token) throw new TypeError("Deployment token required");
      headers.set("Authorization", `Bearer ${this.#token}`);
    } else if (request.auth.kind === "webhook") {
      if (!headerValue(request.auth.secret)) throw new TypeError("Invalid webhook secret");
      headers.set("x-webhook-secret", request.auth.secret);
      if (request.auth.idempotencyKey !== undefined) {
        if (!headerValue(request.auth.idempotencyKey))
          throw new TypeError("Invalid idempotency key");
        headers.set("Idempotency-Key", request.auth.idempotencyKey);
      }
    }
    if (options.requestId !== undefined) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(options.requestId))
        throw new TypeError("Invalid requestId");
      headers.set("x-request-id", options.requestId);
    }
    if (options.preparationRequestId !== undefined) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          options.preparationRequestId,
        )
      )
        throw new TypeError("Invalid preparationRequestId");
      headers.set("x-preparation-request-id", options.preparationRequestId);
    }
    const secrets = [
      this.#token,
      request.auth.kind === "webhook" ? request.auth.secret : undefined,
    ];
    const uuid = (value: unknown) =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const sensitive = (key: string, value: unknown) =>
      /(?:signedxdr|secret|token|password|cookie|authorization|body)/i.test(key) ||
      (/intent/i.test(key) && !uuid(value));
    const collect = (value: unknown, depth = 0): void => {
      if (depth > 12 || !record(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (sensitive(key, child) && typeof child === "string") secrets.push(child);
        else collect(child, depth + 1);
      }
    };
    collect(request.body);
    for (const [key, value] of Object.entries(request.query ?? {}))
      if (/intent/i.test(key)) secrets.push(value);
    const sanitize = (value: unknown, depth = 0): unknown => {
      if (depth > 12) return "[redacted]";
      if (typeof value === "string") {
        let clean = value;
        for (const secret of secrets) if (secret) clean = clean.split(secret).join("[redacted]");
        return clean.replace(/pfk_[A-Za-z0-9_-]+/g, "[redacted]");
      }
      if (Array.isArray(value)) return value.map((child) => sanitize(child, depth + 1));
      if (record(value))
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            key,
            sensitive(key, child) ? "[redacted]" : sanitize(child, depth + 1),
          ]),
        );
      return value;
    };
    const timeout = duration(options.timeoutMs ?? this.#timeout);
    const controller = new AbortController();
    let expired = false;
    const abort = () => controller.abort();
    if (options.signal?.aborted) throw new PaiflowAbortError();
    options.signal?.addEventListener("abort", abort, { once: true });
    let rejectAbort: ((error: Error) => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const onAbort = () => {
      rejectAbort?.(expired ? new PaiflowTimeoutError() : new PaiflowAbortError());
      void reader?.cancel().catch(() => {});
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, timeout);
    try {
      const operation = async (): Promise<ApiResponse<T>> => {
        const response = await this.#fetch(url, {
          method: request.method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
        });
        const metadata: ResponseMetadata = { status: response.status };
        for (const [key, name] of [
          ["requestId", "x-request-id"],
          ["historyRequestId", "x-history-request-id"],
          ["retryAfter", "retry-after"],
        ] as const) {
          const value = response.headers.get(name);
          if (value !== null) metadata[key] = value;
        }
        if (response.redirected || (response.url && new URL(response.url).origin !== this.origin))
          throw new PaiflowTransportError("Unexpected response origin");
        let payload: unknown;
        try {
          reader = response.body?.getReader();
          if (!reader) throw new Error();
          const decoder = new TextDecoder();
          let text = "";
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              text += decoder.decode(chunk.value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            reader.releaseLock();
            reader = undefined;
          }
          payload = JSON.parse(text);
        } catch {
          if (!response.ok)
            throw new PaiflowApiError(
              response.status,
              "HTTP_ERROR",
              "Paiflow HTTP request failed",
              undefined,
              undefined,
              metadata,
            );
          throw new PaiflowMalformedResponseError(metadata);
        }
        if (!response.ok) {
          const error = record(payload) && record(payload.error) ? payload.error : {};
          throw new PaiflowApiError(
            response.status,
            typeof error.code === "string" ? String(sanitize(error.code)) : "HTTP_ERROR",
            typeof error.message === "string"
              ? String(sanitize(error.message))
              : "Paiflow HTTP request failed",
            sanitize(error.fields),
            sanitize(error.details),
            metadata,
          );
        }
        try {
          if (!request.raw && (!record(payload) || !("data" in payload))) throw new Error();
          return {
            data: request.parse(request.raw ? payload : record(payload) ? payload.data : undefined),
            metadata,
          };
        } catch {
          throw new PaiflowMalformedResponseError(metadata);
        }
      };
      return await Promise.race([operation(), interrupted]);
    } catch (error) {
      if (controller.signal.aborted)
        throw expired ? new PaiflowTimeoutError() : new PaiflowAbortError();
      if (error instanceof PaiflowApiError || error instanceof PaiflowTransportError) throw error;
      throw new PaiflowTransportError();
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", onAbort);
    }
  }
}
