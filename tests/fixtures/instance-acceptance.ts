import { createHash } from "node:crypto";
import {
  Address,
  Asset,
  Keypair,
  Networks,
  StrKey,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { bindTemplateVersion } from "@/lib/flow-templates/binder";
import { TemplateDefinitionSchema } from "@/lib/flow-templates/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { pipelineNodeConstructorArgs } from "@/lib/stellar/scval";

/** Public deterministic test identities and unsigned constructor values only. */
export const instanceWallet = (seed: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed));
export const instanceAdmin = instanceWallet(1).publicKey();
export const instanceSubscriber = instanceWallet(2).publicKey();
export const instanceAsset = Asset.native().contractId(Networks.TESTNET);
export const instanceEpoch = 2_051_222_400; // 2035-01-01T00:00:00Z; fixture compiler clock is fixed below.
export const instanceVersionId = "11671167-1167-4167-8167-116711671167";
export const instanceKinds = [
  "immediate",
  "schedule",
  "subscription",
  "time-condition",
  "multisig",
] as const;
export type InstanceAcceptanceKind = (typeof instanceKinds)[number];
const asset = { kind: "native" as const };
const pay = (id: string) => ({
  id,
  type: "pay",
  config: { asset, recipient: instanceWallet(3).publicKey(), fullAmount: true },
});
const edge = (source: string, target: string, branch?: "true" | "false") => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(branch ? { sourceHandle: branch } : {}),
});

export function instanceDefinition(kind: InstanceAcceptanceKind) {
  const root = { id: "root", type: "on_receive", config: { asset } };
  const recipient = {
    inputId: "recipient",
    label: "Recipient",
    type: "wallet",
    target: { nodeId: "pay", field: "recipient" },
  };
  if (kind === "schedule")
    return TemplateDefinitionSchema.parse({
      schemaVersion: 1,
      graph: {
        nodes: [
          {
            id: "root",
            type: "on_schedule",
            config: {
              startsAt: new Date(instanceEpoch * 1000).toISOString(),
              intervalAmount: 1,
              intervalUnit: "minute",
              occurrences: 3,
              pauseAllowed: true,
              retrieveAllowed: true,
            },
          },
          {
            id: "pay",
            type: "pay",
            config: {
              asset,
              recipient: instanceWallet(3).publicKey(),
              fullAmount: false,
              mode: "fixed",
              amountStroops: "100",
            },
          },
        ],
        edges: [edge("root", "pay")],
      },
      inputs: [
        recipient,
        {
          inputId: "start",
          label: "Starts at",
          type: "timestamp",
          target: { nodeId: "root", field: "startsAt" },
        },
      ],
    });
  if (kind === "subscription")
    return TemplateDefinitionSchema.parse({
      schemaVersion: 1,
      graph: {
        nodes: [
          {
            id: "root",
            type: "subscription",
            config: {
              asset,
              subscriber: instanceSubscriber,
              amountPerPeriodStroops: "100",
              intervalAmount: 1,
              intervalUnit: "minute",
              occurrences: 3,
            },
          },
          pay("pay"),
        ],
        edges: [edge("root", "pay")],
      },
      inputs: [recipient],
    });
  if (kind === "time-condition")
    return TemplateDefinitionSchema.parse({
      schemaVersion: 1,
      graph: {
        nodes: [
          root,
          {
            id: "condition",
            type: "condition",
            config: {
              kind: "time_after",
              at: new Date((instanceEpoch + 120) * 1000).toISOString(),
            },
          },
          pay("pay"),
          {
            ...pay("before"),
            config: { ...pay("before").config, recipient: instanceWallet(7).publicKey() },
          },
        ],
        edges: [
          edge("root", "condition"),
          edge("condition", "pay", "true"),
          edge("condition", "before", "false"),
        ],
      },
      inputs: [
        recipient,
        {
          inputId: "deadline",
          label: "Deadline",
          type: "timestamp",
          target: { nodeId: "condition", field: "at" },
        },
      ],
    });
  if (kind === "multisig")
    return TemplateDefinitionSchema.parse({
      schemaVersion: 1,
      graph: {
        nodes: [
          root,
          {
            id: "condition",
            type: "condition",
            config: {
              kind: "multisig",
              signers: [instanceWallet(5).publicKey(), instanceWallet(6).publicKey()],
              threshold: 2,
            },
          },
          pay("pay"),
        ],
        edges: [edge("root", "condition"), edge("condition", "pay")],
      },
      inputs: [recipient],
    });
  return TemplateDefinitionSchema.parse({
    schemaVersion: 1,
    graph: { nodes: [root, pay("pay")], edges: [edge("root", "pay")] },
    inputs: [recipient],
  });
}

