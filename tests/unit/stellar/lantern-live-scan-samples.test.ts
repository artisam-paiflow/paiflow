import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Address,
  Asset,
  Keypair,
  Networks,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import manifest from "@/docs/testing/lantern-live-scan-samples/manifest.json";

const directory = resolve("docs/testing/lantern-live-scan-samples");
const source = "GCDF6TFSMWXBK7DGO4AQ4WYBSTS5OHM6S4OJRG7MZ7V34AT2LYSOJNWZ";
const known = [
  {
    id: "factory-deploy-pipeline",
    hash: "2994ae4fce8176ee373d1baf7524504e069c68b259018ec3ab6cf40d3b1e8420",
    method: "deploy_pipeline",
    contract: "CBFZTEZZN2M7PV3LHM5TSHO6K45RDKT4ICX2YUNWRX6RXWVIOJ3KZJNK",
    maximumFee: "981994",
    actualFee: "851202",
    ledger: 5211160,
    expires: "1792079534",
    revision: "6b320e717b69878e272871fea1ef08d468ea8298",
  },
  {
    id: "deposit",
    hash: "2f68d076c7521c27506186a1e4a4b1b6036acd8a7d84a93d8d5f884a0cbb29b6",
    method: "deposit",
    contract: "CAICBJOPVUT6F5RK4QQO5ZNMPNGQH6N33KZG722EXCH7GJD4UXDETFTL",
    maximumFee: "523953967",
    actualFee: "455616244",
    ledger: 5211379,
    expires: "1792080630",
    revision: "67402e0ba2f9e822c15b8a9b768b4fecdc2fc226",
  },
  {
    id: "splitter-distribute",
    hash: "0217cd1936cc6cc0b8b8b5b186895f3c3f98ab0cc3bac91bbab877cdf1fd190e",
    method: "distribute",
    contract: "CDC5R564G4IHBX6NZMG66YJ5EZGXXJZA373SORYOG7Y7EMBNVRVX2DME",
    maximumFee: "14784",
    actualFee: null,
    ledger: null,
    expires: "1792083192",
    revision: "437beafef0c7e444bbef225e190e4e2ad48e4dd3",
  },
  {
    id: "streamer-top-up",
    hash: "4cba2f6a867558e845c1f0e401ee9e0c910b6dbd0790588bb9b902e3a99a2184",
    method: "top_up",
    contract: "CB7WSHK5TWPVSZVZ3IPRQHCACRHOIYET3AP43H7CYTTE7Z2O2WIVGMRU",
    maximumFee: "782160",
    actualFee: "676793",
    ledger: 5212404,
    expires: "1792085763",
    revision: "b7b92a49f9dbce9e9a3e6d1815690ab0f6958afd",
  },
  {
    id: "token-approve",
    hash: "6dabd461593b301a897807ecc9abf32b7eb3e7b9cfae4ac4a36050608dd8045d",
    method: "approve",
    contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    maximumFee: "3068799",
    actualFee: "2664845",
    ledger: 5212632,
    expires: "1792086899",
    revision: "b7b92a49f9dbce9e9a3e6d1815690ab0f6958afd",
  },
];
function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return { bytesHex: Buffer.from(value).toString("hex") };
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
  return value;
}
function unsigned(filename: string) {
  return readFileSync(resolve(directory, filename), "utf8").trim();
}
function scanInput(envelope: string): Transaction {
  const tx = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
  if (!(tx instanceof Transaction)) throw new Error("Expected ordinary transaction");
  if (tx.signatures.length) throw new Error("Transaction signatures are forbidden");
  if (tx.memo.type !== "none") throw new Error("Memo data is forbidden");
  if (!tx.timeBounds || BigInt(tx.timeBounds.maxTime) === 0n)
    throw new Error("Unbounded fixture expiry");
  if (BigInt(tx.timeBounds.maxTime) * 1000n >= BigInt(Date.now()))
    throw new Error("Fixture must already be expired");
  if (tx.operations.length !== 1 || tx.operations[0]?.type !== "invokeHostFunction")
    throw new Error("Expected one Soroban invocation");
  const authorizations = tx.operations[0].auth ?? [];
  if (authorizations.length !== 1) throw new Error("Expected one source-account authorization");
  for (const authorization of authorizations) {
    // Reject even unsigned address credentials: the package promises there are
    // no address-auth signatures or opaque authorization payloads of any kind.
    if (authorization.credentials().switch().name !== "sorobanCredentialsSourceAccount")
      throw new Error("Address authorization is forbidden");
  }
  return tx;
}

