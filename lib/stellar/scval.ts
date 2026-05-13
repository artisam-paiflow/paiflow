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
      // For brevity: pass condition as a serialized JSON string via Symbol.
      // The on-chain contract decodes the variant. In production, encode as a proper enum.
      const cond = params.condition
        ? nativeToScVal(JSON.stringify(params.condition), { type: "string" })
        : xdr.ScVal.scvVoid();
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
