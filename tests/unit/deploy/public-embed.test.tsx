import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const { db, session } = vi.hoisted(() => ({
  db: { deployment: { findUnique: vi.fn(), findFirst: vi.fn() } },
  session: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/auth", () => ({ requirePageSession: session }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/components/deploy/deployment-canvas", () => ({
  ReadOnlyDeploymentCanvas: ({ graph }: { graph: unknown }) => <pre>{JSON.stringify(graph)}</pre>,
}));
vi.mock("@/components/deploy/deployment-view", () => ({ default: () => <div>Owner view</div> }));
vi.mock("@/components/deploy/api-access-panel", () => ({ default: () => null }));
vi.mock("@/components/app/topbar", () => ({ default: () => null }));

import EmbedPage from "@/app/deployments/[deploymentId]/embed/page";
import OwnerPage from "@/app/deployments/[deploymentId]/page";
import OwnerView from "@/components/deploy/deployment-view";
import PublicView from "@/components/deploy/public-deployment-view";
import { projectPublicEmbed, type PublicEmbedData } from "@/lib/deployments/public-embed";

const ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PRIVATE = "synthetic-private-marker";
const graph = {
  notify: { mode: "every_transaction", sendTo: `${PRIVATE}@example.com` },
  senderKyc: {
    firstName: PRIVATE,
    lastName: PRIVATE,
    countryOrigin: "PH",
    sourceOfFunds: PRIVATE,
    phoneNumber: PRIVATE,
    nationalIdentityNumber: PRIVATE,
  },
  nodes: [
    {
      id: "hook",
      type: "web2_webhook",
      config: { asset: { kind: "native" }, webhookSecret: PRIVATE },
    },
    {
      id: "pay",
      type: "pay",
      config: {
        recipient: ADDRESS,
        asset: { kind: "native" },
        fullAmount: true,
        email: `${PRIVATE}@example.com`,
        accountName: PRIVATE,
        accountNumber: PRIVATE,
        bankCode: PRIVATE,
      },
    },
    {
      id: "split",
      type: "split",
      config: {
        asset: { kind: "native" },
        recipients: [
          {
            address: ADDRESS,
            mode: "percentage",
            bps: 10000,
            email: `${PRIVATE}@example.com`,
            label: PRIVATE,
            accountNumber: PRIVATE,
          },
        ],
      },
    },
  ],
  edges: [{ id: "edge", source: "hook", target: "pay" }],
};
function fixture() {
  return {
    id: ID,
    status: "CONFIRMED",
    contractAddress: "C" + "A".repeat(55),
    network: "testnet",
    webhookSecret: PRIVATE,
    apiToken: PRIVATE,
    ownerId: "owner",
    graphSnapshot: graph,
    pipelineSnapshot: [
      {
        nodeId: "hook",
        templateKind: "WEBHOOK",
        contractAddress: "C" + "A".repeat(55),
        privateMetadata: PRIVATE,
      },
    ],
    flow: { name: "Rewards", templateKind: "WEBHOOK" },
    events: [
      {
        id: "event-row",
        eventId: "event-1",
        kind: "PAYOUT" as const,
        ledger: 42,
        txHash: "a".repeat(64),
        occurredAt: new Date("2026-10-07T00:00:00Z"),
        payload: { secret: PRIVATE },
        decodedData: {
          amount: "10000000",
          secret: PRIVATE,
          email: PRIVATE,
          nested: { secret: PRIVATE },
        },
      },
    ],
    errorMessage: PRIVATE,
    createdAt: new Date("2026-10-07T00:00:00Z"),
  };
}
const params = () => Promise.resolve({ deploymentId: ID });

function findComponent(
  node: ReactNode,
  type: unknown,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findComponent(child, type);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === type) return node;
  return findComponent(node.props.children as ReactNode, type);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.deployment.findUnique.mockResolvedValue(fixture());
  db.deployment.findFirst.mockResolvedValue(fixture());
  session.mockResolvedValue({ id: "owner", role: "USER", username: "owner" });
});

