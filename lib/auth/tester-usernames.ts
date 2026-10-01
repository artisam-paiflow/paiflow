export function testerUsernames(from: number, to: number, prefix = "tester", pad = 0): string[] {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from) {
    throw new Error(`Bad range: --from ${from} --to ${to}`);
  }
  if (!Number.isInteger(pad) || pad < 0 || pad > 32)
    throw new Error("--pad must be an integer from 0 to 32");
  const names = Array.from(
    { length: to - from + 1 },
    (_, i) => `${prefix}${String(from + i).padStart(pad, "0")}`,
  );
  for (const name of names) {
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(name))
      throw new Error(
        "Generated username must be 3–32 letters, digits, underscores, dots or hyphens",
      );
  }
  return names;
}
