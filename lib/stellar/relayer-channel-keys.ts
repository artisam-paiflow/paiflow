import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const KEY_DOMAIN = "paiflow-relayer-channel:";

/**
 * Deterministic relayer channel key: a raw ed25519 seed from
 * sha256(relayerSeed || domain || index). No new secret to store or rotate; a
 * channel key is exactly as sensitive as the relayer secret it comes from, so
 * never log one. Kept apart from `relayer-channels.ts` (which is `server-only`)
 * so `scripts/relayer-channels.ts` can print the public addresses.
 */
export function deriveChannelKeypair(relayerSecret: string, index: number): Keypair {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Relayer channel index must be a non-negative integer");
  }
  const seed = Keypair.fromSecret(relayerSecret).rawSecretKey();
  const digest = createHash("sha256")
    .update(seed)
    .update(KEY_DOMAIN)
    .update(String(index))
    .digest();
  return Keypair.fromRawEd25519Seed(digest);
}
