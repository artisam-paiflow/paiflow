import "server-only";
import type { Deployment } from "@prisma/client";

export type InvokeValidation =
  | { ok: true; contractAddress: string }
  | { ok: false; code: string; message: string };

export function validateSplitterInvoke(deployment: Deployment): InvokeValidation {
  if (!deployment.contractAddress) {
    return { ok: false, code: "NOT_READY", message: "Contract not yet deployed" };
  }
  if (deployment.status !== "CONFIRMED") {
    return {
      ok: false,
      code: "NOT_CONFIRMED",
      message: `Deployment status is ${deployment.status}`,
    };
  }
  return { ok: true, contractAddress: deployment.contractAddress };
}
