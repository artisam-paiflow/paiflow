/**
 * The starter flow seeded into a brand-new flow on `/flows/new`.
 *
 * Recipient addresses are **placeholder demo accounts** — valid Stellar
 * Ed25519 public keys but unfunded and without USDC trustlines. They exist
 * so the starter flow passes validation and can be deployed end-to-end on
 * the demo path. For a real audience-fund-and-distribute run the user
 * should edit each recipient to point at their own funded testnet account.
 *
 * The constants live here (not in `app/flows/new/page.tsx`) so unit tests
 * can import the graph without dragging the NextAuth-touching page module
 * into the test runtime.
 */

export const DEMO_RECIPIENT_ALICE = "GBIRFIVLH6OJXRL7ZTFEYL66NZAGAVEAFGAGRSXB6625QZXAWDFFWGEY";
export const DEMO_RECIPIENT_BOB = "GBGPI4CKOPJMMHEBRC43DPTNLGY4EXUKR2R56VSW4CQX4XPYY3BCZTWH";
export const DEMO_RECIPIENT_CHARLIE = "GAOVXKYHSRGPK4ZOCKDIJKAQ76K2CAIJZWESVWECZDETVCG4DMJQWLK2";

export const STARTER_GRAPH = {
  nodes: [
    {
      id: "trigger-1",
      type: "on_receive",
      config: { asset: { kind: "known", symbol: "USDC" } },
    },
    {
      id: "action-1",
      type: "split",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        recipients: [
          { address: DEMO_RECIPIENT_ALICE, mode: "percentage", bps: 6000, label: "Alice" },
          { address: DEMO_RECIPIENT_BOB, mode: "percentage", bps: 3000, label: "Bob" },
          { address: DEMO_RECIPIENT_CHARLIE, mode: "percentage", bps: 1000, label: "Charlie" },
        ],
      },
    },
  ],
  edges: [{ id: "e1", source: "trigger-1", target: "action-1" }],
} as const;
