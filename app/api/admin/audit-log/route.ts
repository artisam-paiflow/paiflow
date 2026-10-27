import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getAuditLogPage } from "@/lib/admin/audit-log/page";
import { AuditLogQuerySchema } from "@/lib/admin/audit-log/schema";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });
    const query = AuditLogQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json({ data: await getAuditLogPage(query) });
  });
}
