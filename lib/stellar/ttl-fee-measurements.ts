import "server-only";
import {
  FeeBumpTransaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { AppError } from "@/lib/errors";

const StroopsSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const TtlFeeInputSchema = z.object({
  transactions: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .min(1)
    .max(100),
});
export type TtlFeeInput = z.infer<typeof TtlFeeInputSchema>;
export const TtlFeeEventSchema = z.object({
  stage: z.enum(["before", "after"]),
  amountStroops: z.string().regex(/^-?(0|[1-9]\d*)$/),
});
export type TtlFeeEvent = z.infer<typeof TtlFeeEventSchema>;

/** Result.feeCharged is already net on protocol 23+: never subtract the refund twice. */
export function reconcileTtlFees(
  input: TtlFeeEvent[],
  declaredFeeStroops: string,
  resultFeeChargedStroops: string,
) {
  const events = z.array(TtlFeeEventSchema).parse(input);
  const declared = BigInt(StroopsSchema.parse(declaredFeeStroops));
  const result = BigInt(StroopsSchema.parse(resultFeeChargedStroops));
  const before = events.filter((e) => e.stage === "before");
  if (
    before.length !== 1 ||
    events.some((e) =>
      e.stage === "before" ? BigInt(e.amountStroops) < 0n : BigInt(e.amountStroops) > 0n,
    )
  ) {
    throw new AppError("UPSTREAM_RPC", "Incomplete or inconsistent fee events");
  }
  const initiallyCharged = BigInt(before[0]!.amountStroops);
  const refund = -events
    .filter((e) => e.stage === "after")
    .reduce((sum, e) => sum + BigInt(e.amountStroops), 0n);
  const net = initiallyCharged - refund;
  if (initiallyCharged > declared || net < 0n || net !== result) {
    throw new AppError("UPSTREAM_RPC", "Fee events do not reconcile with transaction result");
  }
  return {
    declaredFeeStroops: declared.toString(),
    initiallyChargedStroops: initiallyCharged.toString(),
    refundStroops: refund.toString(),
    netFeeStroops: net.toString(),
    resultFeeChargedStroops: result.toString(),
  };
}

/** Read-only measurement. Unsupported metadata fails visibly rather than guessing refunds. */
export async function measureSorobanTransactionFee(
  server: rpc.Server,
  hash: string,
  passphrase: string,
) {
  z.string()
    .regex(/^[0-9a-f]{64}$/)
    .parse(hash);
  const result = await server.getTransaction(hash);
  if (
    result.status !== rpc.Api.GetTransactionStatus.SUCCESS ||
    result.resultMetaXdr.switch() !== 4
  ) {
    throw new AppError("UPSTREAM_RPC", "Successful protocol-23 transaction metadata required");
  }
  const envelope = TransactionBuilder.fromXDR(result.envelopeXdr, passphrase);
  const payer = envelope instanceof FeeBumpTransaction ? envelope.feeSource : envelope.source;
  const transaction = envelope instanceof FeeBumpTransaction ? envelope.innerTransaction : envelope;
  if (
    transaction.operations.length !== 1 ||
    !["restoreFootprint", "extendFootprintTtl", "invokeHostFunction"].includes(
      transaction.operations[0]!.type,
    )
  ) {
    throw new AppError("VALIDATION", "Expected one Soroban operation");
  }
  const meta = result.resultMetaXdr.v4();
  const events: TtlFeeEvent[] = [];
  for (const event of meta.events()) {
    const body = event.event().body().v0();
    const topics = body.topics().map(scValToNative);
    if (topics[0] !== "fee") continue;
    if (topics[1] !== payer || body.data().switch() !== xdr.ScValType.scvI128()) {
      throw new AppError("UPSTREAM_RPC", "Unexpected fee payer or amount encoding");
    }
    const amount = scValToNative(body.data()) as unknown;
    if (typeof amount !== "bigint") throw new AppError("UPSTREAM_RPC", "Invalid fee amount");
    events.push({
      stage:
        event.stage() === xdr.TransactionEventStage.transactionEventStageBeforeAllTxes()
          ? "before"
          : "after",
      amountStroops: amount.toString(),
    });
  }
  const fees = reconcileTtlFees(events, envelope.fee, result.resultXdr.feeCharged().toString());
  const ext = meta.sorobanMeta()?.ext();
  return {
    hash,
    ledger: result.ledger,
    payer,
    operation: transaction.operations[0]!.type,
    ...fees,
    rentFeeStroops: ext?.switch() === 1 ? ext.v1().rentFeeCharged().toString() : null,
    feeEvents: events,
  };
}

/** The existing read-only TTL tool continues to refuse non-rent transactions. */
export async function measureTtlTransactionFee(
  server: rpc.Server,
  hash: string,
  passphrase: string,
) {
  const measured = await measureSorobanTransactionFee(server, hash, passphrase);
  if (!["restoreFootprint", "extendFootprintTtl"].includes(measured.operation)) {
    throw new AppError("VALIDATION", "Expected one TTL rent operation");
  }
  return measured;
}
