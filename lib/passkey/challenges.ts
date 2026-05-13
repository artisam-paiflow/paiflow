import "server-only";
import { redis } from "@/lib/redis";

const memStore = new Map<string, { value: string; expiresAt: number }>();

function memSet(key: string, value: string, ttlSeconds: number) {
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
function memGet(key: string): string | null {
  const v = memStore.get(key);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    memStore.delete(key);
    return null;
  }
  return v.value;
}

export async function saveChallenge(scope: string, id: string, challenge: string) {
  const key = `wa:${scope}:${id}`;
  const r = redis();
  if (r) {
    await r.set(key, challenge, "EX", 300);
  } else {
    memSet(key, challenge, 300);
  }
}

export async function popChallenge(scope: string, id: string): Promise<string | null> {
  const key = `wa:${scope}:${id}`;
  const r = redis();
  if (r) {
    const v = await r.get(key);
    if (v) await r.del(key);
    return v;
  }
  const v = memGet(key);
  if (v) memStore.delete(key);
  return v;
}
