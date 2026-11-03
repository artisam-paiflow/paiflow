import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Address, contract, scValToNative } from "@stellar/stellar-sdk";
import {
  instanceBindings,
  instanceConstructors,
  instanceDefinition,
  instanceKinds,
  instancePacket,
  instanceVersionId,
} from "@/tests/fixtures/instance-acceptance";
import { bindTemplateVersion } from "@/lib/flow-templates/binder";
import {
  inspectInstanceConstructor,
  instanceConformanceExitCode,
} from "@/tests/fixtures/instance-conformance";

describe("private-instance constructor acceptance packets", () => {
  it.each(instanceKinds)(
    "reproduces the committed unsigned %s packet through the production binder and compiler",
    (kind) => {
      expect(instancePacket(kind)).toBe(
        readFileSync(
          path.resolve("tests/fixtures/instance-acceptance", `${kind}.xdr-hex`),
          "utf8",
        ).trim(),
      );
      const a = instanceConstructors(kind, 0),
        b = instanceConstructors(kind, 1);
      expect(a.map((n) => n.templateKind)).toEqual(b.map((n) => n.templateKind));
      expect(b.every((n) => a.every((other) => other.address !== n.address))).toBe(true);
      const definition = instanceDefinition(kind);
      const original = structuredClone(definition);
      const bound = bindTemplateVersion(definition, instanceVersionId, instanceBindings(kind, 1));
      expect(definition).toEqual(original);
      expect(bound.graph.fieldPolicies).toBeUndefined(); // Creation permission grants no runtime mutation mode.
    },
  );
  it("pins distinct agreement windows while retaining independent constructor identity", () => {
    const a = instanceConstructors("schedule", 0)[0]!,
      b = instanceConstructors("schedule", 1)[0]!;
    expect(BigInt(scValToNative(b.args[5]!)) - BigInt(scValToNative(a.args[5]!))).toBe(120n);
    expect(BigInt(scValToNative(b.args[6]!)) - BigInt(scValToNative(a.args[6]!))).toBe(120n);
    const ta = instanceConstructors("time-condition", 0).find(
      (n) => n.templateKind === "TIMELOCK_BRANCH",
    )!;
    const tb = instanceConstructors("time-condition", 1).find(
      (n) => n.templateKind === "TIMELOCK_BRANCH",
    )!;
    expect(BigInt(scValToNative(tb.args[2]!)) - BigInt(scValToNative(ta.args[2]!))).toBe(120n);
  });
  it("never fills a required creation recipient from the configured exemplar", () => {
    expect(() =>
      bindTemplateVersion(instanceDefinition("immediate"), instanceVersionId, {
        version: 1,
        templateVersionId: instanceVersionId,
        values: [],
      }),
    ).toThrow("Missing creation input recipient");
    const recipient = instanceConstructors("immediate", 0).find((n) => n.templateKind === "PAYER")!;
    expect(Address.fromScVal(recipient.args[1]!).toString()).not.toBe(
      instanceDefinition("immediate").graph.nodes.find((n) => n.type === "pay")!.config.recipient,
    );
  });
  it("keeps both MULTISIG readiness failures visible in the same checker used by the CLI", () => {
    const evidence = JSON.parse(
      readFileSync(
        path.resolve("docs/evidence/2026-11-01-instance-artifact-conformance.json"),
        "utf8",
      ),
    ) as {
      observations: Array<{ nodes: Array<{ templateKind: string; contractSpecXdr?: string[] }> }>;
    };
    const node = evidence.observations
      .flatMap((o) => o.nodes)
      .find((n) => n.templateKind === "MULTISIG")!;
    const actualSpec = new contract.Spec(node.contractSpecXdr!);
    const production = instanceConstructors("multisig", 0).find(
      (n) => n.templateKind === "MULTISIG",
    )!;
    const observed = inspectInstanceConstructor(actualSpec, production.args, "execute_step");
    expect(observed.constructorInputs).toHaveLength(5);
    expect(observed.encodedArgumentCount).toBe(6);
    expect(observed.constructorError).toContain("expected 5 arguments");
    expect(observed.incomingMethodAvailable).toBe(false);
    expect(instanceConformanceExitCode([{ nodes: [observed] }])).toBe(1);
    expect(
      instanceConformanceExitCode([
        { nodes: [{ constructorError: null, incomingMethodAvailable: true }] },
      ]),
    ).toBe(0);
  });
});
