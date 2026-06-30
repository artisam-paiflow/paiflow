import "server-only";
import {
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  hash,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { sorobanRpc, horizon } from "./client";
import { stellarFactoryAddress, stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { ContractParams, PipelineNode, PipelineNodeParams } from "@/lib/flows/to-params";
import type { FlowGraph } from "@/lib/flows/schema";
import { constructorArgs, nodeBlueprint, pipelineNodeConstructorArgs } from "./scval";

// 2 XLM covers: 1 XLM base reserve + ~0.5 XLM Soroban storage entries + ~0.5 XLM tx fee buffer
const MIN_DEPLOYMENT_XLM_STROOPS = 20_000_000n;

export type PreparedDeploy = {
  xdr: string;
  contractAddress: string;
  salt: Buffer;
};

export async function checkAccountFunding(
  sourceAccount: string,
  minLumens: bigint = MIN_DEPLOYMENT_XLM_STROOPS,
): Promise<void> {
  let acct: Awaited<ReturnType<ReturnType<typeof horizon>["loadAccount"]>>;
  try {
    acct = await horizon().loadAccount(sourceAccount);
  } catch (e) {
    if (e instanceof Error && e.name === "NotFoundError") {
      throw new AppError(
        "INSUFFICIENT_FUNDS",
        `Account ${sourceAccount} is not funded. Send at least ${Number(minLumens) / 10_000_000} XLM to activate it first.`,
      );
    }
    throw e;
  }
  const native = acct.balances.find((b) => b.asset_type === "native");
  const [whole = "0", frac = ""] = (native?.balance ?? "0").split(".");
  const balance = BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7));
  if (balance < minLumens) {
    throw new AppError(
      "INSUFFICIENT_FUNDS",
      `Account has ${native?.balance ?? "0"} XLM. Minimum ${Number(minLumens) / 10_000_000} XLM required for deployment fees and rent.`,
    );
  }
}

/** Build & simulate a Soroban contract creation tx. Returns unsigned XDR. */
export async function prepareDeployTx(opts: {
  wasmHash: string; // hex
  sourceAccount: string; // G... user pubkey
  params: ContractParams;
}): Promise<PreparedDeploy> {
  const server = sorobanRpc();
  const sourceAcct = await server.getAccount(opts.sourceAccount);
  const wasmHashBuf = Buffer.from(opts.wasmHash, "hex");
  if (wasmHashBuf.length !== 32) {
    throw new AppError("VALIDATION", "wasmHash must be 32 bytes");
  }
  const salt = randomBytes(32);

  const args = constructorArgs(opts.params, opts.sourceAccount);

  const op = Operation.createCustomContract({
    address: new Address(opts.sourceAccount),
    wasmHash: wasmHashBuf,
    salt,
    constructorArgs: args,
  });

  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  // Pre-compute the contract address (deterministic from source + salt + network).
  const contractAddress = computeContractAddress(opts.sourceAccount, salt);

  return { xdr: assembled.toXDR(), contractAddress, salt };
}

export type PipelineDeployNode = {
  nodeId: string;
  templateKind: string;
  wasmHash: string;
  params: PipelineNodeParams;
};

export type PreparedPipelineDeploy = {
  xdr: string;
  pipeline: Array<{
    nodeId: string;
    contractAddress: string;
    salt: Buffer;
    templateKind: string;
  }>;
};

