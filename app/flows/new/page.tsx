import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { TemplateKind } from "@prisma/client";

const STARTER_GRAPH = {
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
          {
            address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            bps: 6000,
            label: "Mom",
          },
          {
            address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            bps: 3000,
            label: "Landlord",
          },
          {
            address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            bps: 1000,
            label: "Savings",
          },
        ],
      },
    },
  ],
  edges: [{ id: "e1", source: "trigger-1", target: "action-1" }],
} as const;

export default async function NewFlow() {
  const user = await requireSession();
  const flow = await db.flow.create({
    data: {
      ownerId: user.id,
      name: "Untitled flow",
      templateKind: TemplateKind.SPLITTER,
      graph: STARTER_GRAPH as object,
      parameters: {
        kind: "splitter",
        asset: { kind: "known", symbol: "USDC" },
        recipients: STARTER_GRAPH.nodes[1]!.config.recipients.map((r) => ({
          address: r.address,
          bps: r.bps,
        })),
      } as object,
    },
  });
  redirect(`/flows/${flow.id}`);
}
