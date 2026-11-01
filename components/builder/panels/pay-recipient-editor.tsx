"use client";

import type { AddressEntry } from "@/lib/address-book.types";
import type { PayFieldPolicy } from "@/lib/flows/field-policies";
import { isPendingAddress } from "@/lib/flows/schema";
import { AddressPicker } from "../inputs/address-picker";
import { FieldModeSelect } from "../inputs/field-mode-select";

export function PayRecipientEditor({
  recipient,
  policy,
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
        onChange={(recipientMode) => onPolicyChange({ ...policy, recipient: recipientMode })}
      />
      {policy.recipient === "execution" ? (
        <p className="text-xs text-zinc-400">
          The payer must supply the recipient for every payment. No saved address is used. The
          payout amount or percentage stays constant.
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
    </div>
  );
}
