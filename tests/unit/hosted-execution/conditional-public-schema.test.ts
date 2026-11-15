import { createHash, webcrypto } from "node:crypto";
import { Networks } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  ConditionalHostedBrowserRecoverySchema,
  ConditionalHostedOwnershipRequestSchema,
  ConditionalHostedPreparedSchema,
  ConditionalHostedReceiptSchema,
} from "@/lib/hosted-execution/conditional-schema";
import {
  canonicalHostedValue,
  conditionalHostedOwnershipBinding,
  conditionalHostedOwnershipContext,
} from "@/lib/hosted-execution/conditional-ownership-binding";
import { HostedBrowserRecoverySchema } from "@/lib/hosted-execution/form";
import { HostedReceiptSchema } from "@/lib/hosted-execution/schema";
import { conditionalAcceptanceIntent } from "../../fixtures/conditional-v2-acceptance";
const execution = conditionalAcceptanceIntent(),
  deploymentId = execution.deploymentId;
const input = {
  recoveryKey: "ef".repeat(32),
  payment: {
    from: execution.payer,
    amount: execution.amountStroops,
    arguments: execution.arguments,
  },
};
const recovery = {
  version: 2 as const,
  deploymentId,
  network: "testnet" as const,
  recoveryKey: input.recoveryKey,
  request: input.payment,
  phase: "preparing" as const,
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
describe("separate conditional hosted wire", () => {
  it("strictly rejects private extras, threshold overrides, missing inputs and v1 arguments", () => {
    expect(ConditionalHostedOwnershipRequestSchema.parse(input)).toEqual(input);
    for (const bad of [
      { ...input, ownerEmail: "private@example.test" },
      { ...input, payment: { ...input.payment, thresholdStroops: "100" } },
      { ...input, payment: { ...input.payment, arguments: { version: 1, inputs: [] } } },
      { ...input, payment: { ...input.payment, arguments: undefined } },
      { ...input, recoveryKey: "a".repeat(63) },
    ])
      expect(ConditionalHostedOwnershipRequestSchema.safeParse(bad).success).toBe(false);
  });
  it("does not strip v2 recovery into v1 or persist transaction bytes", () => {
    expect(ConditionalHostedBrowserRecoverySchema.parse(recovery)).toEqual(recovery);
    expect(HostedBrowserRecoverySchema.safeParse(recovery).success).toBe(false);
    for (const extra of [{ xdr: "unsigned bytes" }, { signedXdr: "signed bytes" }, { version: 3 }])
      expect(
        ConditionalHostedBrowserRecoverySchema.safeParse({ ...recovery, ...extra }).success,
      ).toBe(false);
  });
  it.each(["prepared", "signing", "submitted"])(
    "preserves paired original identity in %s",
    (phase) => {
      expect(ConditionalHostedBrowserRecoverySchema.safeParse({ ...recovery, phase }).success).toBe(
        false,
      );
      expect(
        ConditionalHostedBrowserRecoverySchema.safeParse({
          ...recovery,
          phase,
          intent: deploymentId,
        }).success,
      ).toBe(false);
      expect(
        ConditionalHostedBrowserRecoverySchema.safeParse({
          ...recovery,
          phase,
          intent: deploymentId,
          txHash: "aa".repeat(32),
        }).success,
      ).toBe(true);
    },
  );
  it("cannot downgrade signing uncertainty into ownership/preparation", () => {
    const original = { intent: deploymentId, txHash: "aa".repeat(32), attemptId: deploymentId };
    for (const phase of ["ownership", "preparing", "prepared"])
      expect(
        ConditionalHostedBrowserRecoverySchema.safeParse({ ...recovery, ...original, phase })
          .success,
      ).toBe(false);
    expect(
      ConditionalHostedBrowserRecoverySchema.safeParse({
        ...recovery,
        ...original,
        phase: "signing",
      }).success,
    ).toBe(true);
  });
  it("requires a literal separate receipt version", () => {
    const receipt = {
      version: 2,
      intent: deploymentId,
      txHash: "aa".repeat(32),
      state: "PREPARED",
      network: "testnet",
      expiresAt: "2026-11-15T00:00:00.000Z",
    };
    expect(ConditionalHostedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(HostedReceiptSchema.safeParse(receipt).success).toBe(false);
  });
  it("requires complete execution evidence and bounded canonical financial values", () => {
    const p = {
      version: 2,
      prepared: {
        intent: deploymentId,
        txHash: "aa".repeat(32),
        walletAddress: execution.payer,
        xdr: "synthetic unsigned envelope",
        expiresAt: "2026-11-15T00:00:00.000Z",
        network: "testnet",
        networkPassphrase: Networks.TESTNET,
        execution,
      },
      feeStroops: "100",
      rows: [],
      refundStroops: "0",
      accumulation: false,
    };
    expect(ConditionalHostedPreparedSchema.safeParse(p).success).toBe(true);
    for (const bad of [
      { ...p, feeStroops: "01" },
      { ...p, refundStroops: (2n ** 127n).toString() },
      { ...p, prepared: { ...p.prepared, execution: undefined } },
      { ...p, privateContacts: [] },
    ])
      expect(ConditionalHostedPreparedSchema.safeParse(bad).success).toBe(false);
  });
});
it("browser WebCrypto and server canonical proof binding match while separating all identity domains", async () => {
  vi.stubGlobal("crypto", webcrypto);
  try {
    const id = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    const context = conditionalHostedOwnershipContext({
      domain: "paiflow.hosted-execution.ownership",
      version: 2,
      deploymentId: id.toUpperCase(),
      payer: input.payment.from,
      network: "testnet",
      networkPassphraseHash: hash(Networks.TESTNET),
      requestDigest: hash(canonicalHostedValue(input.payment)),
      recoveryKeyHash: hash(input.recoveryKey),
    });
    const actual = await conditionalHostedOwnershipBinding(id, input, "testnet", Networks.TESTNET);
    expect(actual).toBe(hash(canonicalHostedValue(context)));
    expect(
      await conditionalHostedOwnershipBinding(id.toUpperCase(), input, "testnet", Networks.TESTNET),
    ).toBe(actual);
    for (const other of [
      { ...input, recoveryKey: "ac".repeat(32) },
      { ...input, payment: { ...input.payment, amount: "112" } },
    ])
      expect(
        await conditionalHostedOwnershipBinding(id, other, "testnet", Networks.TESTNET),
      ).not.toBe(actual);
    expect(await conditionalHostedOwnershipBinding(id, input, "mainnet", Networks.PUBLIC)).not.toBe(
      actual,
    );
    expect(
      hash(
        canonicalHostedValue({
          version: 2,
          deploymentId: id,
          network: "testnet",
          input: input.payment,
        }),
      ),
    ).not.toBe(hash(canonicalHostedValue(input.payment)));
    expect(canonicalHostedValue({ b: 1, a: ["x", "y"], ignored: undefined })).toBe(
      canonicalHostedValue({ a: ["x", "y"], b: 1 }),
    );
    expect(canonicalHostedValue(["x", "y"])).not.toBe(canonicalHostedValue(["y", "x"]));
  } finally {
    vi.unstubAllGlobals();
  }
});
