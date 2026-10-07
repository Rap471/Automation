import type { Page } from "@playwright/test";
import { regressionConfig } from "../config/regression.config";
import { CheckBook } from "../checklist/regressionChecklist";
import { ConsoleMonitor } from "../helpers/ConsoleMonitor";
import { EvidenceCollector } from "../helpers/EvidenceCollector";
import { GameFrameHelper } from "../helpers/GameFrameHelper";
import { NetworkMonitor } from "../helpers/NetworkMonitor";
import { amplifiedWager, readPayloadFlag, requestIsAmplified } from "../helpers/BetPayloadParser";
import { compareSpin } from "../helpers/SpinComparator";
import { parseSpinResponse, type ParsedSpinResult } from "../helpers/SpinResultParser";
import { GameLauncherPage } from "../pages/GameLauncherPage";
import type { CheckStatus, FrontendSnapshot, GameInfo, GameResult, SpinNetworkData, SpinValidation } from "../types";
import { qaEmit } from "../live/qaEvents";
import { hasTwoDecimalPlaces, moneyEqual, parseMoney } from "../utils/money";

const CRITICAL_IDS = new Set([
  "balance-sync",
  "total-win-sync",
  "backend-bet",
  "bet-deducted",
  "no-stuck-reel",
  "no-double-spin",
  "rapid-click",
  "rapid-space",
  "freeze",
  "free-spin-count",
  "buy-balance",
  "buy-deduction",
  "max-win-cap",
  "transaction-state",
  "launch",
]);

function readUnresolvedSpinId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const root = body as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const value = data.unresolvedSpin ?? root.unresolvedSpin;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

interface SpinOptions {
  rapid?: number;
  fallbackInvoke?: boolean;
  sampleBetLock?: boolean;
  sampleBuyLock?: boolean;
  retried?: boolean;
}

export class GameSessionRunner {
  private spinNumber = 0;
  private normalDurationMs = 0;
  private laterSession = false;
  private launchMaxWinText: string | undefined;

  constructor(
    private readonly page: Page,
    private readonly launcher: GameLauncherPage,
    private readonly frame: GameFrameHelper,
    private readonly network: NetworkMonitor,
    private readonly consoleMonitor: ConsoleMonitor,
    private readonly evidence: EvidenceCollector,
  ) {}

  async run(game: GameInfo, laterSession: boolean): Promise<GameResult> {
    const book = new CheckBook(game.gameName);
    const spins: SpinValidation[] = [];
    const notes: string[] = [];
    this.spinNumber = 0;
    this.laterSession = laterSession;
    this.network.setGame(game.gameName);
    this.consoleMonitor.setContext(game.gameName);
    let launch: GameResult["launch"] = "BLOCKED";
    let baseline: { sprites: number; dom: number } | undefined;
    let sawSkip = false;
    let buyVisibleWhileBusy: boolean | undefined;

    qaEmit({ type: "GAME_STARTED", game: game.gameName, status: "RUNNING", message: "Game started" });
    try {
      await this.launcher.openGame(game);
      const state = await this.frame.waitForInteractive(regressionConfig.launchTimeoutMs);
      baseline = { sprites: state.spriteCount, dom: state.domCount };
      launch = this.recordLaunch(book, state, game.gameName);
      if (launch !== "PASS") {
        await this.evidence.capture(this.page, game.gameName, 0, "launch-failure", { state }).catch(() => undefined);
        return await this.finish(game, launch, "BLOCKED", book, spins, notes);
      }

      book.set("multiple-sessions", laterSession ? "PASS" : "NOT APPLICABLE", laterSession ? "This game launched after the previous game session was closed." : "Covered when a later game launches in the same player session.");
      book.set("refund", "NOT APPLICABLE", "Launcher scenario remains no-scenario, so refund retries are not part of this session.");
      book.set("low-balance", "NOT APPLICABLE", "The shared staging wallet is not drained to zero.");
      if (state.maxWinText) {
        this.launchMaxWinText = state.maxWinText;
        book.set("max-win-text", "PASS", state.maxWinText);
      } else book.set("max-win-text", "NOT APPLICABLE", "No max-win text was visible at initialization.");
      this.recordCurrency(book, state);
      book.set("controller", state.controls.spin ? "PASS" : "FAIL", `Spin ${state.controls.spin ? "visible" : "missing"}, autoplay ${state.hasAutoplay}, turbo ${state.hasTurbo}, menu ${state.hasMenu}, buy ${state.hasBuy}.`);
      this.recordStaticBetChecks(book, state);

      for (let index = 0; index < regressionConfig.normalSpins; index += 1) {
        const validation = await this.performSpins(game, book, "Spin button", async () => {
          const clicked = await this.frame.clickControl("spin");
          if (!clicked) await this.frame.invoke("spin");
        }, {
          fallbackInvoke: true,
          sampleBetLock: index === 0,
          sampleBuyLock: index === 0,
        });
        spins.push(...validation.spins);
        if (index === 0) this.normalDurationMs = validation.durationMs;
        if (validation.skipConsumed) sawSkip = true;
        if (validation.buyVisibleWhileBusy != null) buyVisibleWhileBusy = validation.buyVisibleWhileBusy;
      }

      for (let index = 0; index < regressionConfig.spaceSpins; index += 1) {
        const validation = await this.performSpins(game, book, "SPACE", () => this.frame.pressSpace(1), { fallbackInvoke: true });
        spins.push(...validation.spins);
      }

      const rapidClick = await this.performSpins(game, book, "Rapid click", async () => {
        await this.frame.clickControl("spin");
      }, { rapid: regressionConfig.rapidSpinAttempts });
      spins.push(...rapidClick.spins);
      const rapidSpace = await this.performSpins(game, book, "Rapid SPACE", () => this.frame.pressSpace(1), { rapid: 3 });
      spins.push(...rapidSpace.spins);
      book.set("rapid-click", rapidClick.requests === 1 ? "PASS" : "FAIL", `${rapidClick.requests} bet request(s) after ${regressionConfig.rapidSpinAttempts} clicks.`, spins.at(-1)?.spinNumber);
      book.set("rapid-space", rapidSpace.requests === 1 ? "PASS" : "FAIL", `${rapidSpace.requests} bet request(s) after Space Space Space.`, spins.at(-1)?.spinNumber);
      const doubled = rapidClick.requests > 1 || rapidSpace.requests > 1;
      book.set("no-double-spin", doubled ? "FAIL" : "PASS", `Rapid click requests ${rapidClick.requests}. Rapid space requests ${rapidSpace.requests}.`);
      book.set("rapid-stress", doubled ? "FAIL" : "PASS", "Rapid Spin clicks and rapid Space presses were applied. Bet clicks during a spin are covered by the bet-lock check.");

      book.set("space-skip", sawSkip ? "PASS" : "NOT APPLICABLE", sawSkip ? "The game consumed a manual skip during a spin." : "No skippable win state reported skip consumption.");
      book.set("bonus-skip", sawSkip ? "PASS" : "NOT APPLICABLE", sawSkip ? "Space consumed a bonus skip." : "No bonus dialogue reported a skip.");
      if (buyVisibleWhileBusy != null) {
        book.set("buy-disabled-spin", buyVisibleWhileBusy ? "FAIL" : "PASS", buyVisibleWhileBusy ? "Buy control stayed enabled while the reels were busy." : "Buy control was not enabled while the reels were busy.");
      }

      await this.optionalFeatures(game, book, spins);
      await this.recordHistory(book);
      if (baseline) await this.recordPooling(book, baseline.sprites, baseline.dom);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(message);
      if (launch === "PASS") book.set("freeze", "FAIL", message);
      else book.set("launch", "BLOCKED", message);
      await this.evidence.capture(this.page, game.gameName, this.spinNumber, "failure", { message }).catch(() => undefined);
    }

    if (launch === "PASS") this.summarizeSpins(book, spins, game.gameName);

    const outcome: GameResult["result"] = book.list().some((check) => check.status === "FAIL") || spins.some((spin) => spin.sampled && !spin.passed)
      ? "FAIL"
      : launch === "PASS" ? "PASS" : "BLOCKED";
    return await this.finish(game, launch, outcome, book, spins, notes);
  }

  private recordLaunch(book: CheckBook, state: FrontendSnapshot, gameName: string): GameResult["launch"] {
    const canvasOk = state.canvas.cssWidth > 40 && state.canvas.cssHeight > 40;
    const playing = state.phase === "playing" && state.bet != null;
    book.set("canvas", canvasOk ? "PASS" : "FAIL", canvasOk ? `Canvas ${Math.round(state.canvas.cssWidth)}x${Math.round(state.canvas.cssHeight)}.` : "Canvas did not render.");
    book.set("orientation", state.orientationBlocked ? "FAIL" : "PASS", state.orientationBlocked ? "Orientation gate covers the game." : "Game canvas is usable in the current viewport.");
    book.set("scroll-orientation", canvasOk && !state.orientationBlocked ? "PASS" : "FAIL", "Checked canvas size and orientation gate.");
    book.set("loading-state", state.phase === "loading" || state.phase === "preloader" ? "FAIL" : "PASS", `Phase is ${state.phase}.`);
    book.set("not-stuck-loading", playing ? "PASS" : "FAIL", playing ? "Game left the loading/preloader state." : `Still in ${state.phase}.`);
    book.set("no-infinite-loading", playing ? "PASS" : "FAIL", playing ? "Initialization finished." : "Initialization did not finish before the timeout.");
    book.set("no-error-modal", state.errorTexts.length ? "FAIL" : "PASS", state.errorTexts.join(" | ") || "No error text was visible.");
    book.set("init-error", state.errorTexts.length ? "FAIL" : "PASS", state.errorTexts.join(" | ") || "No initialization error text.");
    book.set("spin-available", state.controls.spin?.visible ? "PASS" : "FAIL", state.controls.spin?.visible ? "Spin hit zone is visible." : "Spin hit zone was not visible.");
    book.set("idle-state", state.idle ? "PASS" : "BLOCKED", state.idle ? "Game reported Idle." : "Game did not report Idle before the first spin.");
    if (!playing || !state.controls.spin?.visible) {
      const pageError = this.consoleMonitor.forGame(gameName).consoleErrors.find((error) => /page error/i.test(error.type));
      const reason = pageError ? `${pageError.message}. Phase ${state.phase}.` : `Phase ${state.phase}. Spin control ${state.controls.spin?.visible ? "visible" : "missing"}.`;
      book.set("launch", "BLOCKED", reason.trim());
      return "BLOCKED";
    }
    book.set("launch", "PASS", "Game reached an interactive Idle state.");
    return "PASS";
  }

