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
// All supported Stellar assets (XLM, USDC) use 7 decimal places.
const STELLAR_DECIMALS = 7;

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
    const makeRequest = async () =>
      fetch(url, {
        ...init,
        headers: {
          ...(await this.authHeaders()),
          ...(init.headers ?? {}),
        },
      });

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
    const quantity = stroopsToDecimal(params.amountStroops, STELLAR_DECIMALS);
    const body = {
      side: "sell",
      quote_currency: params.assetCode,
      base_currency: params.fiatCurrency,
      currency: params.fiatCurrency,
      quantity,
    };

    const res = await this.fetchWithRetry(`${this.baseUrl()}/pdax-institution/v2/trade/quote`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`PDAX quote failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      quote_id: string;
      expires_at: string;
      quote_currency: string;
      base_currency: string;
      side: string;
      base_quantity: string;
      price: string;
      total_amount: string;
    };

    const amountIn = decimalToStroops(data.base_quantity, STELLAR_DECIMALS);
    const amountOut = decimalToSmallest(data.total_amount, 2);

    return {
      id: data.quote_id,
      amountIn,
      amountOut,
      fiatAmount: data.total_amount,
      fiatCurrency: data.base_currency,
      expiresAt: new Date(data.expires_at),
      metadata: {
        price: data.price,
        side: data.side,
        quoteCurrency: data.quote_currency,
      },
    };
  }

  async executeTrade(request: OffRampTradeRequest): Promise<OffRampTradeResult> {
    const body = {
      quote_id: request.quoteId,
      side: "sell",
      idempotency_id: crypto.randomUUID(),
    };

    const res = await this.fetchWithRetry(`${this.baseUrl()}/pdax-institution/v1/trade`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`PDAX trade failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      order_id: number;
      status: string;
      quote_currency: string;
      base_currency: string;
      side: string;
      base_quantity: string;
      price: string;
      total_amount: string;
      created_at: string;
      updated_at: string;
    };

    return {
      providerRef: data.order_id.toString(),
      status: normalizeOrderStatus(data.status),
      metadata: {
        baseQuantity: data.base_quantity,
        totalAmount: data.total_amount,
        price: data.price,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    };
  }

  async initiatePayout(request: OffRampPayoutRequest): Promise<OffRampPayoutResult> {
    const sender = request.sender;
    const isCashOut = request.jobSource === "CASH_OUT";
    const body = {
      identifier: request.payrollRunId ?? crypto.randomUUID(),
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
      fee_type: "SENDER",
      beneficiary_first_name: request.accountName.split(" ")[0] ?? request.accountName,
      beneficiary_middle_name: "n.a.",
      beneficiary_last_name: request.accountName.split(" ").slice(1).join(" ") || "n.a.",
      beneficiary_bank_code: request.bankCode,
      beneficiary_account_name: request.accountName,
      beneficiary_account_number: request.accountNumber,
      purpose: isCashOut ? "CASH_OUT" : "PAYROLL",
      relationship_of_sender_to_beneficiary: isCashOut ? "SELF" : "EMPLOYER",
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

    const data = (await res.json()) as {
      request_id: string;
      identifier: string;
      reference_number: string;
      amount: string;
      method: string;
      fee: string;
      status: string;
      retry_methods?: string;
    };

    return {
      providerRef: data.identifier,
      status: normalizeTransactionStatus(data.status),
      metadata: {
        requestId: data.request_id,
        referenceNumber: data.reference_number,
        amount: data.amount,
        method: data.method,
        fee: data.fee,
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

function stroopsToDecimal(stroops: string, decimals: number): string {
  const value = BigInt(stroops);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const str = abs.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, -decimals) || "0";
  const frac = str.slice(-decimals).replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

function decimalToStroops(decimal: string, decimals: number): string {
  const [whole = "0", frac = ""] = decimal.replace(/^-/, "").split(".");
  const padded = frac.slice(0, decimals).padEnd(decimals, "0");
  const sign = decimal.startsWith("-") ? "-" : "";
  return `${sign}${whole}${padded}`.replace(/^0+(?=\d)/, "");
}

function decimalToSmallest(decimal: string, decimals: number): string {
  return decimalToStroops(decimal, decimals);
}
