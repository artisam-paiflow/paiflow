import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { CreateAddressContactSchema } from "@/lib/address-book/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";

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
    await enforceWriteRateLimit("addressBookWrite", user.id);
    const body = CreateAddressContactSchema.parse(await req.json());

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

    if (body.createOnly) {
      try {
        // The unique owner/name constraint also protects against a stale contact list
        // or simultaneous inline saves. This branch must never update an existing row.
        const entry = await db.addressBookEntry.create({
          data: { ownerId: user.id, label: body.label, address: body.address },
        });
        return NextResponse.json({ data: entry });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const message = "A contact with this name already exists. Choose a different name.";
          throw new AppError("CONFLICT", message, { label: [message] });
        }
        throw err;
      }
    }

    const entry = await db.addressBookEntry.upsert({
      where: { ownerId_label: { ownerId: user.id, label: body.label } },
      update: { address: body.address },
      create: { ownerId: user.id, label: body.label, address: body.address },
    });
    return NextResponse.json({ data: entry });
  });
}
