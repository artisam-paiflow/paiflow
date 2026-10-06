import "server-only";
import { createHash } from "node:crypto";
import {
  Address,
  Asset,
  Keypair,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { env, stellarPassphrase } from "@/lib/env";
import { sorobanRpc } from "@/lib/stellar/client";
import {
  FeeBudgetSchema,
  reserveTransactionFee,
  type FeeReservation,
} from "@/lib/stellar/fee-budget";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { ttlInstanceKey } from "@/lib/stellar/ttl-maintenance";
import {
  buildRelayerTx,
  withRelayerChannel,
  type RelayerRestorationRecord,
  type RelayerRestorationOutcome,
} from "@/lib/stellar/relayer-channels";
import { measureSorobanTransactionFee } from "@/lib/stellar/ttl-fee-measurements";

export const TTL_REHEARSAL = {
  budget: { name: "ttl804-testnet-20261004", limitStroops: "1500000000" },
  maxFeeStroops: "500000000",
  paymentStroops: "10000000",
  wasm: {
    WEBHOOK: "bcf0ad2d7cedc728bd24cee8f20efa289efc3d5d8f24ed8a513fe393a5507d6c",
    PAYER: "b331db1c3e26da4fe8aec7635a567a11fb5e069123c355eaae92d095d5ef457f",
  },
} as const;

const ContractAddressSchema = z.string().refine(StrKey.isValidContract);
const AccountAddressSchema = z.string().refine(StrKey.isValidEd25519PublicKey);
export const TtlRecoveryFixtureSchema = z
  .object({
    environment: z.literal("hackathon-testing"),
    network: z.literal("TESTNET"),
    phase: z.literal("awaiting-natural-expiry"),
    budget: FeeBudgetSchema.refine(
      (v) =>
        v.name === TTL_REHEARSAL.budget.name &&
        v.limitStroops === TTL_REHEARSAL.budget.limitStroops,
    ),
    admin: AccountAddressSchema,
    recipient: AccountAddressSchema,
    relayer: AccountAddressSchema,
    registeredForMaintenance: z.literal(false),
    pipeline: z
      .array(
        z.object({
          nodeId: z.enum(["webhook", "pay"]),
          contractAddress: ContractAddressSchema,
          templateKind: z.enum(["WEBHOOK", "PAYER"]),
        }),
      )
      .length(2),
    instances: z
      .array(
        z.object({
          address: ContractAddressSchema,
          valueSha256: z.string().regex(/^[a-f0-9]{64}$/),
          wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .length(2),
  })
  .superRefine((v, ctx) => {
    const webhook = v.pipeline.find((n) => n.nodeId === "webhook");
    const pay = v.pipeline.find((n) => n.nodeId === "pay");
    if (
      !webhook ||
      !pay ||
      webhook.contractAddress === pay.contractAddress ||
      webhook.templateKind !== "WEBHOOK" ||
      pay.templateKind !== "PAYER" ||
      !v.instances.some(
        (i) => i.address === webhook.contractAddress && i.wasmHash === TTL_REHEARSAL.wasm.WEBHOOK,
      ) ||
      !v.instances.some(
        (i) => i.address === pay.contractAddress && i.wasmHash === TTL_REHEARSAL.wasm.PAYER,
      )
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Fixture pipeline binding mismatch" });
    }
  });
export type TtlRecoveryFixture = z.infer<typeof TtlRecoveryFixtureSchema>;

export type TtlFixtureTransactionRecord = RelayerRestorationRecord & {
  purpose: "ttl-restoration" | "fixture-payment";
};
export type TtlFixtureTransactionOutcome = RelayerRestorationOutcome & {
  purpose: TtlFixtureTransactionRecord["purpose"];
};
export type TtlFixtureTransactionObserver = {
  beforeSend: (record: TtlFixtureTransactionRecord) => Promise<void>;
  onFinality: (outcome: TtlFixtureTransactionOutcome) => Promise<void>;
};

/** Guard the ops tool independently of app defaults; it never accepts MAINNET. */
export function assertTtlRehearsalEnvironment(): void {
  const config = env();
  if (
    config.STELLAR_NETWORK !== "testnet" ||
    config.RAILWAY_ENVIRONMENT_NAME !== "hackathon-testing"
  ) {
    throw new Error("TTL rehearsal requires Railway hackathon-testing and TESTNET");
  }
  const budget = FeeBudgetSchema.parse({
    name: config.STELLAR_TTL_FEE_BUDGET_NAME,
    limitStroops: config.STELLAR_TTL_FEE_BUDGET_STROOPS,
  });
  if (
    budget.name !== TTL_REHEARSAL.budget.name ||
    budget.limitStroops !== TTL_REHEARSAL.budget.limitStroops ||
    config.STELLAR_TTL_MAX_FEE_STROOPS !== TTL_REHEARSAL.maxFeeStroops ||
    config.STELLAR_TTL_MAINTENANCE_ENABLED
  ) {
    throw new Error("TTL rehearsal requires the approved caps and disabled maintenance");
  }
}

export function ttlRehearsalGraph(recipient: string, relayer: string): FlowGraph {
  z.string().refine(StrKey.isValidEd25519PublicKey).parse(recipient);
  z.string().refine(StrKey.isValidEd25519PublicKey).parse(relayer);
  return FlowGraphSchema.parse({
    nodes: [
      { id: "webhook", type: "webhook", config: { asset: { kind: "native" }, relayer } },
      {
        id: "pay",
        type: "pay",
        config: { recipient, asset: { kind: "native" }, mode: "percentage", percentage: 100 },
      },
    ],
    edges: [{ id: "webhook-pay", source: "webhook", target: "pay" }],
  });
}

/** Only public state; reading/simulation never commits a TTL renewal. */
export async function readTtlFixtureInstances(addresses: string[]) {
  const response = await sorobanRpc().getLedgerEntries(...addresses.map(ttlInstanceKey));
  return addresses.map((address) => {
    const entry = response.entries.find(
      (e) => e.key.toXDR("base64") === ttlInstanceKey(address).toXDR("base64"),
    );
    if (!entry) throw new Error("Fixture instance read unavailable");
    const executable = entry.val.contractData().val().instance().executable();
    if (executable.switch().name !== "contractExecutableWasm")
      throw new Error("Fixture executable mismatch");
    return {
      address,
      latestLedger: response.latestLedger,
      liveUntilLedger: entry.liveUntilLedgerSeq,
      valueSha256: createHash("sha256").update(entry.val.toXDR()).digest("hex"),
      wasmHash: executable.wasmHash().toString("hex"),
    };
  });
}

export async function readTtlFixtureAccount(address: string) {
  AccountAddressSchema.parse(address);
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrPublicKey() }),
  );
  const response = await sorobanRpc().getLedgerEntries(key);
  const entry = response.entries.find((row) => row.key.toXDR("base64") === key.toXDR("base64"));
  if (!entry) throw new Error("Fixture payer account unavailable");
  const account = entry.val.account();
  return {
    address,
    latestLedger: response.latestLedger,
    balanceStroops: account.balance().toString(),
    sequence: account.seqNum().toString(),
  };
}

/** Reserve a simulated fee before signing. No retry, including unknown finality. */
export async function submitTtlFixtureTransaction(
  transaction: Transaction,
  signer: Keypair,
  purpose: FeeReservation["purpose"],
  beforeSend: (publicRecord: {
    hash: string;
    declaredFeeStroops: string;
    purpose: string;
  }) => Promise<void>,
) {
  assertTtlRehearsalEnvironment();
  if (
    transaction.networkPassphrase !== stellarPassphrase() ||
    transaction.source !== signer.publicKey() ||
    BigInt(transaction.fee) > BigInt(TTL_REHEARSAL.maxFeeStroops)
  ) {
    throw new Error("Fixture transaction network, source or fee exceeds approval");
  }
  const hash = transaction.hash().toString("hex");
  await reserveTransactionFee({
    network: "testnet",
    budget: TTL_REHEARSAL.budget,
    txHash: hash,
    payer: transaction.source,
    declaredFeeStroops: transaction.fee,
    purpose,
  });
  // Public manifest is persisted before submission as well as the DB reservation.
  await beforeSend({ hash, declaredFeeStroops: transaction.fee, purpose });
  transaction.sign(signer);
  const server = sorobanRpc();
  const sent = await server.sendTransaction(transaction);
  if (sent.status === "ERROR")
    throw new Error("Fixture transaction rejected; reservation retained");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);
    if (result.status === "SUCCESS")
      return {
        hash,
        declaredFeeStroops: transaction.fee,
        netFeeStroops: result.resultXdr.feeCharged().toString(),
        ledger: result.ledger,
        fees: await measureSorobanTransactionFee(server, hash, stellarPassphrase()),
      };
    if (result.status === "FAILED")
      throw new Error("Fixture transaction failed; reservation retained");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Fixture finality unknown; reconcile recorded hash without resubmission");
}