describe("public embed server/browser boundary", () => {
  it.each([
    null,
    { id: "other-team", role: "USER" },
    { id: "sandbox", role: "SANDBOX" },
    { id: "owner", role: "USER" },
  ])("projects the same safe data for viewer %j", async (viewer) => {
    session.mockResolvedValue(viewer);
    const page = await EmbedPage({ params: params() });
    const view = findComponent(page, PublicView)!;
    expect(view).toBeDefined();
    const data = view.props.data as PublicEmbedData;
    // Inspect serialized component props, not just whether a secret field is hidden.
    const serialized = JSON.stringify(view.props);
    expect(serialized).not.toContain(PRIVATE);
    for (const field of [
      "webhookSecret",
      "apiToken",
      "senderKyc",
      "notify",
      "pipelineSnapshot",
      "payload",
      "decodedData",
      "accountNumber",
      "email",
    ]) {
      expect(serialized).not.toContain(field);
    }
    expect(data.graph.nodes.map((n) => n.label)).toEqual([
      "HTTP Webhook (XLM)",
      "Pay",
      "Split (1)",
    ]);
    expect(data.initialEvents[0]?.amountStroops).toBe("10000000");
    const html = renderToStaticMarkup(<PublicView data={data} />);
    expect(html).not.toContain(PRIVATE);
    expect(html).toContain("PAYOUT");
    expect(html).not.toMatch(/Secret token|Copy webhook|Dev values|Release now|API access/);
    expect(session).not.toHaveBeenCalled();
    expect(db.deployment.findUnique.mock.calls[0]?.[0].select).not.toHaveProperty("webhookSecret");
    // The snapshot is read internally to determine payment eligibility, but
    // never serialized to the public component (asserted above).
    expect(findComponent(page, OwnerView)).toBeUndefined();
  });

  it.each([
    null,
    { ...fixture(), status: "PENDING" },
    { ...fixture(), contractAddress: null },
    { ...fixture(), graphSnapshot: { nodes: "bad" } },
  ])("refuses unavailable or invalid deployments", async (row) => {
    db.deployment.findUnique.mockResolvedValue(row);
    await expect(EmbedPage({ params: params() })).rejects.toThrow("NOT_FOUND");
  });

  it("rejects malformed ids before querying", async () => {
    await expect(
      EmbedPage({ params: Promise.resolve({ deploymentId: "not-a-uuid" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(db.deployment.findUnique).not.toHaveBeenCalled();
  });

  it.each([PRIVATE, { secret: PRIVATE }, "-1", "1.5", "9".repeat(40), null])(
    "omits unsafe event amount %j",
    (amount) => {
      const row = fixture();
      const data = projectPublicEmbed({
        ...row,
        events: [{ ...row.events[0]!, decodedData: { amount } }],
      });
      expect(data?.initialEvents[0]).not.toHaveProperty("amountStroops");
      expect(JSON.stringify(data)).not.toContain(PRIVATE);
    },
  );

  it("does not mutate the owner's graph or metadata", () => {
    const row = fixture();
    const before = JSON.stringify(row);
    projectPublicEmbed(row);
    expect(JSON.stringify(row)).toBe(before);
  });
});

describe("private owner page", () => {
  it("retains secret access behind the owner-scoped query", async () => {
    const page = await OwnerPage({ params: params() });
    expect(session).toHaveBeenCalledOnce();
    expect(db.deployment.findFirst.mock.calls[0]?.[0].where).toEqual({ id: ID, ownerId: "owner" });
    expect(findComponent(page, OwnerView)?.props.webhookSecret).toBe(PRIVATE);
  });

  it("does not expose the owner page to another team", async () => {
    session.mockResolvedValue({ id: "other-team", role: "USER", username: "other" });
    db.deployment.findFirst.mockResolvedValue(null);
    await expect(OwnerPage({ params: params() })).rejects.toThrow("NOT_FOUND");
    expect(db.deployment.findFirst.mock.calls[0]?.[0].where.ownerId).toBe("other-team");
  });
});
