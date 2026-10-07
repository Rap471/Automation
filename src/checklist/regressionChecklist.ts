import type { CheckStatus, RegressionCheck } from "../types";

export const CHECKLIST: Array<{ id: string; name: string }> = [
  { id: "launch", name: "Game launches successfully" },
  { id: "init-error", name: "Initialize error handling" },
  { id: "canvas", name: "Game canvas/UI appears" },
  { id: "not-stuck-loading", name: "Game is not stuck on loading" },
  { id: "spin-available", name: "Spin button available" },
  { id: "no-error-modal", name: "No unexpected error modal" },
  { id: "no-infinite-loading", name: "No infinite loading" },
  { id: "no-fatal-console", name: "No fatal console errors" },
  { id: "orientation", name: "Orientation usable" },
  { id: "idle-state", name: "Game reaches Idle" },
  { id: "spin-button", name: "Spin button clickable in Idle state" },
  { id: "spin-starts", name: "Spin starts correctly" },
  { id: "no-double-spin", name: "No double spin triggered on rapid click / space" },
  { id: "rapid-click", name: "Rapid click does not double spin" },
  { id: "rapid-space", name: "Rapid SPACE does not double spin" },
  { id: "space-spin", name: "SPACE starts a spin" },
  { id: "space-skip", name: "Skip function of space" },
  { id: "bet-deducted", name: "Bet deducted" },
  { id: "bet-deducted-immediate", name: "Bet deducted immediately upon spin" },
  { id: "reels-stop", name: "Reels stop correctly (no stuck reel)" },
  { id: "no-stuck-reel", name: "No stuck reel" },
  { id: "result-shown", name: "Result shown after reel stop" },
  { id: "return-idle", name: "Return to Idle" },
  { id: "balance-sync", name: "Balance updates correctly after win" },
  { id: "total-win-sync", name: "Total win displays correctly" },
  { id: "no-win", name: "No win scenario works correctly" },
  { id: "max-win-single", name: "Max win single spin implementation" },
  { id: "max-win-animation", name: "Max win single spin animation" },
  { id: "normal-multiplier", name: "Normal mode multiplier" },
  { id: "payout-guide", name: "Misleading payout guides on help screen" },
  { id: "currency", name: "Currency should be ZAR not R" },
  { id: "refund", name: "No refund handler" },
  { id: "multiple-sessions", name: "Can do multiple session in one account" },
  { id: "buy-restrictions", name: "Buy feature restrictions" },
  { id: "refresh-free-spins", name: "Spin continuation for the refreshed free spin" },
  { id: "scroll-orientation", name: "Scroll and page orientation" },
  { id: "controller", name: "Controller" },
  { id: "buy-balance", name: "After buy bonus balance match" },
  { id: "force-resolved-buy", name: "Buy feature force resolved" },
  { id: "bet-step", name: "Bet increase/decrease" },
  { id: "bet-increase", name: "Bet + increases correctly" },
  { id: "bet-decrease", name: "Bet – decreases correctly" },
  { id: "bet-min", name: "Bet cannot go below minimum" },
  { id: "bet-max", name: "Bet cannot exceed maximum" },
  { id: "bet-limits", name: "Minimum/maximum bet limits" },
  { id: "bet-lock", name: "Bet locked during spin/s" },
  { id: "backend-bet", name: "Bet value matches backend request" },
  { id: "currency-format", name: "Currency formatting correct (e.g., KRW, USD, TND)" },
  { id: "buy-recalc", name: "Buy amount recalculates when bet changes" },
  { id: "buy-amount", name: "Buy amount matches expected multiplier" },
  { id: "buy-disabled-spin", name: "Buy disabled during spin" },
  { id: "buy-insufficient", name: "Buy disabled if insufficient balance" },
  { id: "buy-amplified", name: "Buy disabled when amplified" },
  { id: "buy-deduction", name: "Buy deducts correct amount" },
  { id: "buy-trigger", name: "Buy triggers correct feature" },
  { id: "buy-win-idle", name: "In idle state during win dialogue for feature" },
  { id: "buy-max-win", name: "Max win animation for buy" },
  { id: "multi-session-buy", name: "Cannot buy feature within multiple session in one account" },
  { id: "autoplay-start", name: "Autoplay starts correctly" },
  { id: "autoplay-count", name: "Autoplay runs selected number of spins" },
  { id: "autoplay-stop", name: "Autoplay stops when manually stopped" },
  { id: "autoplay-balance", name: "Autoplay stops on insufficient balance" },
  { id: "autoplay-turbo", name: "Autoplay respects turbo mode" },
  { id: "autoplay-scatter", name: "Autoplay continues when scatter triggers" },
  { id: "autoplay-max-win", name: "Autoplay continues even when max win triggers" },
  { id: "autoplay-credit", name: "Autoplay credit the balance after scatter" },
  { id: "autoplay-disables", name: "Autoplay disables amplified, bet, and buy feature" },
  { id: "autoplay-retrigger", name: "Go back to Autoplay after retrigger" },
  { id: "no-buy-autoplay", name: "Cannot Buy during autoplay (if restricted)" },
  { id: "turbo-toggle", name: "Turbo toggle works" },
  { id: "turbo-speed", name: "Reel speed increases in Turbo" },
  { id: "turbo-persists", name: "Turbo persists during autoplay" },
  { id: "turbo-win", name: "Turbo does not break win dialogue animation logic" },
  { id: "free-spins-trigger", name: "Scatter triggers feature correctly" },
  { id: "free-spin-count", name: "Free spins count displayed correctly (Auto 0 if max win reach)" },
  { id: "free-spin-no-bet", name: "No bet deducted during free spins" },
  { id: "free-spin-wins", name: "Free-spin wins accumulate" },
  { id: "free-spin-multiplier", name: "Free-spin multiplier" },
  { id: "feature-exit", name: "Feature exit" },
  { id: "feature-reset", name: "Feature state reset" },
  { id: "feature-retrigger", name: "Feature retrigger" },
  { id: "refresh-consistency", name: "Refreshed session consistency" },
  { id: "max-win-text", name: "Has the max win text" },
  { id: "help-max-win", name: "Help screen and launch has same max win text" },
  { id: "bet-display", name: "Bet display matches internal value" },
  { id: "buy-display", name: "Buy display matches calculated value" },
  { id: "ui-backend-sync", name: "UI/backend synchronization" },
  { id: "win-animation", name: "No delayed or incorrect win animation" },
  { id: "animation-discrepancy", name: "Animation discrepancy" },
  { id: "win-line", name: "Animation for win line" },
  { id: "overlapping-ui", name: "No overlapping UI elements" },
  { id: "drop-speed", name: "Drop speeds" },
  { id: "history", name: "History record and backend" },
  { id: "history-decimals", name: "2 decimals for History & Balance" },
  { id: "audio", name: "Spin sound plays correctly" },
  { id: "win-sound", name: "Win sound plays correctly" },
  { id: "feature-sound", name: "Feature sound plays correctly" },
  { id: "sound-settings", name: "SFX toggle works" },
  { id: "bgm", name: "BG toggle works" },
  { id: "volume-slider", name: "BGm & Sound fx scroll bar" },
  { id: "menu-sound-persist", name: "Opening menu does NOT re-enable disabled sounds" },
  { id: "bg-other-tab", name: "BG music NOT must hear if you are in other tab" },
  { id: "sfx-other-tab", name: "SFX music NOT must hear if you are in other tab" },
  { id: "feature-intro-lock", name: "Cannot spin during feature intro animation" },
  { id: "state-management", name: "Game returns to Idle state after spin" },
  { id: "freeze", name: "No freeze after big win" },
  { id: "loading-state", name: "No infinite loading state" },
  { id: "italic-loading", name: "Font should not be italic on loading screen" },
  { id: "rapid-stress", name: "Rapid click stress test (Spin, Buy, Bet, Homescreen and expand)" },
  { id: "bonus-skip", name: "Click -- skip function bonus" },
  { id: "low-balance", name: "Low balance" },
  { id: "max-bet", name: "Max bet" },
  { id: "max-win-cap", name: "Max win cap logic works" },
  { id: "max-win-message", name: "Max win message" },
  { id: "network-delay", name: "Network delay handling" },
  { id: "refresh-recovery", name: "Refresh recovery" },
  { id: "console-errors", name: "Console errors" },
  { id: "help-screen", name: "Help screen" },
  { id: "object-pooling", name: "Object pooling" },
  { id: "currency-precision", name: "2 decimal for UI" },
  { id: "symbols-sync", name: "Symbol synchronization" },
  { id: "transaction-state", name: "Transaction state" },
  { id: "scatter-sync", name: "Scatter synchronization" },
  { id: "multiplier-sync", name: "Multiplier synchronization" },
];

