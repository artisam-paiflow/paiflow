import "server-only";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { ContractParams, PipelineNodeParams } from "@/lib/flows/to-params";
import { assetContractId } from "./assets";

function addr(a: string): xdr.ScVal {
  return new Address(a).toScVal();
}

function i128(n: string | bigint): xdr.ScVal {
  return nativeToScVal(typeof n === "bigint" ? n : BigInt(n), { type: "i128" });
}

function u32(n: number): xdr.ScVal {
  return nativeToScVal(n, { type: "u32" });
}

function u64(n: number | bigint): xdr.ScVal {
  return nativeToScVal(typeof n === "bigint" ? n : BigInt(n), { type: "u64" });
}

function bool(b: boolean): xdr.ScVal {
  return nativeToScVal(b, { type: "bool" });
}

// Mode is a #[contracttype] enum; in Soroban SDK v26 it serializes as
// ScVal::Vec([ScVal::Symbol(variant_name)]) for fieldless variants.
function enumVariant(name: string): xdr.ScVal {
  const variants = ["After", "Before"];
  if (!variants.includes(name)) throw new Error(`Unknown enum variant: ${name}`);
  return xdr.ScVal.scvVec([symbol(name)]);
}

function string(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "string" });
}

function symbol(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "symbol" });
}

function recipientsVec(
  recipients: Array<{ address: string; bps: number; amount: string }>,
): xdr.ScVal {
  return xdr.ScVal.scvVec(
    recipients.map((r) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: symbol("address"),
          val: addr(r.address),
        }),
        new xdr.ScMapEntry({ key: symbol("amount"), val: i128(r.amount) }),
        new xdr.ScMapEntry({ key: symbol("bps"), val: u32(r.bps) }),
      ]),
    ),
  );
}

function payrollRecipientsVec(recipients: Array<{ address: string; amount: string }>): xdr.ScVal {
  return xdr.ScVal.scvVec(
    recipients.map((r) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: symbol("address"),
          val: addr(r.address),
        }),
        new xdr.ScMapEntry({ key: symbol("amount"), val: i128(r.amount) }),
      ]),
    ),
  );
}

function workflowTargets(nodeIds: string[], addresses: Record<string, string>): xdr.ScVal {
  return xdr.ScVal.scvVec(
    nodeIds.map((id) => {
      const address = addresses[id];
      if (!address) throw new Error(`Missing computed address for node ${id}`);
      return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: symbol("address"), val: addr(address) }),
        new xdr.ScMapEntry({ key: symbol("data"), val: string("") }),
      ]);
    }),
  );
}

function amountPerIntervalStroops(params: { amountPerIntervalStroops: string }): xdr.ScVal {
  return i128(params.amountPerIntervalStroops);
}

function intervalSeconds(params: { intervalSeconds: number }): xdr.ScVal {
  return u64(params.intervalSeconds);
}

function amountStroops(params: { amountStroops: string }): xdr.ScVal {
  return i128(params.amountStroops);
}

function conditionKind(cond: { kind: string; [key: string]: unknown }): xdr.ScVal {
  switch (cond.kind) {
    case "time_after": {
      const ts = BigInt(Math.floor(new Date(cond.at as string).getTime() / 1000));
      return xdr.ScVal.scvVec([symbol("Timeout"), u64(ts)]);
    }
    case "time_before": {
      const ts = BigInt(Math.floor(new Date(cond.at as string).getTime() / 1000));
      return xdr.ScVal.scvVec([symbol("Timeout"), u64(ts)]);
    }
    case "oracle_gte": {
      const oracleConfig = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: symbol("oracle"),
          val: addr(cond.oracle as string),
        }),
        new xdr.ScMapEntry({
          key: symbol("key"),
          val: string(cond.key as string),
        }),
        new xdr.ScMapEntry({
          key: symbol("threshold"),
          val: i128(cond.threshold as string),
        }),
      ]);
      return xdr.ScVal.scvVec([symbol("OracleGte"), oracleConfig]);
    }
    case "amount_gt":
    case "amount_lt": {
      throw new Error(
        "amount_gt/amount_lt conditions are not supported in conditional constructor",
      );
    }
    default:
      return xdr.ScVal.scvVec([symbol("Multisig"), u32(1)]);
  }
}

