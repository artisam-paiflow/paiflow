// Its own module so both schema.ts and the builder's address input can use it
// without address-rules.ts (which imports schema.ts) forming a cycle.

/**
 * True for anything that could be all or part of a Stellar secret seed: it
 * starts with S (either case, after whitespace). No address a flow accepts
 * starts with S — accounts are G…, contracts C…, placeholders PENDING: — so
 * nothing valid is refused, and a secret key is never stored or echoed.
 */
export function looksLikeSecretSeed(value: string): boolean {
  return /^s/i.test(value.trim());
}

export const SECRET_SEED_MESSAGE =
  "That looks like a secret key (S…). Never paste a secret key into Paiflow; enter the public address (G…) instead.";
