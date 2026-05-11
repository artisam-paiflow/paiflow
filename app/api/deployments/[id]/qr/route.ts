import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { sep7PaymentUri } from "@/lib/stellar/sep7";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import { z } from "zod";

const Query = z.object({
  size: z.coerce.number().int().min(64).max(1024).default(256),
  format: z.enum(["svg", "png"]).default("svg"),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const d = await db.deployment.findFirst({ where: { id, ownerId: session.id } });
  if (!d || !d.contractAddress) return new Response("Not ready", { status: 404 });
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const graph = FlowGraphSchema.safeParse(d.graphSnapshot);
  const trigger = graph.success ? graph.data.nodes.find(isTrigger) : null;
  const asset =
    trigger?.type === "on_receive" ? trigger.config.asset : ({ kind: "native" } as const);
  const uri = sep7PaymentUri({ destination: d.contractAddress, asset });
  if (q.format === "svg") {
    const svg = await QRCode.toString(uri, {
      type: "svg",
      width: q.size,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "private, max-age=60",
      },
    });
  }
  const png = await QRCode.toBuffer(uri, {
    type: "png",
    width: q.size,
    margin: 1,
  });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=60",
    },
  });
}
