import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Contract, Networks, TransactionBuilder, Operation } from "@stellar/stellar-sdk";
import {
  conditionalOwnerFixture,
  conditionalEditorRecipient,
} from "@/tests/fixtures/conditional-owner-configuration";
import {
  conditionalConfigurationChanges,
  conditionalConfigurationRevisionKey,
  proposedConditionalConfigurations,
  ConditionalConfigurationRecoverySchema,
  assertConditionalConfigurationPrepared,
  assertConditionalConfigurationRefusal,
} from "@/components/deploy/conditional-configuration-editor.utils";
import {
  editorProtocol,
  readEditorRecovery,
  saveEditorRecovery,
} from "@/components/deploy/configuration-protocol";
import { assertConditionalConfigurationEnvelope } from "@/lib/stellar/conditional-configuration-review";
import { mutationV2Args } from "@/lib/stellar/conditional-v2-codec";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
const fixture = () => conditionalOwnerFixture();
const marker = () => {
  const f = fixture();
  return {
    version: 2 as const,
    ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deploymentId: f.state.deploymentId,
    network: "testnet" as const,
    key: "conditional-original-key",
    request: f.request,
    reviewed: f.state,
    phase: "prepared" as const,
    prepared: f.receipt(),
    result: null,
    refusal: null,
  };
};
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("strict conditional owner review and recovery", () => {
  it("builds only declared changes across prefix/condition/both branches and revalidates the complete result", () => {
    const f = fixture();
    const drafts = structuredClone(f.state.statuses.map(({ state }) => state));
    if (drafts[1]!.configuration.kind === "pay")
      drafts[1]!.configuration.configuration.recipient = conditionalEditorRecipient;
    if (drafts[2]!.configuration.kind === "condition")
      drafts[2]!.configuration.thresholdStroops = "0";
    for (const i of [3, 4])
      if (drafts[i]!.configuration.kind === "split")
        drafts[i]!.configuration.configuration.configuredRows[0]!.recipient =
          conditionalEditorRecipient;
    const request = conditionalConfigurationChanges(f.state, drafts);
    expect(request.arguments.changes.map((c) => c.nodeId)).toEqual([
      "fee",
      "condition",
      "yes",
      "no",
    ]);
    expect(proposedConditionalConfigurations(f.state, request)).toEqual(drafts);
  });
  it.each([
    "owner",
    "asset",
    "revision",
    "parent",
    "next",
    "comparison",
    "mode",
    "rowId",
    "rowOrder",
    "constantRecipient",
    "nodeOrder",
    "nodeCount",
  ])("refuses immutable %s changes", (attack) => {
    const f = fixture(),
      drafts = structuredClone(f.state.statuses.map(({ state }) => state));
    if (attack === "owner") drafts[1]!.admin = conditionalEditorRecipient;
    if (attack === "asset") drafts[1]!.assetContract = drafts[0]!.contractAddress;
    if (attack === "revision") drafts[1]!.revision = "1";
    if (attack === "parent") drafts[1]!.parentContract = drafts[2]!.contractAddress;
    if (attack === "next") drafts[1]!.nextContracts = [];
    if (attack === "comparison" && drafts[2]!.configuration.kind === "condition")
      drafts[2]!.configuration.comparison = "amount_lt";
    if (attack === "mode" && drafts[2]!.configuration.kind === "condition")
      drafts[2]!.configuration.thresholdMode = "constant";
    const split = drafts[3]!.configuration;
    if (split.kind === "split") {
      if (attack === "rowId") split.configuration.configuredRows[0]!.rowId = "replaced";
      if (attack === "rowOrder") split.configuration.configuredRows.reverse();
      if (attack === "constantRecipient")
        split.configuration.configuredRows[1]!.recipient = conditionalEditorRecipient;
    }
    if (attack === "nodeOrder") drafts.reverse();
    if (attack === "nodeCount") drafts.pop();
    expect(() => conditionalConfigurationChanges(f.state, drafts)).toThrow();
  });
  it("rejects no-op, exhausted revisions and out-of-range threshold values before preparation", () => {
    const f = fixture();
    expect(() =>
      conditionalConfigurationChanges(
        f.state,
        f.state.statuses.map(({ state }) => state),
      ),
    ).toThrow();
    for (const threshold of ["-1", "01", (2n ** 127n).toString()]) {
      const drafts = structuredClone(f.state.statuses.map(({ state }) => state));
      if (drafts[2]!.configuration.kind === "condition")
        drafts[2]!.configuration.thresholdStroops = threshold;
      expect(() => conditionalConfigurationChanges(f.state, drafts)).toThrow();
    }
    const exhausted = structuredClone(f.state);
    exhausted.nodes[2]!.expectedRevision = (2n ** 64n - 1n).toString();
    exhausted.statuses[2]!.state.revision = exhausted.nodes[2]!.expectedRevision;
    const drafts = structuredClone(exhausted.statuses.map(({ state }) => state));
    if (drafts[2]!.configuration.kind === "condition")
      drafts[2]!.configuration.thresholdStroops = "51";
    expect(() => conditionalConfigurationChanges(exhausted, drafts)).toThrow();
  });
  it("excludes ledger/debt churn from review identity but includes every inactive revision and value", () => {
    const f = fixture(),
      changed = structuredClone(f.state);
    changed.confirmedLedger++;
    changed.statuses[4]!.obligationsStroops = "2";
    expect(conditionalConfigurationRevisionKey(changed)).toBe(
      conditionalConfigurationRevisionKey(f.state),
    );
    changed.statuses[4]!.state.revision = "1";
    changed.nodes[4]!.expectedRevision = "1";
    expect(conditionalConfigurationRevisionKey(changed)).not.toBe(
      conditionalConfigurationRevisionKey(f.state),
    );
  });
  it.each(["hash", "fee", "expiry", "wallet", "network", "definition", "binding", "request"])(
    "rejects substituted %s review evidence",
    (attack) => {
      const f = fixture(),
        p = f.receipt();
      if (attack === "hash") p.txHash = "ab".repeat(32);
      if (attack === "fee") p.feeStroops = "101";
      if (attack === "expiry") p.expiresAt = new Date(Date.parse(p.expiresAt) + 1000).toISOString();
      if (attack === "wallet") p.walletAddress = conditionalEditorRecipient;
      if (attack === "network") p.network = "mainnet";
      if (attack === "definition") p.mutation.definition.condition.thresholdStroops = "51";
      if (attack === "binding") p.mutation.nodes[4]!.expectedRevision = "1";
      const request = structuredClone(f.request);
      if (attack === "request") request.arguments.changes[0]!.expectedRevision = "1";
      expect(() => assertConditionalConfigurationPrepared(p, f.state, request)).toThrow();
    },
  );
  it.each(["method", "root", "args", "source", "extraOperation", "infinite", "signed"])(
    "inspects actual %s envelope body rather than trusting metadata",
    (attack) => {
      const f = fixture(),
        p = f.receipt();
      const args = mutationV2Args(p.mutation);
      const builder = new TransactionBuilder(
        new Account(attack === "source" ? conditionalEditorRecipient : p.walletAddress, "10"),
        { fee: "100", networkPassphrase: Networks.TESTNET },
      );
      builder.addOperation(
        new Contract(
          attack === "root" ? f.state.nodes[1]!.contractAddress : p.mutation.rootContract,
        ).call(
          attack === "method" ? "mutate_v1" : "mutate_v2",
          ...(attack === "args" ? args.slice(0, 1) : args),
        ),
      );
      if (attack === "extraOperation")
        builder.addOperation(Operation.manageData({ name: "unexpected", value: "x" }));
      builder.setTimeout(attack === "infinite" ? 0 : 180);
      const tx = builder.build();
      if (attack === "signed") {
        /* Wallet signatures are forbidden on the original unsigned review. */ tx.sign(
          requireAdmin(),
        );
      }
      p.xdr = tx.toXDR();
      p.txHash = tx.hash().toString("hex");
      p.feeStroops = tx.fee;
      p.expiresAt = new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString();
      expect(() => assertConditionalConfigurationEnvelope(p)).toThrow();
    },
  );
  it("strictly separates unknown/mixed records and verifies storage readback without clearing bytes", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", new EventTarget());
    const r = marker();
    saveEditorRecovery("shared", r);
    expect(readEditorRecovery("shared")).toEqual(ConditionalConfigurationRecoverySchema.parse(r));
    for (const raw of [
      { ...r, version: 3 },
      { ...r, version: undefined },
      { ...r, request: { ...r.request, arguments: { version: 1, changes: [] } } },
    ]) {
      const bytes = JSON.stringify(raw);
      data.set("shared", bytes);
      expect(() => readEditorRecovery("shared")).toThrow();
      expect(data.get("shared")).toBe(bytes);
    }
    storage.setItem = () => {};
    expect(() => saveEditorRecovery("shared", r)).toThrow();
    expect(() => editorProtocol(false).parseRecovery(r)).toThrow();
  });
  it("requires canonical server UUID and outer version2 in a fresh NOT_ADMITTED proof", async () => {
    const r = marker();
    const hash = async (s: string) =>
      Array.from(
        new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
    const proof = {
      version: 2,
      outcome: "NOT_ADMITTED",
      refusalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      deploymentId: r.deploymentId,
      network: r.network,
      admin: r.request.admin,
      idempotencyKeyHash: await hash(r.key),
      requestDigest: executionRequestDigest({
        version: 2,
        deploymentId: r.reviewed.deploymentId,
        network: r.network,
        input: r.request,
      }),
      refusedAt: new Date().toISOString(),
      reasonCode: "CONFLICT",
    };
    expect(await assertConditionalConfigurationRefusal(proof, r)).toEqual(proof);
    await expect(
      assertConditionalConfigurationRefusal(
        {
          ...proof,
          requestDigest: executionRequestDigest({
            deploymentId: r.deploymentId,
            network: r.network,
            input: r.request,
          }),
        },
        r,
      ),
    ).rejects.toThrow();
    await expect(
      assertConditionalConfigurationRefusal({ ...proof, version: 1 }, r),
    ).rejects.toThrow();
  });
});
import { conditionalEditorAdmin as requireAdminValue } from "@/tests/fixtures/conditional-owner-configuration";
const requireAdmin = () => requireAdminValue;
