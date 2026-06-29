import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";

const UpdateSchema = z
  .object({
    label: z.string().min(1).max(64).optional(),
    address: z
      .string()
      .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
      .optional(),
  })
  .refine((data) => data.label !== undefined || data.address !== undefined, {
    message: "At least one of label or address is required",
  });

async function requireOwnedEntry(userId: string, id: string) {
  const entry = await db.addressBookEntry.findFirst({
    where: { id, ownerId: userId },
  });
  if (!entry) throw new AppError("NOT_FOUND", "Address book entry not found");
  return entry;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const body = UpdateSchema.parse(await req.json());

    const existing = await requireOwnedEntry(user.id, id);

    if (body.label && body.label !== existing.label) {
      const conflict = await db.addressBookEntry.findFirst({
        where: { ownerId: user.id, label: body.label, NOT: { id } },
      });
      if (conflict) {
        throw new AppError("CONFLICT", "A contact with this label already exists");
      }
    }

    if (body.address && body.address !== existing.address) {
      const addressConflict = await db.addressBookEntry.findFirst({
        where: { ownerId: user.id, address: body.address, NOT: { id } },
      });
      if (addressConflict) {
        throw new AppError(
          "CONFLICT",
          `This address is already saved as "${addressConflict.label}".`,
        );
      }
    }

    const updated = await db.addressBookEntry.update({
      where: { id },
      data: {
        ...(body.label !== undefined && { label: body.label }),
        ...(body.address !== undefined && { address: body.address }),
      },
    });

    return NextResponse.json({ data: updated });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;

    await requireOwnedEntry(user.id, id);

    await db.addressBookEntry.delete({ where: { id } });
    return NextResponse.json({ data: { ok: true } });
  });
}
