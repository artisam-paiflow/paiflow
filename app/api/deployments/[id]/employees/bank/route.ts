import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { requirePayrollSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
const BankDetailSchema = z.object({
  employeeId: z.string().guid({ error: "Invalid uuid" }).optional(),
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
async function requirePayrollDeployment(id: string, userId: string) {
  const where = { id, ownerId: userId };
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
async function GETHandler(
  req: NextRequest,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  return withErrorHandler(async () => {
    const { user } = await requirePayrollSession(req);
    const { id } = await ctx.params;
    await requirePayrollDeployment(id, user.id);
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
async function POSTHandler(
  req: NextRequest,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  return withErrorHandler(async () => {
    const { user } = await requirePayrollSession(req);
    const { id } = await ctx.params;
    const rlKey = `employee-bank:${user.id}`;
    const rl = await rateLimit(rlKey, 60, 60);
    if (!rl.ok) throw rateLimitedError(rl, "Too many bank detail updates");
    const deployment = await requirePayrollDeployment(id, user.id);

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
    if (employee.cashOutContractAddress) {
      throw new AppError(
        "VALIDATION",
        "This recipient has immutable bank details. Deploy a new flow to change its bank destination.",
      );
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
    const cashOutTxHash = null;
    await audit({
      action: "PAYROLL_UPDATE_BANK",
      userId: user.id,
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
async function DELETEHandler(
  req: NextRequest,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  return withErrorHandler(async () => {
    const { user } = await requirePayrollSession(req);
    const { id } = await ctx.params;
    const rlKey = `employee-bank:${user.id}`;
    const rl = await rateLimit(rlKey, 60, 60);
    if (!rl.ok) throw rateLimitedError(rl, "Too many bank detail updates");
    const deployment = await requirePayrollDeployment(id, user.id);

    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");
    const employeeId = searchParams.get("employeeId");
    if (employeeId) {
      if (!z.string().guid({ error: "Invalid uuid" }).safeParse(employeeId).success) {
        throw new AppError("VALIDATION", "Invalid employeeId");
      }
    } else if (!address || !StrKey.isValidEd25519PublicKey(address)) {
      throw new AppError("VALIDATION", "Invalid or missing Stellar address");
    }
    let employee;
    if (employeeId) {
      if (!z.string().guid({ error: "Invalid uuid" }).safeParse(employeeId).success) {
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
    if (employee.cashOutContractAddress) {
      throw new AppError(
        "VALIDATION",
        "This recipient has immutable bank details. Deploy a new flow to change its bank destination.",
      );
    }
    await db.employeeBankDetail.delete({
      where: { employeeId: employee.id },
    });
    await audit({
      action: "PAYROLL_UPDATE_BANK",
      userId: user.id,
      metadata: { deploymentId: id, employeeId: employee.id, address: employee.address },
    });
    return NextResponse.json({ data: { success: true } });
  });
}
export const GET = deploymentServiceRoute(GETHandler, "payroll");
export const POST = deploymentServiceRoute(POSTHandler, "payroll");
export const DELETE = deploymentServiceRoute(DELETEHandler, "payroll");