export function instanceBindings(
  kind: InstanceAcceptanceKind,
  index: number,
  versionId = instanceVersionId,
) {
  return {
    version: 1 as const,
    templateVersionId: versionId,
    values: [
      {
        inputId: "recipient",
        value: { type: "wallet" as const, value: instanceWallet(10 + index).publicKey() },
      },
      ...(kind === "schedule"
        ? [
            {
              inputId: "start",
              value: {
                type: "timestamp" as const,
                value: new Date((instanceEpoch + index * 120) * 1000).toISOString(),
              },
            },
          ]
        : []),
      ...(kind === "time-condition"
        ? [
            {
              inputId: "deadline",
              value: {
                type: "timestamp" as const,
                value: new Date((instanceEpoch + 120 + index * 120) * 1000).toISOString(),
              },
            },
          ]
        : []),
    ],
  };
}

export function instanceConstructors(kind: InstanceAcceptanceKind, index: number) {
  const { graph } = bindTemplateVersion(
    instanceDefinition(kind),
    instanceVersionId,
    instanceBindings(kind, index),
  );
  const previous = Date.now;
  let pipeline;
  try {
    Date.now = () => instanceEpoch * 1000;
    pipeline = flowToPipeline(graph, instanceAdmin, { ownerAddress: instanceAdmin });
  } finally {
    Date.now = previous;
  }
  const addresses = Object.fromEntries(
    pipeline.map((n) => [
      n.nodeId,
      StrKey.encodeContract(
        createHash("sha256").update(`1167:${kind}:${index}:${n.nodeId}`).digest(),
      ),
    ]),
  );
  return pipeline.map((node) => {
    const parentId = graph.edges.find((e) => e.target === node.nodeId)?.source;
    const parent = (parentId ? addresses[parentId] : undefined) ?? instanceAdmin;
    return {
      ...node,
      address: addresses[node.nodeId]!,
      args: pipelineNodeConstructorArgs(node.params, instanceAdmin, parent, addresses),
    };
  });
}

/** Exactly the production binder/compiler/constructor encoder, not a second ABI. */
export function instancePacket(kind: InstanceAcceptanceKind) {
  const string = (s: string) => nativeToScVal(s, { type: "string" });
  return xdr.ScVal.scvVec([
    string(kind),
    new Address(instanceAsset).toScVal(),
    new Address(instanceAdmin).toScVal(),
    new Address(instanceSubscriber).toScVal(),
    xdr.ScVal.scvVec(
      [0, 1].map((index) =>
        xdr.ScVal.scvVec(
          instanceConstructors(kind, index).map((node) =>
            xdr.ScVal.scvVec([
              string(node.nodeId),
              new Address(node.address).toScVal(),
              string(node.templateKind),
              xdr.ScVal.scvVec(node.args),
            ]),
          ),
        ),
      ),
    ),
    xdr.ScVal.scvVec(
      [10, 11, 5, 6].map((seed) => new Address(instanceWallet(seed).publicKey()).toScVal()),
    ),
  ]).toXDR("hex");
}

/** Relocate only synthetic addresses to one actual preparation's salt-derived
 * addresses. Integer/enum/struct bytes remain untouched for the guest bridge. */
export function relocateInstanceValue(
  value: xdr.ScVal,
  addresses: ReadonlyMap<string, string>,
): xdr.ScVal {
  switch (value.switch().name) {
    case "scvAddress":
      return new Address(
        addresses.get(Address.fromScVal(value).toString()) ?? Address.fromScVal(value).toString(),
      ).toScVal();
    case "scvVec":
      return xdr.ScVal.scvVec(value.vec()!.map((item) => relocateInstanceValue(item, addresses)));
    case "scvMap":
      return xdr.ScVal.scvMap(
        value.map()!.map(
          (entry) =>
            new xdr.ScMapEntry({
              key: relocateInstanceValue(entry.key(), addresses),
              val: relocateInstanceValue(entry.val(), addresses),
            }),
        ),
      );
    default:
      return value;
  }
}
