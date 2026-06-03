import type { TemplateKind } from "@prisma/client";

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  SPLITTER: "Splitter",
  STREAMER: "Streamer",
  CONDITIONAL: "Conditional",
  DEPOSIT_TRIGGER: "Deposit Trigger",
  ROUTER: "Router",
  TIMELOCK: "Timelock",
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateKind, string> = {
  SPLITTER: "Distributes inbound funds by basis points across recipients.",
  STREAMER: "Pays a recipient continuously over a fixed period.",
  CONDITIONAL: "Releases funds when a condition is met.",
  DEPOSIT_TRIGGER: "Entry point that receives a user deposit and kicks off a chain.",
  ROUTER: "Routes funds to different paths based on a threshold amount.",
  TIMELOCK: "Holds funds until a specific timestamp is reached.",
};