describe("sanitized real unsigned Testnet scan samples", () => {
  it("contains exactly five real samples and explicitly retains all acceptance/provenance gaps", () => {
    expect(Object.keys(manifest).sort()).toEqual([
      "coverage",
      "network",
      "purpose",
      "samples",
      "schemaVersion",
    ]);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.samples.map((sample) => sample.id)).toEqual(known.map((sample) => sample.id));
    expect(manifest.coverage).toEqual({
      realSamples: 5,
      requestedSamples: 5,
      missingRealSamples: [],
    });
    expect(manifest.network.name).toBe("testnet");
    expect(manifest.network.passphrase).toBe(Networks.TESTNET);
    expect(manifest.network.provenance).toContain("XDR has no network field");
    for (const sample of manifest.samples) {
      expect(Object.keys(sample).sort()).toEqual(
        [
          "id",
          "file",
          "capture",
          "transactionHashTestnet",
          "source",
          "sequence",
          "maximumFeeStroops",
          "actualFeeChargedStroops",
          "timeBounds",
          "expiresAt",
          "transactionSignatures",
          "addressAuthorizationEntries",
          "amountStroops",
          "operations",
          "chainExecution",
        ].sort(),
      );
      expect(Object.keys(sample.capture).sort()).toEqual(
        [
          "revision",
          "preparedAt",
          "environment",
          "provenance",
          "receiptObservedAt",
          "rawSimulationResponseRetained",
          "rawServerPassphraseRetained",
          "simulationEvidence",
          "kind",
          "publicRpcEvidenceFile",
        ].sort(),
      );
      expect(sample.capture.rawSimulationResponseRetained).toBe(
        sample.id === "splitter-distribute",
      );
      expect(sample.capture.rawServerPassphraseRetained).toBe(false);
      expect(sample.capture.environment).toBe(
        sample.id === "splitter-distribute" ? "Read-only public Testnet RPC" : "Railway testing",
      );
    }
  });
  it.each(known)(
    "decodes $id with its known hash, exact arguments, expiry and fee distinctions",
    (expected) => {
      const sample = manifest.samples.find((candidate) => candidate.id === expected.id)!;
      const bytes = unsigned(sample.file);
      const tx = scanInput(bytes);
      expect(tx.hash().toString("hex")).toBe(expected.hash);
      expect(sample.transactionHashTestnet).toBe(expected.hash);
      expect(TransactionBuilder.fromXDR(bytes, Networks.PUBLIC).hash()).not.toEqual(tx.hash());
      expect(sample.source).toBe(source);
      expect(tx.source).toBe(source);
      expect(tx.sequence).toBe(sample.sequence);
      expect(tx.fee).toBe(expected.maximumFee);
      expect(sample.maximumFeeStroops).toBe(expected.maximumFee);
      expect(sample.actualFeeChargedStroops).toBe(expected.actualFee);
      if (sample.actualFeeChargedStroops !== null)
        expect(BigInt(sample.actualFeeChargedStroops)).toBeLessThan(BigInt(tx.fee));
      expect(tx.timeBounds).toEqual(sample.timeBounds);
      expect(tx.timeBounds!.maxTime).toBe(expected.expires);
      expect(new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString()).toBe(sample.expiresAt);
      expect(sample.capture.revision).toBe(expected.revision);
      expect(sample.chainExecution).toEqual(
        expected.ledger === null
          ? null
          : {
              network: "testnet",
              status: "SUCCESS",
              ledger: expected.ledger,
              horizonTransactionUrl: `https://horizon-testnet.stellar.org/transactions/${expected.hash}`,
            },
      );
      const operation = tx.operations[0]!;
      if (operation.type !== "invokeHostFunction") throw new Error("Unexpected operation");
      const invocation = operation.func.invokeContract();
      expect(operation.func.switch().name).toBe("hostFunctionTypeInvokeContract");
      expect(Address.fromScAddress(invocation.contractAddress()).toString()).toBe(
        expected.contract,
      );
      expect(invocation.functionName().toString()).toBe(expected.method);
      expect(sample.operations).toEqual([
        {
          type: "invokeHostFunction",
          hostFunctionType: "hostFunctionTypeInvokeContract",
          contract: expected.contract,
          method: expected.method,
          arguments: invocation.args().map(scValToNative).map(jsonValue),
          auth: operation.auth!.map((authorization) => ({
            credential: authorization.credentials().switch().name,
            root: authorization.rootInvocation().function().switch().name,
          })),
        },
      ]);
      expect(operation.auth).toHaveLength(1);
      expect(sample.transactionSignatures).toBe(0);
      expect(sample.addressAuthorizationEntries).toBe(0);
    },
  );
  it("guards the deposit's exact sender and amount rather than accepting an arbitrary invocation", () => {
    const sample = manifest.samples.find((candidate) => candidate.id === "deposit")!;
    expect(sample.operations[0]!.arguments).toEqual([source, "1000000"]);
    expect(sample.amountStroops).toBe("1000000");
  });
  it("binds the top-up to the pinned Streamer, exact native transfer and source-only auth tree", () => {
    const sample = manifest.samples.find((candidate) => candidate.id === "streamer-top-up")!;
    expect(sample.operations[0]!.arguments).toEqual([source, "1000000"]);
    expect(sample.amountStroops).toBe("1000000");
    expect(sample.capture.kind).toBe("application UI capture");
    const tx = scanInput(unsigned(sample.file));
    const operation = tx.operations[0]!;
    if (operation.type !== "invokeHostFunction") throw new Error("Unexpected operation");
    const root = operation.auth![0]!.rootInvocation();
    expect(root.function().switch().name).toBe("sorobanAuthorizedFunctionTypeContractFn");
    const fn = root.function().contractFn();
    const target = "CB7WSHK5TWPVSZVZ3IPRQHCACRHOIYET3AP43H7CYTTE7Z2O2WIVGMRU";
    expect(Address.fromScAddress(fn.contractAddress()).toString()).toBe(target);
    expect(fn.functionName().toString()).toBe("top_up");
    expect(fn.args().map(scValToNative).map(jsonValue)).toEqual([source, "1000000"]);
    expect(root.subInvocations()).toHaveLength(1);
    const child = root.subInvocations()[0]!;
    expect(child.function().switch().name).toBe("sorobanAuthorizedFunctionTypeContractFn");
    const transfer = child.function().contractFn();
    expect(Address.fromScAddress(transfer.contractAddress()).toString()).toBe(
      Asset.native().contractId(Networks.TESTNET),
    );
    expect(transfer.functionName().toString()).toBe("transfer");
    expect(transfer.args().map(scValToNative).map(jsonValue)).toEqual([source, target, "1000000"]);
    expect(child.subInvocations()).toHaveLength(0);
  });
  it("binds the approval to one stroop, the pinned subscription spender and exact expiration ledger", () => {
    const sample = manifest.samples.find((candidate) => candidate.id === "token-approve")!;
    const spender = "CCKHNCKLTVSQJXILPH7P4HSHVT6EAJJGAZKUXEZ7NPPQN57JXMFQGPP5";
    const args = [source, spender, "1", 8323016];
    expect(sample.operations[0]!.arguments).toEqual(args);
    expect(sample.amountStroops).toBe("1");
    expect(sample.capture.kind).toBe("application UI capture");
    const tx = scanInput(unsigned(sample.file));
    const operation = tx.operations[0]!;
    if (operation.type !== "invokeHostFunction") throw new Error("Unexpected operation");
    const root = operation.auth![0]!.rootInvocation();
    expect(root.function().switch().name).toBe("sorobanAuthorizedFunctionTypeContractFn");
    const fn = root.function().contractFn();
    expect(Address.fromScAddress(fn.contractAddress()).toString()).toBe(
      Asset.native().contractId(Networks.TESTNET),
    );
    expect(fn.functionName().toString()).toBe("approve");
    expect(fn.args().map(scValToNative).map(jsonValue)).toEqual(args);
    expect(root.subInvocations()).toHaveLength(0);
  });
  it("preserves genuine whitelisted public simulation evidence without claiming submission", () => {
    const sample = manifest.samples.find((candidate) => candidate.id === "splitter-distribute")!;
    expect(sample.capture.kind).toBe("read-only actual-builder RPC sample");
    expect(sample.chainExecution).toBeNull();
    expect(sample.actualFeeChargedStroops).toBeNull();
    expect(sample.operations[0]!.arguments).toEqual([source, "1000000"]);
    const evidence = JSON.parse(
      readFileSync(resolve(directory, sample.capture.publicRpcEvidenceFile!), "utf8"),
    ) as {
      rpcUrl: string;
      networkPassphrase: string;
      requestMethod: string;
      capturedAt: string;
      verifiedBeforeSimulation: {
        ledger: number;
        source: string;
        admin: string;
        contract: string;
        recipients: unknown[];
        nextSteps: unknown[];
        paused: boolean;
      };
      result: rpc.Api.RawSimulateTransactionResponse;
    };
    expect(Object.keys(evidence).sort()).toEqual(
      [
        "rpcUrl",
        "networkPassphrase",
        "requestMethod",
        "capturedAt",
        "verifiedBeforeSimulation",
        "result",
      ].sort(),
    );
    expect(evidence.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(evidence.networkPassphrase).toBe(Networks.TESTNET);
    expect(evidence.requestMethod).toBe("simulateTransaction");
    expect(evidence.verifiedBeforeSimulation).toEqual({
      ledger: 5211884,
      source,
      admin: source,
      contract: "CDC5R564G4IHBX6NZMG66YJ5EZGXXJZA373SORYOG7Y7EMBNVRVX2DME",
      recipients: [{ address: source, amount: "1000000", bps: 0, is_cash_out: false }],
      nextSteps: [],
      paused: false,
    });
    expect(Object.keys(evidence.result).sort()).toEqual(
      ["latestLedger", "minResourceFee", "transactionData", "results"].sort(),
    );
    const simulation = rpc.parseRawSimulation(evidence.result);
    if (!rpc.Api.isSimulationSuccess(simulation))
      throw new Error("Expected actual successful simulation");
    expect(simulation.latestLedger).toBe(5211885);
    expect(simulation.minResourceFee).toBe("14684");
    expect(simulation.result?.auth).toHaveLength(1);
    for (const auth of simulation.result?.auth ?? [])
      expect(auth.credentials().switch().name).toBe("sorobanCredentialsSourceAccount");
    const tx = scanInput(unsigned(sample.file));
    expect(BigInt(tx.fee)).toBe(BigInt(simulation.minResourceFee) + 100n);
    expect(tx.toEnvelope().v1().tx().ext().sorobanData().toXDR("base64")).toBe(
      simulation.transactionData.build().toXDR("base64"),
    );
    expect(
      tx.operations[0]?.type === "invokeHostFunction" &&
        tx.operations[0].auth?.map((auth) => auth.toXDR("base64")),
    ).toEqual(simulation.result!.auth.map((auth) => auth.toXDR("base64")));
  });
  it("rejects an envelope with any transaction signature", () => {
    const tx = scanInput(unsigned(manifest.samples[0]!.file));
    tx.sign(Keypair.random());
    expect(() => scanInput(tx.toXDR())).toThrow("Transaction signatures are forbidden");
  });
  it("rejects address authorization even when it contains no signature", () => {
    const envelope = xdr.TransactionEnvelope.fromXDR(unsigned(manifest.samples[0]!.file), "base64");
    const operation = envelope.v1().tx().operations()[0]!.body().invokeHostFunctionOp();
    operation.auth()[0]!.credentials(
      xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(source).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 5211160,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
    );
    expect(() => scanInput(envelope.toXDR("base64"))).toThrow("Address authorization is forbidden");
  });
});
