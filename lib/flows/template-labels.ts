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
  PAYER: "Payer",
  PAYROLL: "Payroll",
  PAYER_DEV: "Payer (dev)",
  SPLITTER_DEV: "Splitter (dev)",
  SUBSCRIPTION_DEV: "Subscription (dev)",
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
  PAYER: "Sends a fixed amount to a single recipient.",
  PAYROLL: "Pulls fixed salaries from an employer and distributes to employees on a schedule.",
  PAYER_DEV:
    "Mutable payer: recipient and amount can be left blank at deploy and set later via the API.",
  SPLITTER_DEV:
    "Mutable splitter: recipients can be left blank at deploy and set later via the API.",
  SUBSCRIPTION_DEV:
    "Mutable subscription: subscriber, amount and schedule can be set or changed via the API.",
};
