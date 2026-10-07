import { amplifiedWager, requestIsAmplified } from "./BetPayloadParser";
import { moneyDiff, moneyEqual } from "../utils/money";
import { hasTumbles, sameSymbolGrid, type ParsedSpinResult } from "./SpinResultParser";
import type { FieldComparison, FrontendSnapshot, SpinNetworkData, SpinValidation } from "../types";

export interface CompareInput {
  gameName: string;
  spinNumber: number;
  trigger: string;
  network: SpinNetworkData;
  parsed: ParsedSpinResult;
  frontend: FrontendSnapshot;
  peakWin?: number;
  hudWin?: number;
  sawSpinning: boolean;
  returnedToIdle: boolean;
  duplicateRequests: number;
  screenshot?: string;
  decimals?: number;
}

function amplifyBetRow(frontend: number | undefined, base: number | undefined, decimals: number): FieldComparison {
  if (base == null) return numericRow("bet", frontend, base, decimals);
  const wager = amplifiedWager(base, decimals);
  if (frontend == null) {
    return {
      field: "bet",
      frontend: null,
      backend: base,
      result: "NOT COMPARED",
      difference: "Manual test. Automation cannot read this value from the canvas.",
    };
  }
  const match = moneyEqual(frontend, wager, decimals);
  return {
    field: "bet",
    frontend,
    backend: base,
    result: match ? "MATCH" : "MISMATCH",
    difference: match
      ? `Amplify is on. UI bet ${frontend} is the backend bet ${base} plus 25%.`
      : `Amplify is on. UI bet ${frontend} should be backend bet ${base} plus 25% (${wager}).`,
  };
}

function numericRow(field: string, frontend?: number, backend?: number, decimals = 2): FieldComparison {
  if (frontend == null && backend == null) {
    return { field, frontend, backend, result: "NOT COMPARED" };
  }
  if (frontend == null || backend == null) {
    return {
      field,
      frontend: frontend ?? null,
      backend: backend ?? null,
      result: "NOT COMPARED",
      difference: "Manual test. Automation cannot read this value from the canvas.",
    };
  }
  const match = moneyEqual(frontend, backend, decimals);
  return {
    field,
    frontend,
    backend,
    result: match ? "MATCH" : "MISMATCH",
    difference: match ? "0" : moneyDiff(frontend, backend),
  };
}

