import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { updateBankByRelayer } from "@/lib/stellar/dev-mutate";

const BankDetailSchema = z.object({
  employeeId: z.string().uuid().optional(),
  address: z
    .string()
    .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
    .optional(),
  accountName: z.string().min(1).max(128),
  accountNumber: z.string().min(1).max(64),
  bankCode: z.string().min(1).max(32),
});

const PostSchema = BankDetailSchema.refine((v) => !!v.employeeId !== !!v.address, {
  message: "Provide exactly one of employeeId or address",
});

async function requirePayrollDeployment(id: string, userId: string | null) {
  const where = userId ? { id, ownerId: userId } : { id };
  const d = await db.deployment.findFirst({
    where,
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
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    await requirePayrollDeployment(id, user?.id ?? null);

    const employees = await db.employee.findMany({
      where: { deploymentId: id },
      include: { bankDetail: true },
    });

    const data = employees.map((e) => ({
      id: e.id,
      address: e.address,
      payoutMode: e.payoutMode,
      cashOutContractAddress: e.cashOutContractAddress,
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
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const rlKey = user ? `employee-bank:${user.id}` : `employee-bank:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 60, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many bank detail updates");
    await requirePayrollDeployment(id, user?.id ?? null);

    const body = PostSchema.parse(await req.json());

    let employee;
    if (body.employeeId) {
      employee = await db.employee.findUnique({
        where: { id: body.employeeId },
      });
      if (!employee || employee.deploymentId !== id) {
        throw new AppError("NOT_FOUND", "Employee not found");
      }
    } else {
      employee = await db.employee.upsert({
        where: { deploymentId_address: { deploymentId: id, address: body.address! } },
        create: {
          deploymentId: id,
          address: body.address!,
          amountStroops: "0",
        },
        update: {},
      });
    }

    const bankDetail = await db.employeeBankDetail.upsert({
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

    // If this employee is configured for fiat payout, mirror the bank details
    // onto the on-chain CASH_OUT_DEV contract so it can sink funds to treasury.
    let cashOutTxHash: string | null = null;
    if (employee.payoutMode === "FIAT" && employee.cashOutContractAddress) {
      const update = await updateBankByRelayer(employee.cashOutContractAddress, {
        accountName: body.accountName,
        accountNumber: body.accountNumber,
        bankCode: body.bankCode,
      });
      if (update.status !== "SUCCESS") {
        throw new AppError(
          "UPSTREAM_RPC",
          update.errorMessage ?? "Failed to update cash-out bank details",
        );
      }
      cashOutTxHash = update.txHash;
    }

    await audit({
      action: "DEV_UPDATE_BANK",
      userId: user?.id ?? null,
      metadata: {
        deploymentId: id,
        employeeId: employee.id,
        address: body.address ?? employee.address,
        cashOutTxHash,
      },
    });

    return NextResponse.json({
      data: { success: true, employeeId: employee.id, bankDetail, cashOutTxHash },
    });
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const rlKey = user ? `employee-bank:${user.id}` : `employee-bank:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 60, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many bank detail updates");
    await requirePayrollDeployment(id, user?.id ?? null);

    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");
    const employeeId = searchParams.get("employeeId");

    if (employeeId) {
      if (!z.string().uuid().safeParse(employeeId).success) {
        throw new AppError("VALIDATION", "Invalid employeeId");
      }
    } else if (!address || !StrKey.isValidEd25519PublicKey(address)) {
      throw new AppError("VALIDATION", "Invalid or missing Stellar address");
    }

    let employee;
    if (employeeId) {
      if (!z.string().uuid().safeParse(employeeId).success) {
        throw new AppError("VALIDATION", "Invalid employeeId");
      }
      employee = await db.employee.findUnique({
        where: { id: employeeId },
        include: { bankDetail: true },
      });
      if (!employee || employee.deploymentId !== id) {
        throw new AppError("NOT_FOUND", "Bank details not found");
      }
    } else {
      employee = await db.employee.findUnique({
        where: { deploymentId_address: { deploymentId: id, address: address! } },
        include: { bankDetail: true },
      });
      if (!employee?.bankDetail) {
        throw new AppError("NOT_FOUND", "Bank details not found");
      }
    }

    if (!employee.bankDetail) {
      throw new AppError("NOT_FOUND", "Bank details not found");
    }

    await db.employeeBankDetail.delete({
      where: { employeeId: employee.id },
    });

    await audit({
      action: "DEV_UPDATE_BANK",
      userId: user?.id ?? null,
      metadata: { deploymentId: id, employeeId: employee.id, address: employee.address },
    });

    return NextResponse.json({ data: { success: true } });
  });
}
