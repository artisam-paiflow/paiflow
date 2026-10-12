import "server-only";
import { AppError } from "@/lib/errors";
/** Bound streaming bodies before JSON parsing, including requests without Content-Length. */
export async function fundingBody(req: Request): Promise<unknown> {
  if (!req.body) throw new AppError("VALIDATION", "Request body must be valid JSON");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 110_000) {
        await reader.cancel();
        throw new AppError("VALIDATION", "Request body too large");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  } finally {
    reader.releaseLock();
  }
}
