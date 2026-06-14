import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV_FILE = ".env.local";

/**
 * Parse `.env.local` into a key/value map. First occurrence wins, matching the
 * behavior of `dotenv`. Missing or unreadable files return an empty map.
 */
export function readEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const content = readFileSync(ENV_FILE, "utf8");
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in result)) result[key] = value;
  }
  return result;
}

/**
 * Rewrite `.env.local` in place, replacing existing keys and appending new
 * ones at the end. Preserves comments, blank lines, and unrelated entries.
 */
export function writeEnvLocal(updates: Record<string, string>): void {
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  let lines: string[] = [];
  if (existsSync(ENV_FILE)) {
    lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  }

  const seen = new Set<string>();
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  const toAppend = keys.filter((key) => !seen.has(key));
  if (toAppend.length > 0) {
    if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] !== "") {
      updatedLines.push("");
    }
    updatedLines.push(`# updated ${new Date().toISOString()}`);
    for (const key of toAppend) {
      updatedLines.push(`${key}=${updates[key]}`);
    }
  }

  while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === "") {
    updatedLines.pop();
  }

  writeFileSync(ENV_FILE, updatedLines.join("\n") + "\n");
}
