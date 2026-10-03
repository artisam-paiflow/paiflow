import { Account, BadResponseError, Horizon, Keypair, Operation } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProvisionError } from "@/lib/hackathon/wallets";
import { send } from "@/scripts/hackathon-wallets";

const signer = Keypair.random();
const operations = [Operation.accountMerge({ destination: Keypair.random().publicKey() })];
const generic =
  "Transaction failed or its outcome is unknown; retry the same command to reconcile chain balances";

afterEach(() => vi.restoreAllMocks());

function rejectSubmission(error: unknown) {
  vi.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue(
    // send() only consumes the transaction-source interface of this response.
    new Account(signer.publicKey(), "1") as unknown as Horizon.AccountResponse,
  );
  vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue(error);
  return send(signer, operations);
}

describe("Horizon submission diagnostics", () => {
  it("includes only transaction and operation result codes from a mocked rejection", async () => {
    const envelope = "private-envelope-xdr";
    const error = new BadResponseError(`Failed ${signer.secret()} ${envelope}`, {
      extras: {
        envelope_xdr: envelope,
        result_xdr: "private-result-xdr",
        secretKey: signer.secret(),
        result_codes: {
          transaction: "tx_failed",
          operations: ["op_over_source_max", "op_too_few_offers", "op_no_trust"],
          secretKey: signer.secret(),
        },
      },
    });
    const failure = await rejectSubmission(error).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ProvisionError);
    expect((failure as ProvisionError).message).toBe(
      `${generic} (transaction: tx_failed; operations: op_over_source_max, op_too_few_offers, op_no_trust)`,
    );
  });

  it.each([
    new Error("private request payload"),
    new BadResponseError("private payload", {}),
    new BadResponseError("private payload", {
      extras: { result_codes: { transaction: signer.secret(), operations: ["op_no_trust"] } },
    }),
  ])("retains safe generic diagnostics when codes are absent or malformed", async (error) => {
    const failure = await rejectSubmission(error).catch((err: unknown) => err);
    expect((failure as ProvisionError).message).toBe(generic);
  });
});