  private recordStaticBetChecks(book: CheckBook, state: FrontendSnapshot): void {
    if (state.betLevels.length) {
      const min = Math.min(...state.betLevels);
      const max = Math.max(...state.betLevels);
      const shownMin = state.displayedBetLevels.includes(min);
      const shownMax = state.displayedBetLevels.includes(max);
      book.set("bet-limits", shownMin && shownMax ? "PASS" : "NOT APPLICABLE", shownMin && shownMax ? `Displayed bet ladder includes min ${min} and max ${max}.` : `Backend ladder is ${min} to ${max}. The open UI did not expose every level.`);
    }
    if (!state.hasBuy) {
      for (const id of ["buy-restrictions", "buy-balance", "force-resolved-buy", "buy-amount", "buy-disabled-spin", "buy-deduction", "buy-trigger", "buy-max-win"]) {
        book.set(id, "NOT APPLICABLE", "This game did not expose a Buy Feature control.");
      }
    } else if (state.buyAmount != null && state.bet != null && state.buyMultiplier) {
      const expected = Math.round(state.bet * state.buyMultiplier * 100) / 100;
      book.set("buy-amount", moneyEqual(state.buyAmount, expected) ? "PASS" : "FAIL", `UI buy ${state.buyAmount} vs bet ${state.bet} x ${state.buyMultiplier} = ${expected}.`);
    }
    if (!regressionConfig.enableBuyPurchase) {
      book.set("buy-deduction", "SKIPPED", "Buy purchase is disabled for this run (REGRESSION_BUY_PURCHASE).");
      book.set("buy-trigger", "SKIPPED", "Buy purchase is disabled for this run (REGRESSION_BUY_PURCHASE).");
      book.set("buy-balance", "SKIPPED", "Buy purchase is disabled for this run (REGRESSION_BUY_PURCHASE).");
      book.set("buy-max-win", "SKIPPED", "Buy purchase is disabled for this run (REGRESSION_BUY_PURCHASE).");
      book.set("force-resolved-buy", "SKIPPED", "Buy purchase is disabled for this run (REGRESSION_BUY_PURCHASE).");
    }
    if (!state.hasAutoplay || !regressionConfig.enableAutoplay) {
      const status = state.hasAutoplay ? "SKIPPED" : "NOT APPLICABLE";
      const details = state.hasAutoplay ? "Autoplay is disabled for this run (REGRESSION_AUTOPLAY)." : "This game did not expose Autoplay.";
      for (const id of ["autoplay-start", "autoplay-count", "autoplay-stop", "autoplay-balance", "autoplay-turbo", "autoplay-scatter", "autoplay-max-win"]) book.set(id, status, details);
    }
    if (!state.hasTurbo || !regressionConfig.enableTurbo) {
      const status = state.hasTurbo ? "SKIPPED" : "NOT APPLICABLE";
      const details = state.hasTurbo ? "Turbo is disabled for this run (REGRESSION_TURBO)." : "This game did not expose Turbo.";
      for (const id of ["turbo-toggle", "turbo-speed", "turbo-win"]) book.set(id, status, details);
    }
    if (!regressionConfig.enableRefresh) {
      book.set("refresh-recovery", "SKIPPED", "Refresh recovery is disabled for this run (REGRESSION_REFRESH).");
      book.set("refresh-consistency", "SKIPPED", "Refresh recovery is disabled for this run (REGRESSION_REFRESH).");
      book.set("refresh-free-spins", "SKIPPED", "Refresh recovery is disabled for this run (REGRESSION_REFRESH).");
    }
    if (!regressionConfig.enableNetworkDelay) book.set("network-delay", "SKIPPED", "Network delay is disabled for this run (REGRESSION_DELAY).");
    if (!regressionConfig.enableMenu) {
      for (const id of ["help-screen", "payout-guide", "audio", "sound-settings", "bgm"]) book.set(id, "SKIPPED", "Menu checks are disabled for this run (REGRESSION_MENU).");
    }
    if (!regressionConfig.enableMaxBetSelection) book.set("max-bet", "SKIPPED", "Max-bet selection is disabled for this run (REGRESSION_MAX_BET).");
  }

  private lastReelSkipAt = 0;

  private async skipReelAnimation(state: FrontendSnapshot, force = false): Promise<void> {
    if (state.canvas.gameWidth <= 0 || state.canvas.gameHeight <= 0) return;
    if (!force && !state.busy) return;
    if (Date.now() - this.lastReelSkipAt < 1_000) return;
    this.lastReelSkipAt = Date.now();
    await this.frame.clickGamePoint(state.canvas.gameWidth / 2, state.canvas.gameHeight * 0.38, state).catch(() => undefined);
  }

  private async performSpins(game: GameInfo, book: CheckBook, triggerName: string, trigger: () => Promise<unknown>, options: SpinOptions = {}): Promise<{ spins: SpinValidation[]; requests: number; durationMs: number; skipConsumed: boolean; buyVisibleWhileBusy?: boolean }> {
    const before = await this.frame.readState();
    const start = this.network.count();
    const started = Date.now();
    const timeout = regressionConfig.spinTimeoutMs;
    let sawSpinning = false;
    let skipConsumed = false;
    let buyVisibleWhileBusy: boolean | undefined;
    let fallbackUsed = false;
    const baseSpin = this.spinNumber;
    const peaks = new Map<number, number>();
    const screenshots = new Map<number, string>();
    const saved = new Set<number>();
    const rapid = (options.rapid ?? 1) > 1;
    const initialWin = Math.max(before.cachedTotalWin || 0, ...(before.displayedWins || []), ...before.winTexts.map((text) => parseMoney(text) || 0));
    const initialHudWin = before.winDisplay;
    let hudWin: number | undefined;
    if (!rapid) await this.waitForBaseGame(timeout);

    await trigger();
    const extra = Math.max(0, (options.rapid ?? 1) - 1);
    for (let index = 0; index < extra; index += 1) {
      await trigger();
    }

    const deadline = Date.now() + timeout;
    let quiet = 0;
    let idleWithoutSpin = 0;
    while (Date.now() < deadline) {
      const arrived = this.network.count() - start;
      if (arrived === 0 && options.fallbackInvoke && !fallbackUsed && Date.now() - started > 4_000) {
        fallbackUsed = triggerName === "SPACE" ? await this.frame.dispatchSpace() : await this.frame.invoke("spin");
      }
      const state = await this.frame.readState();
      if (await this.frame.dismissPressAnywhere().catch(() => false)) {
        await this.page.waitForTimeout(400);
        continue;
      }
      if (state.busy) sawSpinning = true;
      if (state.busy) await this.skipReelAnimation(state);
      if (state.skipConsumed) skipConsumed = true;
      if (options.sampleBuyLock && state.busy && state.hasBuy && typeof state.buyEnabled === "boolean") buyVisibleWhileBusy = state.buyEnabled;
      const index = Math.max(0, arrived - 1);
      const parsedPeak = [state.cachedTotalWin, ...(state.displayedWins || []), ...state.winTexts.map((text) => parseMoney(text))]
        .filter((value): value is number => value != null && value > 0 && value !== initialWin);
      if (parsedPeak.length) peaks.set(index, Math.max(peaks.get(index) || 0, ...parsedPeak));
      if (state.winDisplay != null && state.winDisplay !== initialHudWin) hudWin = state.winDisplay;
      await this.persistNewRecords(game, baseSpin, start, saved, screenshots);
      if (options.sampleBetLock && state.busy) {
        const currentBet = state.bet;
        await this.frame.clickControl("increase").catch(() => false);
        const after = await this.frame.readState();
        book.set("bet-lock", currentBet == null || after.bet == null || moneyEqual(currentBet, after.bet) ? "PASS" : "FAIL", `Bet before pressure ${currentBet ?? "n/a"}, after ${after.bet ?? "n/a"}.`);
        options.sampleBetLock = false;
      }
      idleWithoutSpin = arrived > 0 && state.idle && !sawSpinning ? idleWithoutSpin + 1 : 0;
      const animationFinished = arrived > 0 && state.idle && (sawSpinning || idleWithoutSpin >= 30);
      quiet = animationFinished ? quiet + 1 : 0;
      if (quiet >= 10) break;
      await this.page.waitForTimeout(100);
    }

    await this.persistNewRecords(game, baseSpin, start, saved, screenshots);
    const records = this.network.all().slice(start);
    this.spinNumber = baseSpin + records.length;
    const durationMs = Date.now() - started;
    const finalState = await this.frame.readState().catch(() => before);
    if (finalState.winDisplay != null && finalState.winDisplay !== initialHudWin) hudWin = finalState.winDisplay;
    const validations: SpinValidation[] = [];
    if (!records.length) {
      if (!rapid && !options.retried && this.inFeature(finalState)) {
        await this.waitForBaseGame(timeout);
        return this.performSpins(game, book, triggerName, trigger, { ...options, retried: true });
      }
      this.spinNumber = baseSpin;
      const failed = this.emptySpin(game, triggerName, before, sawSpinning, finalState.idle);
      failed.failureScreenshot = await this.evidence.capture(this.page, game.gameName, failed.spinNumber, "failure", { trigger: triggerName });
      validations.push(failed);
      if (triggerName === "Spin button" || triggerName === "SPACE") {
        book.set("spin-starts", "FAIL", `No /slots/bet response after ${triggerName}.`, failed.spinNumber);
        book.set("freeze", "FAIL", `${triggerName} did not resolve.`, failed.spinNumber);
      }
      return { spins: validations, requests: 0, durationMs, skipConsumed, buyVisibleWhileBusy };
    }

    records.forEach((record, index) => {
      const parsed = (record.spinData as ParsedSpinResult) ?? parseSpinResponse(record.responseBody);
      record.balanceBefore = index === 0 ? before.balance : records[index - 1]?.balanceAfter;
      const sampled = index === records.length - 1;
      const validation = compareSpin({
        gameName: game.gameName,
        spinNumber: baseSpin + index + 1,
        trigger: triggerName,
        network: record,
        parsed,
        frontend: sampled ? finalState : { ...finalState, bet: undefined, balance: undefined, balanceDisplay: undefined, winDisplay: undefined, winDisplayText: undefined, cachedTotalWin: undefined, symbols: undefined, freeSpins: undefined, multiplier: undefined },
        peakWin: sampled ? peaks.get(index) || (parsed.totalWin === 0 ? 0 : undefined) : undefined,
        hudWin: sampled ? hudWin : undefined,
        sawSpinning,
        returnedToIdle: finalState.idle,
        duplicateRequests: Math.max(0, records.length - 1),
        screenshot: screenshots.get(index),
        decimals: finalState.currencyDecimals ?? regressionConfig.currencyDecimals,
      });
      if (!sampled) {
        validation.sampled = false;
        validation.passed = false;
        validation.correlation = "NOT SAMPLED";
        validation.mismatches = [];
        validation.comparisons = validation.comparisons.map((row) => ({ ...row, result: "NOT COMPARED" as const }));
        validation.notes.push("Frontend state for this intermediate response was not isolated from the following spin.");
      }
      if (fallbackUsed) validation.notes.push("The first input did not produce a bet within 4s, so an alternate input path was used.");
      validations.push(validation);
      this.logSpin(validation);
      if (validation.sampled && !validation.passed) {
        this.evidence.writeFailure(game.gameName, validation.spinNumber, "fe-be", {
          frontend: validation.frontend,
          backend: validation.backend,
          mismatches: validation.mismatches,
          request: validation.network?.requestPayload,
          response: validation.network?.responseBody,
        });
      }
    });

    const primary = validations[0];
    if (primary) this.applyPrimaryChecks(book, primary, before, records[0], durationMs, triggerName, records.length);
    return { spins: validations, requests: records.length, durationMs, skipConsumed, buyVisibleWhileBusy };
  }

