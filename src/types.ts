export type CheckStatus = "PASS" | "FAIL" | "SKIPPED" | "NOT APPLICABLE" | "BLOCKED" | "MANUAL";

export type GameOutcome = "PASS" | "FAIL" | "BLOCKED";

export interface GameInfo {
  gameName: string;
  gameId: string;
  index: number;
  locatorDescription: string;
}

export interface ControlPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface FrontendSnapshot {
  phase: "loading" | "preloader" | "playing" | "missing";
  idle: boolean;
  busy: boolean;
  bet?: number;
  betText?: string;
  balance?: number;
  balanceText?: string;
  balanceDisplay?: number;
  balanceSource?: string;
  winDisplay?: number;
  winDisplayText?: string;
  winSource?: string;
  buyAmount?: number;
  buyText?: string;
  freeSpins?: number;
  multiplier?: number;
  feature: string;
  symbols?: unknown;
  cachedTotalWin?: number;
  winTexts: string[];
  errorTexts: string[];
  texts: string[];
  displayedWins: number[];
  maxWinText?: string;
  currency?: string;
  currencyDecimals?: number;
  betLevels: number[];
  displayedBetLevels: number[];
  buyMultiplier?: number;
  flags: Record<string, boolean | number>;
  controls: Record<string, ControlPoint | null>;
  canvas: { cssWidth: number; cssHeight: number; gameWidth: number; gameHeight: number };
  spriteCount: number;
  domCount: number;
  orientationBlocked: boolean;
  hasBuy: boolean;
  hasAutoplay: boolean;
  hasTurbo: boolean;
  hasMenu: boolean;
  buyEnabled?: boolean;
  enhancedBet?: boolean;
  maxWinMultiplier?: number;
  skipConsumed?: boolean;
}

export interface SpinNetworkData {
  spinId: string;
  gameName: string;
  timestamp: string;
  requestPayload: unknown;
  responseBody: unknown;
  status: number;
  betSize?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  totalWin?: number;
  spinData?: unknown;
  requestPath?: string;
  responsePath?: string;
}

export interface FieldComparison {
  field: string;
  frontend: unknown;
  backend: unknown;
  result: "MATCH" | "MISMATCH" | "NOT COMPARED";
  difference?: string;
}

export interface SpinValidation {
  gameName: string;
  spinNumber: number;
  trigger: string;
  frontend: {
    bet?: number;
    balance?: number;
    totalWin?: number;
    symbols?: unknown;
    multiplier?: number;
    freeSpins?: number;
    feature?: string;
  };
  backend: {
    bet?: number;
    balance?: number;
    totalWin?: number;
    symbols?: unknown;
    multiplier?: number;
    freeSpins?: number;
    feature?: string;
  };
  comparisons: FieldComparison[];
  mismatches: Array<{ field: string; frontend: unknown; backend: unknown; difference?: string }>;
  passed: boolean;
  sampled: boolean;
  correlation: "PASS" | "FAIL" | "NOT SAMPLED";
  network?: SpinNetworkData;
  sawSpinning: boolean;
  returnedToIdle: boolean;
  duplicateRequests: number;
  notes: string[];
  screenshot?: string;
  failureScreenshot?: string;
  win: boolean;
}

export interface RegressionCheck {
  id: string;
  name: string;
  status: CheckStatus;
  details: string;
  spinNumber?: number;
  gameName?: string;
}

export interface CapturedError {
  gameName: string;
  timestamp: string;
  type: string;
  message: string;
  url?: string;
  spinNumber?: number;
}

export interface GameResult {
  gameName: string;
  gameId: string;
  index: number;
  launch: CheckStatus;
  result: GameOutcome;
  spinCount: number;
  winCount: number;
  checks: RegressionCheck[];
  spins: SpinValidation[];
  consoleErrors: CapturedError[];
  networkErrors: CapturedError[];
  feBeMismatches: number;
  notes: string[];
  critical: string[];
  reviewShot?: string;
}

export interface ReportModel {
  generatedAt: string;
  playerId: string;
  launcherUrl: string;
  config: Record<string, unknown>;
  discovered: GameInfo[];
  games: GameResult[];
  attempted: number;
  completed: number;
}
