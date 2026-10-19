import { createRequire } from "node:module";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import type { WalletKit } from "@/components/deploy/wallet-kit";
import { connectSelectedWallet } from "@/components/deploy/selected-wallet-connection";
import { selectWallet } from "@/components/deploy/select-wallet";

// Exercise the installed adapter's account/topic search, rather than replacing
// that behavior with an idealized SDK mock.
vi.mock("@/components/deploy/select-wallet", () => ({
  selectWallet: vi.fn(async () => ({ id: "wallet_connect", name: "WalletConnect" })),
}));
const require = createRequire(import.meta.url);
const { WalletConnectModule } =
  require("@creit.tech/stellar-wallets-kit/modules/walletconnect.module.cjs") as typeof import("@creit.tech/stellar-wallets-kit/modules/walletconnect.module");
const wallet = Keypair.random();
const other = Keypair.random();
function transaction() {
  return new TransactionBuilder(new Account(wallet.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({ destination: other.publicKey(), amount: "0.1", asset: Asset.native() }),
    )
    .setTimeout(180)
    .build();
}
function fixture() {
  const session = (topic: string) => ({
    topic,
    expiry: Date.now() / 1000 + 600,
    namespaces: {
      stellar: {
        accounts: [`stellar:testnet:${wallet.publicKey()}`],
        methods: ["stellar_signXDR"],
      },
    },
    peer: {
      metadata: { name: "Freighter", description: "test", url: "https://example.test", icons: [] },
    },
  });
  const client = {
    session: { values: [session("older-topic"), session("chosen-topic")] },
    request: vi.fn(async ({ request }: { request: { params: { xdr: string } } }) => {
      const tx = TransactionBuilder.fromXDR(request.params.xdr, Networks.TESTNET);
      tx.sign(wallet);
      return { signedXDR: tx.toXDR() };
    }),
  };
  const module = new WalletConnectModule({
    client,
    modal: {},
    method: "stellar_signXDR",
    network: Networks.TESTNET,
  } as unknown as ConstructorParameters<typeof WalletConnectModule>[0]);
  vi.spyOn(module, "connectWalletConnect").mockResolvedValue({
    id: "chosen-topic",
    accounts: [{ network: "testnet", publicKey: wallet.publicKey() }],
  } as Awaited<ReturnType<typeof module.connectWalletConnect>>);
  const sdkSign = vi.spyOn(module, "signTransaction");
  const kit = {
    openModal: async (options: {
      onWalletSelected: (wallet: { id: string; name: string }) => void;
    }) => {
      options.onWalletSelected({ id: "wallet_connect", name: "WalletConnect" });
    },
    setWallet: vi.fn(),
    getAddress: () => module.getAddress(),
    signTransaction: (...args: Parameters<typeof module.signTransaction>) =>
      module.signTransaction(...args),
  };
  const shared = { kit, module, client } as unknown as WalletKit;
  return { shared, client, module, sdkSign };
}
async function connect(value = fixture(), signal = new AbortController().signal) {
  const connection = await connectSelectedWallet(value.shared, "testnet", signal);
  if (!connection) throw new Error("Expected selected connection");
  return { ...value, connection };
}

describe("exact approved WalletConnect signing", () => {
  it("requests the freshly approved topic even with an older same-account session first", async () => {
    const { connection, client, sdkSign } = await connect();
    const tx = transaction();
    await connection.signTransaction(tx.toXDR(), {
      address: wallet.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith({
      topic: "chosen-topic",
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: tx.toXDR() } },
    });
    expect(sdkSign).not.toHaveBeenCalled();
  });
  it.each(["expired", "missing", "account", "method"])(
    "refuses before requesting when the selected session becomes %s",
    async (state) => {
      const { connection, client } = await connect();
      const chosen = client.session.values[1]!;
      if (state === "expired") chosen.expiry = 1;
      if (state === "missing") client.session.values.splice(1, 1);
      if (state === "account")
        chosen.namespaces.stellar.accounts = [`stellar:testnet:${other.publicKey()}`];
      if (state === "method") chosen.namespaces.stellar.methods = ["stellar_signAndSubmitXDR"];
      await expect(
        connection.signTransaction(transaction().toXDR(), {
          address: wallet.publicKey(),
          networkPassphrase: Networks.TESTNET,
        }),
      ).rejects.toThrow(/ended or changed/);
      expect(client.request).not.toHaveBeenCalled();
    },
  );
  it("refuses a wrong server network or account without requesting a signature", async () => {
    const { connection, client } = await connect();
    await expect(
      connection.signTransaction(transaction().toXDR(), {
        address: wallet.publicKey(),
        networkPassphrase: Networks.PUBLIC,
      }),
    ).rejects.toThrow(/networks/);
    await expect(
      connection.signTransaction(transaction().toXDR(), {
        address: other.publicKey(),
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow(/account/);
    expect(client.request).not.toHaveBeenCalled();
  });
  it("revalidates the selected session after the wallet answers", async () => {
    const { connection, client } = await connect();
    const original = client.request.getMockImplementation()!;
    client.request.mockImplementation(async (request) => {
      const result = await original(request);
      client.session.values.splice(1, 1);
      return result;
    });
    await expect(
      connection.signTransaction(transaction().toXDR(), {
        address: wallet.publicKey(),
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow(/ended or changed/);
  });
  it("refuses a response signed by another wallet", async () => {
    const { connection, client } = await connect();
    client.request.mockImplementation(async ({ request }) => {
      const tx = TransactionBuilder.fromXDR(request.params.xdr, Networks.TESTNET);
      tx.sign(other);
      return { signedXDR: tx.toXDR() };
    });
    await expect(
      connection.signTransaction(transaction().toXDR(), {
        address: wallet.publicKey(),
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow(/did not sign/);
  });
  it("rejects completion after the owning attempt is aborted", async () => {
    const controller = new AbortController();
    const { connection, client } = await connect(fixture(), controller.signal);
    const original = client.request.getMockImplementation()!;
    client.request.mockImplementation(async (request) => {
      const result = await original(request);
      controller.abort();
      return result;
    });
    await expect(
      connection.signTransaction(transaction().toXDR(), {
        address: wallet.publicKey(),
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow();
  });
});

describe("desktop signer selection", () => {
  it("reselects the chosen module after an awaited account check", async () => {
    vi.mocked(selectWallet).mockResolvedValueOnce({ id: "freighter", name: "Freighter" });
    let selected = "freighter";
    const signedBy: string[] = [];
    const kit = {
      getNetwork: async () => ({ networkPassphrase: Networks.TESTNET }),
      setWallet: (id: string) => {
        selected = id;
      },
      getAddress: async () => {
        selected = "other-surface-wallet";
        return { address: wallet.publicKey() };
      },
      signTransaction: async () => {
        signedBy.push(selected);
        return { signedTxXdr: "signed" };
      },
    };
    const connection = await connectSelectedWallet(
      { kit, module: null, client: null } as unknown as WalletKit,
      "testnet",
      new AbortController().signal,
    );
    if (!connection) throw new Error("Expected connection");
    await connection.signTransaction("unsigned", {
      address: wallet.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    expect(signedBy).toEqual(["freighter"]);
  });
});

describe("desktop post-sign connection admission", () => {
  it.each(["account", "network", "network-error", "abort-account", "abort-network"])(
    "refuses a signed result after %s changes during wallet review",
    async (change) => {
      vi.mocked(selectWallet).mockResolvedValueOnce({ id: "freighter", name: "Freighter" });
      const controller = new AbortController();
      let signed = false;
      const kit = {
        setWallet: vi.fn(),
        getAddress: vi.fn(async (options?: { skipRequestAccess?: boolean }) => {
          if (signed) {
            expect(options).toEqual({ skipRequestAccess: true });
            if (change === "abort-account") controller.abort();
          }
          return {
            address: signed && change === "account" ? other.publicKey() : wallet.publicKey(),
          };
        }),
        signTransaction: vi.fn(async () => {
          signed = true;
          return { signedTxXdr: "signed" };
        }),
        getNetwork: vi.fn(async () => {
          if (change === "abort-network") controller.abort();
          if (change === "network-error") throw new Error("Connection lost reading network");
          return { networkPassphrase: change === "network" ? Networks.PUBLIC : Networks.TESTNET };
        }),
      };
      const connection = await connectSelectedWallet(
        { kit, module: null, client: null } as unknown as WalletKit,
        "testnet",
        controller.signal,
      );
      if (!connection) throw new Error("Expected connection");
      await expect(
        connection.signTransaction("unsigned", {
          address: wallet.publicKey(),
          networkPassphrase: Networks.TESTNET,
        }),
      ).rejects.toThrow();
      expect(kit.signTransaction).toHaveBeenCalledOnce();
      if (change === "account" || change === "abort-account")
        expect(kit.getNetwork).not.toHaveBeenCalled();
    },
  );
});

describe("Lantern selected grant binding", () => {
  it("does not let an old surface use a reconnected same-account grant", async () => {
    vi.mocked(selectWallet).mockResolvedValueOnce({ id: "lantern", name: "Lantern" });
    let generation = 1;
    const lantern = {
      get connectionGeneration() {
        return generation;
      },
      assertConnectionGeneration: (expected: number) => {
        if (expected !== generation) throw new Error("Lantern grant changed");
      },
    };
    const kit = {
      setWallet: vi.fn(),
      getAddress: vi.fn(async () => ({ address: wallet.publicKey() })),
      signTransaction: vi.fn(),
      getNetwork: vi.fn(),
    };
    const connection = await connectSelectedWallet(
      { kit, lantern } as unknown as WalletKit,
      "testnet",
      new AbortController().signal,
    );
    generation += 2; // switch away, then reconnect the same account
    await expect(
      connection!.signTransaction("unsigned", {
        address: wallet.publicKey(),
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow("grant changed");
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });
});

describe("Lantern late signed result admission", () => {
  it.each(["sign", "post-sign-address"])(
    "refuses completion when a grant changes during %s",
    async (boundary) => {
      vi.mocked(selectWallet).mockResolvedValueOnce({ id: "lantern", name: "Lantern" });
      let generation = 1;
      let resolve!: () => void;
      const waiting = new Promise<void>((done) => {
        resolve = done;
      });
      let signed = false;
      const reached = vi.fn();
      const lantern = {
        get connectionGeneration() {
          return generation;
        },
        assertConnectionGeneration: (expected: number) => {
          if (expected !== generation) throw new Error("Lantern grant changed");
        },
      };
      const kit = {
        setWallet: vi.fn(),
        getAddress: vi.fn(async () => {
          if (signed && boundary === "post-sign-address") {
            reached();
            await waiting;
          }
          return { address: wallet.publicKey() };
        }),
        signTransaction: vi.fn(async () => {
          signed = true;
          if (boundary === "sign") {
            reached();
            await waiting;
          }
          return { signedTxXdr: "signed" };
        }),
        getNetwork: vi.fn(async () => ({ networkPassphrase: Networks.TESTNET })),
      };
      const connection = await connectSelectedWallet(
        { kit, lantern } as unknown as WalletKit,
        "testnet",
        new AbortController().signal,
      );
      const submitted = vi.fn();
      const pending = connection!
        .signTransaction("unsigned", {
          address: wallet.publicKey(),
          networkPassphrase: Networks.TESTNET,
        })
        .then(submitted);
      await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce());
      generation++;
      resolve();
      await expect(pending).rejects.toThrow("grant changed");
      expect(submitted).not.toHaveBeenCalled();
    },
  );
});
