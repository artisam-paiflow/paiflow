import { createRequire } from "node:module";
import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PatchOpSchema } from "@/lib/ai/prompts";
import { FundingPrepareSchema, FundingReconcileSchema } from "@/lib/api/v1/funding-schema";
import { ContractEventItemSchema, ExecuteSubmitQuerySchema } from "@/lib/api/v1/schema";
import { DevPayerSchema, DevSplitterSchema } from "@/lib/dev/schema";
import { CreateDeveloperTokenSchema } from "@/lib/developer-tokens/schema";
import { SettlementVerificationSchema } from "@/lib/deployments/service-schema";
import { AllowanceDeploymentIdSchema } from "@/lib/subscription/schema";
import { OnScheduleTrigger } from "@/lib/flows/schema";
import { coercedIntegerNumber, integerNumber } from "@/lib/validation/number";

const wallet = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
const acceptedIds = [
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
  "12345678-1234-1234-1234-123456789abc",
  "12345678-1234-4234-8234-123456789abc",
  "ABCDEF12-ABCD-ABCD-ABCD-ABCDEF123456",
];
const rejectedIds = [
  "12345678-1234-1234-1234-123456789ab",
  "12345678-1234-1234-1234-123456789abg",
  "12345678123412341234123456789abc",
  " 12345678-1234-1234-1234-123456789abc",
];

function identifierResults(id: string): boolean[] {
  return [
    AllowanceDeploymentIdSchema.safeParse(id).success,
    FundingReconcileSchema.safeParse({ action: "schedule.fund", intent: id }).success,
    CreateDeveloperTokenSchema.safeParse({ permission: "READ_ONLY", deploymentIds: [id] }).success,
    SettlementVerificationSchema.safeParse({
      kind: "fence-work",
      id,
      evidence: "Independent verification of the stopped worker",
      confirmation: "Verified worker stopped",
    }).success,
  ];
}

