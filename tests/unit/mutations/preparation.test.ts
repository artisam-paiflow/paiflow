import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Keypair,
  TransactionBuilder,
  Transaction,
  Networks,
  SorobanDataBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
const mock = vi.hoisted(() => ({ simulate: vi.fn(), account: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ simulateTransaction: mock.simulate }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mock.account }));
import { prepareMutationTransaction } from "@/lib/stellar/prepare-mutation";
import { mutationV1Args } from "@/lib/stellar/execution-v1";
import { admin, intent, root, pay } from "./fixtures";
const mutation = intent({ id: "11111111-1111-4111-8111-111111111111" } as Deployment);
function auth(address = false) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: address
      ? xdr.SorobanCredentials.sorobanCredentialsAddress(
          new xdr.SorobanAddressCredentials({
            address: new Address(admin.publicKey()).toScAddress(),
            nonce: xdr.Int64.fromString("1"),
            signatureExpirationLedger: 150,
            signature: xdr.ScVal.scvVoid(),
          }),
        )
      : xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(root).toScAddress(),
          functionName: "mutate_v1",
          args: mutationV1Args(mutation.nodes, mutation.arguments),
        }),
      ),
      subInvocations: [],
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.account.mockResolvedValue(new Account(admin.publicKey(), "10"));
  mock.simulate.mockResolvedValue({
    _parsed: true,
    id: "1",
    latestLedger: 100,
    transactionData: new SorobanDataBuilder().setResourceFee("1000"),
    minResourceFee: "1000",
    result: { retval: xdr.ScVal.scvVoid(), auth: [auth()] },
    events: [],
  });
});
describe("mutation transaction simulation and source admin auth", () => {
  it("simulates admin source, assembles exact full-path bindings and preserves source auth", async () => {
    const value = await prepareMutationTransaction(mutation),
      tx = TransactionBuilder.fromXDR(value, Networks.TESTNET);
    if (!(tx instanceof Transaction)) throw new Error("Expected v1 envelope");
    expect(tx.source).toBe(admin.publicKey());
    expect(tx.fee).toBe("1100");
    expect(mock.simulate).toHaveBeenCalledOnce();
    const op = tx.operations[0];
    expect(op?.type).toBe("invokeHostFunction");
    if (op?.type !== "invokeHostFunction") throw new Error();
    expect(op.func.invokeContract().functionName().toString()).toBe("mutate_v1");
    expect(op.auth?.length).toBe(1);
    expect(op.auth![0]!.credentials().switch().name).toBe("sorobanCredentialsSourceAccount");
    expect(
      op.func
        .invokeContract()
        .args()
        .map((v) => v.toXDR("base64")),
    ).toEqual(mutationV1Args(mutation.nodes, mutation.arguments).map((v) => v.toXDR("base64")));
  });
  it("uses an account already read inside preparation without another RPC account lookup", async () => {
    const source = new Account(admin.publicKey(), "22");
    const value = await prepareMutationTransaction(mutation, source);
    const tx = TransactionBuilder.fromXDR(value, Networks.TESTNET);
    if (!(tx instanceof Transaction)) throw new Error("Expected v1 envelope");
    expect(tx.sequence).toBe("23");
    expect(mock.account).not.toHaveBeenCalled();
    expect(mock.simulate).toHaveBeenCalledOnce();
  });
  it("refuses a prefetched account belonging to another admin before simulation", async () => {
    await expect(
      prepareMutationTransaction(mutation, new Account(Keypair.random().publicKey(), "22")),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mock.account).not.toHaveBeenCalled();
    expect(mock.simulate).not.toHaveBeenCalled();
  });
  it("refuses unexpected non-source address authorizations and failed simulation", async () => {
    const sim = await mock.simulate();
    sim.result.auth = [auth(true)];
    mock.simulate.mockResolvedValue(sim);
    await expect(prepareMutationTransaction(mutation)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    mock.simulate.mockResolvedValue({ error: "contract refused", latestLedger: 100 });
    await expect(prepareMutationTransaction(mutation)).rejects.toBeDefined();
  });
});
