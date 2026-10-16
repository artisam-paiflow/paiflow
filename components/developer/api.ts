import type { z } from "zod";

type FieldErrors = Record<string, string[]>;
export class ManagementError extends Error {
  constructor(
    message: string,
    public fields: FieldErrors = {},
  ) {
    super(message);
  }
}

// Never echo arbitrary response bodies: the create response contains a live credential.
export async function managementRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = json && typeof json === "object" && "error" in json ? json.error : null;
    const fields: FieldErrors = {};
    if (
      error &&
      typeof error === "object" &&
      "fields" in error &&
      error.fields &&
      typeof error.fields === "object"
    ) {
      for (const [key, value] of Object.entries(error.fields)) {
        if (Array.isArray(value) && value.every((v) => typeof v === "string")) fields[key] = value;
      }
    }
    throw new ManagementError(
      error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Request failed. Try again.",
      fields,
    );
  }
  const data = json && typeof json === "object" && "data" in json ? json.data : undefined;
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ManagementError("Unexpected response. Reload and try again.");
  return parsed.data;
}

const buttonBase =
  "border-outline-variant/50 hover:border-primary focus-visible:ring-primary min-h-11 rounded border px-3 py-2 text-sm focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonClass = `${buttonBase} text-on-surface`;
export const primaryClass = `${buttonBase} bg-primary text-on-primary font-semibold`;
