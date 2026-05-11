import "server-only";
import { env } from "./env";
import { AppError } from "./errors";

function allowlist(): Set<string> {
  const raw = process.env.MAINNET_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function assertMainnetAllowed(opts: {
  network: "testnet" | "mainnet";
  userId: string;
  confirmation?: string;
}) {
  if (opts.network !== "mainnet") return;
  if (!env().ENABLE_MAINNET) {
    throw new AppError("FORBIDDEN", "Mainnet deploys are disabled on this instance");
  }
  const list = allowlist();
  if (list.size > 0 && !list.has(opts.userId)) {
    throw new AppError("FORBIDDEN", "This account is not allowlisted for mainnet");
  }
  if (opts.confirmation !== "I understand") {
    throw new AppError(
      "VALIDATION",
      'Mainnet writes require typing "I understand" in the confirm field',
    );
  }
}
