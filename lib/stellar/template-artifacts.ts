import "server-only";
import { Address, xdr } from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import type { TemplateArtifacts } from "@/lib/flow-templates/schema";
import { sorobanRpc } from "./client";
import { deploymentPreparationRead } from "./deployment-preparation";

/** One confirmed ledger proves the pinned factory executable and uploaded code.
 * Registry rows alone are never evidence that an artifact exists on this network. */
export async function assertTemplateArtifactAvailability(
  artifacts: TemplateArtifacts,
  deploymentId: string,
) {
  const hashes = [
    ...new Set([artifacts.factoryWasmHash, ...artifacts.nodes.map((node) => node.wasmHash)]),
  ];
  const instanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(artifacts.factoryAddress).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const keys = [
    instanceKey,
    ...hashes.map((hash) =>
      xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(hash, "hex") })),
    ),
  ];
  const result = await deploymentPreparationRead(
    "simulation",
    () => sorobanRpc().getLedgerEntries(...keys),
    deploymentId,
  );
  try {
    const entries = new Map(result.entries.map((entry) => [entry.key.toXDR("base64"), entry.val]));
    const executable = entries
      .get(instanceKey.toXDR("base64"))
      ?.contractData()
      .val()
      .instance()
      .executable();
    if (
      !executable ||
      executable.switch().name !== "contractExecutableWasm" ||
      executable.wasmHash().toString("hex") !== artifacts.factoryWasmHash
    )
      throw new Error("Factory mismatch");
    for (const [index, hash] of hashes.entries()) {
      const code = entries.get(keys[index + 1]!.toXDR("base64"));
      if (!code || code.contractCode().hash().toString("hex") !== hash)
        throw new Error("Missing code");
    }
  } catch {
    throw new AppError(
      "CONFLICT",
      "Pinned template factory or contract artifacts are unavailable on this network; publish a reviewed replacement version",
    );
  }
}
