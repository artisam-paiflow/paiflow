import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";

const BankDetailSchema = z.object({
  address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
  accountName: z.string().min(1).max(128),
  accountNumber: z.string().min(1).max(64),
  bankCode: z.string().min(1).max(32),
});

const PostSchema = BankDetailSchema;

async function requirePayrollDeployment(id: string, userId: string) {
  const d = await db.deployment.findFirst({
    where: { id, ownerId: userId },
    include: { flow: { select: { templateKind: true } } },
  });
  if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
  if (d.flow.templateKind !== "PAYROLL") {
    throw new AppError("VALIDATION", "Deployment is not a payroll");
  }
  return d;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    await requirePayrollDeployment(id, user.id);

    const employees = await db.employee.findMany({
      where: { deploymentId: id },
      include: { bankDetail: true },
    });

    const data = employees.map((e) => ({
      address: e.address,
      bankDetail: e.bankDetail
        ? {
            accountName: e.bankDetail.accountName,
            accountNumber: e.bankDetail.accountNumber,
            bankCode: e.bankDetail.bankCode,
          }
        : null,
    }));

    return NextResponse.json({ data });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    await requirePayrollDeployment(id, user.id);

    const body = PostSchema.parse(await req.json());

    const employee = await db.employee.findUnique({
      where: { deploymentId_address: { deploymentId: id, address: body.address } },
    });
    if (!employee) {
      throw new AppError("NOT_FOUND", "Employee not found");
    }

    await db.employeeBankDetail.upsert({
      where: { employeeId: employee.id },
      create: {
        employeeId: employee.id,
        accountName: body.accountName,
        accountNumber: body.accountNumber,
        bankCode: body.bankCode,
      },
      update: {
        accountName: body.accountName,
        accountNumber: body.accountNumber,
        bankCode: body.bankCode,
      },
    });

    return NextResponse.json({ data: { success: true } });
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    await requirePayrollDeployment(id, user.id);

    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");
    if (!address || !StrKey.isValidEd25519PublicKey(address)) {
      throw new AppError("VALIDATION", "Invalid or missing Stellar address");
    }

    const employee = await db.employee.findUnique({
      where: { deploymentId_address: { deploymentId: id, address } },
      include: { bankDetail: true },
    });
    if (!employee?.bankDetail) {
      throw new AppError("NOT_FOUND", "Bank details not found");
    }

    await db.employeeBankDetail.delete({
      where: { employeeId: employee.id },
    });

    return NextResponse.json({ data: { success: true } });
  });
}
