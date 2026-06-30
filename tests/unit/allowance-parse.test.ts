import { describe, it, expect } from "vitest";
import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { detectAllowanceFromEnvelope } from "@/lib/stellar/events";

describe("detectAllowanceFromEnvelope", () => {
  it("detects a token approve invocation", () => {
    const source = Keypair.random();
    const tokenId = Buffer.alloc(32);
    tokenId[0] = 1;
    const tokenScAddress = xdr.ScAddress.scAddressTypeContract(tokenId as unknown as xdr.Hash);
    const spender = Keypair.random().publicKey();

    const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: tokenScAddress,
        functionName: "approve",
        args: [
          new Address(source.publicKey()).toScVal(),
          new Address(spender).toScVal(),
          nativeToScVal(1_000_000n, { type: "i128" }),
          nativeToScVal(123_456, { type: "u32" }),
        ],
      }),
    );

    const tx = new TransactionBuilder(new Account(source.publicKey(), "123456"), {
      fee: BASE_FEE,
      networkPassphrase: "Test SDF Network ; September 2015",
    })
      .addOperation(Operation.invokeHostFunction({ func: hostFunction }))
      .setTimeout(30)
      .build();

    const result = detectAllowanceFromEnvelope(tx.toXDR());
    expect(result).not.toBeNull();
    expect(result!.from).toBe(source.publicKey());
    expect(result!.spender).toBe(spender);
    expect(result!.amount).toBe("1000000");
  });
});