export async function prepareTtlFixtureDeposit(
  source: string,
  webhook: string,
): Promise<Transaction> {
  const server = sorobanRpc();
  // A direct token transfer avoids invoking/renewing the fixture contract.
  const tx = new TransactionBuilder(await server.getAccount(source), {
    fee: "100",
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: Asset.native().contractId(stellarPassphrase()),
        function: "transfer",
        args: [
          new Address(source).toScVal(),
          new Address(webhook).toScVal(),
          nativeToScVal(BigInt(TTL_REHEARSAL.paymentStroops), { type: "i128" }),
        ],
      }),
    )
    .setTimeout(180)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || rpc.Api.isSimulationRestore(sim))
    throw new Error("Fixture deposit simulation failed or requires recovery");
  return rpc.assembleTransaction(tx, sim).build();
}

/** Future recovery/payment rehearsal: use the actual channel/auth/restore builder. */
export async function submitTtlFixtureEscrow(
  webhook: string,
  observer: TtlFixtureTransactionObserver,
) {
  assertTtlRehearsalEnvironment();
  return withRelayerChannel(async (channel) => {
    const transaction = await buildRelayerTx({
      channel,
      operation: Operation.invokeContractFunction({
        contract: webhook,
        function: "execute_escrow",
        args: [nativeToScVal(BigInt(TTL_REHEARSAL.paymentStroops), { type: "i128" })],
      }),
      onSimulationError: () => new Error("Fixture escrow simulation failed"),
      restorationObserver: {
        beforeSend: (record) => observer.beforeSend({ ...record, purpose: "ttl-restoration" }),
        onFinality: (outcome) => observer.onFinality({ ...outcome, purpose: "ttl-restoration" }),
      },
    });
    if (BigInt(transaction.fee) > BigInt(TTL_REHEARSAL.maxFeeStroops))
      throw new Error("Fixture payment fee exceeds approval");
    const hash = transaction.hash().toString("hex");
    await reserveTransactionFee({
      network: "testnet",
      budget: TTL_REHEARSAL.budget,
      txHash: hash,
      payer: channel.publicKey,
      declaredFeeStroops: transaction.fee,
      purpose: "fixture-payment",
    });
    const record: TtlFixtureTransactionRecord = {
      hash,
      payer: channel.publicKey,
      declaredFeeStroops: transaction.fee,
      purpose: "fixture-payment",
    };
    await observer.beforeSend(record);
    channel.trackPending(hash, transaction.timeBounds?.maxTime);
    const server = sorobanRpc();
    const sent = await server.sendTransaction(transaction);
    if (sent.status === "ERROR") {
      channel.clearPending?.(hash);
      throw new Error("Fixture escrow rejected; reservation retained");
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await server.getTransaction(hash);
      if (result.status === "SUCCESS" || result.status === "FAILED") {
        channel.clearPending?.(hash);
        const outcome: TtlFixtureTransactionOutcome = {
          ...record,
          status: result.status,
          netFeeStroops: result.resultXdr.feeCharged().toString(),
          ledger: result.ledger,
        };
        // Persist finality before any optional fee/verification RPC can fail.
        await observer.onFinality(outcome);
        if (result.status === "FAILED")
          throw new Error("Fixture escrow failed; reservation retained");
        return {
          ...outcome,
          status: "SUCCESS" as const,
          fees: await measureSorobanTransactionFee(server, hash, stellarPassphrase()),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("Fixture escrow finality unknown; no payment retry");
  });
}

export async function readTtlFixtureTokenBalances(source: string, addresses: string[]) {
  const server = sorobanRpc();
  const rows: Record<string, string> = {};
  for (const address of addresses) {
    const tx = new TransactionBuilder(await server.getAccount(source), {
      fee: "100",
      networkPassphrase: stellarPassphrase(),
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: Asset.native().contractId(stellarPassphrase()),
          function: "balance",
          args: [new Address(address).toScVal()],
        }),
      )
      .setTimeout(180)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || rpc.Api.isSimulationRestore(sim) || !sim.result)
      throw new Error("Fixture balance read unavailable");
    const value = sim.result.retval;
    if (value.switch() !== xdr.ScValType.scvI128())
      throw new Error("Fixture balance encoding invalid");
    const balance: unknown = scValToNative(value);
    if (typeof balance !== "bigint" || balance < 0n)
      throw new Error("Fixture balance value invalid");
    rows[address] = balance.toString();
  }
  return rows;
}
