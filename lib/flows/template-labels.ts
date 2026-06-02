import type { TemplateKind } from "@prisma/client";

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  SPLITTER: "Splitter",
  STREAMER: "Streamer",
  CONDITIONAL: "Conditional",
  TRIGGER: "Trigger",
  ROUTER: "Router",
  TIMELOCK: "Timelock",
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateKind, string> = {
  SPLITTER: "Distributes inbound funds by basis points across recipients.",
  STREAMER: "Pays a recipient continuously over a fixed period.",
  CONDITIONAL: "Releases funds when a condition is met.",
  TRIGGER: "Entry point that receives external calls and kicks off a chain.",
  ROUTER: "Routes funds to different paths based on a threshold amount.",
  TIMELOCK: "Holds funds until a specific timestamp is reached.",
};