/** Build & simulate a pipeline deployment tx via the on-chain factory. */
export async function preparePipelineDeployTx(opts: {
  sourceAccount: string;
  graph: FlowGraph;
  nodes: PipelineDeployNode[];
}): Promise<PreparedPipelineDeploy> {
  const server = sorobanRpc();
  const factoryAddress = stellarFactoryAddress();
  if (!factoryAddress) {
    throw new AppError(
      "INTERNAL",
      "Pipeline factory address is not configured. Set STELLAR_FACTORY_ADDRESS_<NETWORK> in your environment.",
    );
  }

  const sourceAcct = await server.getAccount(opts.sourceAccount);

  // 1. Generate salts & compute deterministic addresses for every node.
  const pipeline = opts.nodes.map((n) => {
    const salt = randomBytes(32);
    const contractAddress = computeContractAddress(opts.sourceAccount, salt);
    return { ...n, salt, contractAddress };
  });

  const nodeAddresses: Record<string, string> = {};
  for (const p of pipeline) {
    nodeAddresses[p.nodeId] = p.contractAddress;
  }

  // 2. Determine parent relationships from the graph edges.
  const parentByNode = new Map<string, string>();
  for (const e of opts.graph.edges) {
    parentByNode.set(e.target, e.source);
  }

  // 3. Build NodeBlueprint SCVals for each node.
  const blueprintVals: xdr.ScVal[] = [];
  for (const p of pipeline) {
    const parentNodeId =
      parentByNode.get(p.nodeId) ??
      (p.params.kind === "cash_out_dev" || p.params.kind === "cash_out"
        ? p.params.parentNodeId
        : undefined);
    let parentAddress: string | undefined;
    if (parentNodeId && nodeAddresses[parentNodeId]) {
      parentAddress = nodeAddresses[parentNodeId];
    } else if (p.params.kind !== "deposit_trigger") {
      // Standalone contracts (e.g. streamer with on_schedule) use admin as parent.
      parentAddress = opts.sourceAccount;
    }

    // Inject the global relayer address into timelock nodes so the backend
    // cron can auto-release them. When no relayer is configured we fall back
    // to the admin (sourceAccount) which disables the relayer path.
    let params = p.params;
    if (params.kind === "timelock") {
      params = {
        ...params,
        relayer: stellarRelayerAddress() ?? opts.sourceAccount,
      };
    }

    const args = pipelineNodeConstructorArgs(
      params,
      opts.sourceAccount,
      parentAddress,
      nodeAddresses,
    );

    blueprintVals.push(nodeBlueprint(p.wasmHash, p.salt, args));
  }

  // 4. Build a single factory invocation.
  const op = Operation.invokeContractFunction({
    contract: factoryAddress,
    function: "deploy_pipeline",
    args: [new Address(opts.sourceAccount).toScVal(), xdr.ScVal.scvVec(blueprintVals)],
  });

  const tx = new TransactionBuilder(sourceAcct, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  // 5. Simulate the single-op transaction.
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new AppError("UPSTREAM_RPC", `Soroban simulate failed: ${sim.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();

  return {
    xdr: assembled.toXDR(),
    pipeline: pipeline.map((p) => ({
      nodeId: p.nodeId,
      contractAddress: p.contractAddress,
      salt: p.salt,
      templateKind: p.templateKind,
    })),
  };
}

function computeContractAddress(sourceAccount: string, salt: Buffer): string {
  // Per CAP-46, contract IDs from address+salt are SHA256(networkId || preimage).
  // For Pink Raft we read the address back from the tx result on submit; this helper
  // returns the user-facing salt-derived expected address using SDK utilities.
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(stellarPassphrase())),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: new Address(sourceAccount).toScAddress(),
          salt,
        }),
      ),
    }),
  );
  const idBytes = hash(preimage.toXDR());
  return Address.contract(idBytes).toString();
}

export type SubmitResult = {
  status: "SUCCESS" | "FAILED";
  txHash: string;
  contractAddress?: string;
  errorMessage?: string;
};

/** Submit a signed XDR, poll until finalized. */
export async function submitDeployTx(signedXdr: string): Promise<SubmitResult> {
  const server = sorobanRpc();
  const tx = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
  const send = await server.sendTransaction(tx);

  if (send.status === "ERROR") {
    return {
      status: "FAILED",
      txHash: send.hash,
      errorMessage: `sendTransaction error: ${JSON.stringify(send.errorResult?.result?.()) ?? send.status}`,
    };
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(send.hash);
    if (got.status === "SUCCESS") {
      const created = extractCreatedContract(got);
      return {
        status: "SUCCESS",
        txHash: send.hash,
        contractAddress: created ?? undefined,
      };
    }
    if (got.status === "FAILED") {
      return {
        status: "FAILED",
        txHash: send.hash,
        errorMessage: "Transaction failed on the network",
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "FAILED", txHash: send.hash, errorMessage: "Timed out waiting for finality" };
}

function extractCreatedContract(tx: rpc.Api.GetSuccessfulTransactionResponse): string | null {
  try {
    const retval = tx.returnValue;
    if (!retval) return null;
    if (retval.switch().name === "scvAddress") {
      return Address.fromScAddress(retval.address()).toString();
    }
    return null;
  } catch {
    return null;
  }
}
