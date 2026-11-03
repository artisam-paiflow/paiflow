import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { decodeExecutionState } from "@/lib/stellar/execution-v1";
import { assertOriginalConfiguration } from "@/lib/stellar/execution-state";
import { projectConfirmedGraph } from "@/lib/mutations/graph";
import { applyMutationValues } from "@/lib/mutations/values";
import {
  mutationArguments,
  mutationConstructors,
  mutationPacket,
  mutationReplacement,
  mutationScenarios,
} from "@/tests/fixtures/mutation-acceptance";
import { mutationObservations } from "@/tests/fixtures/mutation-observations";

describe("production mutation packets and actual local guest observations", () => {
  it("records local evidence with matching packet and WASM identities, without a rollout claim", () => {
    const report = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "docs/evidence/2026-11-01-mutation-readiness.json"),
        "utf8",
      ),
    ) as {
      evidenceKind: string;
      noNetworkIO: boolean;
      network: string;
      cases: Array<{
        name: string;
        packetSha256: string;
        wasmHashes: string[];
        localResources: { instructions: number; memoryBytes: number };
      }>;
    };
    expect(report.evidenceKind).toBe("local-guest-and-synthetic-rpc-only");
    expect(report.noNetworkIO).toBe(true);
    expect(report.network).toBe("testnet");
    for (const scenario of mutationScenarios) {
      const actual = mutationObservations(scenario).initial,
        recorded = report.cases.find((item) => item.name === scenario.name)!;
      expect(recorded.packetSha256).toBe(actual.packetHash);
      expect(recorded.wasmHashes).toEqual(actual.wasmHashes);
      expect(recorded.localResources.instructions).toBeLessThan(100_000_000);
      expect(recorded.localResources.memoryBytes).toBeLessThan(41_943_040);
    }
  });
  for (const scenario of mutationScenarios) {
    it(`${scenario.name}: regenerates exact unsigned constructor/payment/mutation bytes`, () => {
      const file = path.join(
        process.cwd(),
        "tests/fixtures/mutation-acceptance",
        `${scenario.name}.xdr-hex`,
      );
      expect(readFileSync(file, "utf8").trim()).toBe(mutationPacket(scenario));
    });
    it(`${scenario.name}: real getter/config_v1 bytes agree with production decoders and mutation values`, () => {
      const evidence = mutationObservations(scenario),
        constructors = mutationConstructors(scenario);
      const decode = (stage: typeof evidence.initial) =>
        stage.nodes.slice(1).map((node, index) => {
          const current = decodeExecutionState(scValToNative(node.configuration), {
            nodeId: node.nodeId,
            contractAddress: node.address,
            templateKind: constructors[index + 1]!.templateKind,
            confirmedLedger: 101,
          });
          if (current.kind === "on_receive") throw new Error("Unexpected root in payout states");
          assertOriginalConfiguration(scenario.graph, current.configuration);
          return current.configuration;
        });
      const initial = decode(evidence.initial),
        changed = decode(evidence.changed);
      const proposed = applyMutationValues(initial, mutationArguments(scenario));
      expect(proposed.map((n) => n.configuration)).toEqual(changed.map((n) => n.configuration));
      expect(initial.every((n) => n.revision === "0")).toBe(true);
      expect(changed.every((n) => n.revision === "1")).toBe(true);
      expect(evidence.initial.events).toEqual([]);
      expect(evidence.changed.events).toHaveLength(2);
      for (const event of evidence.changed.events) {
        const topics = event.topics.map(scValToNative);
        expect(topics[0]).toBe("config_v1");
        const observation = evidence.changed.nodes.find((n) => n.address === event.address)!;
        expect(topics[1]).toBe(observation.nodeId);
        expect(event.value.toXDR("hex")).toBe(observation.configuration.toXDR("hex"));
      }
      const graph = projectConfirmedGraph(scenario.graph, changed);
      expect(graph.nodes.find((n) => n.id === "fee")?.config).toMatchObject({
        recipient: mutationReplacement,
        amountStroops: "20",
      });
      expect(scenario.graph.nodes.find((n) => n.id === "fee")?.config).toMatchObject({
        amountStroops: "10",
      });
    });
    it(`${scenario.name}: accepted guest authorization tree binds exact production mutation arguments and changed children`, () => {
      const evidence = mutationObservations(scenario).initial;
      const auth = evidence.acceptedMutationAuth;
      expect(auth.credentials().switch().name).toBe("sorobanCredentialsSourceAccount");
      const root = auth.rootInvocation();
      const call = root.function().contractFn();
      expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(
        evidence.nodes[0]!.address,
      );
      expect(call.functionName().toString()).toBe("mutate_v1");
      const packet = xdr.ScVal.fromXDR(mutationPacket(scenario), "hex").vec()!;
      expect(call.args().map((arg) => arg.toXDR("hex"))).toEqual(
        packet[6]!.vec()!.map((arg) => arg.toXDR("hex")),
      );
      expect(root.subInvocations()).toHaveLength(1);
      expect(root.subInvocations()[0]!.subInvocations()).toHaveLength(1);
    });
  }
});
