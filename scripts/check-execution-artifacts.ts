/** Read-only local build verification; never uploads or changes registry/env values. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EXECUTION_V1_WASM_HASHES } from "../lib/stellar/execution-artifacts";

const filenames = {
  DEPOSIT_TRIGGER: "deposit_trigger",
  PAYER: "payer",
  SPLITTER: "paiflow_splitter",
} as const;
async function main() {
  for (const [kind, filename] of Object.entries(filenames)) {
    const bytes = await readFile(
      resolve("contracts/target/wasm32v1-none/release", `${filename}.wasm`),
    );
    const actual = createHash("sha256").update(bytes).digest("hex");
    const expected = EXECUTION_V1_WASM_HASHES[kind as keyof typeof filenames];
    if (actual !== expected)
      throw new Error(`${kind} local WASM differs from reviewed execution manifest`);
    process.stdout.write(`${kind}: ${actual} (${bytes.length} bytes)\n`);
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Artifact verification failed"}\n`,
  );
  process.exitCode = 1;
});
