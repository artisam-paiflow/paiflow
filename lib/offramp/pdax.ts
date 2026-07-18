import "server-only";
import crypto from "crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { getPdaxAuthHeaders, refreshPdaxAccessToken } from "./pdax-auth";
import {
  OffRampProvider,
  OffRampPayoutRequest,
  OffRampPayoutResult,
  OffRampQuote,
  OffRampTradeRequest,
  OffRampTradeResult,
  OffRampWebhookPayload,
  type PdaxSenderProfile,
} from "./provider";

const PDAX_API_TIMEOUT_MS = 30_000;
// Stellar stores every asset with 7 decimal places (stroops).
const STELLAR_DECIMALS = 7;
// PDAX's institutional wallets use each asset's native precision. USDC uses
// 6 decimals, so a quantity with 7 decimals violates PDAX's quantity step
// rule and returns OT010029 "Invalid Quantity Step".
const PDAX_XLM_DECIMALS = 7;
const PDAX_USDC_DECIMALS = 6;

export class PdaxOffRampProvider implements OffRampProvider {
  readonly name = "pdax";

  private baseUrl(): string {
    const url = env().OFFRAMP_API_URL ?? "https://api.pdax.ph";
    return url.replace(/\/$/, "");
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return getPdaxAuthHeaders();
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const makeRequest = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PDAX_API_TIMEOUT_MS);
      try {
        return await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            ...(await this.authHeaders()),
            ...(init.headers ?? {}),
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let res = await makeRequest();

    // Refresh token on 401 and retry once.
    if (res.status === 401) {
      log.info("PDAX request returned 401; attempting token refresh");
      const newToken = await refreshPdaxAccessToken();
      if (newToken) {
        res = await makeRequest();
      } else {
        throw new Error("PDAX access token expired and refresh failed");
      }
    }

    return res;
  }

  async quote(params: {
    amountStroops: string;
    assetCode: string;
    fiatCurrency: string;
  }): Promise<OffRampQuote> {
    const quantity = stellarStroopsToPdaxQuantity(params.amountStroops, params.assetCode);
    const body = {
      side: "sell",
      quote_currency: params.assetCode,
      base_currency: params.fiatCurrency,
      currency: params.assetCode,
      quantity,
    };

    const res = await this.fetchWithRetry(`${this.baseUrl()}/pdax-institution/v2/trade/quote`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`PDAX quote failed: ${res.status} ${await res.text()}`);
    }

    const payload = parsePdaxResponse(await res.json()) as {
      quote_id: string;
      expires_at: string;
      quote_currency: string;
      base_currency: string;
      side: string;
      base_quantity: string | number;
      price: string | number;
      total_amount: string | number;
    };

    const amountIn = pdaxQuantityToStellarStroops(payload.base_quantity, params.assetCode);
    const fiatAmount = toFixedDecimal(String(payload.total_amount), 2);
    const amountOut = decimalToSmallest(fiatAmount, 2);

