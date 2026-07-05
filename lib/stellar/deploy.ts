import "server-only";
import {
  Address,
  BASE_FEE,
  Keypair,
  NotFoundError,
  Operation,
  TransactionBuilder,
  hash,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { sorobanRpc, horizon, withRelayerLock } from "./client";
import {
  stellarFactoryAddress,
  stellarPassphrase,
  stellarRelayerAddress,
  stellarRelayerSecretKey,
} from "@/lib/env";
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
    if (e instanceof NotFoundError) {
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

type PipelinePlan = {
  nodes: Array<{
    nodeId: string;
    templateKind: string;
    wasmHash: string;
    params: PipelineNodeParams;
    salt: Buffer;
    contractAddress: string;
  }>;
  parentByNode: Map<string, string>;
  nodeAddresses: Record<string, string>;
};

function buildPipelinePlan(
  sourceAccount: string,
  graph: FlowGraph,
  nodes: PipelineDeployNode[],
): PipelinePlan {
  const pipeline = nodes.map((n) => {
    const salt = randomBytes(32);
    const contractAddress = computeContractAddress(sourceAccount, salt);
    return { ...n, salt, contractAddress };
  });

  const nodeAddresses: Record<string, string> = {};
  for (const p of pipeline) {
    nodeAddresses[p.nodeId] = p.contractAddress;
  }

  const parentByNode = new Map<string, string>();
  for (const e of graph.edges) {
    parentByNode.set(e.target, e.source);
  }

  return { nodes: pipeline, parentByNode, nodeAddresses };
}

async function preparePipelineDeployTxFromPlan(
  sourceAccount: string,
  plan: PipelinePlan,
): Promise<PreparedPipelineDeploy> {
  const server = sorobanRpc();
  const factoryAddress = stellarFactoryAddress();
  if (!factoryAddress) {
    throw new AppError(
      "INTERNAL",
      "Pipeline factory address is not configured. Set STELLAR_FACTORY_ADDRESS_<NETWORK> in your environment.",
    );
  }

  const sourceAcct = await server.getAccount(sourceAccount);

  const blueprintVals: xdr.ScVal[] = [];
  for (const p of plan.nodes) {
    const parentNodeId =
      plan.parentByNode.get(p.nodeId) ??
      (p.params.kind === "cash_out_dev" || p.params.kind === "cash_out"
        ? p.params.parentNodeId
        : undefined);
    let parentAddress: string | undefined;
    if (parentNodeId && plan.nodeAddresses[parentNodeId]) {
      parentAddress = plan.nodeAddresses[parentNodeId];
    } else if (p.params.kind !== "deposit_trigger") {
      // Standalone contracts (e.g. streamer with on_schedule) use admin as parent.
      parentAddress = sourceAccount;
    }

    // Inject the global relayer address into timelock nodes so the backend
    // cron can auto-release them. When no relayer is configured we fall back
    // to the admin (sourceAccount) which disables the relayer path.
    let params = p.params;
    if (params.kind === "timelock") {
      params = {
        ...params,
        relayer: stellarRelayerAddress() ?? sourceAccount,
      };
    }

    const args = pipelineNodeConstructorArgs(
      params,
      sourceAccount,
      parentAddress,
      plan.nodeAddresses,
    );

    blueprintVals.push(nodeBlueprint(p.wasmHash, p.salt, args));
  }

  const op = Operation.invokeContractFunction({
    contract: factoryAddress,
    function: "deploy_pipeline",
    args: [new Address(sourceAccount).toScVal(), xdr.ScVal.scvVec(blueprintVals)],
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

  return {
    xdr: assembled.toXDR(),
    pipeline: plan.nodes.map((p) => ({
      nodeId: p.nodeId,
      contractAddress: p.contractAddress,
      salt: p.salt,
      templateKind: p.templateKind,
    })),
  };
}

/** Build & simulate a pipeline deployment tx via the on-chain factory. */
export async function preparePipelineDeployTx(opts: {
  sourceAccount: string;
  graph: FlowGraph;
  nodes: PipelineDeployNode[];
}): Promise<PreparedPipelineDeploy> {
  const plan = buildPipelinePlan(opts.sourceAccount, opts.graph, opts.nodes);
  return preparePipelineDeployTxFromPlan(opts.sourceAccount, plan);
}

function computeContractAddress(sourceAccount: string, salt: Buffer): string {
  // Per CAP-46, contract IDs from address+salt are SHA256(networkId || preimage).
  // For Paiflow we read the address back from the tx result on submit; this helper
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

export type RelayerPipelineDeployResult = SubmitResult & {
  pipeline: PreparedPipelineDeploy["pipeline"];
};

/**
 * Deploy a pipeline where the RELAYER is the deployer/admin and the signer.
 *
 * The on-chain factory derives each contract address from `source + salt` and
 * calls `source.require_auth()`, so a fully machine-driven deploy (no user
 * wallet in the loop) must use the relayer as `source`. The relayer key signs
 * and submits the assembled tx; the returned contract addresses are therefore
 * derived from the relayer address, not the employer.
 */
export async function deployPipelineByRelayer(opts: {
  graph: FlowGraph;
  nodes: PipelineDeployNode[];
}): Promise<RelayerPipelineDeployResult> {
  const secret = stellarRelayerSecretKey();
  const relayerAddress = stellarRelayerAddress();
  if (!secret || !relayerAddress) {
    throw new AppError(
      "INTERNAL",
      "STELLAR_RELAYER_ADDRESS / STELLAR_RELAYER_SECRET_KEY must be configured",
    );
  }

  const relayerKeypair = Keypair.fromSecret(secret);
  if (relayerKeypair.publicKey() !== relayerAddress) {
    throw new AppError(
      "INTERNAL",
      "STELLAR_RELAYER_SECRET_KEY does not match STELLAR_RELAYER_ADDRESS",
    );
  }

  // Build the deterministic part of the pipeline (salts, contract addresses,
  // parent mapping) outside the global relayer lock so the queued closure does
  // not retain the request-scoped graph or the relayer keypair.
  const plan = buildPipelinePlan(relayerAddress, opts.graph, opts.nodes);

  // Serialize the relayer's sequence-number lifecycle (fetch → sign → submit)
  // against every other relayer-signing path (auto-charge crons, auto-release,
  // streamer jobs, webhook execute). Without this lock, two concurrent deploys
  // — or a deploy racing a cron — reuse the same sequence number and one gets
  // txBadSeq.
  return withRelayerLock(async () => {
    const prepared = await preparePipelineDeployTxFromPlan(relayerAddress, plan);

    const tx = TransactionBuilder.fromXDR(prepared.xdr, stellarPassphrase());
    tx.sign(Keypair.fromSecret(secret));

    const result = await submitDeployTx(tx.toXDR());
    return { ...result, pipeline: prepared.pipeline };
  });
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
