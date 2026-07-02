import "server-only";
import {
  deployCashOutDevByRelayer,
  updateBankByRelayer,
  type DevRecipient,
  type DevMutateResult,
} from "./dev-mutate";

export type CashOutInputRecipient = {
  address: string;
  amount: string;
  bps: number;
  payoutMode?: "crypto" | "fiat";
  bankDetail?: { accountName: string; accountNumber: string; bankCode: string };
};

export type CashOutExistingEmployee = {
  address: string;
  cashOutContractAddress: string | null;
};

export type PreparedDevCashOutRecipients = {
  onChainRecipients: DevRecipient[];
  txHashes: string[];
  cashOutByInputAddress: Map<string, string>;
};

/**
 * Prepare the on-chain recipient list for a dev-mode splitter, deploying or
 * reusing CASH_OUT_DEV contracts for fiat recipients.
 *
 * The caller must already have validated that fiat recipients provide bank
 * details and are not using percentage mode.
 */
export async function prepareDevCashOutRecipients(opts: {
  splitterContractAddress: string;
  adminAddress: string;
  assetContractAddress: string;
  treasury: string;
  existingEmployees: CashOutExistingEmployee[];
  inputRecipients: CashOutInputRecipient[];
}): Promise<PreparedDevCashOutRecipients> {
  const existingByAddress = new Map(opts.existingEmployees.map((e) => [e.address, e]));
  const txHashes: string[] = [];
  const cashOutByInputAddress = new Map<string, string>();
  const onChainRecipients: DevRecipient[] = [];

  for (const r of opts.inputRecipients) {
    if (r.payoutMode !== "fiat") {
      onChainRecipients.push({
        address: r.address,
        amount: r.amount,
        bps: r.bps,
        isCashOut: false,
      });
      continue;
    }

    const existing = existingByAddress.get(r.address);
    let cashOutAddress = existing?.cashOutContractAddress;

    if (!cashOutAddress) {
      const deploy = await deployCashOutDevByRelayer({
        adminAddress: opts.adminAddress,
        assetContractAddress: opts.assetContractAddress,
        treasury: opts.treasury,
        parent: opts.splitterContractAddress,
        accountName: r.bankDetail?.accountName,
        accountNumber: r.bankDetail?.accountNumber,
        bankCode: r.bankDetail?.bankCode,
      });
      if (deploy.status !== "SUCCESS" || !deploy.contractAddress) {
        throw new CashOutDeployError(deploy);
      }
      txHashes.push(deploy.txHash);
      cashOutAddress = deploy.contractAddress;
    } else if (r.bankDetail) {
      const update = await updateBankByRelayer(cashOutAddress, {
        accountName: r.bankDetail.accountName,
        accountNumber: r.bankDetail.accountNumber,
        bankCode: r.bankDetail.bankCode,
      });
      if (update.status !== "SUCCESS") {
        throw new CashOutBankUpdateError(update);
      }
      txHashes.push(update.txHash);
    }

    cashOutByInputAddress.set(r.address, cashOutAddress);
    onChainRecipients.push({
      address: cashOutAddress,
      amount: r.amount,
      bps: 0,
      isCashOut: true,
    });
  }

  return { onChainRecipients, txHashes, cashOutByInputAddress };
}

export class CashOutDeployError extends Error {
  constructor(public readonly result: DevMutateResult) {
    super(result.errorMessage ?? "Failed to deploy cash-out contract");
  }
}

export class CashOutBankUpdateError extends Error {
  constructor(public readonly result: DevMutateResult) {
    super(result.errorMessage ?? "Failed to update cash-out bank details");
  }
}
