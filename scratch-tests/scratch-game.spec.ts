import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { regressionConfig } from "../src/config/regression.config";
import { parseMoney } from "../src/utils/money";
import { GameFrameHelper } from "../src/helpers/GameFrameHelper";
import { GameLauncherPage } from "../src/pages/GameLauncherPage";
import { ScratchGame, type ScratchView } from "../src/scratch/ScratchGame";
import { qaEmit } from "../src/live/qaEvents";
import { writeScratchReport, type ScratchCheck } from "../src/scratch/scratchReport";

type Status = ScratchCheck["status"];

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", ZAR: "R" };
const SCRATCH_MIN_BET = { "3×3": 0.2, "4×4": 1, "5×5": 2.4 } as const;

function sameMoney(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null || right == null) return false;
  return Math.round(left * 100) === Math.round(right * 100);
}

function sameCurrency(code: string | undefined, betText: string): boolean {
  if (!code || !betText) return false;
  if (betText.toUpperCase().includes(code.toUpperCase())) return true;
  const symbol = CURRENCY_SYMBOL[code.toUpperCase()];
  return !!symbol && betText.includes(symbol);
}

function sizeFromNote(note: string): number | undefined {
  const match = note.match(/"size"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function betFromNote(note: string): number | undefined {
  for (const part of note.split(" | ")) {
    const jsonStart = part.indexOf("{");
    if (jsonStart < 0) continue;
    const found = betFromBody(part.slice(jsonStart));
    if (found != null) return found;
  }
  return undefined;
}

function betFromBody(body: string | null): number | undefined {
  if (!body) return undefined;
  try {
    return findBet(JSON.parse(body));
  } catch {
    return undefined;
  }
}

function findBet(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["bet", "betAmount", "baseBet", "wager", "stake", "amount", "price"]) {
    if (!(key in record)) continue;
    const parsed = Number(record[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  for (const item of Object.values(record)) {
    if (item && typeof item === "object") {
      const nested = findBet(item);
      if (nested != null) return nested;
    }
  }
  return undefined;
}

const configuredNames = regressionConfig.gameNames.map((name) => name.trim()).filter(Boolean);
const limitedNames = regressionConfig.gameLimit > 0 ? configuredNames.slice(0, regressionConfig.gameLimit) : configuredNames;
const scratchGame = (process.env.SCRATCH_GAME ?? "").trim().toLowerCase();
const liveNames = (process.env.QA_GAME_LIST ?? "").split("|").map((name) => name.trim()).filter(Boolean);
const scratchNames = liveNames.length
  ? liveNames
  : scratchGame
    ? limitedNames.filter((name) => name.toLowerCase().includes(scratchGame))
    : limitedNames;

if (scratchNames.length === 0) {
  test("scratch game list is empty", async () => {
    throw new Error("Add game names in src/config/regression.config.ts so scratch has a game to launch.");
  });
}

for (const [order, gameName] of scratchNames.entries()) {
test(`Scratch ${gameName}`, async ({ page }, testInfo) => {
  test.setTimeout(4 * 60 * 1000);
  const playerId = `automation-scratch-${testInfo.workerIndex + 1}`;
  writeScratchReport([{
    name: "Button is existing and clickable",
    status: "BLOCKED",
    details: "This game is still running. Its finished result replaces this row.",
  }], gameName, order);
  qaEmit({ type: "GAME_STARTED", game: gameName, worker: testInfo.workerIndex + 1, status: "RUNNING", message: "Scratch started" });
  const checks: ScratchCheck[] = [];
  const note = async (name: string, status: Status, details: string) => {
    let screenshot: string | undefined;
    if (status === "FAIL" || status === "BLOCKED") {
      const folder = path.join(process.cwd(), "test-results", "scratch-screenshots");
      fs.mkdirSync(folder, { recursive: true });
      const gameSlug = gameName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 30);
      const fileName = `${gameSlug}-${String(checks.length + 1).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40)}.png`;
      const target = path.join(folder, fileName);
      const frame = page.locator('iframe[title="Game session"]');
      const saved = await frame.first().screenshot({ path: target }).then(() => true).catch(async () => {
        await page.screenshot({ path: target }).catch(() => undefined);
        return fs.existsSync(target);
      });
      if (saved) screenshot = `scratch-screenshots/${fileName}`;
    }
    const existing = checks.find((check) => check.name === name);
    if (existing) {
      existing.status = status;
      existing.details = details;
      existing.screenshot = screenshot;
    } else {
      checks.push({ name, status, details, screenshot });
    }
    console.log(`${gameName}  ${status}  ${name}  ${details}${screenshot ? `  screenshot ${screenshot}` : ""}`);
    writeScratchReport(checks, gameName, order);
    qaEmit({
      type: status === "FAIL" ? "ERROR_DETECTED" : "CHECK",
      game: gameName,
      worker: testInfo.workerIndex + 1,
      status,
      message: name,
      details,
      screenshot,
    });
    if (screenshot) {
      qaEmit({ type: "SCREENSHOT", game: gameName, worker: testInfo.workerIndex + 1, status, message: "Screenshot captured", screenshot, details: name });
    }
  };
  const launcher = new GameLauncherPage(page);
  const frameHelper = new GameFrameHelper(page);
  try {
    console.log(`Worker ${testInfo.workerIndex + 1} player ${playerId} launching ${gameName}`);
    await launcher.open();
    await launcher.setPlayer(playerId);
    const found = await launcher.discoverGames();
    const match = found.find((game) => game.gameName.toLowerCase().includes(gameName.toLowerCase()));
    expect(match, `Game not on the launcher: ${gameName}`).toBeTruthy();
    await launcher.openGame(match!);
    const slot = await frameHelper.waitForInteractive(regressionConfig.launchTimeoutMs);
    const scratch = new ScratchGame(await frameHelper.frame());
    const closed = await scratch.snapshot();
    const buttonPoint = await scratchButtonPoint(page);
    await note(
      "Button is existing and clickable",
      closed.buttonExists && closed.buttonEnabled && /^scratch$/i.test(closed.buttonLabel) ? "PASS" : "FAIL",
      closed.buttonExists ? `Label "${closed.buttonLabel}", enabled ${closed.buttonEnabled}.` : "SCRATCH button was not on the slot controller.",
    );

    const scratchIsOpen = (view: ScratchView) => view.panelVisible || view.hostVisible || /scratch card/i.test(view.title);
    let panel = await waitUntil(scratch, scratchIsOpen, 4_000);
    let scratchClicks = 0;
    if (scratchIsOpen(panel)) {
      console.log(`${gameName} SCRATCH panel already open after launch. No click.`);
    }
    for (let attempt = 1; attempt <= 3 && !scratchIsOpen(panel); attempt += 1) {
      const point = attempt === 1 ? buttonPoint : await scratchButtonPoint(page);
      const latest = await scratch.snapshot();
      if (scratchIsOpen(latest)) {
        panel = latest;
        break;
      }
      if (!point) continue;
      scratchClicks = attempt;
      console.log(`${gameName} SCRATCH click ${attempt} at ${Math.round(point.x)},${Math.round(point.y)}`);
      await frameHelper.clickGamePoint(point.x, point.y);
      panel = await waitUntil(scratch, scratchIsOpen, 4_000);
    }
    if (scratchIsOpen(panel)) panel = await waitUntil(scratch, (view) => scratchIsOpen(view) && !view.busy, 12_000);
    const openedOnLaunch = scratchIsOpen(panel) && scratchClicks === 0;
    await note(
      "Scratch Card Panel",
      scratchIsOpen(panel) && /scratch card/i.test(panel.title) ? "PASS" : "FAIL",
      scratchIsOpen(panel)
        ? openedOnLaunch
          ? `Panel title "${panel.title}" opened by itself after launch.`
          : `Panel title "${panel.title}" after ${scratchClicks} SCRATCH click${scratchClicks === 1 ? "" : "s"}.`
        : `SCRATCH stayed closed after ${scratchClicks} click${scratchClicks === 1 ? "" : "s"}.`,
    );
    if (!scratchIsOpen(panel)) {
      for (const name of [
        "Bet + increases correctly",
        "Bet – decreases correctly",
        "Bet locked during scratching",
        "Bet value matches backend request",
        "Bet currency is same with the slot bet currency",
        "Dimension selection is existing and clickable",
        "Clicking 3x3 size change the scratch dimension",
        "Clicking 4x4 size change the scratch dimension",
        "Clicking 5x5 size change the scratch dimension",
        "Legends exist for 3x3",
        "Legends exist for 4x4",
        "Legends exist for 5x5",
        "Legends differ by dimension",
        "Base bet on 3x3 dimension cannot go below minimum",
        "Base bet on 4x4 dimension cannot go below minimum",
        "Base bet on 5x5 dimension cannot go below minimum",
        "Base bet on 3x3 dimension cannot go above maximum",
        "Base bet on 4x4 dimension cannot go above maximum",
        "Base bet on 5x5 dimension cannot go above maximum",
        "Cannot scratch upon launching panel",
        "Buy Card button",
        "Buy button disabled until the card settles",
        "Size locked during scratching",
        "Scratch all button",
        "Buy Card returns after scratch all",
        "Can scratch manually",
        "Win can only have three or more symbols",
        "Total win prompts",
      ]) await note(name, "BLOCKED", "The scratch card panel did not open.");
      return;
    }

    await note(
      "Bet currency is same with the slot bet currency",
      sameCurrency(slot.currency, panel.betText) ? "PASS" : "FAIL",
      `Slot currency ${slot.currency ?? "missing"}. Scratch bet text "${panel.betText}".`,
    );

    const dimsOk = panel.dims.some((label) => /3\s*[x×]\s*3/i.test(label))
      && panel.dims.some((label) => /4\s*[x×]\s*4/i.test(label))
      && panel.dims.some((label) => /5\s*[x×]\s*5/i.test(label));

    let sizesClicked = 0;
    const legendsBySize: Record<string, string> = {};
    const sizeResult = async (label: string, checkName: string, legendName: string) => {
      const before = panel.selected;
      panel = await scratch.size(label);
      const changed = panel.selected != null && panel.selected !== before;
      const clicked = panel.lastClick === "pointer";
      if (changed && clicked) sizesClicked += 1;
      const sizeName = panel.selected === 0 ? "3×3" : panel.selected === 1 ? "4×4" : panel.selected === 2 ? "5×5" : String(panel.selected);
      legendsBySize[label] = panel.legend.join(", ");
      await note(checkName, changed && clicked ? "PASS" : "FAIL", `Clicked ${label}. Selected size ${before} -> ${panel.selected} (${sizeName}). ${panel.networkNote}`);
      await note(legendName, panel.legend.length > 0 ? "PASS" : "FAIL", panel.legend.length ? panel.legend.join(", ") : "Legend was empty.");
    };
    await sizeResult("5×5", "Clicking 5x5 size change the scratch dimension", "Legends exist for 5x5");
    await sizeResult("4×4", "Clicking 4x4 size change the scratch dimension", "Legends exist for 4x4");
    await sizeResult("3×3", "Clicking 3x3 size change the scratch dimension", "Legends exist for 3x3");
    await note("Dimension selection is existing and clickable", dimsOk && sizesClicked === 3 ? "PASS" : "FAIL", `Sizes: ${panel.dims.join(", ") || "none"}. Clicks that changed the grid: ${sizesClicked}.`);
    const legendLines = (["3×3", "4×4", "5×5"] as const).map((label) => `${label}: ${legendsBySize[label] || "empty"}`);
    const legendSets = new Set(Object.values(legendsBySize).filter(Boolean));
    await note(
      "Legends differ by dimension",
      legendSets.size === 3 ? "PASS" : "FAIL",
      legendLines.join(" "),
    );

    const room = panel.levels.length > (panel.minIndex ?? 0) + 1;
    if (room) {
      const start = panel.bet;
      const raised = await scratch.step(1);
      const lowered = await scratch.step(-1);
      panel = lowered;
      await note("Bet + increases correctly", raised.bet != null && start != null && raised.bet > start ? "PASS" : "FAIL", `Bet ${start} -> ${raised.bet}.`);
      await note("Bet – decreases correctly", lowered.bet != null && raised.bet != null && lowered.bet < raised.bet ? "PASS" : "FAIL", `Bet ${raised.bet} -> ${lowered.bet}.`);
    } else {
      await note("Bet + increases correctly", "BLOCKED", "The selected size has no bet above the minimum.");
      await note("Bet – decreases correctly", "BLOCKED", "The selected size has no bet above the minimum.");
    }

    for (const [label, name] of [
      ["3×3", "Base bet on 3x3 dimension cannot go below minimum"],
      ["4×4", "Base bet on 4x4 dimension cannot go below minimum"],
      ["5×5", "Base bet on 5x5 dimension cannot go below minimum"],
    ] as const) {
      const expected = SCRATCH_MIN_BET[label];
      panel = await scratch.size(label);
      for (let step = 0; step < panel.levels.length + 2; step += 1) panel = await scratch.step(-1);
      const held = await scratch.step(-1);
      const atFloor = sameMoney(panel.bet, expected) && sameMoney(held.bet, expected);
      await note(name, atFloor ? "PASS" : "FAIL", `Minimum ${expected.toFixed(2)}. Bet stayed ${held.bet == null ? "unread" : held.bet.toFixed(2)}.`);
      panel = held;
    }

    for (const [label, name] of [
      ["3×3", "Base bet on 3x3 dimension cannot go above maximum"],
      ["4×4", "Base bet on 4x4 dimension cannot go above maximum"],
      ["5×5", "Base bet on 5x5 dimension cannot go above maximum"],
    ] as const) {
      panel = await scratch.size(label);
      const top = panel.levels.length ? panel.levels[panel.levels.length - 1] : undefined;
      let previous = panel.bet;
      for (let step = 0; step < panel.levels.length + 2; step += 1) {
        panel = await scratch.step(1);
        if (sameMoney(panel.bet, previous)) break;
        previous = panel.bet;
      }
      const held = await scratch.step(1);
      const atCeiling = top != null && sameMoney(panel.bet, top) && sameMoney(held.bet, top);
      await note(name, atCeiling ? "PASS" : "FAIL", `Maximum ${top ?? "n/a"}. Bet stayed ${held.bet}.`);
      panel = held;
    }

    panel = await scratch.size("3×3");
    const beforePoke = await scratch.snapshot();
    const poked = await scratch.poke();
    await note(
      "Cannot scratch upon launching panel",
      !beforePoke.hasRound && poked.revealed === 0 && !poked.scratching ? "PASS" : "FAIL",
      `Round ${beforePoke.hasRound}. Revealed cells ${poked.revealed}. Scratching ${poked.scratching}.`,
    );

    const paidAmount = (view: ScratchView): number => {
      if ((view.totalWin ?? 0) > 0) return view.totalWin ?? 0;
      const shown = parseMoney(view.amountText);
      return shown != null && shown > 0 ? shown : 0;
    };
    type CardOutcome = { label: string; paid: number; match: number; symbols: string; prompt: string; promptVisible: boolean; promptAmount: number | null; totalWin: number | null };
    const cards: CardOutcome[] = [];
    const winPromptVisible = (view: ScratchView) => {
      const shown = parseMoney(view.amountText) ?? parseMoney(view.youWon);
      const winCopy = /you won|winner|congrats/i.test(view.youWon);
      return (view.youWonVisible && winCopy) || ((view.youWonVisible || view.amountVisible) && shown != null && shown > 0);
    };
    const remember = (label: string, view: ScratchView) => {
      if (!view.hasRound) return;
      cards.push({
        label,
        paid: paidAmount(view),
        match: view.matchCount,
        symbols: view.symbols.join(", "),
        prompt: `${view.youWon} ${view.amountText}`.trim(),
        promptVisible: winPromptVisible(view),
        promptAmount: parseMoney(view.amountText) ?? parseMoney(view.youWon) ?? null,
        totalWin: view.totalWin,
      });
    };
    const sizeBuys: Array<{ label: string; sizeClick: string; buyClick: string; uiBet: number | null; requestBet: number | undefined; requestSize: number | undefined; cells: number; hasRound: boolean; networkNote: string; paid: number; match: number; symbols: string; prompt: string; promptVisible: boolean }> = [];
    for (const label of ["3×3", "4×4", "5×5"] as const) {
      panel = await scratch.size(label);
      const sizeClick = panel.lastClick;
      const sizeNote = panel.networkNote;
      for (let step = 0; step < panel.levels.length + 2; step += 1) panel = await scratch.step(-1);
      panel = await waitUntil(scratch, (view) => !view.busy, 8_000);
      const uiBet = panel.bet;
      const actionBefore = panel.actionLabel;
      const boughtNow = await scratch.buy();
      const networkNote = boughtNow.networkNote;
      const bought = await waitUntil(scratch, (view) => view.hasRound && view.cellCount > 0, 15_000);
      panel = bought.hasRound ? bought : boughtNow;
      if (label === "3×3") {
        if (!panel.hasRound) {
          await note("Buy button disabled until the card settles", "BLOCKED", "The 3×3 BUY click did not start a card.");
          await note("Bet locked during scratching", "BLOCKED", "The 3×3 BUY click did not start a card.");
          await note("Size locked during scratching", "BLOCKED", "The 3×3 BUY click did not start a card.");
          await note("Can scratch manually", "BLOCKED", "The 3×3 BUY click did not start a card.");
          await note("Scratch all button", "BLOCKED", "The 3×3 BUY click did not start a card.");
          await note("Buy Card returns after scratch all", "BLOCKED", "The 3×3 BUY click did not start a card.");
        } else {
          const disabledOnBuy = boughtNow.actionDisabled;
          panel = await waitUntil(scratch, (view) => view.hasRound && view.settled, 12_000);
          await note(
            "Buy button disabled until the card settles",
            disabledOnBuy && panel.settled && !panel.actionDisabled ? "PASS" : "FAIL",
            `Disabled right after buy ${disabledOnBuy}. After the card settled, disabled ${panel.actionDisabled}.`,
          );
          const beforeManual = panel;
          await scratch.poke();
          const manual = await waitUntil(scratch, (view) => view.revealed > beforeManual.revealed, 6_000);
          const lockedFrom = manual.bet;
          const locked = await scratch.step(1, { keepCard: true });
          panel = locked;
          await note(
            "Bet locked during scratching",
            manual.scratching && sameMoney(lockedFrom, locked.bet) ? "PASS" : "FAIL",
            `Scratching ${manual.scratching}. Bet ${lockedFrom} -> ${locked.bet}.`,
          );
          const sizeBefore = panel.selected;
          const sizeAttempt = await scratch.pressSize("5×5");
          panel = sizeAttempt;
          await note(
            "Size locked during scratching",
            manual.scratching && sizeAttempt.selected === sizeBefore ? "PASS" : "FAIL",
            `Scratching ${manual.scratching}. Clicked 5×5. Size stayed ${sizeBefore} -> ${sizeAttempt.selected}. ${sizeAttempt.networkNote}`,
          );
          await note(
            "Can scratch manually",
            !beforeManual.scratching && manual.revealed > beforeManual.revealed ? "PASS" : "FAIL",
            `Scratching ${beforeManual.scratching} -> ${manual.scratching}. Revealed ${beforeManual.revealed} -> ${manual.revealed} of ${manual.cellCount}.`,
          );
          const scratchAllLabel = manual.actionLabel;
          panel = await scratch.reveal();
          panel = await waitUntil(scratch, (view) => view.cellCount > 0 && view.revealed >= view.cellCount && view.allRevealed, 12_000);
          const uncovered = panel.cellCount > 0 && panel.revealed >= panel.cellCount && panel.allRevealed;
          await note(
            "Scratch all button",
            /scratch all/i.test(scratchAllLabel) && uncovered ? "PASS" : "FAIL",
            `Button "${scratchAllLabel}". All revealed ${panel.allRevealed}. Revealed ${panel.revealed} of ${panel.cellCount}.`,
          );
          const returned = await waitUntil(scratch, (view) => view.settled && /buy\s*card/i.test(view.actionLabel), 12_000);
          panel = returned;
          await note(
            "Buy Card returns after scratch all",
            returned.settled && /buy\s*card/i.test(returned.actionLabel) ? "PASS" : "FAIL",
            `Button "${returned.actionLabel}". Settled ${returned.settled}.`,
          );
        }
      } else if (panel.hasRound) {
        panel = await waitUntil(scratch, (view) => view.hasRound && view.settled, 12_000);
        await scratch.poke();
        await scratch.reveal();
        panel = await waitUntil(scratch, (view) => view.settled && (paidAmount(view) > 0 || view.allRevealed || !view.scratching), 10_000);
      }
      if (paidAmount(panel) === 0 && panel.matchCount >= 3) {
        panel = await waitUntil(scratch, (view) => paidAmount(view) > 0, 8_000);
      }
      if (paidAmount(panel) > 0 && !panel.youWonVisible && !panel.amountVisible) {
        panel = await waitUntil(scratch, (view) => view.youWonVisible || view.amountVisible, 8_000);
      }
      remember(label, panel);
      sizeBuys.push({
        label,
        sizeClick,
        buyClick: boughtNow.lastClick,
        uiBet,
        requestBet: betFromNote(networkNote),
        requestSize: sizeFromNote(networkNote),
        cells: panel.cellCount,
        hasRound: panel.hasRound,
        networkNote,
        paid: paidAmount(panel),
        match: panel.matchCount,
        symbols: panel.symbols.join(", "),
        prompt: `${panel.youWon} ${panel.amountText}`.trim(),
        promptVisible: panel.youWonVisible || panel.amountVisible,
      });
      console.log(`${label} size ${sizeClick} ${sizeNote} | buy ${boughtNow.lastClick} cells ${panel.cellCount} ${networkNote} paid ${paidAmount(panel)} action "${actionBefore}"`);
    }

    const expected = [
      { label: "3×3", size: 0, cells: 9 },
      { label: "4×4", size: 1, cells: 16 },
      { label: "5×5", size: 2, cells: 25 },
    ];
    const buyLines = sizeBuys.map((run, index) => `${run.label} size-click ${run.sizeClick}, buy-click ${run.buyClick}, cells ${run.cells}, request size ${run.requestSize ?? "missing"}, UI bet ${run.uiBet}, request bet ${run.requestBet ?? "missing"}. ${run.networkNote}`);
    const boughtAll = expected.every((item, index) => {
      const run = sizeBuys[index];
      return !!run && run.sizeClick === "pointer" && run.buyClick === "pointer" && run.hasRound && run.requestSize === item.size && run.cells === item.cells;
    });
    await note(
      "Buy Card button",
      boughtAll ? "PASS" : "FAIL",
      buyLines.join(" "),
    );
    const betsMatch = sizeBuys.length === 3 && sizeBuys.every((run) => run.hasRound && sameMoney(run.uiBet, run.requestBet));
    await note(
      "Bet value matches backend request",
      betsMatch ? "PASS" : sizeBuys.some((run) => run.hasRound) ? "FAIL" : "BLOCKED",
      buyLines.join(" "),
    );

    const describeCard = (card: CardOutcome) => `${card.label} paid ${card.paid}, match ${card.match}, prompt "${card.prompt}" visible ${card.promptVisible}`;
    const promptMatches = (card: CardOutcome) => {
      if (card.promptAmount == null) return false;
      if (card.totalWin != null && card.totalWin > 0) return sameMoney(card.promptAmount, card.totalWin);
      return sameMoney(card.promptAmount, card.paid);
    };
    if (!cards.some((card) => card.paid > 0)) {
      for (let card = cards.length; card < 6; card += 1) {
        const previous = panel.symbols.join("|");
        panel = await waitUntil(scratch, (view) => !view.busy, 10_000);
        const next = await scratch.buy();
        console.log(`Next card ${next.networkNote}`);
        const ready = await waitUntil(scratch, (view) => view.hasRound && view.symbols.join("|") !== previous && view.symbols.join("|") !== "", 15_000);
        panel = ready.symbols.join("|") !== previous ? ready : next;
        if (!panel.symbols.length || panel.symbols.join("|") === previous) break;
        await scratch.poke();
        await scratch.reveal();
        panel = await waitUntil(scratch, (view) => paidAmount(view) > 0 || view.allRevealed || (!view.busy && !view.scratching), 10_000);
        if (paidAmount(panel) === 0 && panel.matchCount >= 3) {
          panel = await waitUntil(scratch, (view) => paidAmount(view) > 0, 8_000);
        }
        if (paidAmount(panel) > 0 && !panel.youWonVisible && !panel.amountVisible) {
          panel = await waitUntil(scratch, (view) => view.youWonVisible || view.amountVisible, 8_000);
        }
        remember(`card ${card + 1}`, panel);
        console.log(`Card ${card + 1} paid ${paidAmount(panel)} match ${panel.matchCount} ${panel.symbols.join(", ")}`);
        if (paidAmount(panel) > 0) break;
      }
    }
    const winners = cards.filter((card) => card.paid > 0);
    const unpaidMatch = cards.filter((card) => card.paid === 0 && card.match >= 3);
    const shortWin = cards.filter((card) => card.paid > 0 && card.match < 3);
    const lossPrompt = cards.filter((card) => card.paid === 0 && card.promptVisible);
    const badWinPrompt = winners.filter((card) => !card.promptVisible || !promptMatches(card));
    if (unpaidMatch.length || shortWin.length) {
      await note("Win can only have three or more symbols", "FAIL", [...unpaidMatch, ...shortWin].map(describeCard).join(" "));
    } else if (!winners.length) {
      await note("Win can only have three or more symbols", "BLOCKED", cards.length ? `${cards.length} card(s) were bought. None paid a win. Losing cards stayed under three matching symbols. ${cards.map(describeCard).join(" ")}` : "No card was bought, so a winning match was not observed.");
    } else {
      await note("Win can only have three or more symbols", "PASS", winners.map(describeCard).join(" "));
    }
    if (lossPrompt.length || badWinPrompt.length) {
      await note("Total win prompts", "FAIL", [...lossPrompt, ...badWinPrompt].map(describeCard).join(" "));
    } else if (!winners.length) {
      await note("Total win prompts", "BLOCKED", cards.length ? `${cards.length} card(s) were bought. None paid a win, so the total-win prompt was not shown. Losing cards kept the prompt hidden.` : "No card was bought, so the total-win prompt was not shown.");
    } else {
      await note("Total win prompts", "PASS", winners.map((card) => `${card.label} prompt "${card.prompt}" amount ${card.promptAmount} total win ${card.totalWin}`).join(" "));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!checks.length) await note("Button is existing and clickable", "BLOCKED", message);
    else throw error;
  } finally {
    const report = writeScratchReport(checks, gameName, order);
    console.log(`Saved ${gameName} in ${report}`);
    const failed = checks.filter((check) => check.status === "FAIL").length;
    const passed = checks.filter((check) => check.status === "PASS").length;
    qaEmit({
      type: "GAME_COMPLETED",
      game: gameName,
      worker: testInfo.workerIndex + 1,
      status: failed ? "FAIL" : checks.some((check) => check.status === "BLOCKED") ? "BLOCKED" : "PASS",
      message: `Scratch finished. ${passed} passed, ${failed} failed`,
    });
    await launcher.closeGame().catch(() => undefined);
    if (checks.length) {
      const required = [
        "Button is existing and clickable",
        "Scratch Card Panel",
        "Bet + increases correctly",
        "Bet – decreases correctly",
        "Bet locked during scratching",
        "Bet value matches backend request",
        "Bet currency is same with the slot bet currency",
        "Dimension selection is existing and clickable",
        "Clicking 3x3 size change the scratch dimension",
        "Clicking 4x4 size change the scratch dimension",
        "Clicking 5x5 size change the scratch dimension",
        "Legends exist for 3x3",
        "Legends exist for 4x4",
        "Legends exist for 5x5",
        "Legends differ by dimension",
        "Base bet on 3x3 dimension cannot go below minimum",
        "Base bet on 4x4 dimension cannot go below minimum",
        "Base bet on 5x5 dimension cannot go below minimum",
        "Base bet on 3x3 dimension cannot go above maximum",
        "Base bet on 4x4 dimension cannot go above maximum",
        "Base bet on 5x5 dimension cannot go above maximum",
        "Cannot scratch upon launching panel",
        "Buy Card button",
        "Buy button disabled until the card settles",
        "Size locked during scratching",
        "Scratch all button",
        "Buy Card returns after scratch all",
        "Can scratch manually",
        "Win can only have three or more symbols",
        "Total win prompts",
      ];
      const missing = required.filter((name) => !checks.some((check) => check.name === name));
      const inconclusiveWhenBlocked = new Set([
        "Win can only have three or more symbols",
        "Total win prompts",
      ]);
      const failed = checks.filter((check) => check.status === "FAIL" || (check.status === "BLOCKED" && !inconclusiveWhenBlocked.has(check.name)));
      expect([...missing.map((name) => `Missing: ${name}`), ...failed.map((check) => `${check.name}: ${check.details}`)], "scratch cases").toEqual([]);
    }
  }
});
}

async function scratchButtonPoint(page: Page): Promise<{ x: number; y: number } | null> {
  const frame = page.frames().find((item) => /stg-games\.dijoker\.com/.test(item.url()));
  if (!frame) return null;
  return frame.evaluate(() => {
    const game = (window as any).phaserGame;
    const scene = (game?.scene?.scenes ?? []).find((item: any) => item?.slotController);
    const bounds = scene?.slotController?.scratchCardButton?.getBounds?.();
    if (!bounds || !Number.isFinite(bounds.centerX)) return null;
    return { x: bounds.centerX, y: bounds.centerY };
  });
}

async function waitUntil(scratch: ScratchGame, done: (view: ScratchView) => boolean, timeoutMs: number): Promise<ScratchView> {
  let view = await scratch.snapshot();
  const deadline = Date.now() + timeoutMs;
  while (!done(view) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    view = await scratch.snapshot();
  }
  return view;
}
