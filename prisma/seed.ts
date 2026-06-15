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
          "__constructor",
          "distribute",
          "pause",
          "unpause",
          "recipients",
          "execute_step",
          "set_next_steps",
          "next_steps",
        ],
        events: ["payout", "forward"],
      },
    },
    {
      kind: TemplateKind.STREAMER,
      envKey: `STELLAR_WASM_HASH_STREAMER_${networkSuffix}`,
      abi: {
        functions: ["__constructor", "execute_step", "claim", "top_up", "cancel", "available"],
        events: ["receive", "claim", "cancel", "deposit"],
      },
    },
    {
      kind: TemplateKind.CONDITIONAL,
      envKey: `STELLAR_WASM_HASH_CONDITIONAL_${networkSuffix}`,
      abi: {
        functions: ["__constructor", "execute_step", "release", "cancel", "status"],
        events: ["receive", "release", "cancel"],
      },
    },
    {
      kind: TemplateKind.DEPOSIT_TRIGGER,
      envKey: `STELLAR_WASM_HASH_DEPOSIT_TRIGGER_${networkSuffix}`,
      abi: {
        functions: ["__constructor", "deposit", "next_steps", "asset"],
        events: ["deposit"],
      },
    },
    {
      kind: TemplateKind.ROUTER,
      envKey: `STELLAR_WASM_HASH_ROUTER_${networkSuffix}`,
      abi: {
        functions: ["__constructor", "execute_step", "threshold", "path_a", "path_b"],
        events: ["route"],
      },
    },
    {
      kind: TemplateKind.TIMELOCK,
      envKey: `STELLAR_WASM_HASH_TIMELOCK_${networkSuffix}`,
      abi: {
        functions: ["__constructor", "execute_step", "release", "balance", "unlock_time"],
        events: ["receive", "release"],
      },
    },
    {
      kind: TemplateKind.PAYER,
      envKey: `STELLAR_WASM_HASH_PAYER_${networkSuffix}`,
      abi: {
        functions: [
          "__constructor",
          "execute_step",
          "cancel",
          "balance",
          "configured_amount",
          "recipient",
        ],
        events: ["pay", "cancel", "forward"],
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
