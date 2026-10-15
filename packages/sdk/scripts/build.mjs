import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Deleted or renamed source modules must never survive into a later tarball.
rmSync(resolve(packageRoot, "dist"), { recursive: true, force: true });
execFileSync(
  process.execPath,
  [resolve(packageRoot, "../../node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
  {
    cwd: packageRoot,
    stdio: "inherit",
  },
);
