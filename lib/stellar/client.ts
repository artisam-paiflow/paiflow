import "server-only";
import { rpc, Horizon } from "@stellar/stellar-sdk";
import { stellarHorizonUrl, stellarRpcUrl } from "@/lib/env";

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
