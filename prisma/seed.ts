import { PrismaClient, Role, TemplateKind } from "@prisma/client";
import argon2 from "argon2";

const db = new PrismaClient();

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function main() {
  const env = process.env.NODE_ENV ?? "development";
  const allowReseed = process.env.ALLOW_RESEED === "true";
  const username = process.env.ADMIN_SEED_USERNAME ?? "admin";
  const password = process.env.ADMIN_SEED_PASSWORD;
  const network = process.env.STELLAR_NETWORK ?? "testnet";

  if (!password) {
    throw new Error("ADMIN_SEED_PASSWORD is required to seed. Refusing to seed with a default.");
  }
  if (password.length < 12) {
    throw new Error("ADMIN_SEED_PASSWORD must be at least 12 characters.");
  }

  const existingAdmin = await db.user.findFirst({ where: { role: Role.ADMIN } });
  if (existingAdmin && env === "production" && !allowReseed) {
    console.log("[seed] Admin already exists in production. Skipping reseed.");
  } else {
    const passwordHash = await argon2.hash(password, ARGON_OPTS);
    await db.user.upsert({
      where: { username },
      update: { passwordHash, role: Role.ADMIN, isActive: true },
      create: {
        username,
        passwordHash,
        role: Role.ADMIN,
        isActive: true,
      },
    });
    console.log(`[seed] Admin user '${username}' ready.`);
  }

  const templates: Array<{ kind: TemplateKind; envKey: string; abi: object }> = [
    {
      kind: TemplateKind.SPLITTER,
      envKey: "STELLAR_WASM_HASH_SPLITTER",
      abi: {
        functions: ["__init", "distribute", "pause", "unpause", "recipients"],
        events: ["Distributed"],
      },
    },
    {
      kind: TemplateKind.STREAMER,
      envKey: "STELLAR_WASM_HASH_STREAMER",
      abi: {
        functions: ["__init", "claim", "top_up", "cancel", "available"],
        events: ["Claimed", "Cancelled"],
      },
    },
    {
      kind: TemplateKind.CONDITIONAL,
      envKey: "STELLAR_WASM_HASH_CONDITIONAL",
      abi: {
        functions: ["__init", "release", "cancel", "status"],
        events: ["Released", "Cancelled"],
      },
    },
  ];

  for (const t of templates) {
    const hash = process.env[t.envKey];
    if (!hash) {
      console.log(
        `[seed] ${t.envKey} not set; skipping ContractTemplate(${t.kind}). Run pnpm contracts:upload.`,
      );
      continue;
    }
    await db.contractTemplate.upsert({
      where: { kind_network: { kind: t.kind, network } },
      update: { wasmHash: hash, abiJson: t.abi },
      create: { kind: t.kind, network, wasmHash: hash, abiJson: t.abi },
    });
    console.log(`[seed] ContractTemplate(${t.kind}@${network}) hash=${hash.slice(0, 12)}…`);
  }

  console.log("[seed] done");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
