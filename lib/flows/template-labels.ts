import type { TemplateKind } from "@prisma/client";

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  SPLITTER: "Splitter",
  STREAMER: "Streamer",
  CONDITIONAL: "Conditional",
  DEPOSIT_TRIGGER: "Deposit Trigger",
  ROUTER: "Router",
  TIMELOCK: "Timelock",
  FACTORY: "Factory",
  WEBHOOK: "Webhook",
  SUBSCRIPTION: "Subscription",
  ORACLE: "Oracle",
  MULTISIG: "Multisig",
  SWAPPER: "Swapper",
  YIELD: "Yield",
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateKind, string> = {
  SPLITTER: "Distributes inbound funds by basis points across recipients.",
  STREAMER: "Pays a recipient continuously over a fixed period.",
  CONDITIONAL: "Releases funds when a condition is met.",
  DEPOSIT_TRIGGER: "Entry point that receives a user deposit and kicks off a chain.",
  ROUTER: "Routes funds to different paths based on a threshold amount.",
  TIMELOCK: "Holds funds until a specific timestamp is reached.",
  FACTORY: "Deploys pipeline contracts on-chain.",
  WEBHOOK: "Relayer-authorized trigger for off-chain events.",
  SUBSCRIPTION: "Recurring billing puller using pre-authorized funds.",
  ORACLE: "Price-conditioned trigger that executes when a threshold is met.",
  MULTISIG: "N-of-M human approval gate before funds are released.",
  SWAPPER: "Fixed-rate token swap from asset_in to asset_out.",
  YIELD: "Deposits incoming funds into a vault or lending pool.",
};
