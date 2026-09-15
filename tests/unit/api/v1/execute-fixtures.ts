// Shared by execute.test.ts and execute-envelope.test.ts. Not a *.test.ts, so
// vitest does not collect it on its own.
import type { NextRequest } from "next/server";
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { hashApiToken } from "@/lib/auth/api-token";

export const DEPLOYMENT_ID = "11111111-1111-1111-1111-111111111111";
export const OWNER_ID = "44444444-4444-4444-4444-444444444444";
export const TRIGGER = StrKey.encodeContract(Buffer.alloc(32, 1));
export const SWAPPER = StrKey.encodeContract(Buffer.alloc(32, 2));
export const PAYER = StrKey.encodeContract(Buffer.alloc(32, 3));
export const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
export const ROUTER = StrKey.encodeContract(Buffer.alloc(32, 7));

export const SWAPPER_PIPELINE = [
  { nodeId: "trigger", contractAddress: TRIGGER, templateKind: "DEPOSIT_TRIGGER" },
  { nodeId: "swap", contractAddress: SWAPPER, templateKind: "SWAPPER" },
  { nodeId: "pay", contractAddress: PAYER, templateKind: "PAYER" },
];

let seq = 0;

/** A fresh plaintext token per call, so each test gets its own rate-limit bucket. */
export function newToken() {
  seq += 1;
  const plaintext = `pfk_${seq.toString(16).padStart(64, "0")}`;
  return { plaintext, id: `token-${seq}` };
}

export function tokenRow(
  token: { plaintext: string; id: string },
  deployment: Record<string, unknown> = {},
  owner: { isActive: boolean; role: string } = { isActive: true, role: "USER" },
) {
  return {
    id: token.id,
    deploymentId: DEPLOYMENT_ID,
    createdById: OWNER_ID,
    tokenHash: hashApiToken(token.plaintext),
    tokenPrefix: token.plaintext.slice(0, 12),
    label: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    deployment: {
      id: DEPLOYMENT_ID,
      ownerId: OWNER_ID,
      status: "CONFIRMED",
      contractAddress: TRIGGER,
      pipelineSnapshot: SWAPPER_PIPELINE,
      ...deployment,
      owner,
    },
  };
}

export function request(
  path: string,
  opts: { token?: string; authorization?: string; body?: unknown; rawBody?: string } = {},
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  const auth = opts.authorization ?? (opts.token ? `Bearer ${opts.token}` : undefined);
  if (auth) headers.set("authorization", auth);
  return new Request(`https://paiflow.test${path}`, {
    method: "POST",
    headers,
    body: opts.rawBody ?? JSON.stringify(opts.body ?? {}),
  }) as unknown as NextRequest;
}

export const ctx = (id: string = DEPLOYMENT_ID) => ({ params: Promise.resolve({ id }) });

/** A signed envelope built with the real SDK, shaped as prepare would build it. */
export function signedEnvelope(
  opts: {
    signer?: Keypair;
    contract?: string;
    fn?: string;
    operations?: number;
  } = {},
): string {
  const signer = opts.signer ?? Keypair.random();
  const builder = new TransactionBuilder(new Account(signer.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });
  for (let i = 0; i < (opts.operations ?? 1); i++) {
    builder.addOperation(
      Operation.invokeContractFunction({
        contract: opts.contract ?? TRIGGER,
        function: opts.fn ?? "deposit",
        args: [
          new Address(signer.publicKey()).toScVal(),
          nativeToScVal(10_000_000n, { type: "i128" }),
        ],
      }),
    );
  }
  const tx = builder.setTimeout(180).build();
  tx.sign(signer);
  return tx.toXDR();
}

export function contractErrorEvent(contract: string, code: number): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: StrKey.decodeContract(contract) as unknown as xdr.ContractId,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
          data: xdr.ScVal.scvVoid(),
        }),
      ),
    }),
  });
}

export function txResult(result: xdr.TransactionResultResult): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString("100"),
    result,
    ext: new xdr.TransactionResultExt(0),
  });
}