    return {
      id: payload.quote_id,
      amountIn,
      amountOut,
      fiatAmount,
      fiatCurrency: payload.base_currency,
      expiresAt: new Date(payload.expires_at),
      metadata: {
        price: payload.price,
        side: payload.side,
        quoteCurrency: payload.quote_currency,
      },
    };
  }

  async executeTrade(request: OffRampTradeRequest): Promise<OffRampTradeResult> {
    const body = {
      quote_id: request.quoteId,
      side: "sell",
      idempotency_id: request.jobId,
    };
    console.log(
      "[PDAX executeTrade] idempotency_id:",
      request.jobId,
      "body:",
      JSON.stringify(body),
    );

    const res = await this.fetchWithRetry(`${this.baseUrl()}/pdax-institution/v1/trade`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`PDAX trade failed: ${res.status} ${await res.text()}`);
    }

    const payload = parsePdaxResponse(await res.json()) as {
      order_id: number;
      status: string;
      quote_currency: string;
      base_currency: string;
      side: string;
      base_quantity: string | number;
      price: string | number;
      total_amount: string | number;
      created_at: string;
      updated_at: string;
    };

    return {
      providerRef: payload.order_id.toString(),
      status: normalizeOrderStatus(payload.status),
      metadata: {
        baseQuantity: payload.base_quantity,
        totalAmount: payload.total_amount,
        price: payload.price,
        createdAt: payload.created_at,
        updatedAt: payload.updated_at,
      },
    };
  }

  async initiatePayout(request: OffRampPayoutRequest): Promise<OffRampPayoutResult> {
    const sender = request.sender;
    const isCashOut = request.jobSource === "CASH_OUT";
    const body = {
      identifier: request.jobId,
      sender_first_name: sender.firstName,
      sender_middle_name: sender.middleName || "n.a.",
      sender_last_name: sender.lastName,
      sender_country_origin: sender.countryOrigin,
      sender_address_line_one: sender.addressLineOne,
      sender_address_line_two: sender.addressLineTwo,
      sender_city: sender.city,
      sender_province: sender.province,
      sender_country: sender.country,
      sender_zip_code: sender.zipCode,
      sender_phone_number: sender.phoneNumber,
      sender_nationality: sender.nationality,
      sender_national_identity_number: sender.nationalIdentityNumber,
      sender_dob: sender.dob,
      sender_place_of_birth: sender.placeOfBirth,
      source_of_funds: sender.sourceOfFunds,
      sender_email: sender.email,
      fee_type: "Sender",
      beneficiary_first_name: request.accountName.split(" ")[0] ?? request.accountName,
      beneficiary_middle_name: "n.a.",
      beneficiary_last_name: request.accountName.split(" ").slice(1).join(" ") || "n.a.",
      beneficiary_bank_code: request.bankCode,
      beneficiary_account_name: request.accountName,
      beneficiary_account_number: request.accountNumber,
      purpose: isCashOut ? "Business Transaction" : "Business Expense/Employee Remittance",
      relationship_of_sender_to_beneficiary: isCashOut ? "Myself" : "Business",
      currency: request.fiatCurrency,
      amount: request.fiatAmount,
      method: "PAY-TO-ACCOUNT-REAL-TIME",
    };

    const res = await this.fetchWithRetry(`${this.baseUrl()}/pdax-institution/v1/fiat/withdraw`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`PDAX fiat withdraw failed: ${res.status} ${await res.text()}`);
    }

    const payload = parsePdaxResponse(await res.json()) as {
      request_id: string;
      identifier: string;
      reference_number: string;
      amount: string | number;
      method: string;
      fee: string | number;
      status: string;
      retry_methods?: string;
    };

    return {
      providerRef: payload.identifier,
      status: normalizeTransactionStatus(payload.status),
      metadata: {
        requestId: payload.request_id,
        referenceNumber: payload.reference_number,
        amount: payload.amount,
        method: payload.method,
        fee: payload.fee,
      },
    };
  }

  async validateWebhook(payload: unknown): Promise<OffRampWebhookPayload> {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid webhook payload");
    }
    const p = payload as Record<string, unknown>;

    const identifier = p.identifier;
    if (!identifier || typeof identifier !== "string") {
      throw new Error("Missing identifier in webhook payload");
    }

    const status = p.status;
    if (!status || typeof status !== "string") {
      throw new Error("Missing status in webhook payload");
    }

    return {
      providerRef: identifier,
      status: normalizeTransactionStatus(status),
      metadata: {
        requestId: p.request_id,
        referenceNumber: p.reference_number,
        transactionType: p.transaction_type,
        asset: p.asset,
        amount: p.amount,
        method: p.method,
        fee: p.fee,
      },
    };
  }
}

