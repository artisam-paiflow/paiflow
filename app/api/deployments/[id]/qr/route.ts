import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { sep7PaymentUri } from "@/lib/stellar/sep7";
import { prepareDistributeTx } from "@/lib/stellar/invoke";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import { z } from "zod";

const Query = z.object({
  size: z.coerce.number().int().min(64).max(1024).default(256),
  format: z.enum(["svg", "png"]).default("svg"),
  action: z.enum(["pay", "invoke", "trigger"]).default("pay"),
  amount: z.string().regex(/^\d+$/).optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const d = await db.deployment.findFirst({
    where: { id, ownerId: session.id },
    include: { flow: { select: { templateKind: true } } },
  });
  if (!d || !d.contractAddress) return new Response("Not ready", { status: 404 });

  let uri: string;
  if (q.action === "trigger") {
    if (d.flow.templateKind !== "SPLITTER") {
      return new Response("Trigger QR only available for splitter deployments", { status: 400 });
    }
    if (d.status !== "CONFIRMED") {
      return new Response("Contract not yet confirmed", { status: 400 });
    }
    if (!d.contractAddress) {
      return new Response("Contract address not available", { status: 400 });
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    uri = d.distributeAmountStroops
      ? `${appUrl}/trigger/${d.id}?amount=${"0"}`
      : `${appUrl}/trigger/${d.id}`;
  } else if (q.action === "invoke") {
    if (d.flow.templateKind !== "SPLITTER") {
      return new Response("Invoke QR only available for splitter deployments", { status: 400 });
    }
    if (d.status !== "CONFIRMED") {
      return new Response("Contract not yet confirmed", { status: 400 });
    }
    const amount = q.amount ?? d.distributeAmountStroops;
    if (!amount) {
      return new Response("Amount required for invoke action", { status: 400 });
    }
    if (!d.sourceAccount) {
      return new Response("Source account not available", { status: 400 });
    }
    const { xdr } = await prepareDistributeTx({
      contractAddress: d.contractAddress,
      amount,
      sourceAccount: d.sourceAccount,
    });
    uri = `web+stellar:tx?xdr=${encodeURIComponent(xdr)}`;
  } else {
    const graph = FlowGraphSchema.safeParse(d.graphSnapshot);
    const trigger = graph.success ? graph.data.nodes.find(isTrigger) : null;
    const asset =
      trigger?.type === "on_receive" ? trigger.config.asset : ({ kind: "native" } as const);
    uri = sep7PaymentUri({ destination: d.contractAddress, asset });
  }

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
