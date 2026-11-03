import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  acceptancePacket,
  acceptanceScenarios,
  structuralCeilingScenario,
} from "../tests/fixtures/execution-acceptance";
import { env } from "../lib/env";

if (env().STELLAR_NETWORK !== "testnet")
  throw new Error(
    "Synthetic acceptance vectors require testnet configuration; no network I/O is performed",
  );

const destination = path.join(process.cwd(), "tests/fixtures/execution-acceptance");
mkdirSync(destination, { recursive: true });
for (const scenario of [...acceptanceScenarios, structuralCeilingScenario])
  writeFileSync(
    path.join(destination, `${scenario.name}.xdr-hex`),
    `${acceptancePacket(scenario)}\n`,
  );
