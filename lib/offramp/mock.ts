import {
  OffRampProvider,
  OffRampPayoutRequest,
  OffRampPayoutResult,
  OffRampQuote,
  OffRampTradeRequest,
  OffRampTradeResult,
  OffRampWebhookPayload,
} from "./provider";

export class MockOffRampProvider implements OffRampProvider {
  readonly name = "mock";

  async quote(params: {
    amountStroops: string;
    assetCode: string;
    fiatCurrency: string;
  }): Promise<OffRampQuote> {
    const amountIn = BigInt(params.amountStroops);
    // 1 USDC = 58 PHP, PHP in centavos.
    const amountOut = (amountIn * 58n) / 10_000_000n;
    // Display amount in PHP.
    const fiatAmount = formatDecimal(amountOut, 2);
    const id = `mock-quote-${Date.now()}`;
    return {
      id,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      fiatAmount,
      fiatCurrency: params.fiatCurrency,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      metadata: { rate: "58.00", assetCode: params.assetCode },
    };
  }

  async executeTrade(request: OffRampTradeRequest): Promise<OffRampTradeResult> {
    return {
      providerRef: `mock-trade-${request.payrollRunId}-${request.employeeId}`,
      status: "COMPLETED",
      metadata: { quoteId: request.quoteId, amountStroops: request.amountStroops },
    };
  }

  async initiatePayout(request: OffRampPayoutRequest): Promise<OffRampPayoutResult> {
    return {
      providerRef: `mock-withdraw-${request.payrollRunId}-${request.employeeId}`,
      status: "PENDING",
      metadata: {
        accountName: request.accountName,
        bankCode: request.bankCode,
        fiatAmount: request.fiatAmount,
        fiatCurrency: request.fiatCurrency,
      },
    };
  }

  async validateWebhook(payload: unknown): Promise<OffRampWebhookPayload> {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid webhook payload");
    }
    const p = payload as Record<string, unknown>;
    if (!p.providerRef || typeof p.providerRef !== "string") {
      throw new Error("Missing providerRef");
    }
    if (!p.status || typeof p.status !== "string") {
      throw new Error("Missing status");
    }
    if (!["PENDING", "COMPLETED", "FAILED"].includes(p.status)) {
      throw new Error(`Invalid status: ${p.status}`);
    }
    return {
      providerRef: p.providerRef,
      status: p.status as "PENDING" | "COMPLETED" | "FAILED",
      employeeId: typeof p.employeeId === "string" ? p.employeeId : undefined,
      payrollRunId: typeof p.payrollRunId === "string" ? p.payrollRunId : undefined,
      metadata:
        p.metadata && typeof p.metadata === "object"
          ? (p.metadata as Record<string, unknown>)
          : undefined,
    };
  }
}

function formatDecimal(value: bigint, decimals: number): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const str = abs.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, -decimals) || "0";
  const frac = str.slice(-decimals).replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}
