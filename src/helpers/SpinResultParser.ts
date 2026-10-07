function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export interface ParsedSpinResult {
  balance?: number;
  totalWin?: number;
  accumulatedWin?: number;
  transactionState?: string;
  symbols?: unknown;
  freeSpins?: number;
  multiplier?: number;
  feature: string;
  tumbles?: unknown;
  bonus?: unknown;
  scatter: boolean;
  maxWin: boolean;
  raw: unknown;
}

function featureOf(body: Record<string, unknown>, slot?: Record<string, unknown>): string {
  const freeSpin = asRecord(slot?.freeSpin);
  const items = freeSpin?.items;
  const fsCount = asNumber(body.fsCount) ?? 0;
  const bonus = asRecord(slot?.bonus);
  if ((Array.isArray(items) && items.length > 0) || fsCount > 0 || body.fsStatus) return "free-spins";
  if ((asNumber(bonus?.win) ?? 0) > 0) return "bonus";
  return "base";
}

export function parseSpinResponse(body: unknown): ParsedSpinResult {
  const root = asRecord(body) ?? {};
  const data = asRecord(root.data) ?? root;
  const slot = asRecord(data.slot) ?? asRecord(data.result) ?? asRecord(data.spin);
  const freeSpin = asRecord(slot?.freeSpin);
  const totalWin = asNumber(slot?.totalWin) ?? asNumber(data.totalWin) ?? asNumber(data.win) ?? asNumber(data.payout);
  const maxWinFlag = Boolean(data.maxWin || data.isMaxWin || slot?.maxWin || slot?.isMaxWin);
  return {
    balance: asNumber(data.balance) ?? asNumber(data.balanceAfter) ?? asNumber(slot?.balance),
    totalWin,
    accumulatedWin: asNumber(data.fsTotalAccumulatedWin) ?? asNumber(slot?.accumulatedWin),
    transactionState: typeof data.transactionState === "string" ? data.transactionState : typeof data.status === "string" ? data.status : undefined,
    symbols: slot?.area ?? slot?.reels ?? slot?.symbols ?? data.symbols,
    freeSpins: asNumber(data.fsCount) ?? asNumber(freeSpin?.count) ?? (Array.isArray(freeSpin?.items) ? freeSpin.items.length : undefined),
    multiplier: asNumber(freeSpin?.multiplierValue) ?? asNumber(slot?.multiplier) ?? asNumber(data.multiplier),
    feature: featureOf(data, slot),
    tumbles: slot?.tumbles,
    bonus: slot?.bonus,
    scatter: featureOf(data, slot) === "free-spins",
    maxWin: maxWinFlag,
    raw: body,
  };
}

export function sameSymbolGrid(frontend: unknown, backend: unknown): boolean {
  const variants = [
    backend,
    reverseOuter(backend),
    transposeGrid(backend),
    reverseOuter(transposeGrid(backend)),
    transposeGrid(reverseOuter(backend)),
  ];
  return variants.some((variant) => gridsEqual(frontend, variant));
}

function reverseOuter(value: unknown): unknown {
  const grid = normalizeGrid(value);
  return [...grid].reverse();
}

export function gridsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeGrid(left)) === JSON.stringify(normalizeGrid(right));
}

export function transposeGrid(value: unknown): unknown {
  const grid = normalizeGrid(value);
  if (!grid.length) return value;
  const width = Math.max(...grid.map((row) => row.length));
  const transposed: unknown[][] = [];
  for (let column = 0; column < width; column += 1) {
    transposed.push(grid.map((row) => row[column] ?? null));
  }
  return transposed;
}

function normalizeGrid(value: unknown): unknown[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : [normalizeCell(row)]));
}

function normalizeCell(value: unknown): unknown {
  if (value == null || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return record.symbol ?? record.symbolId ?? record.id ?? record.value ?? null;
  }
  return null;
}

export function hasTumbles(parsed: ParsedSpinResult): boolean {
  return Array.isArray(parsed.tumbles) && parsed.tumbles.length > 0;
}
