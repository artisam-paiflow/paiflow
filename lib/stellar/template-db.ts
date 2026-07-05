import { TemplateKind } from "@prisma/client";
import { db } from "@/lib/prisma";

export async function setWasmHash(
  kind: TemplateKind,
  network: string,
  wasmHash: string,
  abiJson?: object,
): Promise<void> {
  await db.contractTemplate.upsert({
    where: { kind_network: { kind, network } },
    update: { wasmHash, abiJson: abiJson ?? {} },
    create: { kind, network, wasmHash, abiJson: abiJson ?? {} },
  });
}

export async function setFactoryAddress(
  network: string,
  address: string,
  wasmHash?: string,
): Promise<void> {
  await db.factoryDeployment.upsert({
    where: { network },
    update: { address, ...(wasmHash !== undefined ? { wasmHash } : {}) },
    create: { network, address, wasmHash },
  });
}

export async function getWasmHashesFromDb(
  kinds: TemplateKind[],
  network: string,
): Promise<Map<TemplateKind, string>> {
  const rows = await db.contractTemplate.findMany({
    where: { network, kind: { in: kinds } },
  });
  return new Map(rows.map((r) => [r.kind, r.wasmHash]));
}

export async function getWasmHashFromDb(
  kind: TemplateKind,
  network: string,
): Promise<string | undefined> {
  const row = await db.contractTemplate.findUnique({
    where: { kind_network: { kind, network } },
  });
  return row?.wasmHash;
}

export async function getFactoryAddressFromDb(network: string): Promise<string | undefined> {
  const row = await db.factoryDeployment.findUnique({ where: { network } });
  return row?.address;
}
