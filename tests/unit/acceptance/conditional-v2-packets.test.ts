import {
  Account,
  SorobanDataBuilder,
  TransactionBuilder,
  Networks,
  xdr,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  hashes: vi.fn(),
  factory: vi.fn(),
  load: vi.fn(),
  simulate: vi.fn(),
}));
vi.mock("@/lib/stellar/conditional-artifact-config", () => ({
  getConditionalWasmHashes: mocks.hashes,
}));
vi.mock("@/lib/stellar/config", () => ({
  getFactoryAddress: mocks.factory,
  getWasmHashes: () => {
    throw new Error("Legacy registry must never provide conditional artifacts");
  },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ simulateTransaction: mocks.simulate }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mocks.load }));
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import { verifyConditionalDeploymentOriginal } from "@/lib/stellar/prepare-conditional-deploy";
import { executionV2Args, mutationV2Args } from "@/lib/stellar/conditional-v2-codec";
import {
  createJoinedCapsule,
  joinedCanvas,
  joinedFactory,
  joinedLayouts,
  joinedSha256,
  writeJoinedCapsules,
} from "@/tests/fixtures/conditional-v2-joined-acceptance";
beforeEach(() => {
  mocks.hashes.mockResolvedValue(new Map(Object.entries(CONDITIONAL_V2_WASM_HASHES)));
  mocks.factory.mockResolvedValue(joinedFactory);
  mocks.load.mockImplementation(
    async (_server: unknown, address: string) => new Account(address, "10"),
  );
  mocks.simulate.mockImplementation(async () => ({
    _parsed: true,
    id: "joined-local",
    latestLedger: 100,
    minResourceFee: "1000",
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    events: [],
  }));
});
describe("production conditional factory evidence capsules", () => {
  it.each(["minimal-gt", "minimal-lt", "standard"] as const)(
    "captures actual factory args and complete original for %s without signed envelopes",
    async (layout) => {
      const c = await createJoinedCapsule(layout),
        e = c.publicEvidence;
      const fields = xdr.ScVal.fromXDR(c.packet, "hex").vec()!;
      expect(fields).toHaveLength(9);
      const tx = TransactionBuilder.fromXDR(e.prepared.xdr, Networks.TESTNET);
      if (!("operations" in tx) || tx.operations[0]!.type !== "invokeHostFunction")
        throw new Error("factory op");
      expect(fields[2]!.vec()!.map((v) => v.toXDR("hex"))).toEqual(
        tx.operations[0]!.func.invokeContract()
          .args()
          .map((v) => v.toXDR("hex")),
      );
      expect(e.packetSha256).toBe(joinedSha256(Buffer.from(c.packet, "hex")));
      expect(e.original.sourceAccount).not.toBe(c.payer.publicKey());
      expect(
        verifyConditionalDeploymentOriginal(
          {
            ...e.original,
            unsignedXdr: e.prepared.xdr,
            preparedTxHash: e.prepared.conditionalReview.txHash,
          },
          joinedFactory,
        ).envelope,
      ).toEqual(e.original.paramsSnapshot);
      for (const [i, op] of e.operations.entries()) {
        const actualArgs = fields[7]!.vec()![i]!.vec()![2]!.vec()!;
        const expected =
          "payer" in op.intent ? executionV2Args(op.intent) : mutationV2Args(op.intent);
        expect(actualArgs.map((v) => v.toXDR("hex"))).toEqual(expected.map((v) => v.toXDR("hex")));
        const unsigned = TransactionBuilder.fromXDR(op.unsignedXdr, Networks.TESTNET);
        expect(unsigned.signatures).toHaveLength(0);
      }
      expect(JSON.stringify(e)).not.toMatch(/"(?:secret|privateKey|seed)"/);
      if (layout === "standard") {
        expect(e.operations.map((op) => op.id)).toEqual([
          "before",
          "group",
          "stale",
          "fresh-true",
          "fresh-false",
        ]);
        expect((e.operations[2]!.intent as { nonce: string }).nonce).not.toBe(
          (e.operations[0]!.intent as { nonce: string }).nonce,
        );
        const fresh = e.operations.at(-1)!.intent;
        expect(fresh).toMatchObject({
          selectedBranch: "false",
          amountAtConditionStroops: "99",
          arguments: { inputs: [{ kind: "pay", nodeId: "no" }] },
        });
        expect(e.original.paramsSnapshot.definition.condition.thresholdStroops).toBe("100");
      } else {
        expect(
          e.operations.map((op) =>
            "selectedBranch" in op.intent ? op.intent.selectedBranch : "mutation",
          ),
        ).toEqual(
          layout === "minimal-gt" ? ["false", "false", "true"] : ["true", "false", "false"],
        );
      }
    },
  );
  it("keeps all seven bounded layouts explicit without claiming deployability at structural limits", () => {
    expect(joinedLayouts.map((l) => joinedCanvas(l).nodes.length)).toEqual([4, 4, 5, 4, 8, 12, 40]);
  });
  it.skipIf(!process.env.PAIFLOW_CONDITIONAL_PACKET_DIRECTORY)(
    "produces create-new public packets for the independent actual-WASM harness",
    async () => {
      const directory = process.env.PAIFLOW_CONDITIONAL_PACKET_DIRECTORY!;
      const capsules = [];
      for (const layout of joinedLayouts) capsules.push(await createJoinedCapsule(layout));
      await writeJoinedCapsules(directory, capsules);
    },
    120000,
  );
});
