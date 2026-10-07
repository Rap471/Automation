import { moneyEqual } from "../utils/money";

export const balanceGame = process.env.BALANCE_GAME?.trim() || "Kobo Ass";
export const balancePlayer = process.env.BALANCE_PLAYER?.trim() || "automation-balance-kobo";

export const SCENARIO_NAMES = [
  "Balance before game start",
  "Buy Feature",
  "Buy Scratch",
  "Balance matches backend",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];
export type ScenarioStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT APPLICABLE" | "RUNNING" | "WARN";
export type MatchLabel = "MATCH" | "MISMATCH" | "UNREAD";

export interface Checkpoint {
  point: string;
  ui: number | null;
  backend: number | null;
  match: MatchLabel;
}

export interface ComparisonRow {
  flow: string;
  baseBet: number | null;
  bet: number | null;
  deduction: number | null;
  win: number | null;
  expected: number | null;
  backend: number | null;
  ui: number | null;
  match: MatchLabel;
}

export interface Evidence {
  classification: string;
  layer: "Frontend" | "Backend" | "Network/Transaction" | "Synchronization";
  balanceBefore: number | null;
  action: string;
  bet: number | null;
  deduction: number | null;
  win: number | null;
  expected: number | null;
  backend: number | null;
  ui: number | null;
  difference: number | null;
  transactionDifference: number | null;
  firstMismatch: string;
  api: string;
  request: string;
  response: string;
  screenshot: string;
  severity: "Critical" | "High" | "Medium";
  steps: string;
}

export interface Scenario {
  name: string;
  status: ScenarioStatus;
  details: string;
  classification: string;
  checkpoints: Checkpoint[];
  evidence?: Evidence;
  screenshot?: string;
}

export interface BoardCounters {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notApplicable: number;
  running: number;
  warned: number;
  balanceMismatches: number;
  temporaryUi: number;
  doubleDeductions: number;
  missingDeductions: number;
  duplicateWins: number;
  buyScratchIssues: number;
  bonusIssues: number;
  buyFeatureIssues: number;
  currencyIssues: number;
  raceIssues: number;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function same(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null || right == null || Number.isNaN(left) || Number.isNaN(right)) return false;
  return moneyEqual(left, right);
}

export function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "unread";
  return value.toFixed(2);
}

export function matchLabel(left: number | null | undefined, right: number | null | undefined): MatchLabel {
  if (left == null || right == null) return "UNREAD";
  return same(left, right) ? "MATCH" : "MISMATCH";
}

export function countersFor(scenarios: Scenario[]): BoardCounters {
  const countStatus = (status: ScenarioStatus) => scenarios.filter((item) => item.status === status).length;
  const failed = (item: Scenario) => item.status === "FAIL";
  const named = (pattern: RegExp) => (item: Scenario) => pattern.test(item.name);
  const side = (item: Scenario) => !/^Double deduction/.test(item.name) && !/Rapid|immediately|Space during|Click while bonus/.test(item.name);
  return {
    total: scenarios.length,
    passed: countStatus("PASS"),
    failed: countStatus("FAIL"),
    blocked: countStatus("BLOCKED"),
    notApplicable: countStatus("NOT APPLICABLE"),
    running: countStatus("RUNNING"),
    warned: countStatus("WARN"),
    balanceMismatches: scenarios.filter((item) => failed(item) && /BALANCE MISMATCH|INITIAL BALANCE/.test(item.classification)).length,
    temporaryUi: scenarios.filter((item) => /SYNCHRONIZATION DELAY/.test(item.classification)).length,
    doubleDeductions: scenarios.filter((item) => failed(item) && /^Double deduction/.test(item.name)).length,
    missingDeductions: scenarios.filter((item) => failed(item) && /MISSING DEDUCTION/.test(item.classification)).length,
    duplicateWins: scenarios.filter((item) => failed(item) && /DUPLICATE WIN/.test(item.classification)).length,
    buyScratchIssues: scenarios.filter((item) => failed(item) && side(item) && named(/Buy Scratch|Scratch reveal/)(item) && !/while Buy Feature/.test(item.name)).length
      + scenarios.filter((item) => failed(item) && item.name === "Buy Scratch while Buy Feature").length,
    bonusIssues: scenarios.filter((item) => failed(item) && item.name === "Spin to bonus").length,
    buyFeatureIssues: scenarios.filter((item) => failed(item) && item.name === "Buy Feature").length,
    currencyIssues: scenarios.filter((item) => failed(item) && item.name === "Currency").length,
    raceIssues: scenarios.filter((item) => failed(item) && named(/Rapid|immediately|Space during|Click while bonus/)(item)).length,
  };
}

