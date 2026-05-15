import "server-only";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { ContractParams } from "@/lib/flows/to-params";
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

export function constructorArgs(params: ContractParams, admin: string): xdr.ScVal[] {
  switch (params.kind) {
    case "splitter": {
      const recipientsVec = xdr.ScVal.scvVec(
        params.recipients.map((r) => xdr.ScVal.scvVec([addr(r.address), u32(r.bps)])),
      );
      return [addr(admin), addr(assetContractId(params.asset)), recipientsVec];
    }
    case "streamer": {
      return [
        addr(admin),
        addr(params.recipient),
        addr(assetContractId(params.asset)),
        i128(params.ratePerSecondStroops),
        u64(params.startTs),
        u64(params.endTs),
      ];
    }
    case "conditional": {
      if (!params.condition) {
        return [
          addr(admin),
          addr(params.recipient),
          addr(assetContractId(params.asset)),
          i128(params.amountStroops),
          xdr.ScVal.scvVoid(),
        ];
      }
      const c = params.condition as { kind: string; [key: string]: unknown };
      let cond: xdr.ScVal;
      switch (c.kind) {
        case "time_after":
        case "time_before": {
          const ts = BigInt(Math.floor(new Date(c.at as string).getTime() / 1000));
          cond = xdr.ScVal.scvVec([nativeToScVal("Timeout", { type: "symbol" }), u64(ts)]);
          break;
        }
        case "oracle_gte": {
          cond = xdr.ScVal.scvVec([
            nativeToScVal("OracleGte", { type: "symbol" }),
            nativeToScVal(c.oracle as string, { type: "string" }),
          ]);
          break;
        }
        case "amount_gt":
        case "amount_lt": {
          cond = xdr.ScVal.scvVec([
            nativeToScVal("Multisig", { type: "symbol" }),
            xdr.ScVal.scvU32(1),
          ]);
          break;
        }
        default:
          cond = xdr.ScVal.scvVec([
            nativeToScVal("Multisig", { type: "symbol" }),
            xdr.ScVal.scvU32(1),
          ]);
      }
      return [
        addr(admin),
        addr(params.recipient),
        addr(assetContractId(params.asset)),
        i128(params.amountStroops),
        cond,
      ];
    }
  }
}
