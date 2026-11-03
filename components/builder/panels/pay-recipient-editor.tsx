"use client";

import type { AddressEntry } from "@/lib/address-book.types";
import type { PayFieldPolicy } from "@/lib/flows/field-policies";
import { isPendingAddress } from "@/lib/flows/schema";
import { AddressPicker } from "../inputs/address-picker";
import { FieldModeSelect } from "../inputs/field-mode-select";

export function PayRecipientEditor({
  recipient,
  policy,
  fullAmount = false,
  executionIssue,
  error,
  onRecipientChange,
  onPolicyChange,
  addressBook,
  refreshAddressBook,
  addressBookLoading,
  addressBookError,
}: {
  recipient: string;
  policy: PayFieldPolicy;
  fullAmount?: boolean;
  executionIssue?: string;
  error?: string | null;
  onRecipientChange: (recipient: string) => void;
  onPolicyChange: (policy: PayFieldPolicy) => void;
  addressBook: AddressEntry[];
  refreshAddressBook?: () => void;
  addressBookLoading?: boolean;
  addressBookError?: string | null;
}) {
  return (
    <div className="space-y-3">
      <FieldModeSelect
        label="Recipient source"
        value={policy.recipient}
        executionIssue={executionIssue}
        allowMutable={!executionIssue}
        onChange={(recipientMode) => onPolicyChange({ ...policy, recipient: recipientMode })}
      />
      {policy.recipient === "execution" ? (
        <p className="text-xs text-zinc-400">
          The payer must supply the recipient for every payment. No saved address is used. The
          payout value follows its separate stored-value declaration.
        </p>
      ) : (
        <AddressPicker
          label="Recipient (G… or PENDING:)"
          error={error}
          value={recipient}
          onChange={onRecipientChange}
          pending={isPendingAddress(recipient)}
          addressBook={addressBook}
          onAddressBookChange={refreshAddressBook}
          addressBookLoading={addressBookLoading}
          addressBookError={addressBookError}
        />
      )}
      {!fullAmount ? (
        <FieldModeSelect
          label="Payout value source"
          value={policy.payoutValue}
          allowExecution={false}
          allowMutable={!executionIssue}
          executionIssue={executionIssue}
          onChange={(payoutValue) => {
            if (payoutValue !== "execution") onPolicyChange({ ...policy, payoutValue });
          }}
        />
      ) : (
        <p className="text-xs text-zinc-400">Sending the full amount is a constant rule.</p>
      )}
      {(policy.recipient === "mutable" || policy.payoutValue === "mutable") && (
        <p className="text-xs text-zinc-400">
          Set complete initial values now. Only the deployment admin can update declared stored
          fields later, when the whole path has no unsettled obligations. Deployment needs guarded
          artifacts.
        </p>
      )}
    </div>
  );
}
