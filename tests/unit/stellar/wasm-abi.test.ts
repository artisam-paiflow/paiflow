import { createHash } from "node:crypto";
import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { extractWasmAbi } from "@/lib/stellar/wasm-abi";

const hash = (wasm: Buffer) => createHash("sha256").update(wasm).digest("hex");
function uint(value: number): Buffer {
  const bytes = [];
  do {
    const next = value >>> 7;
    bytes.push((value & 127) | (next ? 128 : 0));
    value = next;
  } while (value);
  return Buffer.from(bytes);
}
function moduleWithSpecs(sections: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
    ...sections.map((section) => {
      const name = Buffer.from("contractspecv0");
      const payload = Buffer.concat([uint(name.length), name, section]);
      return Buffer.concat([Buffer.from([0]), uint(payload.length), payload]);
    }),
  ]);
}
function entry(name: string) {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({ doc: "", name, inputs: [], outputs: [] }),
  );
}

describe("exact-artifact ABI extraction", () => {
  it("retains every spec entry across all sections, including entry order", () => {
    const entries = [entry("subscribe"), entry("charge"), entry("unsubscribe")];
    const wasm = moduleWithSpecs([
      Buffer.concat(entries.slice(0, 2).map((e) => e.toXDR())),
      entries[2]!.toXDR(),
    ]);
    expect(extractWasmAbi(wasm, hash(wasm))).toEqual({
      specEntriesXdr: entries.map((e) => e.toXDR("base64")),
    });
  });

  it("refuses mismatched or malformed expected hashes", () => {
    const wasm = moduleWithSpecs([entry("charge").toXDR()]);
    expect(() => extractWasmAbi(wasm, "a".repeat(64))).toThrow("do not match");
    expect(() => extractWasmAbi(wasm, "not-a-hash")).toThrow("Invalid expected");
  });

  it("rejects invalid WASM and absent, empty, malformed, or truncated specifications", () => {
    for (const wasm of [
      Buffer.from("not-wasm"),
      moduleWithSpecs([]),
      moduleWithSpecs([Buffer.alloc(0)]),
      moduleWithSpecs([Buffer.from([255, 255, 255, 255])]),
      moduleWithSpecs([entry("charge").toXDR().subarray(0, 7)]),
    ])
      expect(() => extractWasmAbi(wasm, hash(wasm))).toThrow();
  });
});
