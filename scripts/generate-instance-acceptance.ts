import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instanceKinds, instancePacket } from "../tests/fixtures/instance-acceptance";
import { env } from "../lib/env";

if (env().STELLAR_NETWORK !== "testnet")
  throw new Error(
    "Unsigned synthetic constructor vectors require testnet configuration; no network I/O is performed",
  );
const destination = path.join(process.cwd(), "tests/fixtures/instance-acceptance");
mkdirSync(destination, { recursive: true });
for (const kind of instanceKinds)
  writeFileSync(path.join(destination, `${kind}.xdr-hex`), `${instancePacket(kind)}\n`);
