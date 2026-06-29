import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";

const CreateSchema = z.object({
  label: z.string().min(1).max(64),
  address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
});

export async function GET() {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const entries = await db.addressBookEntry.findMany({
      where: { ownerId: user.id },
      select: { id: true, label: true, address: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ data: entries });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const body = CreateSchema.parse(await req.json());

    // Block saving the same wallet under a second label. Two contacts pointing
    // at one address are ambiguous and confusing (issue #243). Updating an
    // existing label's address is still fine — only a *different* label
    // claiming an address already in use is rejected.
    const dupAddress = await db.addressBookEntry.findFirst({
      where: { ownerId: user.id, address: body.address, NOT: { label: body.label } },
    });
    if (dupAddress) {
      throw new AppError("CONFLICT", `This address is already saved as "${dupAddress.label}".`);
    }

    const entry = await db.addressBookEntry.upsert({
      where: { ownerId_label: { ownerId: user.id, label: body.label } },
      update: { address: body.address },
      create: { ownerId: user.id, label: body.label, address: body.address },
    });
    return NextResponse.json({ data: entry });
  });
}