export interface JudgeInput {
  action: string;
  beforeUi: number | null;
  beforeBackend: number | null;
  bet: number | null;
  win: number | null;
  afterUi: number | null;
  afterBackend: number | null;
  accepted: number;
  maxAccepted?: number;
  mode: "initial" | "settled" | "either" | "unchanged" | "count";
  checkpoints: Checkpoint[];
  api: string;
  request: string;
  response: string;
  steps: string;
}

export interface JudgeResult {
  status: ScenarioStatus;
  classification: string;
  details: string;
  evidence?: Evidence;
  expected: number | null;
  deduction: number | null;
  match: MatchLabel;
}

function candidates(before: number, bet: number, win: number, mode: JudgeInput["mode"]): number[] {
  const debit = round2(before - bet);
  const credited = round2(before - bet + win);
  if (mode === "unchanged" || mode === "initial") return [round2(before)];
  if (mode === "settled") return [credited];
  return [...new Set([debit, credited])];
}

function firstMismatch(checkpoints: Checkpoint[], finalMatch: MatchLabel): string {
  const found = checkpoints.find((point) => point.match === "MISMATCH");
  if (found) return found.point;
  if (finalMatch === "MISMATCH") return "Final UI state";
  return "None";
}

export function judge(input: JudgeInput): JudgeResult {
  const maxAccepted = input.maxAccepted ?? 1;
  const before = input.beforeBackend;
  const bet = input.bet ?? 0;
  const win = input.win ?? 0;
  const allowed = before == null || input.mode === "count" ? [] : candidates(before, bet, win, input.mode);
  const expected = input.mode === "count"
    ? input.afterBackend
    : allowed.find((value) => same(value, input.afterBackend)) ?? allowed[allowed.length - 1] ?? null;
  const spent = before != null && input.afterBackend != null ? round2(before - input.afterBackend) : null;
  const finalMatch = matchLabel(input.afterUi, input.afterBackend);
  const mismatchAt = firstMismatch(input.checkpoints, finalMatch);
  const recovered = finalMatch === "MATCH" && input.checkpoints.some((point) => point.match === "MISMATCH");

  const base: Omit<Evidence, "classification" | "layer" | "severity"> = {
    balanceBefore: before,
    action: input.action,
    bet: input.bet,
    deduction: spent,
    win: input.win,
    expected,
    backend: input.afterBackend,
    ui: input.afterUi,
    difference: input.afterUi != null && input.afterBackend != null ? round2(input.afterUi - input.afterBackend) : null,
    transactionDifference: expected != null && input.afterBackend != null ? round2(expected - input.afterBackend) : null,
    firstMismatch: mismatchAt,
    api: input.api || "none",
    request: input.request || "none",
    response: input.response || "none",
    screenshot: "",
    steps: input.steps,
  };

  const finish = (status: ScenarioStatus, classification: string, layer: Evidence["layer"], severity: Evidence["severity"], details: string): JudgeResult => ({
    status,
    classification,
    details,
    expected,
    deduction: spent,
    match: finalMatch,
    evidence: status === "PASS" ? undefined : { ...base, classification, layer, severity },
  });

  const line = `Before UI ${money(input.beforeUi)} / backend ${money(before)}. Bet ${money(input.bet)}, win ${money(input.win)}. Expected ${money(expected)}. Backend ${money(input.afterBackend)}. UI ${money(input.afterUi)}. Accepted transactions ${input.accepted}.`;

  if (input.mode === "initial") {
    if (input.beforeUi == null || before == null) {
      return finish("BLOCKED", "", "Frontend", "High", `Initial balance was unreadable. UI ${money(input.beforeUi)}, backend ${money(before)}.`);
    }
    if (!same(input.beforeUi, before)) {
      return finish("FAIL", "INITIAL BALANCE MISMATCH", "Frontend", "Critical", `UI ${money(input.beforeUi)} vs backend ${money(before)}. Difference ${money(round2(input.beforeUi - before))}.`);
    }
    return finish("PASS", "", "Frontend", "Medium", `UI ${money(input.beforeUi)} = backend ${money(before)}.`);
  }

  if (input.afterUi == null || input.afterBackend == null || (input.mode !== "count" && before == null)) {
    return finish("BLOCKED", "", "Network/Transaction", "High", `Balance was unreadable. ${line}`);
  }

  if (input.accepted > maxAccepted) {
    return finish("FAIL", "DUPLICATE TRANSACTION / DOUBLE DEDUCTION", "Network/Transaction", "Critical", `${input.accepted} accepted transactions from one action. Limit ${maxAccepted}. ${line}`);
  }

  if (input.mode !== "count" && input.mode !== "unchanged" && before != null && input.bet != null && input.bet > 0) {
    const twiceDebit = round2(before - input.bet * 2);
    const twiceCredit = round2(before - input.bet * 2 + win);
    const legit = new Set(allowed.map((value) => Math.round(value * 100)));
    const doubled = [twiceDebit, twiceCredit].some((value) => same(value, input.afterBackend) && !legit.has(Math.round(value * 100)));
    if (doubled) {
      return finish("FAIL", "DUPLICATE TRANSACTION / DOUBLE DEDUCTION", "Backend", "Critical", `Backend moved by two bets. ${line}`);
    }
    if (win > 0 && same(input.afterBackend, round2(before - input.bet + win * 2)) && !same(win * 2, win)) {
      return finish("FAIL", "DUPLICATE WIN", "Backend", "Critical", `Backend credited the win twice. ${line}`);
    }
  }

  if (input.mode === "unchanged" && !same(input.afterBackend, before)) {
    return finish("FAIL", "BACKEND BALANCE CALCULATION ERROR", "Backend", "Critical", `This action should leave the backend balance unchanged. ${line}`);
  }

  if (input.accepted === 0 && input.mode !== "unchanged" && input.mode !== "count" && same(input.afterBackend, before)) {
    return finish("BLOCKED", "", "Network/Transaction", "High", `No transaction was sent, so this action was not scored. ${line}`);
  }

  if (input.mode !== "count" && input.mode !== "unchanged" && expected != null && !allowed.some((value) => same(value, input.afterBackend))) {
    if (input.accepted === 0) {
      return finish("FAIL", "MISSING DEDUCTION", "Network/Transaction", "Critical", `The action was played and the backend balance did not change. ${line}`);
    }
    return finish("FAIL", "BACKEND BALANCE CALCULATION ERROR", "Backend", "Critical", `Backend ${money(input.afterBackend)} is not ${allowed.map((value) => money(value)).join(" or ")}. ${line}`);
  }

  if (input.mode !== "count" && input.accepted === 0 && input.bet != null && input.bet > 0 && same(input.afterBackend, before) && input.mode !== "unchanged") {
    return finish("BLOCKED", "", "Network/Transaction", "High", `No accepted transaction was captured. ${line}`);
  }

  if (!same(input.afterUi, input.afterBackend)) {
    const layer = expected != null && same(expected, input.afterBackend) ? "Frontend" : "Backend";
    return finish("FAIL", "BALANCE MISMATCH", layer, "Critical", `UI ${money(input.afterUi)} vs backend ${money(input.afterBackend)}. Difference ${money(round2((input.afterUi ?? 0) - (input.afterBackend ?? 0)))}. ${line}`);
  }

  if (recovered) {
    return {
      status: "WARN",
      classification: "BALANCE UI SYNCHRONIZATION DELAY",
      details: `Final UI matches backend. The UI differed at "${mismatchAt}" and then caught up. ${line}`,
      expected,
      deduction: spent,
      match: "MATCH",
      evidence: {
        ...base,
        classification: "BALANCE UI SYNCHRONIZATION DELAY",
        layer: "Synchronization",
        severity: "Medium",
        firstMismatch: mismatchAt,
      },
    };
  }

  return finish("PASS", "", "Frontend", "Medium", line);
}
