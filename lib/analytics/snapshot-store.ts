import "server-only";
import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Publish only complete snapshots. Hard-linking also refuses to overwrite existing history. */
export async function saveSnapshot(directory: string, filename: string, snapshot: unknown) {
  const contents = JSON.stringify(snapshot, null, 2) + "\n";
  const temporary = join(directory, `.pending-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await link(temporary, join(directory, filename));
  } finally {
    try {
      await handle.close();
    } finally {
      await unlink(temporary);
    }
  }
}
