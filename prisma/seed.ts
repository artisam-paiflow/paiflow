import "dotenv/config";
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

  const networkSuffix = network.toUpperCase();
  const templates: Array<{ kind: TemplateKind; envKey: string; abi: object }> = [
    {
      kind: TemplateKind.SPLITTER,
      envKey: `STELLAR_WASM_HASH_SPLITTER_${networkSuffix}`,
      abi: {
        functions: [
          "__init",
          "distribute",
          "pause",
          "unpause",
          "recipients",
          "receive_and_forward",
          "set_next_steps",
          "next_steps",
        ],
        events: ["Distributed"],
      },
    },
    {
      kind: TemplateKind.STREAMER,
      envKey: `STELLAR_WASM_HASH_STREAMER_${networkSuffix}`,
      abi: {
        functions: ["__init", "claim", "top_up", "cancel", "available"],
        events: ["Claimed", "Cancelled"],
      },
    },
    {
      kind: TemplateKind.CONDITIONAL,
      envKey: `STELLAR_WASM_HASH_CONDITIONAL_${networkSuffix}`,
      abi: {
        functions: ["__init", "release", "cancel", "status"],
        events: ["Released", "Cancelled"],
      },
    },
    {
      kind: TemplateKind.TRIGGER,
      envKey: `STELLAR_WASM_HASH_TRIGGER_${networkSuffix}`,
      abi: {
        functions: ["__init", "trigger", "next_steps", "asset"],
        events: ["Trigger"],
      },
    },
    {
      kind: TemplateKind.ROUTER,
      envKey: `STELLAR_WASM_HASH_ROUTER_${networkSuffix}`,
      abi: {
        functions: ["__init", "receive_and_forward", "threshold", "path_a", "path_b"],
        events: ["Route"],
      },
    },
    {
      kind: TemplateKind.TIMELOCK,
      envKey: `STELLAR_WASM_HASH_TIMELOCK_${networkSuffix}`,
      abi: {
        functions: ["__init", "receive_and_forward", "release", "balance", "unlock_time"],
        events: ["Receive", "Release"],
      },
    },
  ];

  for (const t of templates) {
    const hash = process.env[t.envKey];
    if (!hash) {
      console.log(
        `[seed] ${t.envKey} not set; skipping ContractTemplate(${t.kind}@${network}). Run pnpm contracts:upload --network=${network}.`,
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