/** Build constructor SCVals for a pipeline node. */
export function pipelineNodeConstructorArgs(
  params: PipelineNodeParams,
  admin: string,
  parentAddress: string | undefined,
  nodeAddresses: Record<string, string>,
): xdr.ScVal[] {
  switch (params.kind) {
    case "deposit_trigger": {
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
      ];
    }
    case "splitter": {
      if (!parentAddress) throw new Error("Splitter requires a parent address");
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        recipientsVec(params.recipients),
        i128(params.minAmountStroops),
        addr(parentAddress),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
      ];
    }
    case "streamer": {
      if (!parentAddress) throw new Error("Streamer requires a parent address");
      return [
        addr(admin),
        recipientsVec(params.recipients),
        addr(assetContractId(params.asset)),
        amountPerIntervalStroops(params),
        intervalSeconds(params),
        u64(params.startTs),
        u64(params.endTs),
        addr(parentAddress),
        bool(params.pauseAllowed),
        bool(params.retrieveAllowed),
      ];
    }
    case "conditional": {
      if (!parentAddress) throw new Error("Conditional requires a parent address");
      const cond = params.condition as { kind: string; [key: string]: unknown } | null;
      return [
        addr(admin),
        recipientsVec(params.recipients),
        addr(assetContractId(params.asset)),
        amountStroops(params),
        cond ? conditionKind(cond) : xdr.ScVal.scvVoid(),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
        addr(parentAddress),
      ];
    }
    case "router": {
      if (!parentAddress) throw new Error("Router requires a parent address");
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        i128(params.threshold),
        workflowTargets(params.pathANodeIds, nodeAddresses),
        workflowTargets(params.pathBNodeIds, nodeAddresses),
        addr(parentAddress),
      ];
    }
    case "timelock": {
      if (!parentAddress) throw new Error("Timelock requires a parent address");
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        u64(params.unlockTime),
        enumVariant(params.mode === "after" ? "After" : "Before"),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
        addr(parentAddress),
        addr(params.relayer ?? admin),
      ];
    }
    case "webhook_trigger": {
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        addr(params.relayer),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
      ];
    }
    case "subscription_trigger": {
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        addr(params.subscriber),
        i128(params.amountPerPeriodStroops),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
        addr(params.relayer && params.relayer.length > 0 ? params.relayer : admin),
        u64(params.startTs),
        u64(params.intervalSeconds),
        u64(params.endTs),
      ];
    }
    case "payroll_trigger": {
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        addr(params.employer),
        payrollRecipientsVec(params.recipients),
        addr(params.relayer && params.relayer.length > 0 ? params.relayer : admin),
        u64(params.startTs),
        u64(params.intervalSeconds),
        u64(params.endTs),
      ];
    }
    case "oracle_trigger": {
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        i128(params.threshold),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
      ];
    }
    case "multisig": {
      if (!parentAddress) throw new Error("Multisig requires a parent address");
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        recipientsVec(params.signers.map((s) => ({ ...s, amount: "0" }))),
        u32(params.threshold),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
        addr(parentAddress),
      ];
    }
    case "swapper": {
      if (!parentAddress) throw new Error("Swapper requires a parent address");
      return [
        addr(admin),
        addr(assetContractId(params.assetIn)),
        addr(assetContractId(params.assetOut)),
        u32(params.rateBps),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
        addr(parentAddress),
      ];
    }
    case "yield": {
      if (!parentAddress) throw new Error("Yield requires a parent address");
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        addr(params.vault),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
        addr(parentAddress),
      ];
    }
    case "payer": {
      if (!parentAddress) throw new Error("Payer requires a parent address");
      return [
        addr(admin),
        addr(assetContractId(params.asset)),
        addr(params.recipient),
        i128(params.amountStroops),
        u32(params.percentageBps ?? 0),
        workflowTargets(params.nextStepNodeIds, nodeAddresses),
        addr(parentAddress),
      ];
    }
  }
}

/** Encode a factory NodeBlueprint as an SCVal map. */
export function nodeBlueprint(
  wasmHashHex: string,
  salt: Buffer,
  constructorArgs: xdr.ScVal[],
): xdr.ScVal {
  const wasmHashBuf = Buffer.from(wasmHashHex, "hex");
  if (wasmHashBuf.length !== 32) {
    throw new Error("wasmHash must be 32 bytes");
  }
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: symbol("constructor_args"),
      val: xdr.ScVal.scvVec(constructorArgs),
    }),
    new xdr.ScMapEntry({ key: symbol("salt"), val: xdr.ScVal.scvBytes(salt) }),
    new xdr.ScMapEntry({ key: symbol("wasm_hash"), val: xdr.ScVal.scvBytes(wasmHashBuf) }),
  ]);
}

/** @deprecated Use {@link pipelineNodeConstructorArgs} for new code. */
export function constructorArgs(params: ContractParams, admin: string): xdr.ScVal[] {
  switch (params.kind) {
    case "splitter": {
      const args: xdr.ScVal[] = [
        addr(admin),
        addr(assetContractId(params.asset)),
        recipientsVec(params.recipients),
        i128(params.minAmountStroops ?? "0"),
      ];
      return args;
    }
    case "streamer": {
      return [
        addr(admin),
        recipientsVec(params.recipients),
        addr(assetContractId(params.asset)),
        amountPerIntervalStroops(params),
        intervalSeconds(params),
        u64(params.startTs),
        u64(params.endTs),
        addr(admin),
        bool(params.pauseAllowed ?? true),
        bool(params.retrieveAllowed ?? false),
      ];
    }
    case "conditional": {
      if (!params.condition) {
        return [
          addr(admin),
          recipientsVec(params.recipients),
          addr(assetContractId(params.asset)),
          amountStroops(params),
          xdr.ScVal.scvVoid(),
        ];
      }
      const c = params.condition as { kind: string; [key: string]: unknown };
      let cond: xdr.ScVal;
      switch (c.kind) {
        case "time_after": {
          const ts = BigInt(Math.floor(new Date(c.at as string).getTime() / 1000));
          cond = xdr.ScVal.scvVec([symbol("Timeout"), u64(ts)]);
          break;
        }
        case "time_before": {
          const ts = BigInt(Math.floor(new Date(c.at as string).getTime() / 1000));
          cond = xdr.ScVal.scvVec([symbol("Timeout"), u64(ts)]);
          break;
        }
        case "oracle_gte": {
          const oracleConfig = xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: symbol("oracle"),
              val: addr(c.oracle as string),
            }),
            new xdr.ScMapEntry({
              key: symbol("key"),
              val: string(c.key as string),
            }),
            new xdr.ScMapEntry({
              key: symbol("threshold"),
              val: i128(c.threshold as string),
            }),
          ]);
          cond = xdr.ScVal.scvVec([symbol("OracleGte"), oracleConfig]);
          break;
        }
        case "amount_gt":
        case "amount_lt": {
          throw new Error("amount_gt/amount_lt conditions are not yet supported");
        }
        default:
          cond = xdr.ScVal.scvVec([symbol("Multisig"), u32(1)]);
      }
      return [
        addr(admin),
        recipientsVec(params.recipients),
        addr(assetContractId(params.asset)),
        amountStroops(params),
        cond,
      ];
    }
  }
}
