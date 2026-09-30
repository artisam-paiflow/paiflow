/**
 * Format an ISO timestamp as human-readable text (e.g. "June 25, 2026 at
 * 1:25 PM") instead of leaking the raw string into the English preview. Date
 * and time are formatted separately and joined with "at" so the wording is
 * deterministic across ICU versions. Falls back to the raw string if the value
 * isn't a parseable date.
 */
export function formatScheduleStart(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tz = timeZone || "UTC";
  const date = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);
  return `${date} at ${time}`;
}

/** A deadline with its zone spelled out, since a date alone is ambiguous. */
export function formatDeadline(iso: string, timeZone?: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return iso;
  return `${formatScheduleStart(iso, timeZone)} (${timeZone || "UTC"})`;
}
