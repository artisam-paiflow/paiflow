import { EXECUTION_ARTIFACTS_UNAVAILABLE } from "./field-policy.utils";

export function FieldPolicyNotice({ available }: { available: boolean }) {
  return (
    <div className="border-secondary/30 bg-secondary/5 text-on-surface-variant space-y-2 rounded border p-3 text-xs">
      <p>
        Modes and constant values stay fixed after deployment. Every declared input is required for
        each payer-signed payment; saved draft values are never fallback inputs. Declared mutable
        stored fields start with complete values and require the admin's signature for later
        updates.
      </p>
      {!available && <p role="status">{EXECUTION_ARTIFACTS_UNAVAILABLE}</p>}
      <p>
        Template creation inputs are supplied once. Stored updates never change a deployment's modes
        or constants, and require no unsettled obligations throughout the path.
      </p>
    </div>
  );
}