function normalizeOrderStatus(status: string): "PENDING" | "COMPLETED" | "FAILED" {
  const s = status.toUpperCase();
  if (s === "SUCCESSFUL") return "COMPLETED";
  if (s === "FAILED") return "FAILED";
  return "PENDING";
}

function normalizeTransactionStatus(status: string): "PENDING" | "COMPLETED" | "FAILED" {
  const s = status.toUpperCase();
  if (s === "COMPLETED") return "COMPLETED";
  if (s === "FAILED") return "FAILED";
  return "PENDING";
}

/**
 * PDAX Institution API wraps successful responses as `{ data: ..., status: "success" }`.
 * Some endpoints return the inner object directly in sandbox/UAT. Unwrap when present.
 */
function parsePdaxResponse<T>(json: unknown): T {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

export function getPdaxAssetDecimals(assetCode: string): number {
  if (assetCode === "USDC") return PDAX_USDC_DECIMALS;
  return PDAX_XLM_DECIMALS;
}

export function stellarStroopsToPdaxQuantity(stroops: string, assetCode: string): string {
  const assetDecimals = getPdaxAssetDecimals(assetCode);
  // Stellar stroops are always 7 decimals. Convert to the asset value first,
  // then truncate to the precision PDAX accepts for this asset so the quantity
  // step rule is never violated.
  const value = stroopsToDecimal(stroops, STELLAR_DECIMALS);
  if (assetDecimals === STELLAR_DECIMALS) return value;
  return truncateDecimal(value, assetDecimals);
}

function truncateDecimal(decimal: string, decimals: number): string {
  const [whole = "0", frac = ""] = decimal.replace(/^-/, "").split(".");
  const truncatedFrac = frac.slice(0, decimals).replace(/0+$/, "");
  const sign = decimal.startsWith("-") ? "-" : "";
  return truncatedFrac ? `${sign}${whole}.${truncatedFrac}` : `${sign}${whole}`;
}

export function toFixedDecimal(decimal: string, decimals: number): string {
  const sign = decimal.startsWith("-") ? "-" : "";
  const abs = decimal.replace(/^-/, "");
  const [whole = "0", frac = ""] = abs.split(".");
  const truncatedFrac = frac.slice(0, decimals).padEnd(decimals, "0");
  return `${sign}${whole}.${truncatedFrac}`;
}

export function pdaxQuantityToStellarStroops(quantity: string | number, assetCode: string): string {
  const assetDecimals = getPdaxAssetDecimals(assetCode);
  const decimalStr = typeof quantity === "number" ? quantity.toString() : quantity;
  // Parse the PDAX decimal as asset-smallest units.
  const [whole = "0", frac = ""] = decimalStr.replace(/^-/, "").split(".");
  const paddedFrac = frac.slice(0, assetDecimals).padEnd(assetDecimals, "0");
  const sign = decimalStr.startsWith("-") ? "-" : "";
  const assetSmallest = `${sign}${whole}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  // Scale from asset-smallest units to Stellar stroops (7 decimals).
  const factor = BigInt(10 ** (STELLAR_DECIMALS - assetDecimals));
  return (BigInt(assetSmallest) * factor).toString();
}

function stroopsToDecimal(stroops: string, decimals: number): string {
  const value = BigInt(stroops);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const str = abs.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, -decimals) || "0";
  const frac = str.slice(-decimals).replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

function decimalToStroops(decimal: string | number, decimals: number): string {
  const decimalStr = typeof decimal === "number" ? decimal.toString() : decimal;
  const [whole = "0", frac = ""] = decimalStr.replace(/^-/, "").split(".");
  const padded = frac.slice(0, decimals).padEnd(decimals, "0");
  const sign = decimalStr.startsWith("-") ? "-" : "";
  return `${sign}${whole}${padded}`.replace(/^0+(?=\d)/, "");
}

function decimalToSmallest(decimal: string | number, decimals: number): string {
  return decimalToStroops(decimal, decimals);
}
