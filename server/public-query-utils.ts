export function parsePositiveLimit(
  value: unknown,
  options: { defaultValue: number; maxValue: number },
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return options.defaultValue;
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return options.defaultValue;
  }

  return Math.min(parsed, options.maxValue);
}

export function normalizeQueryText(value: unknown, maxLength = 80): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    return undefined;
  }

  return normalized;
}
