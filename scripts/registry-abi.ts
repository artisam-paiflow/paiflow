import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { TemplateKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { setWasmHash } from "@/lib/stellar/template-db";
import { extractWasmAbi } from "@/lib/stellar/wasm-abi";

export type AbiRepair = {
  kind: TemplateKind;
  wasmPath: string;
  wasmHash: string;
  apply: boolean;
};

/** ABI repair is deliberately separate from the default multi-kind hash sync.
 * It targets one existing row, defaults to inspection, and never uploads WASM. */
export function parseAbiRepair(args: string[]): AbiRepair | undefined {
  if (args.length === 0) return undefined;
  const values = new Map<string, string>();
  let apply = false;
  for (const arg of args) {
    if (arg === "--apply" && !apply) {
      apply = true;
      continue;
    }
    const match = /^--(abi-kind|abi-wasm|abi-hash)=(.+)$/.exec(arg);
    if (!match || values.has(match[1]!))
      throw new Error(`Invalid or repeated ABI repair argument: ${arg}`);
    values.set(match[1]!, match[2]!);
  }
  const kind = values.get("abi-kind");
  const wasmPath = values.get("abi-wasm");
  const wasmHash = values.get("abi-hash");
  if (
    !kind ||
    !Object.hasOwn(TemplateKind, kind) ||
    kind === TemplateKind.PAYROLL ||
    !wasmPath ||
    !wasmHash ||
    !/^[a-f0-9]{64}$/.test(wasmHash)
  )
    throw new Error(
      "ABI repair requires --abi-kind=<active TemplateKind> --abi-wasm=<file> --abi-hash=<64 lowercase hex>; add --apply only after reviewing pin compatibility",
    );
  return { kind: kind as TemplateKind, wasmPath, wasmHash, apply };
}

export function readAbiRepair(repair: AbiRepair) {
  return extractWasmAbi(readFileSync(repair.wasmPath), repair.wasmHash);
}

export async function inspectOrRepairAbi(repair: AbiRepair, network: string) {
  const abiJson = readAbiRepair(repair);
  const row = await db.contractTemplate.findUnique({
    where: { kind_network: { kind: repair.kind, network } },
  });
  if (row?.wasmHash !== repair.wasmHash)
    throw new Error("ABI repair requires the expected hash in the existing registry row");
  if (repair.apply)
    await setWasmHash(repair.kind, network, repair.wasmHash, abiJson, {
      expectedCurrentHash: repair.wasmHash,
    });
  return abiJson;
}

export async function syncBuiltWasm(kind: TemplateKind, network: string, wasmHash: string) {
  const current = await db.contractTemplate.findUnique({
    where: { kind_network: { kind, network } },
  });
  // Preserve representation and immutable ABI digest when only syncing a hash.
  const abiJson = current?.wasmHash === wasmHash ? undefined : readBuiltWasmAbi(kind, wasmHash);
  await setWasmHash(kind, network, wasmHash, abiJson);
}

/** Hash activation must carry ABI from the corresponding build output, never
 * copy metadata from the previous hash or silently install another empty ABI. */
export function readBuiltWasmAbi(kind: TemplateKind, wasmHash: string) {
  const directory = "contracts/target/wasm32v1-none/release";
  const candidates = ["paiflow", "pinkraft"].map((prefix) =>
    resolve(directory, `${prefix}_${kind.toLowerCase()}.wasm`),
  );
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path)
    throw new Error(
      `Matching local WASM is required to register ${kind}; build or supply the exact artifact before syncing a new hash`,
    );
  return extractWasmAbi(readFileSync(path), wasmHash);
}
