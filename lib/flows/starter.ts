/**
 * The starter flow seeded into a brand-new flow on `/flows/new`.
 *
 * `STARTER_GRAPH`'s recipient addresses are **placeholder demo accounts** —
 * valid Stellar Ed25519 public keys but unfunded and without USDC trustlines.
 * They exist so the starter flow passes validation and can be deployed
 * end-to-end on the demo path. For a real audience-fund-and-distribute run the
 * user should edit each recipient to point at their own funded testnet account.
 *
 * `SANDBOX_STARTER_GRAPH` is the exception and must not use them: nobody edits
 * it before deploying, so its recipient has to be able to receive the asset.
 * See `SANDBOX_DEMO_RECIPIENT`.
 *
 * The constants live here (not in `app/flows/new/page.tsx`) so unit tests
 * can import the graph without dragging the NextAuth-touching page module
 * into the test runtime.
 */

export const DEMO_RECIPIENT_ALICE = "GBIRFIVLH6OJXRL7ZTFEYL66NZAGAVEAFGAGRSXB6625QZXAWDFFWGEY";
export const DEMO_RECIPIENT_BOB = "GBGPI4CKOPJMMHEBRC43DPTNLGY4EXUKR2R56VSW4CQX4XPYY3BCZTWH";
export const DEMO_RECIPIENT_CHARLIE = "GAOVXKYHSRGPK4ZOCKDIJKAQ76K2CAIJZWESVWECZDETVCG4DMJQWLK2";

/**
 * The Pay recipient in the sandbox starter, and the one address here that is
 * NOT a placeholder: it is funded on testnet and holds a USDC trustline for
 * the issuer in `lib/stellar/assets.ts`. The sandbox flow is deployed and
 * triggered as-is by visitors who never edit it, and `deposit` simulates the
 * whole pipeline down to the final SAC `transfer` — so a recipient without a
 * trustline fails pre-flight and the sandbox can never complete a swap.
 */
export const SANDBOX_DEMO_RECIPIENT = "GCVJW2CEXCJ6WPRYAMYFIDA6LLIYX5NJIJ6T76NW2BXQXFNPV2V62J7H";

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

/**
 * The flow seeded into a brand-new sandbox session (`POST /api/auth/sandbox`).
 *
 * This is the D1 evidence path: a visitor with no account lands on it and can
 * see, configure and deploy the Swap block. `assetOut` is USDC so the swap
 * exchanges two different assets (`validateFlow` rejects a same-asset swap),
 * and the Pay node is required because a swap sends its whole output to
 * exactly one next step. The recipient is `SANDBOX_DEMO_RECIPIENT` rather than
 * a placeholder, because this graph is deployed and triggered unedited.
 */
export const SANDBOX_STARTER_GRAPH = {
  nodes: [
    {
      id: "trigger-1",
      type: "on_receive",
      config: { asset: { kind: "native" } },
    },
    {
      id: "action-1",
      type: "swap",
      config: {
        assetIn: { kind: "native" },
        assetOut: { kind: "known", symbol: "USDC" },
        slippageBps: 100,
        deadlineSecs: 300,
      },
    },
    {
      id: "action-2",
      type: "pay",
      config: {
        recipient: SANDBOX_DEMO_RECIPIENT,
        asset: { kind: "known", symbol: "USDC" },
        mode: "fixed",
        fullAmount: true,
      },
    },
  ],
  edges: [
    { id: "e1", source: "trigger-1", target: "action-1" },
    { id: "e2", source: "action-1", target: "action-2" },
  ],
} as const;
