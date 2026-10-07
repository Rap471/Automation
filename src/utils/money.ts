export function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.replace(/\s/g, "").match(/-?\d[\d,]*\.?\d*/);
  if (!match) return undefined;
  let token = match[0];
  if (token.includes(",") && token.includes(".")) token = token.replace(/,/g, "");
  else if (/,\d{1,2}$/.test(token)) token = token.replace(",", ".");
  else token = token.replace(/,/g, "");
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function moneyEqual(left?: number, right?: number, decimals = 2): boolean {
  if (left == null || right == null || Number.isNaN(left) || Number.isNaN(right)) return false;
  const factor = 10 ** decimals;
  return Math.round(left * factor) === Math.round(right * factor);
}

export function moneyDiff(left?: number, right?: number): string {
  if (left == null || right == null) return "";
  const diff = Math.round((left - right) * 100) / 100;
  return diff > 0 ? `+${diff}` : String(diff);
}

export function formatMoney(value?: number): string {
  if (value == null || Number.isNaN(value)) return "";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function hasTwoDecimalPlaces(text?: string): boolean {
  if (!text) return false;
  return /\d\.\d{2}\b/.test(text);
}
