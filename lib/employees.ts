import "server-only";
import { db } from "@/lib/db";
import { EmployeePayoutMode } from "@prisma/client";

export type EmployeeInputRecipient = {
  address: string;
  amountStroops: string;
  label?: string;
  payoutMode?: "crypto" | "fiat";
  bankDetail?: { accountName: string; accountNumber: string; bankCode: string };
};

/**
 * Mirror a payroll recipient list into the Employee / EmployeeBankDetail tables.
 *
 * - Removes employees whose addresses are no longer in the recipient list.
 * - Upserts employees by (deploymentId, address), updating amount, label,
 *   payoutMode, and the cash-out contract address when provided.
 * - Upserts bank details when supplied.
 */
export async function syncEmployees(
  deploymentId: string,
  recipients: EmployeeInputRecipient[],
  cashOutByInputAddress?: Map<string, string>,
) {
  const newAddresses = new Set(recipients.map((r) => r.address));

  await db.$transaction(async (tx) => {
    await tx.employee.deleteMany({
      where: { deploymentId, address: { notIn: [...newAddresses] } },
    });

    for (const r of recipients) {
      const mode = r.payoutMode === "fiat" ? EmployeePayoutMode.FIAT : EmployeePayoutMode.CRYPTO;
      const cashOutContractAddress = cashOutByInputAddress?.get(r.address) ?? null;

      const employee = await tx.employee.upsert({
        where: { deploymentId_address: { deploymentId, address: r.address } },
        create: {
          deploymentId,
          address: r.address,
          amountStroops: r.amountStroops,
          label: r.label,
          payoutMode: mode,
          cashOutContractAddress,
        },
        update: {
          amountStroops: r.amountStroops,
          label: r.label,
          payoutMode: mode,
          cashOutContractAddress,
        },
      });

      if (r.bankDetail) {
        await tx.employeeBankDetail.upsert({
          where: { employeeId: employee.id },
          create: {
            employeeId: employee.id,
            accountName: r.bankDetail.accountName,
            accountNumber: r.bankDetail.accountNumber,
            bankCode: r.bankDetail.bankCode,
          },
          update: {
            accountName: r.bankDetail.accountName,
            accountNumber: r.bankDetail.accountNumber,
            bankCode: r.bankDetail.bankCode,
          },
        });
      }
    }
  });
}
