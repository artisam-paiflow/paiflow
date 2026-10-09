import { createHash } from "node:crypto";
import { TRACKING_VERSION } from "./policy";
export function analyticsEventId(key: string): string {
  const hex = createHash("sha256").update(`${TRACKING_VERSION}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
