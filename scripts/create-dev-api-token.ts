/**
 * Mint a developer API token for a Pinkraft user.
 *
 * The token maps a machine caller (e.g. the paiflow-payroll app) to a specific
 * user who will OWN the deployments it creates via POST /api/deployments/dev-payroll.
 * Only the SHA-256 hash is stored; the plaintext below is shown ONCE — copy it
 * into the caller's `x-dev-api-secret` header.
 *
 * Usage:
 *   pnpm dev-token:create --user <username> [--label "paiflow-payroll"]
 *   pnpm dev-token:create --user-id <uuid>  [--label "paiflow-payroll"]
 */
import { randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  const next = process.argv[idx + 1];
  if (idx !== -1 && next && !next.startsWith("--")) {
    return next;
  }
  return undefined;
}

(async () => {
  const username = arg("user");
  const userId = arg("user-id");
  const label = arg("label") ?? "dev-api-token";

  if (!username && !userId) {
    console.error("Provide --user <username> or --user-id <uuid>");
    process.exit(1);
  }

  const user = userId
    ? await db.user.findUnique({ where: { id: userId } })
    : await db.user.findUnique({ where: { username: username! } });

  if (!user) {
    console.error(`User not found: ${userId ?? username}`);
    process.exit(1);
  }

  const token = `pkdev_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await db.devApiToken.create({
    data: { userId: user.id, tokenHash, label },
  });

  console.log("Developer API token created.");
  console.log(`  user:  ${user.username} (${user.id})`);
  console.log(`  label: ${label}`);
  console.log("");
  console.log("  Send this in the `x-dev-api-secret` header. It is shown only once:");
  console.log("");
  console.log(`  ${token}`);
  console.log("");

  await db.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
