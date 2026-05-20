import "server-only";
import { rpc, Horizon, StrKey } from "@stellar/stellar-sdk";
import { stellarHorizonUrl, stellarRpcUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";

const g = globalThis as unknown as {
  __sorobanRpc?: rpc.Server;
  __horizon?: Horizon.Server;
};

export function sorobanRpc(): rpc.Server {
  if (!g.__sorobanRpc) {
    g.__sorobanRpc = new rpc.Server(stellarRpcUrl(), { allowHttp: false });
  }
  return g.__sorobanRpc;
}

export function horizon(): Horizon.Server {
  if (!g.__horizon) {
    g.__horizon = new Horizon.Server(stellarHorizonUrl(), { allowHttp: false });
  }
  return g.__horizon;
}

export function decodeContractAddress(addr: string): Buffer {
  if (StrKey.isValidContract(addr)) {
    return StrKey.decodeContract(addr);
  }
  const raw = Buffer.from(addr, "base64");
  if (raw.length === 32) {
    return raw;
  }
  throw new AppError("VALIDATION", `Invalid contract address: ${addr}`);
}
