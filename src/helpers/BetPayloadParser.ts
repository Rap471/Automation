const BET_KEYS = ["bet", "betAmount", "bet_amount", "betSize", "bet_size", "wager", "stake", "totalBet", "total_bet"];

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function fromObject(source: Record<string, unknown>): number | undefined {
  for (const key of BET_KEYS) {
    if (key in source) {
      const value = asNumber(source[key]);
      if (value != null) return value;
    }
  }
  for (const nested of Object.values(source)) {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const found = fromObject(nested as Record<string, unknown>);
    if (found != null) return found;
  }
  return undefined;
}

export function parseRequestPayload(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function extractBetSize(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  return fromObject(payload as Record<string, unknown>);
}

export function readPayloadFlag(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as Record<string, unknown>)[key];
}

/** Amplify Bet dialog: the player wagers 25% more than the base bet sent in the request. */
export function requestIsAmplified(payload: unknown): boolean {
  if (readPayloadFlag(payload, "isEnhancedBet") !== true) return false;
  return !(Number(readPayloadFlag(payload, "buyFeat") ?? 0) > 0);
}

export function amplifiedWager(baseBet: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(baseBet * 1.25 * factor) / factor;
}