export function compareSpin(input: CompareInput): SpinValidation {
  const decimals = input.decimals ?? input.frontend.currencyDecimals ?? 2;
  let displayedWin = input.hudWin != null
    ? input.hudWin
    : input.peakWin != null && input.peakWin > 0
      ? input.peakWin
      : undefined;
  if (
    displayedWin != null
    && input.parsed.multiplier != null
    && input.parsed.multiplier > 0
    && moneyEqual(displayedWin, input.parsed.multiplier, decimals)
    && (input.parsed.totalWin == null || !moneyEqual(displayedWin, input.parsed.totalWin, decimals))
  ) {
    displayedWin = undefined;
  }
  const winCandidate = displayedWin != null ? displayedWin : input.parsed.totalWin === 0 ? 0 : undefined;
  const amplified = requestIsAmplified(input.network.requestPayload);
  const comparisons: FieldComparison[] = [
    amplified ? amplifyBetRow(input.frontend.bet, input.network.betSize, decimals) : numericRow("bet", input.frontend.bet, input.network.betSize, decimals),
    numericRow("balance", input.frontend.balanceDisplay ?? input.frontend.balance, input.parsed.balance, decimals),
    numericRow("totalWin", winCandidate, input.parsed.totalWin, decimals),
  ];

  if (comparisons[2]?.result === "MISMATCH" && input.parsed.accumulatedWin != null && moneyEqual(winCandidate, input.parsed.accumulatedWin, decimals)) {
    comparisons[2] = {
      field: "totalWin",
      frontend: winCandidate,
      backend: input.parsed.totalWin,
      result: "MATCH",
      difference: "UI matches accumulated free-spin win",
    };
  }

  const backendSymbols = input.parsed.symbols;
  const frontendSymbols = input.frontend.symbols;
  if (backendSymbols == null && frontendSymbols == null) {
    comparisons.push({ field: "symbols", frontend: null, backend: null, result: "NOT COMPARED" });
  } else if (sameSymbolGrid(frontendSymbols, backendSymbols)) {
    comparisons.push({ field: "symbols", frontend: frontendSymbols, backend: backendSymbols, result: "MATCH" });
  } else if (hasTumbles(input.parsed)) {
    comparisons.push({
      field: "symbols",
      frontend: frontendSymbols,
      backend: backendSymbols,
      result: "NOT COMPARED",
      difference: "Backend area is the pre-tumble grid. Frontend grid is the resting grid after tumbles, and the response has no separate final grid.",
    });
  } else {
    comparisons.push({
      field: "symbols",
      frontend: frontendSymbols ?? null,
      backend: backendSymbols ?? null,
      result: "MISMATCH",
      difference: "grids differ",
    });
  }

  const backendMultiplier = input.parsed.multiplier;
  if (backendMultiplier == null || backendMultiplier === 0) {
    comparisons.push({ field: "multiplier", frontend: input.frontend.multiplier ?? null, backend: backendMultiplier ?? null, result: "NOT COMPARED" });
  } else {
    comparisons.push(numericRow("multiplier", input.frontend.multiplier, backendMultiplier, decimals));
  }

  const backendFreeSpins = input.parsed.freeSpins;
  if (!backendFreeSpins) {
    comparisons.push({ field: "freeSpins", frontend: input.frontend.freeSpins ?? null, backend: backendFreeSpins ?? 0, result: "NOT COMPARED" });
  } else {
    const match = input.frontend.freeSpins === backendFreeSpins;
    comparisons.push({
      field: "freeSpins",
      frontend: input.frontend.freeSpins ?? null,
      backend: backendFreeSpins,
      result: match ? "MATCH" : "MISMATCH",
      difference: match ? "0" : `${input.frontend.freeSpins ?? "missing"} vs ${backendFreeSpins}`,
    });
  }

  const sameFeature = (left?: string, right?: string): boolean => left === right || ((left === "scatter" || left === "free-spins") && (right === "scatter" || right === "free-spins"));
  if (input.parsed.feature === "base" && input.frontend.feature === "base") {
    comparisons.push({ field: "feature", frontend: "base", backend: "base", result: "NOT COMPARED" });
  } else {
    const match = sameFeature(input.frontend.feature, input.parsed.feature);
    comparisons.push({
      field: "feature",
      frontend: input.frontend.feature,
      backend: input.parsed.feature,
      result: match ? "MATCH" : "MISMATCH",
    });
  }

  const mismatches = comparisons
    .filter((row) => row.result === "MISMATCH")
    .map((row) => ({ field: row.field, frontend: row.frontend, backend: row.backend, difference: row.difference }));

  const transactionOk = input.network.status >= 200 && input.network.status < 300
    && (!input.parsed.transactionState || /complete|success|ok/i.test(input.parsed.transactionState));

  return {
    gameName: input.gameName,
    spinNumber: input.spinNumber,
    trigger: input.trigger,
    frontend: {
      bet: input.frontend.bet,
      balance: input.frontend.balanceDisplay ?? input.frontend.balance,
      totalWin: winCandidate,
      symbols: frontendSymbols,
      multiplier: input.frontend.multiplier,
      freeSpins: input.frontend.freeSpins,
      feature: input.frontend.feature,
    },
    backend: {
      bet: input.network.betSize,
      balance: input.parsed.balance,
      totalWin: input.parsed.totalWin,
      symbols: backendSymbols,
      multiplier: input.parsed.multiplier,
      freeSpins: input.parsed.freeSpins,
      feature: input.parsed.feature,
    },
    comparisons,
    mismatches,
    passed: mismatches.length === 0 && transactionOk && input.returnedToIdle,
    sampled: true,
    correlation: mismatches.length === 0 && transactionOk && input.returnedToIdle ? "PASS" : "FAIL",
    network: input.network,
    sawSpinning: input.sawSpinning,
    returnedToIdle: input.returnedToIdle,
    duplicateRequests: input.duplicateRequests,
    notes: transactionOk ? [] : [`Transaction state ${input.parsed.transactionState ?? "missing"} with HTTP ${input.network.status}`],
    screenshot: input.screenshot,
    win: (input.parsed.totalWin ?? 0) > 0,
  };
}
