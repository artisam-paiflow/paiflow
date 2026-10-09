import { describe, expect, it } from "vitest";
import {
  DeleteFlowSchema,
  RetireDeploymentSchema,
  SettlementVerificationSchema,
} from "@/lib/deployments/service-schema";
const confirmation = {
  confirmation: "Permanently retire deployment",
  irreversible: true,
  onChainResponsibility: true,
};
describe("irreversible service confirmation schemas", () => {
  it("accepts explicit retirement and unused-flow deletion", () => {
    expect(RetireDeploymentSchema.parse(confirmation)).toEqual(confirmation);
    expect(DeleteFlowSchema.parse({ confirmation: "Permanently delete flow" })).toBeTruthy();
  });
  it.each([
    {},
    { ...confirmation, irreversible: false },
    { ...confirmation, onChainResponsibility: false },
    { ...confirmation, confirmation: "retire" },
    { ...confirmation, restore: true },
    { ...confirmation, irreversible: "true" },
  ])("rejects incomplete or misleading confirmation: %j", (input) => {
    expect(RetireDeploymentSchema.safeParse(input).success).toBe(false);
  });
  it("requires a specific recovery record, verification, and meaningful evidence", () => {
    const valid = {
      kind: "offramp",
      id: "11111111-1111-4111-8111-111111111111",
      evidence: "Provider recovery record verified by operator",
      confirmation: "Verified no remaining obligation",
    };
    expect(SettlementVerificationSchema.safeParse(valid).success).toBe(true);
    for (const input of [
      { ...valid, evidence: " " },
      { ...valid, kind: "force" },
      { ...valid, id: "bad" },
      { ...valid, confirmation: "Force retirement" },
    ])
      expect(SettlementVerificationSchema.safeParse(input).success).toBe(false);
  });
});

it("accepts verified transaction finality and rejects inferred or malformed outcomes", () => {
  const valid = {
    kind: "transaction",
    txHash: "a".repeat(64),
    outcome: "FAILED",
    ledger: 600,
    evidence: "Archived ledger result independently verified",
    confirmation: "Verified no remaining obligation",
  };
  expect(SettlementVerificationSchema.safeParse(valid).success).toBe(true);
  for (const body of [
    { ...valid, outcome: "NOT_FOUND" },
    { ...valid, ledger: 0 },
    { ...valid, txHash: "bad" },
    { ...valid, evidence: "timeout" },
  ])
    expect(SettlementVerificationSchema.safeParse(body).success).toBe(false);
});

it("requires verified terminal claim evidence without restarting future automation", () => {
  const valid = {
    kind: "streamer",
    id: "11111111-1111-4111-8111-111111111111",
    outcome: "SKIPPED",
    evidence: "Worker fenced; no submitted claim or obligation remains",
    confirmation: "Verified no remaining obligation",
  };
  expect(SettlementVerificationSchema.safeParse(valid).success).toBe(true);
  for (const body of [
    { ...valid, outcome: "PENDING" },
    { ...valid, evidence: "timeout" },
    { ...valid, restore: true },
  ])
    expect(SettlementVerificationSchema.safeParse(body).success).toBe(false);
});

it("requires explicit worker fencing evidence separately from obligation completion", () => {
  const valid = {
    kind: "fence-work",
    id: "11111111-1111-4111-8111-111111111111",
    evidence: "Incident recovery: worker process stopped and cannot restart",
    confirmation: "Verified worker stopped",
  };
  expect(SettlementVerificationSchema.parse(valid)).toEqual(valid);
  for (const body of [
    { ...valid, confirmation: "Verified no remaining obligation" },
    { ...valid, confirmation: "Worker lease expired" },
    { ...valid, evidence: " " },
    { ...valid, evidence: "timeout" },
    { ...valid, id: "bad" },
    { ...valid, outcome: "SUCCESS" },
  ])
    expect(SettlementVerificationSchema.safeParse(body).success).toBe(false);
});
