import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { contract } from "@stellar/stellar-sdk";
import {
  instanceConstructors,
  instanceDefinition,
  instanceKinds,
} from "../tests/fixtures/instance-acceptance";
import {
  inspectInstanceConstructor,
  instanceConformanceExitCode,
} from "../tests/fixtures/instance-conformance";

const filenames: Record<string, string> = {
  DEPOSIT_TRIGGER: "deposit_trigger",
  PAYER: "payer",
  STREAMER: "paiflow_streamer",
  SUBSCRIPTION: "paiflow_subscription",
  TIMELOCK_BRANCH: "timelock_branch",
  MULTISIG: "paiflow_multisig",
};
const wasmDir = process.argv[2] ?? "contracts/target/wasm32v1-none/release";
const observations = instanceKinds.map((kind) => ({
  kind,
  nodes: instanceConstructors(kind, 0).map((node, _index, nodes) => {
    const bytes = readFileSync(path.join(wasmDir, `${filenames[node.templateKind]}.wasm`));
    const spec = contract.Spec.fromWasm(bytes);
    const parentId = instanceDefinition(kind).graph.edges.find(
      (edge) => edge.target === node.nodeId,
    )?.source;
    const parent = nodes.find((candidate) => candidate.nodeId === parentId);
    const incoming = !parent
      ? null
      : ["SUBSCRIPTION", "MULTISIG"].includes(parent.templateKind)
        ? "receive_and_forward"
        : "execute_step";
    return {
      nodeId: node.nodeId,
      templateKind: node.templateKind,
      wasmSha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      ...inspectInstanceConstructor(spec, node.args, incoming),
      ...(node.templateKind === "MULTISIG"
        ? { contractSpecXdr: spec.entries.map((entry) => entry.toXDR("base64")) }
        : {}),
    };
  }),
}));
const result = {
  schemaVersion: 1,
  contractsSourceCommit: process.argv[4] ?? "unrecorded",
  evidence:
    "local compiled WASM spec compared with production TypeScript constructor packets; no RPC, signing, upload or activation",
  observations,
};
const output = `${JSON.stringify(result, null, 2)}\n`;
if (process.argv[3]) writeFileSync(process.argv[3], output);
else process.stdout.write(output);
// A known blocked family is evidence, not a fabricated successful readiness check.
process.exitCode = instanceConformanceExitCode(observations);