describe("Zod upgrade preserves existing request contracts", () => {
  it.each(acceptedIds)("retains UUID-like identifier acceptance for %s", (id) => {
    expect(identifierResults(id)).toEqual([true, true, true, true]);
  });
  it.each(rejectedIds)("retains malformed identifier rejection for %s", (id) => {
    expect(identifierResults(id)).toEqual([false, false, false, false]);
  });
  it("retains identifier error text and lowercase token grant normalization", () => {
    expect(AllowanceDeploymentIdSchema.safeParse("invalid").error?.issues[0]?.message).toBe(
      "Invalid uuid",
    );
    expect(
      CreateDeveloperTokenSchema.parse({ permission: "READ_ONLY", deploymentIds: [acceptedIds[4]] })
        .deploymentIds,
    ).toEqual([acceptedIds[4]!.toLowerCase()]);
  });
  it("keeps omitted transformed edge handles absent and converts explicit null to undefined", () => {
    const edge = { id: "e", source: "a", target: "b" };
    const omitted = PatchOpSchema.parse({ op: "addEdge", edge });
    const explicit = PatchOpSchema.parse({ op: "addEdge", edge: { ...edge, sourceHandle: null } });
    expect(omitted).toEqual({ op: "addEdge", edge });
    expect(explicit).toEqual({ op: "addEdge", edge: { ...edge, sourceHandle: undefined } });
    expect(omitted.op === "addEdge" && Object.hasOwn(omitted.edge, "sourceHandle")).toBe(false);
  });
  it("keeps query defaults transformed rather than returning the input string", () => {
    expect(ExecuteSubmitQuerySchema.parse({})).toEqual({ wait: true });
    expect(ExecuteSubmitQuerySchema.parse({ wait: "false" })).toEqual({ wait: false });
  });
  it("preserves legacy unbounded integer acceptance without changing bounded fields or money", () => {
    const large = Number.MAX_SAFE_INTEGER + 1;
    const config = { intervalUnit: "day", startsAt: "2026-10-24T00:00:00Z", intervalAmount: large };
    expect(
      OnScheduleTrigger.parse({ id: "t", type: "on_schedule", config }).config.intervalAmount,
    ).toBe(large);
    expect(integerNumber().parse(large)).toBe(large);
    expect(coercedIntegerNumber().parse(String(large))).toBe(large);
    expect(integerNumber().safeParse(1.5).success).toBe(false);
    expect(integerNumber().safeParse(Infinity).success).toBe(false);
    expect(integerNumber().safeParse(NaN).success).toBe(false);
    expect(
      DevSplitterSchema.safeParse({
        recipients: [{ address: wallet, mode: "percentage", bps: large }],
      }).success,
    ).toBe(false);
    const amount = {
      fromAddress: wallet,
      tokenContractAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amountStroops: ((1n << 127n) - 1n).toString(),
    };
    expect(FundingPrepareSchema.parse(amount).amountStroops).toBe(amount.amountStroops);
    expect(
      FundingPrepareSchema.safeParse({ ...amount, amountStroops: (1n << 127n).toString() }).success,
    ).toBe(false);
    expect(FundingPrepareSchema.safeParse({ ...amount, amountStroops: large }).success).toBe(false);
  });
  it("keeps absent, null and arbitrary event data compatible", () => {
    const row = {
      id: acceptedIds[2],
      eventId: "e",
      kind: "RECEIVE",
      topic: "charge",
      ledger: 1,
      txHash: "a".repeat(64),
      occurredAt: "2026-10-24T00:00:00Z",
    };
    expect(ContractEventItemSchema.parse(row)).toEqual(row);
    expect(ContractEventItemSchema.parse({ ...row, data: null })).toEqual({ ...row, data: null });
    expect(ContractEventItemSchema.parse({ ...row, data: { amount: "123" } }).data).toEqual({
      amount: "123",
    });
  });
  it("runs the actual Pay resolver and preserves field errors", async () => {
    const resolve = zodResolver(DevPayerSchema);
    const options = { fields: {}, shouldUseNativeValidation: false };
    const body = {
      recipient: wallet,
      mode: "fixed" as const,
      amountStroops: "90071992547409931234567",
    };
    expect(await resolve(body, undefined, options)).toEqual({ values: body, errors: {} });
    const refused = await resolve({ ...body, recipient: "invalid" }, undefined, options);
    expect(refused.values).toEqual({});
    expect(refused.errors.recipient?.message).toBe("Invalid Stellar address");
  });
  it("runs the actual Split resolver with an omitted input default and parsed output", async () => {
    const resolve = zodResolver(DevSplitterSchema);
    const result = await resolve(
      { recipients: [{ address: wallet, mode: "fixed", amountStroops: "1234567890123456789" }] },
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    expect(result).toEqual({
      values: {
        recipients: [
          {
            address: wallet,
            mode: "fixed",
            amountStroops: "1234567890123456789",
            payoutMode: "crypto",
          },
        ],
      },
      errors: {},
    });
  });
});

describe("patched collection parsing bounds work before visiting oversized input", () => {
  it.each(["array", "map", "set"] as const)(
    "rejects an oversized %s before validating elements",
    (kind) => {
      let visited = 0;
      const element = z.string().refine(() => {
        visited += 1;
        return false;
      });
      const result =
        kind === "array"
          ? z.array(element).max(1).safeParse(["first", "second"])
          : kind === "map"
            ? z
                .map(element, element)
                .max(1)
                .safeParse(
                  new Map([
                    ["first", "a"],
                    ["second", "b"],
                  ]),
                )
            : z
                .set(element)
                .max(1)
                .safeParse(new Set(["first", "second"]));
      expect(result.success).toBe(false);
      expect(result.error?.issues).toMatchObject([{ code: "too_big" }]);
      expect(visited).toBe(0);
    },
  );
  it("bounds the real Dev Split roster before any Stellar recipient validation", () => {
    const address = Object.defineProperty({}, "address", {
      get: () => {
        throw new Error("recipient visited");
      },
    });
    const result = DevSplitterSchema.safeParse({
      recipients: Array.from({ length: 21 }, () => address),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["recipients"]);
  });
});

describe("WalletConnect's actual transitive ABI validator", () => {
  it("resolves patched v4 and still validates function ABI payloads", () => {
    const root = createRequire(import.meta.url);
    const sign = createRequire(root.resolve("@walletconnect/sign-client"));
    const utils = createRequire(sign.resolve("@walletconnect/utils"));
    const ox = createRequire(utils.resolve("ox"));
    const abi = createRequire(ox.resolve("abitype"));
    const parser = abi("zod") as typeof z;
    expect(parser.core.version.major).toBe(4);
    expect(parser.array(parser.string()).max(1).safeParse([1, 2]).error?.issues).toHaveLength(1);
    const schemas = ox("abitype/zod") as {
      Abi: { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } };
    };
    const value = [
      { type: "function", name: "example", inputs: [], outputs: [], stateMutability: "view" },
    ];
    expect(schemas.Abi.parse(value)).toEqual(value);
    expect(schemas.Abi.safeParse([{ ...value[0], stateMutability: "invalid" }]).success).toBe(
      false,
    );
  });
});
