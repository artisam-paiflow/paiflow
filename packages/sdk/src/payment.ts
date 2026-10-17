import {
  address,
  choice,
  hash,
  integer,
  object,
  pattern,
  text,
  timestamp,
  network,
  stroops,
} from "./read-parsers.js";
import { PaiflowAbortError, PaiflowTimeoutError } from "./transport.js";
import type { ApiResponse, PaiflowTransport, RequestOptions } from "./transport.js";
/** Prepare a caller-signed deposit into this existing deployment. */
export interface ExecutePrepareInput {
  /** Positive integer stroop string bounded to i128, never a floating-point amount. */
  amount: string;
  from: string;
}
export interface PublicPaymentPrepareInput {
  /** Positive integer stroop string bounded to i128, never a floating-point amount. */
  amount: string;
  userAddress: string;
}
/** Exact original wallet-signed envelope. Persist securely before explicit submission. */
export interface SignedSubmission {
  signedXdr: string;
}
/** Request options plus explicit server waiting policy; neither setting enables SDK polling. */
export interface ExecuteSubmitOptions extends RequestOptions {
  /** Omit for server default; false returns without requesting server finality waiting. */
  wait?: boolean;
}
const passphrases = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
} as const;
const input = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch {
    throw new TypeError("Invalid SDK payment input");
  }
};
const parsePublicPrepared = (value: unknown) => {
  const d = object(value);
  return {
    xdr: pattern(d.xdr, /^[\s\S]{1,200000}$/),
    networkPassphrase: choice(d.networkPassphrase, Object.values(passphrases)),
  };
};
const parseExecutePrepared = (value: unknown) => {
  const d = object(value),
    prepared = parsePublicPrepared(value),
    net = network(d.network);
  if (prepared.networkPassphrase !== passphrases[net]) throw new Error();
  return { ...prepared, network: net, expiresAt: timestamp(d.expiresAt) };
};
const parseExecuteSubmitted = (value: unknown) => {
  const d = object(value);
  return {
    txHash: hash(d.txHash),
    status: choice(d.status, ["SUCCESS", "PENDING", "FAILED"]),
    ...(d.ledger === undefined ? {} : { ledger: integer(d.ledger, 1) }),
    ...(d.error === undefined
      ? {}
      : { error: { code: text(object(d.error).code), message: text(object(d.error).message) } }),
  };
};
const parsePublicSubmitted = (value: unknown) => {
  const d = object(value);
  return {
    txHash: hash(d.txHash),
    ...(d.status === undefined ? {} : { status: choice(d.status, ["PENDING"]) }),
  };
};
const parsePublicStatus = (value: unknown) => {
  const d = object(value);
  return {
    txHash: hash(d.txHash),
    status: choice(d.status, ["SUCCESS", "FAILED", "PENDING"]),
    ...(d.errorMessage === undefined ? {} : { errorMessage: text(d.errorMessage) }),
  };
};
/** Unsigned execute preparation. Persist data and history metadata before signing.
 * @useDeclaredType
 */
export type ExecutePrepared = ReturnType<typeof parseExecutePrepared>;
/** Execute submission result; inspect status rather than relying on HTTP success.
 * @useDeclaredType
 */
export type ExecuteSubmitted = ReturnType<typeof parseExecuteSubmitted>;
/** Public preparation with XDR/passphrase only; no receipt or replacement-safety claim.
 * @useDeclaredType
 */
export type PublicPaymentPrepared = ReturnType<typeof parsePublicPrepared>;
/** Public submission hash; an accepted submission is not finality.
 * @useDeclaredType
 */
export type PublicPaymentSubmitted = ReturnType<typeof parsePublicSubmitted>;
/** Global chain lookup; SUCCESS alone does not bind this deployment or an order.
 * @useDeclaredType
 */
export type PublicPaymentStatus = ReturnType<typeof parsePublicStatus>;
const submission = (body: SignedSubmission) =>
  input(() => ({ signedXdr: pattern(body.signedXdr, /^[\s\S]{10,200000}$/) }));
