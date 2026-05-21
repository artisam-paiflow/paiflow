import type { TemplateKind } from "@prisma/client";

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  SPLITTER: "Splitter",
  STREAMER: "Streamer",
  CONDITIONAL: "Conditional",
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateKind, string> = {
  SPLITTER: "Distributes inbound funds by basis points across recipients.",
  STREAMER: "Pays a recipient continuously over a fixed period.",
  CONDITIONAL: "Releases funds when a condition is met.",
};
