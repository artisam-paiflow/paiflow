import { Prisma, TemplateKind } from "@prisma/client";
import { db } from "@/lib/prisma";

export async function setWasmHash(
  kind: TemplateKind,
  network: string,
  wasmHash: string,
  abiJson?: object,
  options?: { expectedCurrentHash: string },
): Promise<void> {
  if (
    abiJson !== undefined &&
    (abiJson === null || Array.isArray(abiJson) || Object.keys(abiJson).length === 0)
  )
    throw new Error("Empty ABI metadata cannot replace registered contract evidence");

  // Serializable admission keeps a concurrent hash change from reusing ABI
  // evidence read for a different artifact. A serialization conflict is safe to
  // retry because this transaction performs only this registry write.
  for (let attempt = 0; ; attempt++) {
    try {
      await db.$transaction(
        async (tx) => {
          const where = { kind_network: { kind, network } };
          const current = await tx.contractTemplate.findUnique({ where });
          if (options && current?.wasmHash !== options.expectedCurrentHash)
            throw new Error(
              "Registry hash changed or is absent; ABI repair requires the exact existing artifact",
            );
          if (current && current.wasmHash !== wasmHash && abiJson === undefined)
            throw new Error("Changing a registered WASM hash requires its matching ABI metadata");
          await tx.contractTemplate.upsert({
            where,
            update: { wasmHash, ...(abiJson !== undefined ? { abiJson } : {}) },
            create: { kind, network, wasmHash, abiJson: abiJson ?? {} },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      )
        continue;
      throw error;
    }
  }
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