export function paymentMethods(transport: PaiflowTransport, id: string) {
  const partner = `/api/v1/deployments/${id}`,
    pub = `/api/deployments/${id}`;
  return {
    execute: {
      prepare: (body: ExecutePrepareInput, options?: RequestOptions) =>
        transport.request(
          {
            path: `${partner}/execute`,
            method: "POST",
            auth: { kind: "token" },
            body: input(() => ({
              amount: stroops(body.amount, true),
              from: address(body.from, "G"),
            })),
            parse: parseExecutePrepared,
          },
          options,
        ),
      submit: (body: SignedSubmission, options: ExecuteSubmitOptions = {}) => {
        if (options.wait !== undefined && typeof options.wait !== "boolean")
          throw new TypeError("Invalid wait");
        return transport.request(
          {
            path: `${partner}/execute/submit`,
            method: "POST",
            auth: { kind: "token" },
            body: submission(body),
            query: options.wait === undefined ? undefined : { wait: String(options.wait) },
            parse: parseExecuteSubmitted,
          },
          options,
        );
      },
    },
    publicPayment: {
      prepare: (body: PublicPaymentPrepareInput, options?: RequestOptions) =>
        transport.request(
          {
            path: `${pub}/trigger`,
            method: "POST",
            auth: { kind: "public" },
            body: input(() => ({
              amount: stroops(body.amount, true),
              userAddress: address(body.userAddress, "G"),
            })),
            parse: parsePublicPrepared,
          },
          options,
        ),
      submit: (body: SignedSubmission, options?: RequestOptions) =>
        transport.request(
          {
            path: `${pub}/submit-trigger`,
            method: "POST",
            auth: { kind: "public" },
            body: submission(body),
            parse: parsePublicSubmitted,
          },
          options,
        ),
      status: (txHash: string, options?: RequestOptions) =>
        transport.request(
          {
            path: `${pub}/tx-status`,
            method: "GET",
            auth: { kind: "public" },
            query: { txHash: input(() => hash(pattern(txHash, /^[a-f0-9]{64}$/i).toLowerCase())) },
            parse: parsePublicStatus,
          },
          options,
        ),
    },
  };
}
/** Supplied to the application wallet callback. No private keys are accepted. */
export interface SignRequest {
  xdr: string;
  networkPassphrase: string;
  walletAddress: string;
  signal: AbortSignal;
}
/** Callback must sign the unchanged envelope; SDK does not verify XDR operations. */
export type SignTransaction = (request: SignRequest) => Promise<SignedSubmission>;
export type PreparedSigner = SignTransaction;
/** Wallet identity/network guard and bounded local signing lifetime. */
export interface SignOptions {
  walletAddress: string;
  expectedNetwork?: "testnet" | "mainnet";
  signal?: AbortSignal;
  timeoutMs?: number;
}
/** Wallet callback rejected or returned an invalid result; original preparation remains required. */
export class PaiflowSigningError extends Error {
  constructor() {
    super("Wallet signing failed");
    this.name = "PaiflowSigningError";
  }
}
/** Signs once without preparing, submitting, rebuilding, retrying or checking finality. */
export interface PreparedEnvelope {
  xdr?: string;
  unsignedXdr?: string;
  networkPassphrase?: string;
  network?: "testnet" | "mainnet";
  expiresAt?: string;
  walletAddress?: string;
}
/**
 * Sign a saved execute/public-payment preparation once, without submitting.
 * @param prepared - Original API response, retained with its history metadata.
 * @param signer - Wallet callback that signs the unchanged original envelope.
 * @param options - Wallet/network checks, cancellation and a signing deadline.
 * @returns Original preparation plus signed submission and preparation-history correlation.
 * @remarks This helper does not parse XDR or prove order price, recipients or finality.
 */
export function signPrepared<T extends PreparedEnvelope>(
  prepared: ApiResponse<T>,
  signer: PreparedSigner,
  options: SignOptions,
) {
  return signPreparedEnvelope(prepared, signer, options, submission);
}
/** Internal signing engine; workflow supplies its own signed-envelope bounds. */
export async function signPreparedEnvelope<T extends PreparedEnvelope>(
  prepared: ApiResponse<T>,
  signer: PreparedSigner,
  options: SignOptions,
  validateSubmission: (body: SignedSubmission) => SignedSubmission,
): Promise<{
  submission: SignedSubmission;
  preparation: ApiResponse<T>;
  submissionOptions: RequestOptions;
}> {
  const walletAddress = input(() => address(options.walletAddress, "G"));
  const d = object(prepared.data);
  const wire = input(() => {
    const net = d.network === undefined ? undefined : network(d.network);
    if (d.xdr !== undefined && d.unsignedXdr !== undefined && d.xdr !== d.unsignedXdr)
      throw new Error();
    return parsePublicPrepared({
      xdr: d.xdr ?? d.unsignedXdr,
      networkPassphrase: d.networkPassphrase ?? (net === undefined ? undefined : passphrases[net]),
    });
  });
  const net = wire.networkPassphrase === passphrases.testnet ? "testnet" : "mainnet";
  if (
    (d.network !== undefined && d.network !== net) ||
    (options.expectedNetwork !== undefined && options.expectedNetwork !== net)
  )
    throw new TypeError("Preparation network mismatch");
  if (d.walletAddress !== undefined && d.walletAddress !== walletAddress)
    throw new TypeError("Preparation wallet mismatch");
  const expiry =
    d.expiresAt === undefined ? undefined : Date.parse(input(() => timestamp(d.expiresAt)));
  if (expiry !== undefined && expiry <= Date.now())
    throw new TypeError(
      "Preparation expired; preserve original transaction before considering replacement",
    );
  const timeout = options.timeoutMs ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647)
    throw new TypeError("Invalid signing timeoutMs");
  if (options.signal?.aborted) throw new PaiflowAbortError();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => {
        controller.abort();
        reject(new PaiflowAbortError());
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new PaiflowTimeoutError());
      }, timeout);
    });
    const signed = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new Error();
        return signer({ ...wire, walletAddress, signal: controller.signal });
      })
      .catch(() => {
        throw new PaiflowSigningError();
      });
    const signedResult = await Promise.race([signed, cancelled]);
    if (options.signal?.aborted) throw new PaiflowAbortError();
    if (expiry !== undefined && expiry <= Date.now())
      throw new TypeError("Preparation expired during signing");
    return {
      submission: validateSubmission(signedResult),
      preparation: prepared,
      submissionOptions:
        prepared.metadata.historyRequestId === undefined
          ? {}
          : { preparationRequestId: prepared.metadata.historyRequestId },
    };
  } finally {
    clearTimeout(timer);
    if (cancel) options.signal?.removeEventListener("abort", cancel);
  }
}
