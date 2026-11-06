import { createHash } from "node:crypto";
import { contract } from "@stellar/stellar-sdk";

/** Extract every spec section from the exact artifact being registered. This
 * compiles the module for validation; it never instantiates or executes WASM. */
export function extractWasmAbi(wasm: Buffer, expectedHash: string): { specEntriesXdr: string[] } {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("Invalid expected WASM hash");
  if (createHash("sha256").update(wasm).digest("hex") !== expectedHash)
    throw new Error("WASM bytes do not match the expected artifact hash");
  const module = new WebAssembly.Module(Uint8Array.from(wasm));
  const sections = WebAssembly.Module.customSections(module, "contractspecv0");
  if (sections.length === 0) throw new Error("WASM has no contract specification");
  const spec = new contract.Spec(Buffer.concat(sections.map((section) => Buffer.from(section))));
  if (spec.entries.length === 0) throw new Error("WASM contract specification is empty");
  return { specEntriesXdr: spec.entries.map((entry) => entry.toXDR("base64")) };
}
