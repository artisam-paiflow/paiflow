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

function recipientsVec(recipients: Array<{ address: string; bps: number }>): xdr.ScVal {
  return xdr.ScVal.scvVec(recipients.map((r) => xdr.ScVal.scvVec([addr(r.address), u32(r.bps)])));
}

function ratePerSecondStroops(params: { ratePerSecondStroops: string }): xdr.ScVal {
  return i128(params.ratePerSecondStroops);
}

function amountStroops(params: { amountStroops: string }): xdr.ScVal {
  return i128(params.amountStroops);
}

export function constructorArgs(params: ContractParams, admin: string): xdr.ScVal[] {
  switch (params.kind) {
    case "splitter": {
      const args: xdr.ScVal[] = [
        addr(admin),
        addr(assetContractId(params.asset)),
        recipientsVec(params.recipients),
      ];
      if (params.minAmountStroops) {
        args.push(i128(params.minAmountStroops));
      }
      return args;
    }
    case "streamer": {
      return [
        addr(admin),
        recipientsVec(params.recipients),
        addr(assetContractId(params.asset)),
        ratePerSecondStroops(params),
        u64(params.startTs),
        u64(params.endTs),
      ];
    }
    case "conditional": {
      const cond = params.condition
        ? nativeToScVal(JSON.stringify(params.condition), { type: "string" })
        : xdr.ScVal.scvVoid();
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