  private async waitForIdle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    while (Date.now() < deadline) {
      const dismissed = await this.frame.dismissPressAnywhere().catch(() => false);
      const state = await this.frame.readState().catch(() => undefined);
      quiet = dismissed ? 0 : state?.idle ? quiet + 1 : 0;
      if (quiet >= 3) return;
      await this.page.waitForTimeout(100);
    }
  }

  private async persistNewRecords(game: GameInfo, baseSpin: number, start: number, saved: Set<number>, screenshots: Map<number, string>): Promise<void> {
    const records = this.network.all().slice(start);
    for (let index = 0; index < records.length; index += 1) {
      if (saved.has(index)) continue;
      saved.add(index);
      const spinNumber = baseSpin + index + 1;
      const record = records[index];
      const parsed = (record.spinData as ParsedSpinResult) ?? parseSpinResponse(record.responseBody);
      record.requestPath = this.evidence.writeJson(game.gameName, spinNumber, "request", record.requestPayload);
      record.responsePath = this.evidence.writeJson(game.gameName, spinNumber, "response", record.responseBody);
      if ((parsed.totalWin ?? 0) > 0) {
        const shot = await this.evidence.capture(this.page, game.gameName, spinNumber, "win", {
          gameName: game.gameName,
          spinNumber,
          bet: record.betSize,
          totalWin: parsed.totalWin,
          balance: parsed.balance,
        });
        if (shot) screenshots.set(index, shot);
      }
    }
  }

  private applyPrimaryChecks(book: CheckBook, spin: SpinValidation, before: FrontendSnapshot, record: SpinNetworkData, durationMs: number, triggerName: string, requestCount: number): void {
    const parsed = (record.spinData as ParsedSpinResult) ?? parseSpinResponse(record.responseBody);
    if (triggerName === "Spin button" || triggerName === "Turbo spin" || triggerName === "Delayed spin") {
      book.set("spin-button", requestCount >= 1 ? "PASS" : "FAIL", `${triggerName} produced ${requestCount} bet request(s).`, spin.spinNumber);
      book.set("spin-starts", requestCount >= 1 ? "PASS" : "FAIL", requestCount ? "Backend accepted the spin." : "Spin did not reach the backend.", spin.spinNumber);
    }
    if (triggerName === "SPACE") book.set("space-spin", requestCount >= 1 ? "PASS" : "FAIL", requestCount ? "SPACE produced one bet request." : "SPACE produced no bet request.", spin.spinNumber);
    book.set("reels-stop", spin.returnedToIdle ? "PASS" : "FAIL", spin.sawSpinning ? "Spinning flag was observed and then cleared." : "Spin resolved before the spinning flag was sampled.", spin.spinNumber);
    book.set("no-stuck-reel", spin.returnedToIdle ? "PASS" : "FAIL", spin.returnedToIdle ? "Reels returned to Idle." : "Reels did not return to Idle before the timeout.", spin.spinNumber);
    book.set("return-idle", spin.returnedToIdle ? "PASS" : "FAIL", spin.returnedToIdle ? "Game State -> Idle." : "Game stayed busy.", spin.spinNumber);
    book.set("result-shown", spin.frontend.symbols || spin.returnedToIdle ? "PASS" : "FAIL", spin.returnedToIdle ? "A resting result was available after the spin." : "No resting result was read.", spin.spinNumber);
    book.set("state-management", spin.returnedToIdle ? "PASS" : "FAIL", spin.returnedToIdle ? "Spin returned to Idle before the next action." : "Spin did not return to Idle.", spin.spinNumber);
    book.set("freeze", spin.returnedToIdle ? "PASS" : "FAIL", `Resolved in ${durationMs}ms.`, spin.spinNumber);

    const amplified = requestIsAmplified(record.requestPayload);
    const wager = record.betSize == null ? undefined : amplified ? amplifiedWager(record.betSize) : record.betSize;
    const expected = before.balance != null && wager != null && parsed.totalWin != null ? Math.round((before.balance - wager + parsed.totalWin) * 100) / 100 : undefined;
    const betOnly = before.balance != null && wager != null && parsed.balance != null ? Math.round((before.balance - wager) * 100) / 100 : undefined;
    const unresolved = record.responseBody != null && typeof record.responseBody === "object" && "unresolvedSpin" in record.responseBody && Boolean((record.responseBody as { unresolvedSpin?: unknown }).unresolvedSpin);
    const winHeldForFeature = (unresolved || parsed.feature === "free-spins") && betOnly != null && moneyEqual(betOnly, parsed.balance);
    const deductionOk = expected == null || parsed.balance == null || moneyEqual(expected, parsed.balance) || winHeldForFeature;
    const deductionDetail = expected == null
      ? "Balance before the spin was not readable."
      : winHeldForFeature
        ? `Balance ${before.balance} -> ${parsed.balance} after deducting wager ${wager}. Feature win ${parsed.totalWin} is still unresolved.`
        : amplified
          ? `Expected ${expected} from ${before.balance} - ${wager} (backend bet ${record.betSize} plus 25% amplify) + ${parsed.totalWin}. Backend balance ${parsed.balance}.`
          : `Expected ${expected} from ${before.balance} - ${record.betSize} + ${parsed.totalWin}. Backend balance ${parsed.balance}.`;
    book.set("bet-deducted", deductionOk ? "PASS" : "FAIL", deductionDetail, spin.spinNumber);
    const dropped = before.balance != null && spin.frontend.balance != null && spin.frontend.balance < before.balance;
    book.set("bet-deducted-immediate", deductionOk && (dropped || durationMs < 1_200) ? "PASS" : deductionOk ? "PASS" : "FAIL", dropped ? "Balance decreased during the spin." : `Final balance math ${deductionOk ? "matched" : "did not match"} within ${durationMs}ms.`, spin.spinNumber);

    if (hasTwoDecimalPlaces(before.betText) && hasTwoDecimalPlaces(before.balanceText)) {
      book.set("currency-format", "PASS", `Bet text ${before.betText}, balance text ${before.balanceText}.`);
      book.set("currency-precision", "PASS", "Bet and balance texts use two decimal places.");
    } else if (before.betText || before.balanceText) {
      book.set("currency-format", "FAIL", `Bet text "${before.betText ?? ""}", balance text "${before.balanceText ?? ""}".`);
      book.set("currency-precision", "FAIL", "A displayed money value did not use two decimals.");
    }

    const transactionOk = record.status >= 200 && record.status < 300 && (!parsed.transactionState || /complete|success|ok/i.test(parsed.transactionState));
    book.set("transaction-state", transactionOk ? "PASS" : "FAIL", `HTTP ${record.status}, state ${parsed.transactionState ?? "n/a"}.`, spin.spinNumber);
    if ((parsed.totalWin ?? 0) === 0) {
      const winCompared = spin.comparisons.find((row) => row.field === "totalWin");
      book.set("no-win", winCompared?.result === "MATCH" ? "PASS" : "FAIL", `Backend totalWin 0. Frontend win ${spin.frontend.totalWin ?? "n/a"}.`, spin.spinNumber);
    }
    if ((parsed.totalWin ?? 0) > 0) book.set("win-animation", (spin.frontend.totalWin ?? 0) > 0 || spin.sawSpinning ? "PASS" : "FAIL", `Backend win ${parsed.totalWin}. Observed frontend win ${spin.frontend.totalWin ?? "n/a"}.`, spin.spinNumber);
    if (before.maxWinMultiplier && record.betSize != null && parsed.totalWin != null) {
      const cap = before.maxWinMultiplier * record.betSize;
      book.set("max-win-cap", parsed.totalWin <= cap + 0.001 ? "PASS" : "FAIL", `Win ${parsed.totalWin} against cap ${cap}.`, spin.spinNumber);
      if (parsed.maxWin || parsed.totalWin >= cap - 0.001) book.set("max-win-single", "PASS", "A spin reached the max-win cap.");
    }
    if (parsed.feature === "free-spins" || readPayloadFlag(record.requestPayload, "isFs") === true) {
      book.set("free-spins-trigger", "PASS", "Backend returned a free-spin/scatter state.", spin.spinNumber);
      book.set("free-spin-count", spin.comparisons.find((row) => row.field === "freeSpins")?.result === "MISMATCH" ? "FAIL" : "PASS", `Frontend ${spin.frontend.freeSpins ?? "n/a"} / backend ${spin.backend.freeSpins ?? "n/a"}.`, spin.spinNumber);
      const freeSpinRequest = readPayloadFlag(record.requestPayload, "isFs") === true;
      if (freeSpinRequest) book.set("free-spin-no-bet", record.betSize === 0 || readPayloadFlag(record.requestPayload, "bet") === "0" || readPayloadFlag(record.requestPayload, "bet") === 0 ? "PASS" : "NOT APPLICABLE", `Free-spin request bet field is ${String(readPayloadFlag(record.requestPayload, "bet"))}.`);
    }
  }

  private async optionalFeatures(game: GameInfo, book: CheckBook, spins: SpinValidation[]): Promise<void> {
    await this.runBetControls(game, book, spins);
    await this.clickBuyFeature(game, book, spins);
    await this.clickAmplifyBet(game, book, spins);
    await this.runAutoplay(game, book, spins);
    if (regressionConfig.enableTurbo && (await this.frame.readState()).hasTurbo) {
      const before = await this.frame.readState();
      const clicked = await this.frame.clickControl("turbo");
      await this.page.waitForTimeout(300);
      const after = await this.frame.readState();
      const toggled = before.flags._isTurbo !== after.flags._isTurbo;
      book.set("turbo-toggle", clicked && toggled ? "PASS" : "FAIL", `Turbo flag ${String(before.flags._isTurbo)} -> ${String(after.flags._isTurbo)}.`);
      const timed = await this.performSpins(game, book, "Turbo spin", async () => {
        const ok = await this.frame.clickControl("spin");
        if (!ok) await this.frame.invoke("spin");
      });
      spins.push(...timed.spins);
      if (this.normalDurationMs > 0 && timed.durationMs > 0) {
        book.set("turbo-speed", timed.durationMs < this.normalDurationMs ? "PASS" : "FAIL", `Turbo spin ${timed.durationMs}ms, baseline spin ${this.normalDurationMs}ms.`);
      } else book.set("turbo-speed", "NOT APPLICABLE", "A baseline spin duration was not available.");
      book.set("turbo-win", timed.spins.every((spin) => spin.returnedToIdle) ? "PASS" : "FAIL", "Turbo spin returned to Idle.");
      if (after.flags._isTurbo) await this.frame.clickControl("turbo");
    }

    if (regressionConfig.enableNetworkDelay) {
      await this.page.route("**/api/v1/slots/bet", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, regressionConfig.networkDelayMs));
        await route.continue();
      });
      try {
        const delayed = await this.performSpins(game, book, "Delayed spin", async () => {
          await this.frame.clickControl("spin");
        }, { rapid: 3, fallbackInvoke: true });
        spins.push(...delayed.spins);
        const recovered = delayed.requests === 1 && delayed.spins.every((spin) => spin.returnedToIdle && spin.passed);
        book.set("network-delay", recovered ? "PASS" : "FAIL", `${delayed.requests} bet request(s) under a ${regressionConfig.networkDelayMs}ms delay. Idle recovery ${delayed.spins.every((spin) => spin.returnedToIdle)}.`);
      } finally {
        await this.page.unroute("**/api/v1/slots/bet");
      }
    }

    if (regressionConfig.enableMaxBetSelection) {
      const state = await this.frame.readState();
      if (state.betLevels.length) {
        const max = Math.max(...state.betLevels);
        const selected = await this.frame.clickText(`^${max}(?:\\.00)?$`);
        const after = await this.frame.readState();
        book.set("max-bet", selected && moneyEqual(after.bet, max) ? "PASS" : "NOT APPLICABLE", `Tried to select max bet ${max}. UI bet is ${after.bet ?? "n/a"}.`);
      }
    }

    if (regressionConfig.enableMenu) await this.inspectMenu(book);
    if (regressionConfig.enableRefresh) await this.refresh(game, book);
  }

  private inFeature(state: FrontendSnapshot): boolean {
    return state.feature === "free-spins" || state.feature === "scatter" || !!state.flags._isInFreeSpinRound || !!state.flags._isBonus || !!state.flags._isScatter;
  }

  private async waitForBaseGame(timeoutMs: number): Promise<FrontendSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    let last = await this.frame.readState();
    while (Date.now() < deadline) {
      if (await this.frame.dismissPressAnywhere().catch(() => false)) {
        quiet = 0;
        await this.page.waitForTimeout(300);
        continue;
      }
      last = await this.frame.readState();
      if (this.inFeature(last) || !last.idle) {
        quiet = 0;
        await this.skipReelAnimation(last, true);
        await this.page.waitForTimeout(200);
        continue;
      }
      quiet += 1;
      if (quiet >= 6) return last;
      await this.page.waitForTimeout(100);
    }
    return last;
  }

  private async clickAmplifyBet(game: GameInfo, book: CheckBook, spins: SpinValidation[]): Promise<void> {
    const before = await this.waitForBaseGame(Math.max(regressionConfig.spinTimeoutMs * 3, 90_000));
    const point = before.controls.amplify;
    if (!point?.visible || this.inFeature(before) || !before.idle) {
      if (!point?.visible) book.set("buy-restrictions", "NOT APPLICABLE", "Amplify Bet is not on this game.");
      else book.set("buy-restrictions", "BLOCKED", "Amplify Bet was still covered, so the round icon was not clicked.");
      return;
    }
    let clicked = await this.frame.clickControl("amplify");
    if (!clicked) clicked = await this.frame.invoke("amplify");
    console.log(`Clicked Amplify Bet circle at ${Math.round(point.x)},${Math.round(point.y)}`);
    await this.page.waitForTimeout(500);
    const armed = await this.frame.readState();
    if (armed.enhancedBet) {
      book.set("buy-amplified", armed.buyEnabled === false ? "PASS" : "FAIL", armed.buyEnabled === false ? "Buy was disabled while Amplify Bet was on." : "Buy stayed enabled while Amplify Bet was on.");
    } else {
      book.set("buy-amplified", "BLOCKED", "Amplify Bet did not turn on, so Buy's disabled state was not observed.");
    }
    const amplified = await this.performSpins(game, book, "Amplify spin", async () => {
      const ok = await this.frame.clickControl("spin");
      if (!ok) await this.frame.invoke("spin");
    }, { fallbackInvoke: true });
    spins.push(...amplified.spins);
    const requestEnhanced = amplified.spins.some((spin) => readPayloadFlag(spin.network?.requestPayload, "isEnhancedBet") === true);
    book.set(
      "buy-restrictions",
      clicked && requestEnhanced ? "PASS" : "FAIL",
      clicked && requestEnhanced
        ? "Amplify Bet icon was clicked and the next /bet request sent isEnhancedBet true."
        : `Amplify Bet click at ${Math.round(point.x)},${Math.round(point.y)} did not send isEnhancedBet true.`,
    );
    if (requestEnhanced) await this.frame.clickControl("amplify");
  }

  private async clickBuyFeatureConfirm(startCount: number): Promise<boolean> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const rows = await this.frame.textDump("^buy\\s*feature$");
      if (rows.length) console.log(rows.join("\n"));
      const clicked = await this.frame.clickText("^buy\\s*feature$");
      if (clicked) {
        console.log("Clicked green BUY FEATURE confirmation");
        const arrived = await this.network.waitForCount(startCount + 1, 2_500).then(() => true).catch(() => false);
        if (arrived) return true;
      }
      await this.page.waitForTimeout(300);
    }
    return false;
  }

  private async clickBuyFeature(game: GameInfo, book: CheckBook, spins: SpinValidation[]): Promise<void> {
    if (!regressionConfig.enableBuyPurchase) return;
    const before = await this.waitForBaseGame(Math.max(regressionConfig.spinTimeoutMs * 3, 90_000));
    console.log((await this.frame.textDump("buy|feature")).join("\n"));
    const point = before.controls.buy;
    if (!before.hasBuy || !point?.visible || !before.idle || this.inFeature(before)) {
      if (this.laterSession) book.set("multi-session-buy", "NOT APPLICABLE", "The Buy control was not available, so the later-session restriction was not proven.");
      if (!before.hasBuy) return;
      book.set("buy-trigger", "BLOCKED", "The green BUY button was not clickable from Idle.");
      return;
    }
    const start = this.network.count();
    console.log(`Buy HUD click ${Math.round(point.x)},${Math.round(point.y)} text "${before.buyText ?? ""}" labels: ${before.texts.filter((text) => /buy/i.test(text)).join(" | ")}`);
    await this.frame.clickControl("buy");
    const confirmed = await this.clickBuyFeatureConfirm(start);
    if (!confirmed) {
      book.set("buy-trigger", "FAIL", "The green BUY FEATURE confirmation button did not appear after Buy Feature was opened.");
      book.set("buy-deduction", "BLOCKED", "The purchase was not confirmed.");
      book.set("buy-balance", "BLOCKED", "The purchase was not confirmed.");
      return;
    }
    let record: SpinNetworkData | undefined;
    try {
      record = await this.network.waitForCount(start + 1, regressionConfig.spinTimeoutMs);
    } catch {
      record = undefined;
    }
    const buyFeat = Number(readPayloadFlag(record?.requestPayload, "buyFeat") ?? 0);
    if (!record || !(buyFeat > 0)) {
      await this.frame.clickText("^(close|cancel|back)$").catch(() => false);
      book.set("buy-trigger", "FAIL", `Green BUY click at ${Math.round(point.x)},${Math.round(point.y)} did not send buyFeat after BUY FEATURE was clicked.`);
      book.set("buy-deduction", "FAIL", "No buy-feature request was captured.");
      book.set("buy-balance", "BLOCKED", "Balance was not compared because the buy request was missing.");
      if (this.laterSession) book.set("multi-session-buy", "NOT APPLICABLE", "Buy did not complete, so the later-session restriction was not proven.");
      return;
    }
    const unresolvedId = readUnresolvedSpinId(record.responseBody);
    if (unresolvedId) console.log(`Waiting for unresolved-spin ${unresolvedId}/complete before the balance check`);
    const deadline = Date.now() + regressionConfig.spinTimeoutMs * 4;
    let after = before;
    let quietNet = 0;
    let lastCount = this.network.count();
    while (Date.now() < deadline) {
      after = await this.frame.readState();
      if (await this.frame.dismissPressAnywhere().catch(() => false)) {
        quietNet = 0;
        await this.page.waitForTimeout(400);
        continue;
      }
      const count = this.network.count();
      if (count !== lastCount || this.network.inflight() > 0) {
        lastCount = count;
        quietNet = 0;
      } else {
        quietNet += 1;
      }
      const complete = unresolvedId ? this.network.unresolvedComplete(unresolvedId) : undefined;
      const networkQuiet = this.network.inflight() === 0 && quietNet >= 8 && (!unresolvedId || complete != null);
      if (after.idle && !this.inFeature(after) && networkQuiet) break;
      if (this.inFeature(after) || !after.idle) await this.skipReelAnimation(after, true);
      await this.page.waitForTimeout(200);
    }
    await this.page.waitForTimeout(500);
    after = await this.frame.readState();
    const complete = unresolvedId ? this.network.unresolvedComplete(unresolvedId) : undefined;
    const networkDone = this.network.inflight() === 0 && (!unresolvedId || complete != null) && after.idle && !this.inFeature(after);
    const parsed = (record.spinData as ParsedSpinResult) ?? parseSpinResponse(record.responseBody);
    const cost = before.buyAmount ?? record.betSize;
    const debitOnly = before.balance != null && cost != null && parsed.balance != null && moneyEqual(Math.round((before.balance - cost) * 100) / 100, parsed.balance);
    const withWin = before.balance != null && cost != null && parsed.totalWin != null && parsed.balance != null && moneyEqual(Math.round((before.balance - cost + parsed.totalWin) * 100) / 100, parsed.balance);
    const balanceOk = debitOnly || withWin;
    book.set("buy-trigger", "PASS", `${game.gameName} BUY FEATURE confirmation sent buyFeat ${buyFeat}.`, spins.length + 1);
    book.set("buy-deduction", balanceOk ? "PASS" : "FAIL", `Balance ${before.balance ?? "n/a"} -> ${parsed.balance ?? "n/a"}. Buy cost ${cost ?? "n/a"}.`);
    const settledBalance = complete?.balance ?? (unresolvedId ? undefined : parsed.balance);
    const matched = networkDone && after.balance != null && settledBalance != null && moneyEqual(after.balance, settledBalance);
    const waitingOn = unresolvedId && !complete
      ? `unresolved-spin/${unresolvedId}/complete had not finished`
      : this.network.inflight() > 0
        ? `${this.network.inflight()} call(s) were still open`
        : "the feature was still on screen";
    console.log(`Buy balance checked after unresolved-spin complete ${complete ? "yes" : "no"}: frontend ${after.balance ?? "n/a"} backend ${settledBalance ?? "n/a"}`);
    book.set(
      "buy-balance",
      matched ? "PASS" : "FAIL",
      !networkDone
        ? `Balance was not compared because ${waitingOn}.`
        : settledBalance == null
          ? `unresolved-spin/${unresolvedId ?? "n/a"}/complete HTTP ${complete?.status ?? "n/a"} did not include a balance.`
          : `Frontend ${after.balance ?? "n/a"} / backend ${settledBalance} after unresolved-spin/${unresolvedId ?? "n/a"}/complete HTTP ${complete?.status ?? "n/a"}.`,
    );
    book.set(
      "force-resolved-buy",
      unresolvedId ? (complete && complete.status >= 200 && complete.status < 300 ? "PASS" : "FAIL") : (!parsed.transactionState || /complete|success|ok|forced/i.test(parsed.transactionState) ? "PASS" : "FAIL"),
      unresolvedId ? `unresolved-spin/${unresolvedId}/complete HTTP ${complete?.status ?? "missing"}.` : `Buy transaction state ${parsed.transactionState ?? "completed"}.`,
    );
    book.set("buy-win-idle", after.idle ? "PASS" : "FAIL", after.idle ? "Game returned to Idle after the buy-feature dialogue." : "Game was not Idle after the buy feature.");
    book.set("multi-session-buy", this.laterSession ? "FAIL" : "NOT APPLICABLE", this.laterSession ? "Buy feature was accepted in another session on the same account." : "Checked when a later game is launched in the same player session.");
    if (before.buyAmount != null && before.bet != null && before.buyMultiplier) {
      const expectedCost = Math.round(before.bet * before.buyMultiplier * 100) / 100;
      book.set("buy-amount", moneyEqual(before.buyAmount, expectedCost) ? "PASS" : "FAIL", `UI buy ${before.buyAmount} vs bet ${before.bet} x ${before.buyMultiplier}.`);
    }
  }

  private recordCurrency(book: CheckBook, state: FrontendSnapshot): void {
    const code = (state.currency || "").toUpperCase();
    const shown = `${state.balanceText ?? ""} ${state.betText ?? ""} ${state.buyText ?? ""}`;
    const usesR = /(^|[^A-Za-z])R([^A-Za-z]|$)/.test(shown);
    if (!code) {
      book.set("currency", "NOT APPLICABLE", "Currency was not exposed by the game session.");
      return;
    }
    if (usesR && !new RegExp(code, "i").test(shown)) {
      book.set("currency", "FAIL", `Currency should be ${code}, not R. Shown: ${shown.trim()}.`);
      return;
    }
    book.set("currency", "PASS", `Session currency is ${code}. Shown: ${shown.trim() || code}.`);
  }

  private async spinAtSelectedBet(game: GameInfo, book: CheckBook, spins: SpinValidation[], selected: number): Promise<boolean> {
    const result = await this.performSpins(game, book, "Bet check", async () => {
      const ok = await this.frame.clickControl("spin");
      if (!ok) await this.frame.invoke("spin");
    }, { fallbackInvoke: true });
    spins.push(...result.spins);
    const sent = result.spins.find((spin) => spin.network?.betSize != null)?.network?.betSize;
    const matched = sent != null && moneyEqual(sent, selected) && result.requests >= 1;
    console.log(`Bet check ${selected}: request bet ${sent ?? "none"}`);
    return matched;
  }

  private async runBetControls(game: GameInfo, book: CheckBook, spins: SpinValidation[]): Promise<void> {
    let state = await this.frame.readState();
    if (!state.idle) return;
    const startBet = state.bet;
    const betLevels = state.betLevels;
    const checked: string[] = [];
    let spinFailed = false;
    const confirmBet = async (amount: number | undefined): Promise<void> => {
      if (amount == null) return;
      const matched = await this.spinAtSelectedBet(game, book, spins, amount);
      checked.push(`${amount} ${matched ? "deducted on one spin" : "spin did not use this bet"}`);
      if (!matched) spinFailed = true;
    };
    await this.frame.clickText("^bet$");
    const decreased = await this.frame.clickControl("decrease");
    let next = await this.frame.readState();
    const wentDown = startBet != null && next.bet != null && next.bet < startBet - 0.001;
    if (wentDown) await confirmBet(next.bet);
    let guard = 0;
    while (guard < 15 && next.idle && !this.inFeature(next)) {
      const current = next.bet;
      await this.frame.clickControl("decrease");
      const after = await this.frame.readState();
      if (current == null || after.bet == null || moneyEqual(current, after.bet)) {
        next = after;
        break;
      }
      next = after;
      await confirmBet(next.bet);
      next = await this.frame.readState();
      guard += 1;
    }
    const minLevel = betLevels.length ? Math.min(...betLevels) : undefined;
    book.set("bet-min", minLevel == null || next.bet == null ? "NOT APPLICABLE" : next.bet + 0.001 < minLevel ? "FAIL" : moneyEqual(next.bet, minLevel) ? "PASS" : "BLOCKED", `Lowest bet reached ${next.bet ?? "n/a"}. Ladder minimum ${minLevel ?? "n/a"}.`);
    const beforeUp = next.bet;
    const increased = await this.frame.clickControl("increase");
    next = await this.frame.readState();
    const wentUp = beforeUp != null && next.bet != null && next.bet > beforeUp + 0.001;
    if (wentUp) await confirmBet(next.bet);
    if (next.buyAmount != null && next.bet != null && next.buyMultiplier) {
      const expected = Math.round(next.bet * next.buyMultiplier * 100) / 100;
      const matched = moneyEqual(next.buyAmount, expected);
      book.set("buy-recalc", matched ? "PASS" : "FAIL", `After the bet change, buy shows ${next.buyAmount}. Expected ${next.bet} x ${next.buyMultiplier} = ${expected}.`);
      book.set("buy-display", matched ? "PASS" : "FAIL", `Buy display ${next.buyAmount} vs calculated ${expected}.`);
    }
    const displayedBet = next.betText == null ? undefined : Number(String(next.betText).replace(/[^0-9.-]/g, ""));
    if (next.bet != null && displayedBet != null && Number.isFinite(displayedBet) && moneyEqual(next.bet, displayedBet)) {
      book.set("bet-display", "PASS", `Displayed bet ${next.betText} matches value ${next.bet}.`);
    } else if (next.bet != null) {
      book.set("bet-display", "BLOCKED", `Internal bet is ${next.bet}. Displayed text is ${next.betText ?? "missing"}.`);
    }
    guard = 0;
    while (guard < 15 && next.idle && !this.inFeature(next)) {
      const current = next.bet;
      await this.frame.clickControl("increase");
      const after = await this.frame.readState();
      if (current == null || after.bet == null || moneyEqual(current, after.bet)) {
        const maxLevel = betLevels.length ? Math.max(...betLevels) : undefined;
        book.set("bet-max", maxLevel == null || after.bet == null ? "NOT APPLICABLE" : after.bet <= maxLevel + 0.001 ? "PASS" : "FAIL", `Highest bet reached ${after.bet}. Ladder maximum ${maxLevel ?? "n/a"}.`);
        break;
      }
      next = after;
      await confirmBet(next.bet);
      next = await this.frame.readState();
      guard += 1;
    }
    if (!book.has("bet-max")) book.set("bet-max", "BLOCKED", "Bet was still increasing after 15 steps, so the maximum was not reached.");
    let restore = 0;
    while (startBet != null && next.bet != null && !moneyEqual(next.bet, startBet) && restore < 20 && next.idle && !this.inFeature(next)) {
      if (next.bet > startBet) await this.frame.clickControl("decrease");
      else await this.frame.clickControl("increase");
      const after = await this.frame.readState();
      if (after.bet == null || moneyEqual(after.bet, next.bet)) break;
      next = after;
      await confirmBet(next.bet);
      next = await this.frame.readState();
      restore += 1;
    }
    const tried = checked.map((line) => Number(line.split(" ")[0])).filter((amount) => Number.isFinite(amount));
    const decreasedAny = startBet != null && tried.some((amount) => amount < startBet - 0.001);
    const increasedAny = startBet != null && tried.some((amount) => amount > startBet + 0.001);
    book.set("bet-decrease", !decreased && !decreasedAny ? "NOT APPLICABLE" : decreasedAny && !spinFailed ? "PASS" : decreasedAny ? "FAIL" : "BLOCKED", decreasedAny ? `Bet moved below ${startBet} and each step was spun once.` : `Bet ${startBet ?? "n/a"} -> ${next.bet ?? "n/a"}.`);
    book.set("bet-increase", !increased && !increasedAny ? "NOT APPLICABLE" : increasedAny && !spinFailed ? "PASS" : increasedAny ? "FAIL" : "BLOCKED", increasedAny ? `Bet moved above ${startBet} and each step was spun once.` : `Bet ${beforeUp ?? "n/a"} -> ${next.bet ?? "n/a"}.`);
    book.set("bet-step", !decreasedAny && !increasedAny ? "BLOCKED" : spinFailed ? "FAIL" : "PASS", checked.length ? checked.join("; ") : `Decrease ${startBet ?? "n/a"} and increase ${beforeUp ?? "n/a"} -> ${next.bet ?? "n/a"}.`);
  }

  private async runAutoplay(game: GameInfo, book: CheckBook, spins: SpinValidation[]): Promise<void> {
    if (!regressionConfig.enableAutoplay) return;
    await this.waitForBaseGame(Math.max(regressionConfig.spinTimeoutMs * 3, 90_000));
    const state = await this.frame.readState();
    if (!state.hasAutoplay && !state.controls.autoplay?.visible) return;
    if (this.inFeature(state) || !state.idle) {
      book.set("autoplay-start", "BLOCKED", "Autoplay was not started because a feature was still on screen.");
      book.set("autoplay-count", "BLOCKED", "Autoplay was not started because a feature was still on screen.");
      book.set("autoplay-stop", "NOT APPLICABLE", "Autoplay never started, so Stop was not required.");
      return;
    }
    let turboArmed = false;
    if (regressionConfig.enableTurbo && state.hasTurbo && state.idle) {
      turboArmed = await this.frame.clickControl("turbo");
    }
    const start = this.network.count();
    const target = regressionConfig.autoplaySpins;
    const opened = await this.frame.clickControl("autoplay");
    await this.page.waitForTimeout(700);
    await this.frame.clickDialogText(`^${target}$`);
    const confirmed = await this.clickStartAutoplay();
    if (!confirmed) {
      if (opened) await this.frame.clickControl("autoplay");
      book.set("autoplay-start", "FAIL", "The Autoplay panel opened, but the spin-count and start buttons were not clicked. The panel was closed so the launcher was not reloaded.");
      book.set("autoplay-count", "FAIL", `Selected ${target} spins. Observed 0 bet request(s).`);
      book.set("autoplay-stop", "NOT APPLICABLE", "Autoplay never started, so Stop was not required.");
      return;
    }
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let lastCount = start;
    const deadline = Date.now() + Math.max(regressionConfig.spinTimeoutMs, target * 8_000);
    while (Date.now() < deadline && this.network.count() - start < target) {
      const now = await this.frame.readState();
      if (await this.frame.dismissPressAnywhere().catch(() => false)) {
        await this.page.waitForTimeout(400);
        continue;
      }
      const count = this.network.count();
      if (count !== lastCount) {
        lastCount = count;
        lastProgressAt = Date.now();
      }
      const stalled = Date.now() - lastProgressAt > 12_000;
      if (stalled && !now.flags._isAutoPlaying) break;
      if (stalled && count === start) break;
      if (now.flags._isAutoPlaying) {
        book.set("autoplay-disables", now.buyEnabled === false ? "PASS" : "FAIL", now.buyEnabled === false ? "Buy was disabled while Autoplay was running." : "Buy stayed enabled while Autoplay was running.");
        book.set("no-buy-autoplay", now.buyEnabled === false ? "PASS" : "FAIL", now.buyEnabled === false ? "Buy could not be used during Autoplay." : "Buy remained available during Autoplay.");
        if (turboArmed) book.set("turbo-persists", now.flags._isTurbo === true ? "PASS" : "FAIL", `Turbo flag during Autoplay is ${String(now.flags._isTurbo)}.`);
        book.set("autoplay-turbo", turboArmed ? (now.flags._isTurbo === true ? "PASS" : "FAIL") : "NOT APPLICABLE", turboArmed ? "Turbo stayed on during Autoplay." : "Turbo was not armed for this Autoplay run.");
      }
      if (now.busy) await this.skipReelAnimation(now);
      if (!now.flags._isAutoPlaying && count > start && now.idle) break;
      await this.page.waitForTimeout(300);
    }
    const running = this.network.count() - start;
    const stillRunning = running > 0 && (await this.frame.readState()).flags._isAutoPlaying === true;
    if (stillRunning) {
      const stopped = await this.frame.clickDialogText("^(stop|cancel)$");
      if (!stopped) await this.frame.clickControl("autoplay");
      const stopDeadline = Date.now() + 8_000;
      while (Date.now() < stopDeadline && (await this.frame.readState()).flags._isAutoPlaying) {
        await this.page.waitForTimeout(300);
      }
    } else if (running === 0 && opened) {
      await this.frame.clickControl("autoplay");
    }
    await this.page.waitForTimeout(500);
    const afterStop = this.network.count() - start;
    book.set("autoplay-start", opened && running > 0 ? "PASS" : "FAIL", running > 0 ? `${running} bet request(s) after Autoplay was started.` : "Autoplay was clicked, but no bet request started. The panel was closed without reloading the player screen.");
    book.set("autoplay-count", running === target ? "PASS" : "FAIL", `Selected ${target} spins. Observed ${running} bet request(s).`);
    book.set("autoplay-stop", running === 0 ? "NOT APPLICABLE" : afterStop - running <= 1 ? "PASS" : "FAIL", running === 0 ? "Autoplay never started, so Stop was not required." : `${afterStop - running} bet request(s) arrived after Stop.`);
    const scatter = spins.some((spin) => spin.backend.feature === "free-spins") || this.network.all().slice(start).some((record) => readPayloadFlag(record.requestPayload, "isFs") === true);
    if (!scatter) {
      book.set("autoplay-scatter", "NOT APPLICABLE", "Autoplay did not meet a scatter in this session.");
      book.set("autoplay-credit", "NOT APPLICABLE", "No scatter occurred during Autoplay, so the credit was not observed.");
      book.set("autoplay-retrigger", "NOT APPLICABLE", "Autoplay did not retrigger a feature.");
    }
    if (!book.has("autoplay-max-win")) book.set("autoplay-max-win", "NOT APPLICABLE", "Autoplay did not reach a max-win result.");
    if (turboArmed && (await this.frame.readState()).flags._isTurbo) await this.frame.clickControl("turbo");
    void game;
  }

  private async clickStartAutoplay(): Promise<boolean> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const rows = await this.frame.textDump("^start\\s+autoplay$");
      if (rows.length) console.log(rows.join("\n"));
      const clicked = await this.frame.clickDialogText("^start\\s+autoplay$");
      if (clicked) {
        console.log("Clicked green START AUTOPLAY");
        return true;
      }
      await this.page.waitForTimeout(300);
    }
    return false;
  }

  private async tryBetStep(game: GameInfo, book: CheckBook, spins: SpinValidation[]): Promise<void> {
    await this.runBetControls(game, book, spins);
  }

  private async inspectMenu(book: CheckBook): Promise<void> {
    const opened = await this.frame.clickControl("menu");
    await this.page.waitForTimeout(500);
    const state = await this.frame.readState();
    const visible = state.texts.join("\n");
    const lower = visible.toLowerCase();
    const helpMax = state.texts.find((text) => /win up to/i.test(text));
    book.set("help-screen", /help|how to play|paytable|payout/i.test(lower) ? "PASS" : opened ? "NOT APPLICABLE" : "NOT APPLICABLE", opened ? "Menu was opened." : "Menu control was not clickable.");
    if (this.launchMaxWinText && helpMax) {
      book.set("help-max-win", helpMax === this.launchMaxWinText ? "PASS" : "FAIL", `Launch: ${this.launchMaxWinText}. Help: ${helpMax}.`);
      book.set("payout-guide", helpMax === this.launchMaxWinText ? "PASS" : "FAIL", helpMax === this.launchMaxWinText ? "Help payout text matches the launch max-win text." : `Help payout text differs from launch. Launch: ${this.launchMaxWinText}. Help: ${helpMax}.`);
    } else {
      book.set("payout-guide", /payout|paytable|pay table/i.test(lower) ? "PASS" : "NOT APPLICABLE", /payout|paytable|pay table/i.test(lower) ? "Payout content was opened and no conflicting max-win text was found." : "Payout content was not identified in the menu.");
      book.set("help-max-win", "NOT APPLICABLE", "Help did not show a max-win line to compare with launch.");
    }
    book.set("sound-settings", "MANUAL", "Manual test. SFX playback cannot be confirmed from the canvas.");
    book.set("bgm", "MANUAL", "Manual test. Background-music playback cannot be confirmed from the canvas.");
    book.set("audio", "MANUAL", "Manual test. Spin audio playback cannot be confirmed from the canvas.");
    book.set("win-sound", "MANUAL", "Manual test. Win audio playback cannot be confirmed from the canvas.");
    book.set("feature-sound", "MANUAL", "Manual test. Feature audio playback cannot be confirmed from the canvas.");
    book.set("volume-slider", "MANUAL", "Manual test. The volume slider value cannot be confirmed from the canvas.");
    book.set("menu-sound-persist", "MANUAL", "Manual test. The game does not expose whether opening the menu re-enables a disabled sound.");
    book.set("bg-other-tab", "MANUAL", "Manual test. Background music in another browser tab is not observable from the game canvas.");
    book.set("sfx-other-tab", "MANUAL", "Manual test. Sound effects in another browser tab are not observable from the game canvas.");
    if (opened) await this.frame.clickControl("menu");
  }

  private async refresh(game: GameInfo, book: CheckBook): Promise<void> {
    const before = await this.frame.readState();
    try {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.launcher.open();
      await this.launcher.setPlayer();
      await this.launcher.openGame(game);
      const after = await this.frame.waitForInteractive(regressionConfig.launchTimeoutMs);
      const balanceOk = before.balance == null || after.balance == null || moneyEqual(before.balance, after.balance);
      book.set("refresh-recovery", after.phase === "playing" && after.idle ? "PASS" : "FAIL", `Recovered phase ${after.phase}, idle ${after.idle}.`);
      book.set("refresh-consistency", balanceOk ? "PASS" : "FAIL", `Balance before refresh ${before.balance ?? "n/a"}, after ${after.balance ?? "n/a"}.`);
      book.set("refresh-free-spins", before.feature === "free-spins" || (before.freeSpins ?? 0) > 0
        ? (after.freeSpins === before.freeSpins ? "PASS" : "FAIL")
        : "NOT APPLICABLE", before.feature === "free-spins" ? `Free spins ${before.freeSpins} -> ${after.freeSpins}.` : "No free-spin round was active to restore.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      book.set("refresh-recovery", "FAIL", message);
      book.set("refresh-consistency", "FAIL", `Balance before refresh ${before.balance ?? "n/a"}. The game was not relaunched.`);
      book.set("refresh-free-spins", "NOT APPLICABLE", "Refresh did not return to the game.");
    }
  }

  private async recordHistory(book: CheckBook): Promise<void> {
    const text = await this.launcher.historyText();
    if (!text.trim()) {
      book.set("history", "NOT APPLICABLE", "Live history panel was not found.");
      book.set("history-decimals", "NOT APPLICABLE", "Live history panel was not found.");
      return;
    }
    if (/waiting for live updates/i.test(text)) {
      book.set("history", "FAIL", "Live history stayed on 'Waiting for live updates'.");
      book.set("history-decimals", "NOT APPLICABLE", "History had no amounts to check.");
      return;
    }
    book.set("history", "PASS", text.slice(0, 180).replace(/\s+/g, " "));
    const amounts = [...text.matchAll(/\b(?:balance|bet|win)\b\s*:?\s*[+-]?(\d[\d,]*\.\d+)/gi)].map((match) => match[1]);
    const precise = amounts.filter((amount) => /\.\d{2}$/.test(amount));
    book.set("history-decimals", !amounts.length ? "NOT APPLICABLE" : precise.length === amounts.length ? "PASS" : "FAIL", amounts.length ? `History amounts: ${amounts.slice(0, 4).join(", ")}.` : "History had no amounts.");
  }

  private async recordPooling(book: CheckBook, initialSprites: number, initialDom: number): Promise<void> {
    const state = await this.frame.readState().catch(() => undefined);
    if (!state) {
      book.set("object-pooling", "NOT APPLICABLE", "Game state was not readable after the session.");
      return;
    }
    const spriteGrowth = state.spriteCount - initialSprites;
    const domGrowth = state.domCount - initialDom;
    const leaked = spriteGrowth > 80 || domGrowth > 250;
    book.set("object-pooling", leaked ? "FAIL" : "PASS", `Sprite count ${initialSprites} -> ${state.spriteCount}. DOM nodes ${initialDom} -> ${state.domCount}.`);
  }

  private summarizeSpins(book: CheckBook, spins: SpinValidation[], gameName: string): void {
    const sampled = spins.filter((spin) => spin.sampled);
    const mismatches = sampled.flatMap((spin) => spin.mismatches);
    const fieldStatus = (field: string): CheckStatus => {
      const rows = sampled.flatMap((spin) => spin.comparisons.filter((row) => row.field === field));
      if (rows.some((row) => row.result === "MISMATCH")) return "FAIL";
      if (rows.some((row) => row.result === "MATCH")) return "PASS";
      if (rows.some((row) => row.difference?.startsWith("Manual test"))) return "MANUAL";
      return "NOT APPLICABLE";
    };
    book.set("ui-backend-sync", sampled.length && sampled.every((spin) => spin.passed) ? "PASS" : sampled.length ? "FAIL" : "NOT APPLICABLE", sampled.length ? `${sampled.filter((spin) => spin.passed).length}/${sampled.length} sampled spins matched.` : "No sampled spins.");
    book.set("balance-sync", fieldStatus("balance"), fieldStatus("balance") === "MANUAL" ? "Manual test. Balance text was not exposed, so a person must compare it." : this.mismatchDetails(sampled, "balance"));
    book.set("total-win-sync", fieldStatus("totalWin"), fieldStatus("totalWin") === "MANUAL" ? "Manual test. The win amount is drawn on the canvas and was not readable." : this.mismatchDetails(sampled, "totalWin"));
    book.set("backend-bet", mismatches.some((item) => item.field === "bet") ? "FAIL" : sampled.length ? "PASS" : "NOT APPLICABLE", this.mismatchDetails(sampled, "bet"));
    book.set("symbols-sync", mismatches.some((item) => item.field === "symbols") ? "FAIL" : sampled.some((spin) => spin.comparisons.some((row) => row.field === "symbols" && row.result === "MATCH")) ? "PASS" : "NOT APPLICABLE", this.mismatchDetails(sampled, "symbols"));
    book.set("multiplier-sync", mismatches.some((item) => item.field === "multiplier") ? "FAIL" : "NOT APPLICABLE", this.mismatchDetails(sampled, "multiplier") || "No multiplier was active.");
    book.set("scatter-sync", mismatches.some((item) => item.field === "feature" || item.field === "freeSpins") ? "FAIL" : sampled.some((spin) => spin.backend.feature === "free-spins") ? "PASS" : "NOT APPLICABLE", "Compared when the backend reported a scatter or free-spin feature.");
    const errors = this.consoleMonitor.forGame(gameName);
    const resourceErrors = errors.consoleErrors.filter((error) => /failed to load resource/i.test(error.message));
    const fatalErrors = errors.consoleErrors.filter((error) => !/failed to load resource/i.test(error.message));
    book.set("console-errors", fatalErrors.length ? "FAIL" : "PASS", fatalErrors.length ? fatalErrors.map((error) => error.message).slice(0, 3).join(" | ") : resourceErrors.length ? `${resourceErrors.length} resource load error(s) are listed in Console Errors and did not stop play.` : "No console errors.");
    book.set("no-fatal-console", fatalErrors.some((error) => /uncaught|typeerror|referenceerror|page error/i.test(`${error.type} ${error.message}`)) ? "FAIL" : "PASS", fatalErrors.map((error) => error.message).slice(0, 3).join(" | ") || resourceErrors.map((error) => error.message).slice(0, 2).join(" | ") || "No fatal console errors.");
    if (!sampled.some((spin) => (spin.backend.totalWin ?? 0) === 0)) book.set("no-win", "NOT APPLICABLE", "Every captured spin had a win, so a no-win sample was not available.");
    if (!book.list().find((check) => check.id === "max-win-single" && check.status === "PASS")) book.set("max-win-single", "NOT APPLICABLE", "No spin reached the max-win cap.");
    book.set("max-win-animation", "MANUAL", "Manual test. Max-win animation cannot be confirmed from the canvas data.");
    book.set("normal-multiplier", sampled.some((spin) => (spin.backend.multiplier ?? 0) > 0) ? "PASS" : "NOT APPLICABLE", "No base-game multiplier was returned.");
    book.set("win-line", "MANUAL", "Manual test. Win-line graphics are canvas-only.");
    for (const id of ["feature-exit", "feature-reset", "feature-retrigger", "free-spin-wins", "free-spin-multiplier"]) {
      if (!sampled.some((spin) => spin.backend.feature === "free-spins")) book.set(id, "NOT APPLICABLE", "No free-spin feature was returned.");
    }
    book.set("autoplay-balance", "NOT APPLICABLE", "Insufficient-balance autoplay was not forced on the shared wallet.");
    book.set("autoplay-scatter", "NOT APPLICABLE", "Autoplay was not combined with a scatter in this session.");
    book.set("autoplay-max-win", "NOT APPLICABLE", "Autoplay did not reach a max-win result.");
    book.set("buy-restrictions", sampled.length ? "NOT APPLICABLE" : "NOT APPLICABLE", "Amplified-bet buy restrictions were not enabled in this session.");
    const winning = sampled.filter((spin) => (spin.backend.totalWin ?? 0) > 0);
    const winBalanceFailed = winning.some((spin) => spin.mismatches.some((item) => item.field === "balance"));
    book.set("balance-after-win", !winning.length ? "NOT APPLICABLE" : winBalanceFailed ? "FAIL" : "PASS", winBalanceFailed ? "A winning spin balance did not match the backend." : winning.length ? `${winning.length} winning spin(s) kept the backend balance.` : "No winning spin was sampled.");
    book.set("max-win-message", this.launchMaxWinText ? "PASS" : "NOT APPLICABLE", this.launchMaxWinText ?? "No max-win message was visible.");
    book.set("italic-loading", "MANUAL", "Manual test. The loading font style is gone before it can be sampled.");
    book.set("buy-insufficient", "MANUAL", "Manual test. The shared wallet is not reduced below the buy cost.");
    book.set("drop-speed", "MANUAL", "Manual test. Drop speed is not exposed by the game state.");
    book.set("overlapping-ui", "MANUAL", "Manual test. Overlapping controls are not exposed as comparable data.");
    book.set("animation-discrepancy", "MANUAL", "Manual test. Win-line and drop animations are canvas-only.");
    book.set("feature-intro-lock", "MANUAL", "Manual test. A feature intro cannot be isolated from the following spin.");
  }

  private mismatchDetails(spins: SpinValidation[], field: string): string {
    const failed = spins.flatMap((spin) => spin.mismatches.filter((item) => item.field === field).map((item) => `Spin ${spin.spinNumber}: FE ${JSON.stringify(item.frontend)} vs BE ${JSON.stringify(item.backend)}`));
    if (failed.length) return failed.slice(0, 3).join(" | ");
    const compared = spins.filter((spin) => spin.comparisons.some((row) => row.field === field && row.result === "MATCH")).length;
    return compared ? `${compared} spin(s) matched on ${field}.` : `No ${field} comparison was available.`;
  }

  private emptySpin(game: GameInfo, trigger: string, before: FrontendSnapshot, sawSpinning: boolean, idle: boolean): SpinValidation & { sampled: boolean } {
    this.spinNumber += 1;
    return {
      gameName: game.gameName,
      spinNumber: this.spinNumber,
      trigger,
      frontend: { bet: before.bet, balance: before.balance, feature: before.feature, symbols: before.symbols },
      backend: {},
      comparisons: [],
      mismatches: [{ field: "response", frontend: before.balance ?? null, backend: null, difference: "no /slots/bet response" }],
      passed: false,
      sampled: true,
      correlation: "FAIL",
      sawSpinning,
      returnedToIdle: idle,
      duplicateRequests: 0,
      notes: ["No backend bet response was captured for this trigger."],
      win: false,
    };
  }

  private logSpin(spin: SpinValidation): void {
    const balanceMismatch = spin.mismatches.find((item) => item.field === "balance");
    qaEmit({
      type: spin.passed ? "SPIN_RESULT" : "MISMATCH",
      game: spin.gameName,
      status: spin.passed ? "PASS" : "FAIL",
      message: spin.passed ? `Spin #${spin.spinNumber} matched` : `Spin #${spin.spinNumber} ${balanceMismatch ? "balance mismatch" : "mismatch"}`,
      spin: spin.spinNumber,
      bet: spin.backend.bet ?? spin.frontend.bet ?? null,
      win: spin.backend.totalWin ?? spin.frontend.totalWin ?? null,
      uiBalance: spin.frontend.balance ?? null,
      beBalance: spin.backend.balance ?? null,
      screenshot: spin.failureScreenshot ?? spin.screenshot,
      http: spin.network?.status,
      details: spin.mismatches.map((item) => `${item.field}: UI ${JSON.stringify(item.frontend)} / BE ${JSON.stringify(item.backend)}`).join("; "),
      transaction: spin.passed ? "ok" : "failed",
    });
    if (spin.failureScreenshot || spin.screenshot) {
      qaEmit({
        type: "SCREENSHOT",
        game: spin.gameName,
        status: spin.passed ? "PASS" : "FAIL",
        message: "Screenshot captured",
        spin: spin.spinNumber,
        screenshot: spin.failureScreenshot ?? spin.screenshot,
      });
    }
    console.log(`Game: ${spin.gameName}`);
    console.log(`Spin: ${spin.spinNumber}`);
    console.log(`Bet Size: ${spin.backend.bet ?? ""}`);
    console.log(`Payload: ${JSON.stringify(spin.network?.requestPayload)}`);
    console.log(`Backend balance: ${spin.backend.balance ?? "null"}`);
    console.log(`Frontend balance: ${spin.frontend.balance ?? "null"}`);
    console.log(`Backend totalWin: ${spin.backend.totalWin ?? "null"}`);
    console.log(`Frontend totalWin: ${spin.frontend.totalWin ?? "null"}`);
    console.log(`Frontend vs Backend: ${spin.passed ? "PASS" : "FAIL"}`);
    for (const mismatch of spin.mismatches) {
      console.log(`  Field: ${mismatch.field}`);
      console.log(`  Frontend: ${JSON.stringify(mismatch.frontend)}`);
      console.log(`  Backend: ${JSON.stringify(mismatch.backend)}`);
    }
  }

  private async finish(game: GameInfo, launch: GameResult["launch"], result: GameResult["result"], book: CheckBook, spins: SpinValidation[], notes: string[]): Promise<GameResult> {
    const checks = book.list();
    const captured = this.consoleMonitor.forGame(game.gameName);
    const counts = book.counts();
    const mismatches = spins.reduce((sum, spin) => sum + spin.mismatches.length, 0);
    const critical = [
      ...checks.filter((check) => check.status === "FAIL" && CRITICAL_IDS.has(check.id)).map((check) => `${game.gameName} - ${check.name}${check.spinNumber ? ` - Spin ${check.spinNumber}` : ""} - ${check.details}`),
      ...spins.flatMap((spin) => spin.mismatches.filter((item) => ["bet", "balance", "totalWin", "freeSpins"].includes(item.field)).map((item) => `${game.gameName} - Spin ${spin.spinNumber} - ${item.field} mismatch - FE ${JSON.stringify(item.frontend)} vs BE ${JSON.stringify(item.backend)}`)),
    ];
    console.log("====================================================");
    console.log(`GAME: ${game.gameName}`);
    console.log("====================================================");
    console.log(`Launch: ${launch}`);
    console.log("Spin Tests:");
    for (const id of ["spin-button", "space-spin", "rapid-click", "bet-deducted", "reels-stop", "result-shown"]) {
      const check = checks.find((item) => item.id === id);
      console.log(`  ${check?.name ?? id}: ${check?.status ?? "NOT APPLICABLE"}`);
    }
    console.log("Regression:");
    console.log(`  Passed: ${counts.passed}`);
    console.log(`  Failed: ${counts.failed}`);
    console.log(`  Skipped: ${counts.skipped}`);
    console.log(`Console Errors: ${captured.consoleErrors.length}`);
    console.log(`Failed Requests: ${captured.networkErrors.length}`);
    console.log("====================================================");
    qaEmit({
      type: "GAME_COMPLETED",
      game: game.gameName,
      status: counts.failed ? "FAIL" : launch === "BLOCKED" ? "BLOCKED" : "PASS",
      message: `${launch}. ${counts.passed} passed, ${counts.failed} failed, ${spins.length} spins`,
      details: critical.slice(0, 3).join(" | "),
    });
    const flagged = checks.some((check) => check.status === "FAIL" || check.status === "BLOCKED");
    const reviewShot = flagged ? await this.evidence.capture(this.page, game.gameName, 0, "review").catch(() => undefined) : undefined;
    return {
      gameName: game.gameName,
      gameId: game.gameId,
      index: game.index,
      launch,
      result,
      spinCount: spins.length,
      winCount: spins.filter((spin) => spin.win).length,
      checks,
      spins,
      consoleErrors: captured.consoleErrors,
      networkErrors: captured.networkErrors,
      feBeMismatches: mismatches,
      notes,
      critical,
      reviewShot,
    };
  }
}
