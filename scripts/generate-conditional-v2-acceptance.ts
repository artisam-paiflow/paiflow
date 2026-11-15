import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  conditionalAcceptancePacket,
  conditionalAcceptanceScenarios,
  conditionalSyntheticPins,
  type ConditionalFixturePins,
} from "../tests/fixtures/conditional-v2-acceptance";

const wasmDirectory = process.argv
  .find((arg) => arg.startsWith("--wasm-directory="))
  ?.slice("--wasm-directory=".length);
const destination = path.resolve(
  process.argv.find((arg) => arg.startsWith("--destination="))?.slice("--destination=".length) ??
    "tests/fixtures/conditional-v2-acceptance",
);
let pins: ConditionalFixturePins = conditionalSyntheticPins;
let pinSource = "synthetic-native-test-pins";
if (wasmDirectory) {
  const families = {
    DEPOSIT_TRIGGER: "deposit_trigger",
    PAYER: "payer",
    SPLITTER: "paiflow_splitter",
    ROUTER: "router",
  } as const;
  pins = Object.fromEntries(
    Object.entries(families).map(([kind, filename]) => [
      kind,
      createHash("sha256")
        .update(readFileSync(path.join(wasmDirectory, `${filename}.wasm`)))
        .digest("hex"),
    ]),
  ) as ConditionalFixturePins;
  pinSource = "local-compiled-bytes-pins-no-registry-activation";
}
mkdirSync(destination, { recursive: true });
for (const scenario of conditionalAcceptanceScenarios)
  writeFileSync(
    path.join(destination, `${scenario.name}.xdr-hex`),
    `${conditionalAcceptancePacket(scenario, pins, pinSource)}\n`,
  );
writeFileSync(
  path.join(destination, "pins.json"),
  `${JSON.stringify({ version: 2, pinSource, pins, noNetworkIO: true }, null, 2)}\n`,
);
