import {
  Account,
  Address,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  walletConnectConnection,
  walletConnectIdentity,
} from "@/components/deploy/wallet-connect-connection";
import type { WalletConnectClient } from "@/components/deploy/wallet-kit";
const signer = Keypair.random();
const other = Keypair.random();
const address = signer.publicKey();
const contract = Address.contract(Buffer.alloc(32, 1)).toString();
function original(amount = 100n) {
  return new TransactionBuilder(new Account(address, "41"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract,
        function: "deposit",
        args: [new Address(address).toScVal(), nativeToScVal(amount, { type: "i128" })],
      }),
    )
    .setTimeout(180)
    .build();
}
const request = vi.fn();
let sessions: ReturnType<typeof session>[];
let client: WalletConnectClient;
function session(topic: string, chain = "stellar:testnet") {
  return {
    topic,
    expiry: Date.now() / 1000 + 600,
    namespaces: { stellar: { accounts: [`${chain}:${address}`], methods: ["stellar_signXDR"] } },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  sessions = [session("older-topic"), session("chosen-topic")];
  client = { session: { values: sessions }, request } as unknown as WalletConnectClient;
  request.mockImplementation(
    async ({ request: call }: { request: { params: { xdr: string } } }) => {
      const tx = TransactionBuilder.fromXDR(call.params.xdr, Networks.TESTNET);
      tx.sign(signer);
      return { signedXDR: tx.toXDR() };
    },
  );
});
function connection(signal = new AbortController().signal) {
  return walletConnectConnection(
    client,
    "testnet",
    walletConnectIdentity(client, "testnet", "chosen-topic"),
    signal,
  );
}
describe("exact approved WalletConnect signing", () => {
  it("pins the approved topic and cryptographically validates its unchanged transaction", async () => {
    const unsigned = original().toXDR();
    const result = await connection().signTransaction(unsigned, {
      address,
      networkPassphrase: Networks.TESTNET,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith({
      topic: "chosen-topic",
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: unsigned } },
    });
    expect(TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET).hash()).toEqual(
      TransactionBuilder.fromXDR(unsigned, Networks.TESTNET).hash(),
    );
  });
  it.each(["account", "session", "method", "chain"])(
    "rejects %s changes during the signature request instead of falling back",
    async (change) => {
      request.mockImplementation(
        async ({ request: call }: { request: { params: { xdr: string } } }) => {
          const tx = TransactionBuilder.fromXDR(call.params.xdr, Networks.TESTNET);
          tx.sign(signer);
          if (change === "session") sessions.splice(1, 1);
          else if (change === "method") sessions[1]!.namespaces.stellar.methods = [];
          else
            sessions[1]!.namespaces.stellar.accounts = [
              change === "chain"
                ? `stellar:pubnet:${address}`
                : `stellar:testnet:${other.publicKey()}`,
            ];
          return { signedXDR: tx.toXDR() };
        },
      );
      await expect(
        connection().signTransaction(original().toXDR(), {
          address,
          networkPassphrase: Networks.TESTNET,
        }),
      ).rejects.toThrow("connection ended or changed");
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it.each(["signer", "body", "network"])(
    "rejects a validly encoded response with the wrong %s",
    async (change) => {
      request.mockImplementation(async () => {
        const tx =
          change === "body"
            ? original(101n)
            : TransactionBuilder.fromXDR(
                original().toXDR(),
                change === "network" ? Networks.PUBLIC : Networks.TESTNET,
              );
        tx.sign(change === "signer" ? other : signer);
        return { signedXDR: tx.toXDR() };
      });
      await expect(
        connection().signTransaction(original().toXDR(), {
          address,
          networkPassphrase: Networks.TESTNET,
        }),
      ).rejects.toThrow();
    },
  );
  it("refuses the wrong server network before asking the wallet", async () => {
    await expect(
      connection().signTransaction(original().toXDR(), {
        address,
        networkPassphrase: Networks.PUBLIC,
      }),
    ).rejects.toThrow("networks do not match");
    expect(request).not.toHaveBeenCalled();
  });
  it("refuses an aborted attempt before asking the wallet", async () => {
    const controller = new AbortController();
    const approved = connection(controller.signal);
    controller.abort();
    await expect(
      approved.signTransaction(original().toXDR(), {
        address,
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("refuses invalid or unapproved accounts and never chooses an older session", () => {
    sessions[1]!.namespaces.stellar.accounts = ["stellar:testnet:G-invalid"];
    expect(() => walletConnectIdentity(client, "testnet", "chosen-topic")).toThrow();
    expect(() => walletConnectIdentity(client, "mainnet", "chosen-topic")).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("preserves every existing signature", async () => {
    const tx = original();
    tx.sign(other);
    const result = await connection().signTransaction(tx.toXDR(), {
      address,
      networkPassphrase: Networks.TESTNET,
    });
    expect(
      TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET).signatures,
    ).toHaveLength(2);
  });
});