const RANK: Record<CheckStatus, number> = {
  FAIL: 5,
  BLOCKED: 4,
  PASS: 3,
  SKIPPED: 2,
  MANUAL: 2,
  "NOT APPLICABLE": 1,
};

const NAMES = new Map(CHECKLIST.map((item) => [item.id, item.name]));

export class CheckBook {
  private readonly checks = new Map<string, RegressionCheck>();

  constructor(private readonly gameName: string) {}

  has(id: string): boolean {
    return this.checks.has(id);
  }

  set(id: string, status: CheckStatus, details: string, spinNumber?: number): void {
    const name = NAMES.get(id) ?? id;
    const previous = this.checks.get(id);
    if (previous && RANK[previous.status] > RANK[status]) return;
    this.checks.set(id, { id, name, status, details, spinNumber, gameName: this.gameName });
  }

  fillGaps(): void {
    for (const item of CHECKLIST) {
      if (!this.checks.has(item.id)) {
        this.set(item.id, "NOT APPLICABLE", "This condition was not present for this game.");
      }
    }
  }

  list(): RegressionCheck[] {
    this.fillGaps();
    return CHECKLIST.map((item) => this.checks.get(item.id)!);
  }

  counts(): { passed: number; failed: number; skipped: number; notApplicable: number; blocked: number } {
    const checks = this.list();
    return {
      passed: checks.filter((check) => check.status === "PASS").length,
      failed: checks.filter((check) => check.status === "FAIL").length,
      skipped: checks.filter((check) => check.status === "SKIPPED").length,
      notApplicable: checks.filter((check) => check.status === "NOT APPLICABLE").length,
      blocked: checks.filter((check) => check.status === "BLOCKED").length,
    };
  }
}
