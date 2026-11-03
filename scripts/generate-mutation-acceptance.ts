import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scValToNative } from "@stellar/stellar-sdk";
import { mutationPacket, mutationScenarios } from "../tests/fixtures/mutation-acceptance";
import { mutationObservations } from "../tests/fixtures/mutation-observations";
import { env } from "../lib/env";

if (env().STELLAR_NETWORK !== "testnet")
  throw new Error("Synthetic vectors require testnet configuration; no network I/O is performed");
const destination = path.join(process.cwd(), "tests/fixtures/mutation-acceptance");
mkdirSync(destination, { recursive: true });
for (const scenario of mutationScenarios)
  writeFileSync(
    path.join(destination, `${scenario.name}.xdr-hex`),
    `${mutationPacket(scenario)}\n`,
  );
const logFlag = process.argv.find((arg) => arg.startsWith("--observations-log="));
if (logFlag) {
  const source = process.argv
    .find((arg) => arg.startsWith("--contract-source="))
    ?.slice("--contract-source=".length);
  if (!source || !/^[a-f0-9]{40}$/.test(source))
    throw new Error("Observation evidence requires the exact --contract-source SHA");
  execFileSync("git", ["cat-file", "-e", `${source}^{commit}`]);
  const changed = execFileSync("git", ["diff", "--name-only", source, "--", "contracts"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((file) => file && !file.includes("/tests/") && !file.includes("/test_snapshots/"));
  if (changed.length)
    throw new Error("Runtime contract source differs from the recorded build source");
  const log = readFileSync(logFlag.slice("--observations-log=".length), "utf8");
  for (const scenario of mutationScenarios) {
    const matches = [
      ...log.matchAll(new RegExp(`MUTATION_EVIDENCE_${scenario.name}:([a-f0-9]+)`, "g")),
    ];
    if (matches.length !== 1)
      throw new Error(`Expected exactly one guest observation for ${scenario.name}`);
    writeFileSync(
      path.join(destination, `${scenario.name}.observations.xdr-hex`),
      `${matches[0]![1]}\n`,
    );
  }
  const cases = mutationScenarios.map((scenario) => {
    const observation = mutationObservations(scenario);
    const resources = log.match(
      new RegExp(
        `MUTATION_RESOURCES_${scenario.name}:InvocationResources \\{ instructions: (\\d+), mem_bytes: (\\d+),[^\\n]*write_entries: (\\d+),[^\\n]*contract_events_size_bytes: (\\d+)`,
      ),
    );
    if (!resources)
      throw new Error(`Missing bounded local resource observation for ${scenario.name}`);
    return {
      name: scenario.name,
      packetSha256: observation.initial.packetHash,
      wasmHashes: observation.initial.wasmHashes,
      localResources: {
        instructions: Number(resources[1]),
        memoryBytes: Number(resources[2]),
        writeEntries: Number(resources[3]),
        eventBytes: Number(resources[4]),
      },
      emittedConfigurationEvents: observation.changed.events.length,
      zeroBalanceObligationProbe: observation.blocked
        ? {
            rawBalancesStroops: observation.blocked.balances,
            accountedObligationsStroops: String(
              (
                scValToNative(
                  observation.blocked.nodes.find((node) => node.nodeId === "split")!.status,
                ) as { obligations: bigint }
              ).obligations,
            ),
          }
        : null,
    };
  });
  const rust = execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim();
  const sdk = readFileSync(path.join(process.cwd(), "contracts/Cargo.lock"), "utf8").match(
    /\[\[package\]\]\nname = "soroban-sdk"\nversion = "([^"]+)"/,
  );
  if (!sdk) throw new Error("Cannot identify locked guest SDK");
  const report = {
    schemaVersion: 1,
    network: "testnet",
    contractSource: source,
    rust,
    sorobanSdk: sdk[1],
    evidenceKind: "local-guest-and-synthetic-rpc-only",
    sourceAuthorization: "exact-root-and-changed-child-source-credential-tree",
    debugAuthObservation: "disabled-for-bounded-guest-calls; authorization-enforced",
    noNetworkIO: true,
    cases,
  };
  writeFileSync(
    path.join(process.cwd(), "docs/evidence/2026-11-01-mutation-readiness.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
