export const WALLET_CONNECT_UNCONFIGURED =
  "Mobile wallet connection is not configured on this deployment " +
  "(NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is unset). Use Freighter on desktop, " +
  "or ask the operator to set it.";

// Kept free of SDK imports so it loads under vitest's node environment.
// The access must stay a literal `process.env.NEXT_PUBLIC_…`: the bundler
// inlines NEXT_PUBLIC_* only when spelled out, so this cannot go through
// lib/env.ts (CLAUDE.md §14).
export function walletConnectProjectId(): string | null {
  const id = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;
  return id && id.trim() ? id : null;
}
