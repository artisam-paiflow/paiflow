import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { AppError, withErrorHandler } from "@/lib/errors";
import { publicEmbedDeployment } from "@/lib/deployments/public-embed-reads";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    // This path only encodes a customer page, never an invocation/allowance XDR.
    z.object({}).strict().parse(Object.fromEntries(req.nextUrl.searchParams));
    const { id } = await ctx.params;
    const deployment = await publicEmbedDeployment(req, id);
    if (!deployment.payment)
      throw new AppError("NOT_FOUND", "No customer payment page for this deployment");
    const url = new URL(deployment.payment.path, req.nextUrl.origin).href;
    const svg = await QRCode.toString(url, { type: "svg", width: 256, margin: 2 });
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    });
  });
}
