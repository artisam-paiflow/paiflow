#!/usr/bin/env tsx
/** Read-only plan by default. Applying a reviewed plan is a separate operator action.
 * Never uploads artifacts, signs transactions or writes legacy registry/env slots. */
import { db } from "@/lib/prisma";
import { env } from "@/lib/env";
import {
  configureConditionalArtifacts,
  parseConditionalArtifactConfigurationArgs,
} from "@/lib/stellar/conditional-artifact-config-command";
async function main() {
  const { apply, ...options } = parseConditionalArtifactConfigurationArgs(process.argv.slice(2));
  const plan = await configureConditionalArtifacts(
    { network: env().STELLAR_NETWORK, ...options },
    apply,
  );
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}
main()
  .catch(() => {
    process.stderr.write(
      "Conditional artifact configuration failed; inspect flags, approved pins and the current dry-run digest.\n",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
