import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { TemplateKind } from "@prisma/client";
import { STARTER_GRAPH } from "@/lib/flows/starter";

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
