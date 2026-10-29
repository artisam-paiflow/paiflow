import "server-only";
import { db } from "@/lib/db";
export type EmployeeInputRecipient = { address: string; amountStroops: string; label?: string };
/** Mirror crypto recipients without removing retained payout history. */
export async function syncEmployees(deploymentId: string, recipients: EmployeeInputRecipient[]) {
  await db.$transaction(async (tx) => {
    // Remove unused roster entries while keeping every employee referenced by
    // financial history; deleting those would cascade to PayrollPayout rows.
    // Lock parent before children, preventing new employee FK inserts from
    // appearing between the row lock and deletion predicate.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Deployment" WHERE id = ${deploymentId}::uuid FOR UPDATE
    `;
    // Wait out concurrent payout inserts before testing the relationship. A
    // predicate alone could race the cascading foreign key under READ COMMITTED.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Employee"
      WHERE "deploymentId" = ${deploymentId}::uuid
      ORDER BY id FOR UPDATE
    `;
    await tx.employee.deleteMany({
      where: {
        deploymentId,
        address: { notIn: recipients.map((recipient) => recipient.address) },
        payouts: { none: {} },
      },
    });
    for (const r of recipients) {
      await tx.employee.upsert({
        where: { deploymentId_address: { deploymentId, address: r.address } },
        create: {
          deploymentId,
          address: r.address,
          amountStroops: r.amountStroops,
          label: r.label,
        },
        update: { amountStroops: r.amountStroops, label: r.label },
      });
    }
  });
}
