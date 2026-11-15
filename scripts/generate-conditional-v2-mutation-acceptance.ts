import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  conditionalSyntheticPins,
  type ConditionalFixturePins,
} from "../tests/fixtures/conditional-v2-acceptance";
import {
  conditionalMutationAcceptancePacket,
  conditionalMutationFixtures,
} from "../tests/fixtures/conditional-v2-mutation-acceptance";

const wasmDirectory = process.argv
  .find((arg) => arg.startsWith("--wasm-directory="))
  ?.slice("--wasm-directory=".length);
const destination = path.resolve(
  process.argv.find((arg) => arg.startsWith("--destination="))?.slice("--destination=".length) ??
    "tests/fixtures/conditional-v2-mutation-acceptance",
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
for (const fixture of conditionalMutationFixtures)
  writeFileSync(
    path.join(destination, `${fixture}.xdr-hex`),
    `${conditionalMutationAcceptancePacket(fixture, pins, pinSource)}\n`,
  );
writeFileSync(
  path.join(destination, "pins.json"),
  `${JSON.stringify({ version: 2, pinSource, pins, noNetworkIO: true }, null, 2)}\n`,
);
