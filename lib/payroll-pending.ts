/** Compatibility names for the legacy employee-manager recovery workflow. */
export {
  deploymentRequestPendingKey as payrollPendingKey,
  readPendingDeploymentRequest as readPendingPayroll,
  savePendingDeploymentRequest as savePendingPayroll,
  clearPendingDeploymentRequest as clearPendingPayroll,
  assertNoPendingDeploymentRequest as assertNoPendingPayroll,
  type PendingDeploymentRequest as PendingPayroll,
} from "@/lib/deployment-request-pending";
