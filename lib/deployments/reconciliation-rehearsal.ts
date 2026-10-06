import "server-only";
import type { Role } from "@prisma/client";
import { env } from "@/lib/env";

/** The authenticated submit route already checks ownership and prepared-XDR binding. */
export function isDeploymentReconciliationRehearsal(
  deployment: {
    flowId: string;
    network: string;
  },
  role: Role,
): boolean {
  const config = env();
  return (
    role === "ADMIN" &&
    config.STELLAR_NETWORK === "testnet" &&
    deployment.network === "testnet" &&
    deployment.flowId === config.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID &&
    config.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL !== undefined &&
    Date.parse(config.STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL) > Date.now()
  );
}
