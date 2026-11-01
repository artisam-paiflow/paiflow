import { describe, expect, it } from "vitest";
import { ExecutePrepareSchema } from "@/lib/api/v1/schema";
import {
  HostedPrepareSchema,
  HostedSubmitSchema,
  HostedReceiptRequestSchema,
  HostedVisibilitySchema,
  HostedPreparedSchema,
  HostedReceiptSchema,
} from "@/lib/hosted-execution/schema";
import {
  HostedBrowserRecoverySchema,
  formArguments,
  tokenInput,
  fieldKey,
} from "@/lib/hosted-execution/form";
import { hostedPaymentReview } from "@/lib/hosted-execution/review";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import { alice, bob, hostedState, payment, preparation, intentId } from "./fixtures";

describe("hosted request boundaries", () => {
  const key = "ab".repeat(32);
  it("parses one exact input and strict response, with no client-supplied network or policy", () => {
    expect(HostedPrepareSchema.parse({ recoveryKey: key, payment }).payment).toEqual(payment);
    expect(HostedPreparedSchema.parse(preparation(payment)).rows[0]?.recipient).toBe(alice);
    expect(HostedVisibilitySchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(
      HostedReceiptSchema.parse({
        intent: intentId,
        txHash: "cd".repeat(32),
        network: "testnet",
        state: "PREPARED",
        expiresAt: "2026-11-01T00:00:00Z",
      }).state,
    ).toBe("PREPARED");
  });
  it.each(["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "public"])(
    "rejects invalid recovery capability %s",
    (recoveryKey) => {
      expect(HostedReceiptRequestSchema.safeParse({ recoveryKey }).success).toBe(false);
    },
  );
  it("rejects unknown, missing and credential fields", () => {
    expect(
      ExecutePrepareSchema.safeParse({ ...payment, hostedAccessHash: "ab".repeat(32) }).success,
    ).toBe(false);
    expect(
      HostedPrepareSchema.safeParse({
        recoveryKey: key,
        payment,
        hostedAccessHash: "ab".repeat(32),
      }).success,
    ).toBe(false);
    expect(
      HostedPrepareSchema.safeParse({ recoveryKey: key, payment, token: "pfk_secret" }).success,
    ).toBe(false);
    expect(
      HostedPrepareSchema.safeParse({
        recoveryKey: key,
        payment: { ...payment, network: "mainnet" },
      }).success,
    ).toBe(false);
    expect(HostedVisibilitySchema.safeParse({ enabled: "true" }).success).toBe(false);
    expect(HostedVisibilitySchema.safeParse({ enabled: true, ownerId: "someone" }).success).toBe(
      false,
    );
    expect(
      HostedSubmitSchema.safeParse({
        recoveryKey: key,
        intent: intentId,
        signedXdr: "signedfixture",
        method: "withdraw",
      }).success,
    ).toBe(false);
    expect(
      HostedSubmitSchema.safeParse({ recoveryKey: key, signedXdr: "signedfixture" }).success,
    ).toBe(false);
    expect(
      HostedReceiptSchema.safeParse({
        intent: intentId,
        txHash: "cd".repeat(32),
        network: "testnet",
        state: "UNKNOWN",
        expiresAt: "now",
      }).success,
    ).toBe(false);
  });
  it("browser recovery refuses unsigned/signed envelopes or wallet credentials", () => {
    const saved = { recoveryKey: key, request: payment, phase: "prepared" };
    expect(HostedBrowserRecoverySchema.safeParse(saved).success).toBe(true);
    for (const field of ["signedXdr", "xdr", "secretKey", "token"])
      expect(
        HostedBrowserRecoverySchema.safeParse({ ...saved, [field]: "forbidden" }).success,
      ).toBe(false);
  });
  it.each(["-1", "1e2", "1.00000001", "1..0", "", "1junk"])(
    "never normalizes an invalid amount %s",
    (value) => expect(() => tokenInput(value)).toThrow(),
  );
  it("converts exact seven-decimal token amounts without floating point", () => {
    expect(tokenInput("9007199254740993.1234567")).toBe("90071992547409931234567");
  });
});

describe("input and payout review", () => {
  it("requires runtime recipient without using a saved placeholder", () => {
    expect(() => formArguments(hostedState, {}, {})).toThrow();
    expect(formArguments(hostedState, { [fieldKey("pay", "pay", "recipient")]: bob }, {})).toEqual({
      version: 1,
      inputs: [{ kind: "pay", nodeId: "pay", recipient: bob }],
    });
  });
  it("shows successive recipients from each execution and does not change stored configuration", () => {
    const first = preparation(payment);
    const second = preparation(
      {
        ...payment,
        arguments: { version: 1, inputs: [{ kind: "pay", nodeId: "pay", recipient: bob }] },
      },
      2,
    );
    expect(first.rows[0]).toMatchObject({
      recipient: alice,
      amountStroops: "100",
      recipientSource: "execution",
      allocationSource: "constant",
    });
    expect(second.rows[0]?.recipient).toBe(bob);
    expect(hostedState.configurations[0]?.configuration).not.toHaveProperty("recipient");
  });
  it("keeps constant platform shares and ordered rounding beside variable roster", () => {
    const state = ExecutionDiscoverySchema.parse({
      ...hostedState,
      policies: {
        version: 1,
        nodes: [
          {
            kind: "split",
            nodeId: "pay",
            allocationMode: "percentage",
            rows: [{ rowId: "platform" }],
            additionalRecipients: "execution",
          },
        ],
      },
      configurations: [
        {
          ...hostedState.configurations[0],
          policy: {
            kind: "split",
            nodeId: "pay",
            allocationMode: "percentage",
            rows: [{ rowId: "platform" }],
            additionalRecipients: "execution",
          },
          configuration: {
            kind: "split",
            configuredRows: [
              {
                rowId: "platform",
                recipient: alice,
                allocation: { kind: "percentage", bps: 1000 },
              },
            ],
            additionalRecipients: [],
          },
        },
      ],
    });
    if (!state.supported) throw new Error();
    const args = formArguments(
      state,
      {},
      { pay: [{ rowId: "worker", recipient: bob, allocation: "90" }] },
    );
    const result = hostedPaymentReview(state, {
      ...preparation(payment).prepared.execution,
      amountStroops: "111",
      arguments: args,
    });
    expect(
      result.rows.map((row) => [row.recipient, row.amountStroops, row.allocationSource]),
    ).toEqual([
      [alice, "11", "constant"],
      [bob, "100", "execution"],
    ]);
    expect(() =>
      formArguments(state, {}, { pay: [{ rowId: "platform", recipient: bob, allocation: "90" }] }),
    ).toThrow();
    expect(() =>
      hostedPaymentReview(state, {
        ...preparation(payment).prepared.execution,
        arguments: formArguments(
          state,
          {},
          { pay: [{ rowId: "worker", recipient: alice, allocation: "90" }] },
        ),
      }),
    ).toThrow();
  });
});
