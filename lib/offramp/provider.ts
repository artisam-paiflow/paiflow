import "server-only";
import { env } from "@/lib/env";
import { MockOffRampProvider } from "./mock";
import { PdaxOffRampProvider } from "./pdax";
import type { OffRampJobSource } from "@prisma/client";

export interface OffRampQuote {
  id: string;
  /** Crypto amount in the smallest unit (e.g. stroops). */
  amountIn: string;
  /** Fiat amount in the smallest unit (e.g. centavos). */
  amountOut: string;
  /** Fiat amount in display units (e.g. "58.00") as expected by the provider. */
  fiatAmount: string;
  fiatCurrency: string;
  expiresAt: Date;
  /** Provider-specific quote payload. */
  metadata?: Record<string, unknown>;
}

export interface OffRampTradeRequest {
  quoteId: string;
  amountStroops: string;
  employeeId?: string | null;
  payrollRunId?: string | null;
  jobSource: OffRampJobSource;
}

export interface OffRampTradeResult {
  /** External order/trade reference from the provider. */
  providerRef: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  /** Provider-specific response payload. */
  metadata?: Record<string, unknown>;
}

export interface OffRampPayoutRequest {
  tradeRef: string;
  amountStroops: string;
  /** Fiat amount in display units (e.g. "58.00"). */
  fiatAmount: string;
  fiatCurrency: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  employeeId?: string | null;
  payrollRunId?: string | null;
  sender: PdaxSenderProfile;
  jobSource: OffRampJobSource;
}

export interface PdaxSenderProfile {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  countryOrigin: string;
  addressLineOne?: string | null;
  addressLineTwo?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zipCode?: string | null;
  phoneNumber?: string | null;
  nationality?: string | null;
  nationalIdentityNumber?: string | null;
  dob?: string | null;
  placeOfBirth?: string | null;
  sourceOfFunds: string;
  email?: string | null;
}

export interface OffRampPayoutResult {
  /** External payout/withdrawal reference from the provider. */
  providerRef: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  /** Provider-specific response payload. */
  metadata?: Record<string, unknown>;
}

export interface OffRampWebhookPayload {
  /** Maps to our withdrawal/payout identifier. */
  providerRef: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  employeeId?: string;
  payrollRunId?: string;
  /** Provider-specific webhook payload. */
  metadata?: Record<string, unknown>;
}

export interface OffRampProvider {
  readonly name: string;
  quote(params: {
    amountStroops: string;
    assetCode: string;
    fiatCurrency: string;
  }): Promise<OffRampQuote>;
  executeTrade(request: OffRampTradeRequest): Promise<OffRampTradeResult>;
  initiatePayout(request: OffRampPayoutRequest): Promise<OffRampPayoutResult>;
  validateWebhook(payload: unknown, signature?: string): Promise<OffRampWebhookPayload>;
}

export function getOffRampProvider(): OffRampProvider {
  const provider = env().OFFRAMP_PROVIDER ?? "mock";
  switch (provider) {
    case "pdax":
      return new PdaxOffRampProvider();
    case "mock":
    default:
      return new MockOffRampProvider();
  }
}

export function offRampAssetCode(): string {
  return env().OFFRAMP_ASSET_CODE ?? "USDCXLM";
}

export function offRampFiatCurrency(): string {
  return "PHP";
}

export function offRampNetwork(): string {
  return env().OFFRAMP_NETWORK ?? "XLM_USDC_T_CEKS";
}

export function offRampChannel(): string {
  return env().OFFRAMP_CHANNEL ?? "InstaPay";
}
