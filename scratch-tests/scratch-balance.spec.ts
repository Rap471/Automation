import fs from "node:fs";
import path from "node:path";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { regressionConfig } from "../src/config/regression.config";
import { GameFrameHelper } from "../src/helpers/GameFrameHelper";
import { GameLauncherPage } from "../src/pages/GameLauncherPage";
import { ScratchGame, type ScratchView } from "../src/scratch/ScratchGame";
import type { FrontendSnapshot } from "../src/types";
import { parseMoney } from "../src/utils/money";

type Severity = "Critical" | "High" | "Medium";

interface Issue {
  game: string;
  severity: Severity;
  title: string;
  step: string;
  expected: string;
  actual: string;
  beforeUi: number | null;
  beforeBackend: number | null;
  afterUi: number | null;
  afterBackend: number | null;
  bet: number | null;
  network: string;
  screenshot?: string;
}

interface Row {
  step: string;
  action: string;
  ui: number | null;
  backend: number | null;
  bet: number | null;
  result: string;
}

interface Note {
  game: string;
  text: string;
}

interface HttpRecord {
  t: number;
  url: string;
  status: number;
  method: string;
  req: string;
  body: string;
  ready: boolean;
}

interface RoundCall {
  t: number;
  bet: unknown;
  size: unknown;
  ok?: boolean;
  error?: string;
  summary?: Record<string, string | number>;
}

interface GameReport {
  game: string;
  playerId: string;
  currency: string;
  sessionId: string;
  gameUrl: string;
  dimension: string;
  bet: number | null;
  initialUi: number | null;
  initialBackend: number | null;
  rows: Row[];
  notes: string[];
  issues: Issue[];
  urls: string[];
}

const GAMES = [
  { name: "Kobo Ass", playerId: "automation-bal-kobo" },
  { name: "Felice in Space", playerId: "automation-bal-felice" },
];

const POPUP = /insufficient|not enough|low balance|bet limit|wager limit|limit exceeded|invalid bet|unable to|something went wrong/i;

class HttpLog {
  records: HttpRecord[] = [];

  attach(page: Page): void {
    page.on("response", (response) => {
      const url = response.url();
      if (!/\/api\/v1\/|\/api\/session\/(balance|bet-limit|transactions)/i.test(url)) return;
      const record: HttpRecord = {
        t: Date.now(),
        url,
        status: response.status(),
        method: response.request().method(),
        req: response.request().postData()?.slice(0, 800) ?? "",
        body: "",
        ready: false,
      };
      this.records.push(record);
      if (this.records.length > 120) this.records.splice(0, this.records.length - 120);
      void response.text().then((body) => {
        record.body = body.slice(0, 4000);
        record.ready = true;
      }).catch(() => {
        record.ready = true;
      });
    });
  }

  since(t: number): HttpRecord[] {
    return this.records.filter((record) => record.t >= t);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function same(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null || right == null || Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.round(left * 100) === Math.round(right * 100);
}

function summaryNumber(calls: RoundCall[], key: string): number | null {
  for (const call of [...calls].reverse()) {
    const value = call.summary?.[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function acceptedBalances(before: number, bet: number, win: number, priorWin: number | null): number[] {
  const wagerOnly = round2(before - bet);
  const withNewWin = round2(before - bet + win);
  const values = [wagerOnly, withNewWin];
  if (priorWin != null && !same(priorWin, win)) {
    values.push(round2(before + priorWin - bet), round2(before + priorWin - bet + win));
  }
  return values;
}

function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "unread";
  return value.toFixed(2);
}

function findNumber(value: unknown, keys: string[], depth = 0): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 5) return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (!(key in record)) continue;
    const raw = record[key];
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const nested = findNumber(child, keys, depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

function pickBalance(body: string): number | null {
  try {
    return findNumber(JSON.parse(body), ["balance", "balanceAfter", "playerBalance"]);
  } catch {
    return null;
  }
}

function pickWin(body: string): number {
  try {
    return findNumber(JSON.parse(body), ["totalWin", "winAmount", "payout"]) ?? 0;
  } catch {
    return 0;
  }
}

function pickMessage(body: string): string {
  try {
    const found = findText(JSON.parse(body), ["message", "error", "errorMessage", "reason"]);
    return found.slice(0, 240);
  } catch {
    return "";
  }
}

function findText(value: unknown, keys: string[], depth = 0): string {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 4) return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return String(record[key]);
  }
  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const nested = findText(child, keys, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function isWager(url: string): boolean {
  return /\/bet\b|scratch|start-?round|\/round\b/i.test(url) && !/bet-limit|betLevels|initialize/i.test(url);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function popupFrom(state: FrontendSnapshot, extra: string): string {
  const rows = [...state.errorTexts, ...state.texts, extra].map((text) => text.trim()).filter((text) => POPUP.test(text));
  return [...new Set(rows)].slice(0, 6).join(" | ");
}

async function setWallet(page: Page, playerId: string, balance: number, betLimit: number | null): Promise<{ balanceStatus: number; balanceBody: string; limitStatus: number; limitBody: string }> {
  return page.evaluate(async ({ playerId, balance, betLimit }) => {
    const balanceRes = await fetch("/api/session/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, balance }),
    });
    const balanceBody = await balanceRes.text();
    const limitRes = await fetch("/api/session/bet-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, amount: betLimit }),
    });
    const limitBody = await limitRes.text();
    return { balanceStatus: balanceRes.status, balanceBody, limitStatus: limitRes.status, limitBody };
  }, { playerId, balance, betLimit });
}

async function toolbarBalance(page: Page): Promise<number | null> {
  const text = await page.getByRole("button", { name: "Update", exact: true }).locator("xpath=preceding-sibling::div[1]").innerText().catch(() => "");
  const match = text.match(/balance:\s*(-?\d[\d,]*(?:\.\d+)?)/i);
  return match ? parseMoney(match[1]) ?? null : null;
}

async function latestLedgerBalance(page: Page, playerId: string, afterMs: number): Promise<number | null> {
  const body = await page.evaluate(async (id) => {
    const res = await fetch(`/api/session/transactions?playerId=${encodeURIComponent(id)}`);
    return res.text();
  }, playerId).catch(() => "");
  try {
    const json = JSON.parse(body) as { data?: { transactions?: unknown[] } | unknown[]; transactions?: unknown[] };
    const data = json.data;
    const list = Array.isArray(data) ? data : data?.transactions ?? json.transactions ?? [];
    if (!Array.isArray(list)) return null;
    const fresh = list
      .filter((item): item is { createdAt?: string; balanceAfter?: number } => !!item && typeof item === "object")
      .filter((item) => typeof item.balanceAfter === "number" && item.createdAt != null && Date.parse(item.createdAt) >= afterMs - 5_000)
      .sort((left, right) => Date.parse(String(right.createdAt)) - Date.parse(String(left.createdAt)));
    return fresh[0]?.balanceAfter ?? null;
  } catch {
    return null;
  }
}

async function shot(page: Page, game: string, name: string): Promise<string> {
  const folder = path.join(process.cwd(), "test-results", "scratch-balance", "screenshots");
  fs.mkdirSync(folder, { recursive: true });
  const file = `${slug(game)}-${slug(name)}.png`;
  const target = path.join(folder, file);
  const frame = page.locator('iframe[title="Game session"]');
  const saved = await frame.screenshot({ path: target }).then(() => true).catch(async () => {
    await page.screenshot({ path: target }).catch(() => undefined);
    return fs.existsSync(target);
  });
  return saved ? `screenshots/${file}` : "";
}

async function scratchButtonPoint(page: Page): Promise<{ x: number; y: number } | null> {
  const frame = page.frames().find((item) => /stg-games\.dijoker\.com/.test(item.url()));
  if (!frame) return null;
  return frame.evaluate(() => {
    const game = (window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: { scratchCardButton?: { getBounds?: () => { centerX: number; centerY: number } } } }> } } }).phaserGame;
    const scene = (game?.scene?.scenes ?? []).find((item) => item?.slotController);
    const bounds = scene?.slotController?.scratchCardButton?.getBounds?.();
    if (!bounds || !Number.isFinite(bounds.centerX)) return null;
    return { x: bounds.centerX, y: bounds.centerY };
  });
}

async function openPanel(page: Page, frameHelper: GameFrameHelper, scratch: ScratchGame): Promise<ScratchView> {
  const open = (view: ScratchView) => view.panelVisible || view.hostVisible || /scratch card/i.test(view.title);
  let panel = await scratch.snapshot();
  if (!open(panel)) {
    for (let attempt = 1; attempt <= 3 && !open(panel); attempt += 1) {
      const point = await scratchButtonPoint(page);
      if (!point) break;
      await frameHelper.clickGamePoint(point.x, point.y);
      const deadline = Date.now() + 4_000;
      while (!open(panel) && Date.now() < deadline) {
        await page.waitForTimeout(300);
        panel = await scratch.snapshot();
      }
    }
  }
  const deadline = Date.now() + 8_000;
  while (open(panel) && panel.busy && Date.now() < deadline) {
    await page.waitForTimeout(300);
    panel = await scratch.snapshot();
  }
  return panel;
}

async function arm(frame: Frame): Promise<{ ok: boolean; detail: string }> {
  return frame.evaluate(() => {
    const holder = window as Window & {
      __qaBalArmed?: boolean;
      __qaBalRounds?: RoundCall[];
      phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { panel?: { options?: { client?: { startRound?: (bet: unknown, size: unknown) => Promise<unknown> } } } }; scratchPanel?: { options?: { client?: { startRound?: (bet: unknown, size: unknown) => Promise<unknown> } } } }> } };
    };
    if (holder.__qaBalArmed) return { ok: true, detail: "already armed" };
    const scene = (holder.phaserGame?.scene?.scenes ?? []).find((item) => item?.slotController);
    const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
    const client = panel?.options?.client;
    if (!client?.startRound) return { ok: false, detail: "startRound was not on the scratch client" };
    const original = client.startRound.bind(client);
    const rounds: RoundCall[] = [];
    holder.__qaBalRounds = rounds;
    const summarize = (result: unknown): Record<string, string | number> => {
      const picked: Record<string, string | number> = {};
      const walk = (value: unknown, depth: number) => {
        if (!value || typeof value !== "object" || Array.isArray(value) || depth > 4) return;
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          if (typeof child === "number" && /balance|totalWin|winAmount|payout|^bet$/i.test(key) && !(key in picked)) picked[key] = child;
          if (typeof child === "string" && /message|error|status|state|reason/i.test(key) && child.length < 200 && !(key in picked)) picked[key] = child;
          if (child && typeof child === "object" && !Array.isArray(child)) walk(child, depth + 1);
        }
      };
      walk(result, 0);
      return picked;
    };
    client.startRound = async (bet: unknown, size: unknown) => {
      const entry: RoundCall = { t: Date.now(), bet, size };
      rounds.push(entry);
      try {
        const result = await original(bet, size);
        entry.ok = true;
        entry.summary = summarize(result);
        return result;
      } catch (error) {
        entry.ok = false;
        entry.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };
    holder.__qaBalArmed = true;
    return { ok: true, detail: `client keys ${Object.keys(client).slice(0, 20).join(", ")}` };
  });
}

async function roundsSince(frame: Frame, t: number): Promise<RoundCall[]> {
  const rows = await frame.evaluate(() => ((window as Window & { __qaBalRounds?: RoundCall[] }).__qaBalRounds ?? []).map((row) => ({ ...row }))).catch(() => [] as RoundCall[]);
  return rows.filter((row) => row.t >= t);
}

async function popupScan(frame: Frame): Promise<string> {
  return frame.evaluate(() => {
    const rows: string[] = [];
    const visit = (node: { text?: string; visible?: boolean; list?: unknown[]; children?: { list?: unknown[] } } | null, depth: number) => {
      if (!node || depth > 7 || rows.length > 10) return;
      if (typeof node.text === "string" && node.visible !== false && /insufficient|not enough|bet limit|invalid bet|something went wrong|limit exceeded|unable to/i.test(node.text)) {
        rows.push(node.text.trim().slice(0, 180));
      }
      const list = node.list || node.children?.list;
      if (!list) return;
      for (const child of list) visit(child as { text?: string; visible?: boolean; list?: unknown[]; children?: { list?: unknown[] } }, depth + 1);
    };
    const game = (window as Window & { phaserGame?: { scene?: { scenes?: unknown[] } } }).phaserGame;
    for (const scene of game?.scene?.scenes ?? []) visit(scene as { text?: string; list?: unknown[] }, 0);
    const dom = document.body?.innerText || "";
    for (const line of dom.split(/\n+/)) {
      if (/insufficient|bet limit|not enough|invalid bet|limit exceeded|unable to/i.test(line)) rows.push(line.trim().slice(0, 180));
    }
    return [...new Set(rows)].join(" | ");
  }).catch(() => "");
}

async function identity(frame: Frame): Promise<{ sessionId: string; currency: string; url: string }> {
  return frame.evaluate(() => {
    const game = (window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: { gameAPI?: { initializationData?: Record<string, unknown> } } }> } } }).phaserGame;
    const scene = (game?.scene?.scenes ?? []).find((item) => item?.slotController);
    const init = scene?.slotController?.gameAPI?.initializationData ?? {};
    const text = (key: string) => typeof init[key] === "string" || typeof init[key] === "number" ? String(init[key]) : "";
    return {
      sessionId: text("sessionId") || text("session") || text("playerId"),
      currency: text("currency"),
      url: location.href,
    };
  }).catch(() => ({ sessionId: "", currency: "", url: "" }));
}

async function forceBuy(frame: Frame, amount: number): Promise<void> {
  await frame.evaluate(async (nextBet) => {
    const game = (window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { panel?: { scratchBetAmount?: number; onNewCard?: () => Promise<unknown>; onPrimaryAction?: () => Promise<unknown> } }; scratchPanel?: { scratchBetAmount?: number; onNewCard?: () => Promise<unknown>; onPrimaryAction?: () => Promise<unknown> } }> } } }).phaserGame;
    const scene = (game?.scene?.scenes ?? []).find((item) => item?.slotController);
    const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
    if (!panel) return;
    panel.scratchBetAmount = nextBet;
    if (typeof panel.onNewCard === "function") await panel.onNewCard();
    else await panel.onPrimaryAction?.();
  }, amount);
}

function rejected(round: RoundCall | undefined, http: HttpRecord | undefined): boolean {
  const code = String(round?.summary?.errorCode ?? "");
  const summary = JSON.stringify(round?.summary ?? {});
  const message = `${round?.error ?? ""} ${summary} ${http ? pickMessage(http.body) : ""}`;
  if (round?.ok === false) return true;
  if (code && !/^(ok|success|0)$/i.test(code)) return true;
  if (http && http.status >= 400) return true;
  return /insufficient|not enough|bet limit|exceed|invalid|rejected|unable|already active/i.test(message);
}

function networkEvidence(rounds: RoundCall[], http: HttpRecord[]): string {
  const call = rounds.map((round) => `startRound bet=${JSON.stringify(round.bet)} size=${JSON.stringify(round.size)} ok=${String(round.ok)} ${round.error ?? ""} ${JSON.stringify(round.summary ?? {})}`).join(" || ");
  const wire = http.filter((record) => record.ready && (isWager(record.url) || /\/balance\b/i.test(record.url))).slice(-3).map((record) => {
    return `${record.method} ${record.status} ${record.url} req=${record.req.slice(0, 180)} balance=${money(pickBalance(record.body))} win=${money(pickWin(record.body))} message=${pickMessage(record.body) || "-"}`;
  }).join(" || ");
  return [call, wire].filter(Boolean).join(" || ") || "No wager request was captured.";
}

test("Scratch balance stays aligned on Kobo and Felice", async ({ page }) => {
  test.setTimeout(18 * 60 * 1000);
  const selected = (process.env.SCRATCH_BALANCE_GAME ?? "").trim().toLowerCase();
  const games = selected ? GAMES.filter((game) => game.name.toLowerCase().includes(selected)) : GAMES;
  expect(games.length, "SCRATCH_BALANCE_GAME did not match Kobo or Felice").toBeGreaterThan(0);
  const http = new HttpLog();
  http.attach(page);
  const launcher = new GameLauncherPage(page);
  const frameHelper = new GameFrameHelper(page);
  const reports: GameReport[] = [];
  const issues: Issue[] = [];
  const notes: Note[] = [];
  const browserVersion = page.context().browser()?.version() ?? "Chromium";

  try {
    for (const game of games) {
      const report = await runGame(page, launcher, frameHelper, http, game, issues, notes).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        issues.push({
          game: game.name,
          severity: "High",
          title: `${game.name} balance run stopped before the lifecycle finished`,
          step: "Run",
          expected: "The buy, scratch, insufficient-balance, and bet-limit lifecycle completes and every settled UI balance matches the backend.",
          actual: message,
          beforeUi: null,
          beforeBackend: null,
          afterUi: null,
          afterBackend: null,
          bet: null,
          network: "",
        });
        return {
          game: game.name,
          playerId: game.playerId,
          currency: "",
          sessionId: "",
          gameUrl: "",
          dimension: "",
          bet: null,
          initialUi: null,
          initialBackend: null,
          rows: [],
          notes: [message],
          issues: [],
          urls: [],
        } satisfies GameReport;
      });
      reports.push(report);
    }
  } finally {
    for (const game of games) {
      await setWallet(page, game.playerId, 10_000, null).catch(() => undefined);
    }
    writeReport(reports, issues, notes, browserVersion);
  }

  const failures = issues.filter((issue) => issue.severity === "Critical" || issue.severity === "High");
  expect(failures.map((issue) => `${issue.severity} ${issue.game} ${issue.title}: ${issue.actual}`), "scratch balance").toEqual([]);
});

async function runGame(
  page: Page,
  launcher: GameLauncherPage,
  frameHelper: GameFrameHelper,
  http: HttpLog,
  game: { name: string; playerId: string },
  issues: Issue[],
  notes: Note[],
): Promise<GameReport> {
  const report: GameReport = {
    game: game.name,
    playerId: game.playerId,
    currency: "",
    sessionId: "",
    gameUrl: "",
    dimension: "",
    bet: null,
    initialUi: null,
    initialBackend: null,
    rows: [],
    notes: [],
    issues: [],
    urls: [],
  };
  const addNote = (text: string) => {
    report.notes.push(text);
    notes.push({ game: game.name, text });
    console.log(`${game.name}  NOTE  ${text}`);
  };
  const addIssue = (issue: Issue) => {
    report.issues.push(issue);
    issues.push(issue);
    console.log(`${game.name}  ${issue.severity}  ${issue.title}  ${issue.actual}`);
  };

  console.log(`${game.name}  player ${game.playerId} opening launcher`);
  await launcher.open();
  await launcher.setPlayer(game.playerId);
  const match = await findGame(launcher, game.name);
  console.log(`${game.name}  opening once so the sandbox wallet exists`);
  await launcher.openGame(match);
  await frameHelper.waitForInteractive(regressionConfig.launchTimeoutMs);
  await launcher.closeGame().catch(() => undefined);
  let wallet = await setWallet(page, game.playerId, 100, null);
  if (wallet.balanceStatus >= 300) throw new Error(`Could not set ${game.playerId} balance to 100: ${wallet.balanceStatus} ${wallet.balanceBody}`);
  const boot = Date.now();
  let scratch = await launch(page, launcher, frameHelper, match);
  let armed = await arm(await frameHelper.frame());
  if (!armed.ok) addNote(`Balance hook: ${armed.detail}`);
  const who = await identity(await frameHelper.frame());
  report.currency = who.currency || (await frameHelper.readState()).currency || "USD";
  report.sessionId = who.sessionId;
  report.gameUrl = who.url;

  let panel = await scratch.snapshot();
  panel = await scratch.size("3×3");
  for (let step = 0; step < panel.levels.length + 2; step += 1) panel = await scratch.step(-1);
  const stake = panel.bet;
  report.bet = stake;
  report.dimension = panel.selected === 0 ? "3×3" : panel.selected === 1 ? "4×4" : panel.selected === 2 ? "5×5" : String(panel.selected ?? "unread");
  if (stake == null) throw new Error("Scratch bet was not readable after selecting 3×3.");

  let backend = await readBackend(page, http, game.playerId, boot, null);
  const opened = await readUi(page, frameHelper, scratch);
  report.initialUi = opened.ui;
  report.initialBackend = backend.balance;
  report.rows.push(row("1", "Initial balance", opened.ui, backend.balance, stake, backend.source));
  judgePair(game.name, "Initial balance", "UI balance equals the backend balance before any scratch buy.", opened.ui, backend.balance, opened.ui, backend.balance, stake, backend.detail, addIssue);
  if (!same(backend.balance, 100)) addNote(`Wallet was set to 100.00 before launch. Backend read ${money(backend.balance)} from ${backend.source}.`);
  console.log(`${game.name}  initial UI ${money(opened.ui)} backend ${money(backend.balance)} bet ${money(stake)} ${report.dimension} ${report.currency}`);

  await clearRound(page, scratch);
  let bought = await buyAndWatch(page, frameHelper, scratch, http, game, "Buy Scratch once", stake, backend.balance, addIssue, addNote);
  if (/already active/i.test(bought.result)) {
    addNote("Buy Scratch returned 'Round already active' and did not deduct. The open round was cleared and the buy was repeated.");
    await clearRound(page, bought.scratch);
    bought = await buyAndWatch(page, frameHelper, bought.scratch, http, game, "Buy Scratch after clearing the open round", stake, bought.backend, addIssue, addNote);
  }
  scratch = bought.scratch;
  backend = { balance: bought.backend, source: bought.source, detail: bought.network };
  report.rows.push(row("2", "Buy Scratch", bought.ui, bought.backend, stake, bought.result));
  await shot(page, game.name, "after-buy");

  const revealed = await revealCard(page, scratch);
  const afterScratch = await settleRead(page, frameHelper, scratch, http, game.playerId, bought.startedAt, bought.backend);
  report.rows.push(row("3", "Scratch / reveal", afterScratch.ui, afterScratch.balance, stake, `paid ${money(revealed.paid)} ${afterScratch.source}`));
  const expectedAfterScratch = bought.backend == null ? null : round2(bought.backend + revealed.paid);
  if (afterScratch.balance != null && expectedAfterScratch != null && !same(afterScratch.balance, expectedAfterScratch) && !same(afterScratch.balance, bought.backend)) {
    addIssue(baseIssue(game.name, "Critical", "Scratch result changed the wallet by something other than the revealed win", "Scratch / reveal", `Backend ${money(bought.backend)} plus win ${money(revealed.paid)} = ${money(expectedAfterScratch)}.`, `Backend became ${money(afterScratch.balance)}.`, bought.ui, bought.backend, afterScratch.ui, afterScratch.balance, stake, afterScratch.detail));
  }
  judgePair(game.name, "After scratch", "UI balance equals the backend balance after the card is revealed.", afterScratch.ui, afterScratch.balance, afterScratch.ui, afterScratch.balance, stake, afterScratch.detail, addIssue);
  backend = { balance: afterScratch.balance, source: afterScratch.source, detail: afterScratch.detail };

  const refreshed = await refreshSession(page, launcher, frameHelper, match, http, game.playerId);
  scratch = refreshed.scratch;
  report.rows.push(row("4", "Refresh after scratch", refreshed.ui, refreshed.balance, stake, refreshed.source));
  judgePair(game.name, "Refresh after a completed card", "Reload shows the committed backend balance.", refreshed.ui, refreshed.balance, refreshed.ui, refreshed.balance, stake, refreshed.detail, addIssue);
  if (backend.balance != null && refreshed.balance != null && !same(backend.balance, refreshed.balance)) {
    addIssue(baseIssue(game.name, "Critical", "Refresh changed the committed scratch balance", "Refresh after scratch", `Backend stays ${money(backend.balance)}.`, `Reload backend is ${money(refreshed.balance)}.`, afterScratch.ui, backend.balance, refreshed.ui, refreshed.balance, stake, refreshed.detail));
  }
  backend = { balance: refreshed.balance ?? backend.balance, source: refreshed.source, detail: refreshed.detail };

  await clearRound(page, scratch);
  panel = await scratch.snapshot();
  if (!/buy/i.test(panel.actionLabel)) {
    await revealCard(page, scratch);
    addNote(`Buy control read "${panel.actionLabel}" before the rapid clicks, so the open card was revealed first.`);
  }
  for (const count of [2, 5, 10]) {
    const burst = await spam(page, frameHelper, scratch, http, game, count, stake, backend.balance, addIssue, addNote);
    scratch = burst.scratch;
    backend = { balance: burst.backend, source: burst.source, detail: burst.network };
    report.rows.push(row("5", `${count} rapid Buy clicks`, burst.ui, burst.backend, stake, burst.result));
  }

  await launcher.closeGame().catch(() => undefined);
  const low = round2(stake / 2);
  wallet = await setWallet(page, game.playerId, low, null);
  if (wallet.balanceStatus >= 300) throw new Error(`Could not lower balance to ${low}: ${wallet.balanceStatus} ${wallet.balanceBody}`);
  const lowBoot = Date.now();
  scratch = await launch(page, launcher, frameHelper, match);
  await arm(await frameHelper.frame());
  panel = await scratch.snapshot();
  const lowRead = await readBackend(page, http, game.playerId, lowBoot, null);
  const lowUi = await readUi(page, frameHelper, scratch);
  report.rows.push(row("6", "Insufficient balance before click", lowUi.ui, lowRead.balance, panel.bet, `wallet set to ${money(low)}`));
  judgePair(game.name, "Insufficient balance precondition", "UI and backend both show the lowered wallet before Buy Scratch.", lowUi.ui, lowRead.balance, lowUi.ui, lowRead.balance, panel.bet, lowRead.detail, addIssue);
  const denied = await buyAndWatch(page, frameHelper, scratch, http, game, "Insufficient balance Buy Scratch", panel.bet ?? stake, lowRead.balance, addIssue, addNote);
  scratch = denied.scratch;
  report.rows.push(row("7", "Insufficient balance popup", denied.ui, denied.backend, panel.bet, denied.result));
  if (!denied.popup) addNote("Insufficient-balance click did not surface a popup. Settled balances were still compared.");
  const repeat = await buyAndWatch(page, frameHelper, scratch, http, game, "Repeat click after insufficient balance", panel.bet ?? stake, denied.backend, addIssue, addNote);
  scratch = repeat.scratch;
  report.rows.push(row("8", "Repeat click after popup", repeat.ui, repeat.backend, panel.bet, repeat.result));
  const lowRefresh = await refreshSession(page, launcher, frameHelper, match, http, game.playerId);
  scratch = lowRefresh.scratch;
  report.rows.push(row("9", "Refresh after insufficient balance", lowRefresh.ui, lowRefresh.balance, panel.bet, lowRefresh.source));
  judgePair(game.name, "Refresh after insufficient balance", "A rejected buy is still rejected after reload. The wallet is unchanged.", lowRefresh.ui, lowRefresh.balance, lowRefresh.ui, lowRefresh.balance, panel.bet, lowRefresh.detail, addIssue);
  const committedLow = repeat.backend ?? denied.backend ?? lowRead.balance;
  if (committedLow != null && lowRefresh.balance != null && !same(committedLow, lowRefresh.balance)) {
    addIssue(baseIssue(game.name, "Critical", "Insufficient balance still changed the wallet after refresh", "Refresh after insufficient balance", `Wallet stays ${money(committedLow)}.`, `Reload backend is ${money(lowRefresh.balance)}.`, denied.ui, committedLow, lowRefresh.ui, lowRefresh.balance, panel.bet, lowRefresh.detail));
  }

  await launcher.closeGame().catch(() => undefined);
  wallet = await setWallet(page, game.playerId, stake, null);
  if (wallet.balanceStatus >= 300) throw new Error(`Could not set one-bet balance ${stake}: ${wallet.balanceStatus}`);
  const exactBoot = Date.now();
  scratch = await launch(page, launcher, frameHelper, match);
  await arm(await frameHelper.frame());
  panel = await scratch.snapshot();
  const exactStake = panel.bet ?? stake;
  const exactBackend = await readBackend(page, http, game.playerId, exactBoot, null);
  const exactUi = await readUi(page, frameHelper, scratch);
  judgePair(game.name, "One-bet wallet before the sequence", "UI and backend show a wallet that can pay for one scratch.", exactUi.ui, exactBackend.balance, exactUi.ui, exactBackend.balance, exactStake, exactBackend.detail, addIssue);
  const first = await buyAndWatch(page, frameHelper, scratch, http, game, "Sequence buy", exactStake, exactBackend.balance, addIssue, addNote);
  scratch = first.scratch;
  report.rows.push(row("10", "Sequence Buy Scratch", first.ui, first.backend, exactStake, first.result));
  const sequenceReveal = await revealCard(page, scratch);
  const sequenceAfter = await settleRead(page, frameHelper, scratch, http, game.playerId, first.startedAt, first.backend);
  report.rows.push(row("11", "Sequence scratch", sequenceAfter.ui, sequenceAfter.balance, exactStake, `paid ${money(sequenceReveal.paid)}`));
  judgePair(game.name, "Sequence after scratch", "UI equals backend after Buy Scratch and reveal.", sequenceAfter.ui, sequenceAfter.balance, sequenceAfter.ui, sequenceAfter.balance, exactStake, sequenceAfter.detail, addIssue);
  const second = await buyAndWatch(page, frameHelper, scratch, http, game, "Sequence second buy", exactStake, sequenceAfter.balance, addIssue, addNote);
  scratch = second.scratch;
  report.rows.push(row("12", "Sequence popup", second.ui, second.backend, exactStake, second.result));
  if (sequenceReveal.paid > 0 && sequenceAfter.balance != null && sequenceAfter.balance >= exactStake) {
    addNote(`The card paid ${money(sequenceReveal.paid)}, so the wallet could cover another ${money(exactStake)} buy. A server-side drop to ${money(low)} was applied without reloading.`);
    await setWallet(page, game.playerId, low, null);
    const stale = await buyAndWatch(page, frameHelper, scratch, http, game, "Buy after the wallet was lowered behind the open game", exactStake, low, addIssue, addNote);
    scratch = stale.scratch;
    report.rows.push(row("13", "Popup after external wallet drop", stale.ui, stale.backend, exactStake, stale.result));
    const staleRefresh = await refreshSession(page, launcher, frameHelper, match, http, game.playerId);
    scratch = staleRefresh.scratch;
    report.rows.push(row("14", "Refresh after external wallet drop", staleRefresh.ui, staleRefresh.balance, exactStake, staleRefresh.source));
    if (staleRefresh.balance != null && !same(staleRefresh.balance, low) && !same(staleRefresh.balance, stale.backend)) {
      addIssue(baseIssue(game.name, "Critical", "Refresh did not restore the wallet that was lowered during the open session", "Refresh after external wallet drop", `Backend after the drop and any rejected buy is ${money(stale.backend ?? low)}.`, `Reload shows ${money(staleRefresh.balance)}.`, stale.ui, stale.backend, staleRefresh.ui, staleRefresh.balance, exactStake, staleRefresh.detail));
    }
  }

  await launcher.closeGame().catch(() => undefined);
  const limit = round2(stake / 2);
  wallet = await setWallet(page, game.playerId, 100, limit);
  if (wallet.limitStatus >= 300) throw new Error(`Could not set bet limit ${limit}: ${wallet.limitStatus} ${wallet.limitBody}`);
  const limitBoot = Date.now();
  scratch = await launch(page, launcher, frameHelper, match);
  await arm(await frameHelper.frame());
  panel = await scratch.snapshot();
  const limitBackend = await readBackend(page, http, game.playerId, limitBoot, null);
  const limitUi = await readUi(page, frameHelper, scratch);
  report.rows.push(row("15", "Bet limit before click", limitUi.ui, limitBackend.balance, panel.bet, `limit ${money(limit)}`));
  const limited = await buyAndWatch(page, frameHelper, scratch, http, game, "Bet limit Buy Scratch", panel.bet ?? stake, limitBackend.balance, addIssue, addNote);
  scratch = limited.scratch;
  report.rows.push(row("16", "Bet limit popup", limited.ui, limited.backend, panel.bet, limited.result));
  if (!limited.popup) addNote(`Bet limit ${money(limit)} did not produce a popup for bet ${money(panel.bet)}.`);
  const limitRefresh = await refreshSession(page, launcher, frameHelper, match, http, game.playerId);
  scratch = limitRefresh.scratch;
  report.rows.push(row("17", "Refresh after bet limit", limitRefresh.ui, limitRefresh.balance, panel.bet, limitRefresh.source));
  judgePair(game.name, "Refresh after bet limit", "A bet-limit rejection does not become a deduction after reload.", limitRefresh.ui, limitRefresh.balance, limitRefresh.ui, limitRefresh.balance, panel.bet, limitRefresh.detail, addIssue);
  if (limitBackend.balance != null && limitRefresh.balance != null && !same(limitBackend.balance, limitRefresh.balance)) {
    addIssue(baseIssue(game.name, "Critical", "Bet limit rejection changed the wallet by the time the game was reloaded", "Refresh after bet limit", `Wallet stays ${money(limitBackend.balance)}.`, `Reload backend is ${money(limitRefresh.balance)}.`, limited.ui, limitBackend.balance, limitRefresh.ui, limitRefresh.balance, panel.bet, limitRefresh.detail));
  }

  await setWallet(page, game.playerId, 100, null);
  const overMax = await forceAndWatch(page, frameHelper, scratch, http, game, "Forced bet above the 55 ladder max", 80, 100, addIssue, addNote);
  scratch = overMax.scratch;
  report.rows.push(row("18", "Forced bet 80", overMax.ui, overMax.backend, 80, overMax.result));
  const overBalance = await forceAndWatch(page, frameHelper, scratch, http, game, "Forced bet above the wallet", 250, overMax.backend, addIssue, addNote);
  report.rows.push(row("19", "Forced bet 250", overBalance.ui, overBalance.backend, 250, overBalance.result));

  report.urls = [...new Set(http.records.map((record) => `${record.method} ${record.status} ${record.url.split("?")[0]}`))].slice(-30);
  console.log(`${game.name}  done  issues ${report.issues.length}`);
  return report;
}

function row(step: string, action: string, ui: number | null, backend: number | null, bet: number | null, result: string): Row {
  return { step, action, ui, backend, bet, result };
}

function baseIssue(
  game: string,
  severity: Severity,
  title: string,
  step: string,
  expected: string,
  actual: string,
  beforeUi: number | null,
  beforeBackend: number | null,
  afterUi: number | null,
  afterBackend: number | null,
  bet: number | null,
  network: string,
  screenshot?: string,
): Issue {
  return { game, severity, title, step, expected, actual, beforeUi, beforeBackend, afterUi, afterBackend, bet, network, screenshot };
}

function judgePair(
  game: string,
  step: string,
  expected: string,
  ui: number | null,
  backend: number | null,
  afterUi: number | null,
  afterBackend: number | null,
  bet: number | null,
  network: string,
  addIssue: (issue: Issue) => void,
): void {
  if (ui == null || backend == null) {
    addIssue(baseIssue(game, "High", "UI or backend balance was unreadable", step, expected, `UI ${money(ui)}, backend ${money(backend)}.`, ui, backend, afterUi, afterBackend, bet, network));
    return;
  }
  if (!same(ui, backend)) {
    addIssue(baseIssue(game, "Critical", "UI balance does not match the backend balance", step, expected, `UI ${money(ui)} vs backend ${money(backend)} (${money(round2(ui - backend))}).`, ui, backend, afterUi, afterBackend, bet, network));
  }
}

async function findGame(launcher: GameLauncherPage, name: string) {
  const found = await launcher.discoverGames();
  const match = found.find((item) => item.gameName.toLowerCase().includes(name.toLowerCase()));
  expect(match, `Game not on the launcher: ${name}`).toBeTruthy();
  return match!;
}

async function launch(page: Page, launcher: GameLauncherPage, frameHelper: GameFrameHelper, match: Awaited<ReturnType<GameLauncherPage["discoverGames"]>>[number]): Promise<ScratchGame> {
  await launcher.openGame(match);
  const state = await frameHelper.waitForInteractive(regressionConfig.launchTimeoutMs);
  if (state.phase !== "playing") throw new Error(`Game did not reach play. Phase ${state.phase}. ${state.errorTexts.join(" ")}`);
  const scratch = new ScratchGame(await frameHelper.frame());
  const panel = await openPanel(page, frameHelper, scratch);
  if (!panel.panelVisible && !/scratch card/i.test(panel.title)) throw new Error("Scratch card panel did not open.");
  return scratch;
}

async function readUi(page: Page, frameHelper: GameFrameHelper, scratch: ScratchGame): Promise<{ ui: number | null; text: string; popup: string; panel: ScratchView }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const state = await frameHelper.readState();
      const panel = await scratch.snapshot();
      const scanned = await popupScan(await frameHelper.frame());
      return { ui: state.balance ?? null, text: state.balanceText ?? "", popup: popupFrom(state, scanned), panel };
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(700);
    }
  }
  throw lastError;
}

async function readBackend(page: Page, http: HttpLog, playerId: string, since: number, fallback: number | null): Promise<{ balance: number | null; source: string; detail: string }> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && http.since(since).some((record) => !record.ready)) await page.waitForTimeout(100);
  const rows = http.since(since).filter((record) => record.ready);
  const balanceCall = [...rows].reverse().find((record) => /\/slots\/balance\b/i.test(record.url) && pickBalance(record.body) != null);
  const wagerCall = [...rows].reverse().find((record) => isWager(record.url) && pickBalance(record.body) != null);
  const initCall = [...rows].reverse().find((record) => /initialize/i.test(record.url) && pickBalance(record.body) != null);
  const chosen = wagerCall ?? balanceCall ?? initCall;
  const ledger = await latestLedgerBalance(page, playerId, since);
  if (chosen) {
    const balance = pickBalance(chosen.body);
    const ledgerNote = ledger == null ? "" : ` ledger ${money(ledger)}`;
    return { balance, source: chosen.url.split("?")[0], detail: `${chosen.method} ${chosen.status} ${chosen.url} ${pickMessage(chosen.body)}${ledgerNote}`.trim() };
  }
  if (ledger != null) return { balance: ledger, source: "session transactions", detail: "Newest transaction balanceAfter." };
  const toolbar = await toolbarBalance(page);
  if (toolbar != null) return { balance: toolbar, source: "launcher wallet", detail: "Launcher Balance label." };
  return { balance: fallback, source: fallback == null ? "unread" : "previous balance", detail: rows.map((record) => `${record.status} ${record.url.split("?")[0]}`).join(" | ") };
}

async function refreshSession(
  page: Page,
  launcher: GameLauncherPage,
  frameHelper: GameFrameHelper,
  match: Awaited<ReturnType<GameLauncherPage["discoverGames"]>>[number],
  http: HttpLog,
  playerId: string,
): Promise<{ scratch: ScratchGame; ui: number | null; balance: number | null; source: string; detail: string }> {
  const started = Date.now();
  const frame = await frameHelper.frame();
  await frame.evaluate(() => location.reload()).catch(async () => {
    await launcher.closeGame().catch(() => undefined);
    await launcher.openGame(match);
  });
  await page.waitForTimeout(800);
  const state = await frameHelper.waitForInteractive(regressionConfig.launchTimeoutMs);
  if (state.phase !== "playing") {
    await launcher.closeGame().catch(() => undefined);
    await launcher.openGame(match);
    await frameHelper.waitForInteractive(regressionConfig.launchTimeoutMs);
  }
  const scratch = new ScratchGame(await frameHelper.frame());
  await openPanel(page, frameHelper, scratch);
  await arm(await frameHelper.frame());
  const ui = await readUi(page, frameHelper, scratch);
  const backend = await readBackend(page, http, playerId, started, null);
  return { scratch, ui: ui.ui, balance: backend.balance, source: backend.source, detail: backend.detail };
}

async function buyAndWatch(
  page: Page,
  frameHelper: GameFrameHelper,
  scratch: ScratchGame,
  http: HttpLog,
  game: { name: string; playerId: string },
  step: string,
  bet: number,
  backendBefore: number | null,
  addIssue: (issue: Issue) => void,
  addNote: (text: string) => void,
): Promise<{ scratch: ScratchGame; ui: number | null; backend: number | null; source: string; result: string; popup: string; network: string; startedAt: number }> {
  const beforeUi = await readUi(page, frameHelper, scratch);
  const startedAt = Date.now();
  const samples: Array<{ ms: number; ui: number | null; popup: string }> = [];
  const click = scratch.clickBuy();
  let popupShot = "";
  let sawPopup = "";
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const current = await readUi(page, frameHelper, scratch).catch(() => beforeUi);
    samples.push({ ms: Date.now() - startedAt, ui: current.ui, popup: current.popup });
    if (current.popup && !popupShot) {
      sawPopup = current.popup;
      popupShot = await shot(page, game.name, `${step}-popup`);
    }
    const calls = await roundsSince(await frameHelper.frame(), startedAt).catch(() => [] as RoundCall[]);
    const wire = http.since(startedAt).filter((record) => record.ready && isWager(record.url));
    if ((calls.some((call) => call.summary || call.error) || wire.length > 0 || current.popup) && Date.now() - startedAt > 500) break;
    await page.waitForTimeout(200);
  }
  const hit = await click.catch((error: unknown) => ({ ok: false, debug: error instanceof Error ? error.message : String(error) }));
  await page.waitForTimeout(1_200);
  let calls = await roundsSince(await frameHelper.frame(), startedAt).catch(() => [] as RoundCall[]);
  let wire = http.since(startedAt).filter((record) => isWager(record.url));
  if (!calls.length && !wire.length && !hit.ok) {
    const frame = await frameHelper.frame();
    await frame.evaluate(async () => {
      const holder = window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { panel?: { onNewCard?: () => Promise<unknown>; onPrimaryAction?: () => Promise<unknown> } }; scratchPanel?: { onNewCard?: () => Promise<unknown>; onPrimaryAction?: () => Promise<unknown> } }> } } };
      const scene = (holder.phaserGame?.scene?.scenes ?? []).find((item) => item?.slotController);
      const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
      if (typeof panel?.onNewCard === "function") await panel.onNewCard();
      else await panel?.onPrimaryAction?.();
    }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    calls = await roundsSince(await frameHelper.frame(), startedAt).catch(() => [] as RoundCall[]);
    wire = http.since(startedAt).filter((record) => isWager(record.url));
  }
  const readyDeadline = Date.now() + 4_000;
  while (Date.now() < readyDeadline && wire.some((record) => !record.ready)) await page.waitForTimeout(100);
  const after = await readUi(page, frameHelper, scratch);
  const backend = await readBackend(page, http, game.playerId, startedAt, backendBefore);
  const summaryBalance = summaryNumber(calls, "balance") ?? summaryNumber(calls, "balanceAfter");
  if (summaryBalance != null) {
    if (backend.balance != null && !same(backend.balance, summaryBalance)) {
      addNote(`${step}: startRound balance ${money(summaryBalance)} disagrees with ${backend.source} ${money(backend.balance)}. The transaction payload is treated as the backend balance.`);
    }
    backend.balance = summaryBalance;
    backend.source = "startRound";
  }
  const accepted = calls.filter((call) => call.ok && !rejected(call, wire[wire.length - 1]));
  const failed = calls.filter((call) => rejected(call, wire[wire.length - 1])) ;
  const popup = after.popup || sawPopup;
  const network = networkEvidence(calls, http.since(startedAt));
  const result = `${popup || "no popup"}; clicks=${hit.ok}; startRound=${calls.length}; http=${wire.length}; accepted=${accepted.length}; summary=${JSON.stringify(calls.at(-1)?.summary ?? {})}`;
  console.log(`${game.name}  ${step}  UI ${money(beforeUi.ui)} -> ${money(after.ui)} backend ${money(backendBefore)} -> ${money(backend.balance)} ${result}`);

  const dipped = samples.some((sample) => sample.ui != null && beforeUi.ui != null && !same(sample.ui, beforeUi.ui) && !same(sample.ui, after.ui));
  if (dipped && same(after.ui, backend.balance)) addNote(`${step}: UI balance moved through ${samples.map((sample) => money(sample.ui)).join(" -> ")} and settled on ${money(after.ui)}.`);
  if (dipped && backend.balance != null && !same(after.ui, backend.balance)) {
    const picture = popupShot || await shot(page, game.name, `${step}-stale`);
    addIssue(baseIssue(game.name, "Critical", "UI balance changed during Buy Scratch and did not settle on the backend balance", step, "The settled UI balance equals the backend balance.", `Samples ${samples.map((sample) => money(sample.ui)).join(" -> ")}. Settled UI ${money(after.ui)}, backend ${money(backend.balance)}.`, beforeUi.ui, backendBefore, after.ui, backend.balance, bet, network, picture));
  }

  if (!calls.length && !wire.length) {
    const settledBackend = backend.balance ?? backendBefore;
    const uiMoved = beforeUi.ui != null && after.ui != null && !same(beforeUi.ui, after.ui);
    const backendMoved = backendBefore != null && settledBackend != null && !same(backendBefore, settledBackend);
    if (uiMoved && !backendMoved) {
      addIssue(baseIssue(game.name, "Critical", "UI balance changed without a Buy Scratch request or a backend change", step, "No request means the wallet and the UI stay put.", `UI ${money(beforeUi.ui)} -> ${money(after.ui)}. Backend stayed ${money(settledBackend)}.`, beforeUi.ui, backendBefore, after.ui, settledBackend, bet, network, popupShot));
    } else if (backendMoved && after.ui != null && !same(after.ui, settledBackend)) {
      addIssue(baseIssue(game.name, "Critical", "Backend balance changed without the UI following it", step, "If a pending win settles, the UI shows that same backend balance.", `UI ${money(beforeUi.ui)} -> ${money(after.ui)}. Backend ${money(backendBefore)} -> ${money(settledBackend)}.`, beforeUi.ui, backendBefore, after.ui, settledBackend, bet, network, popupShot));
    } else if (uiMoved && backendMoved) {
      addNote(`${step}: balance moved ${money(beforeUi.ui)} -> ${money(after.ui)} without a new startRound, and the UI matched the backend. A pending win or collect settled.`);
    }
    judgePair(game.name, step, "UI stays equal to the backend when Buy Scratch does not reach the server.", after.ui, settledBackend, after.ui, settledBackend, bet, network, addIssue);
    return { scratch, ui: after.ui, backend: settledBackend, source: backend.source, result, popup, network, startedAt };
  }

  const serverRejected = failed.length > 0 || wire.some((record) => record.ready && (record.status >= 400 || rejected(undefined, record)));
  const serverAccepted = accepted.length > 0 || wire.some((record) => record.ready && record.status < 400 && pickBalance(record.body) != null && !rejected(undefined, record));
  if (serverRejected && !serverAccepted) {
    if (backendBefore != null && backend.balance != null && !same(backendBefore, backend.balance)) {
      addIssue(baseIssue(game.name, "Critical", "A rejected Buy Scratch still changed the backend balance", step, "A failed buy leaves the backend balance unchanged.", `Backend ${money(backendBefore)} -> ${money(backend.balance)}. Popup: ${popup || "none"}.`, beforeUi.ui, backendBefore, after.ui, backend.balance, bet, network, popupShot || await shot(page, game.name, `${step}-rejected`)));
    }
    if (beforeUi.ui != null && after.ui != null && !same(beforeUi.ui, after.ui)) {
      addIssue(baseIssue(game.name, "Critical", "A rejected Buy Scratch changed the UI balance", step, "The UI balance after a failed buy equals the balance before the click.", `UI ${money(beforeUi.ui)} -> ${money(after.ui)}. Popup: ${popup || "none"}.`, beforeUi.ui, backendBefore, after.ui, backend.balance, bet, network, popupShot));
    }
  }
  if (serverAccepted) {
    const responseBalance = backend.balance;
    const win = summaryNumber(calls, "totalWin") ?? summaryNumber(calls, "winAmount") ?? summaryNumber(calls, "payout") ?? wire.reduce((sum, record) => sum + (record.ready ? pickWin(record.body) : 0), 0);
    const priorWin = summaryNumber(calls, "totalWinAmount");
    if (backendBefore != null && responseBalance != null) {
      const allowed = acceptedBalances(backendBefore, bet, win, priorWin);
      if (!allowed.some((value) => same(responseBalance, value))) {
        addIssue(baseIssue(game.name, "Critical", "Accepted Buy Scratch balance does not match bet and win", step, `Backend becomes one of ${allowed.map((value) => money(value)).join(", ")}. A new win stays off the balance until the card is collected. totalWinAmount is the previous card when it differs from winAmount.`, `Backend ${money(backendBefore)} -> ${money(responseBalance)} for bet ${money(bet)}, win ${money(win)}, prior win ${money(priorWin)}.`, beforeUi.ui, backendBefore, after.ui, responseBalance, bet, network));
      }
    }
    if (accepted.length > 1) {
      addIssue(baseIssue(game.name, "Critical", "One Buy Scratch click created more than one accepted transaction", step, "One click creates one accepted buy.", `${accepted.length} accepted startRound calls. ${network}`, beforeUi.ui, backendBefore, after.ui, backend.balance, bet, network, popupShot));
    }
  }
  judgePair(game.name, step, "Settled UI balance equals the backend balance.", after.ui, backend.balance, after.ui, backend.balance, bet, network, addIssue);
  return { scratch, ui: after.ui, backend: backend.balance, source: backend.source, result, popup, network, startedAt };
}

async function clearRound(page: Page, scratch: ScratchGame): Promise<void> {
  await scratch.poke().catch(() => undefined);
  await scratch.reveal().catch(() => undefined);
  const frame = page.frames().find((item) => /stg-games\.dijoker\.com/.test(item.url()));
  if (!frame) return;
  await frame.evaluate(async () => {
    const game = (window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { panel?: { clearScratchWinPresentation?: () => void; autoCollect?: () => Promise<unknown>; newButtonImage?: { __disabled?: boolean } } }; scratchPanel?: { clearScratchWinPresentation?: () => void; autoCollect?: () => Promise<unknown>; newButtonImage?: { __disabled?: boolean } } }> } } }).phaserGame;
    const scene = (game?.scene?.scenes ?? []).find((item) => item?.slotController);
    const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
    panel?.clearScratchWinPresentation?.();
    if (typeof panel?.autoCollect === "function") await panel.autoCollect();
    if (panel?.newButtonImage) panel.newButtonImage.__disabled = false;
  }).catch(() => undefined);
  await page.waitForTimeout(600);
}

async function revealCard(page: Page, scratch: ScratchGame): Promise<{ paid: number; view: ScratchView }> {
  await scratch.poke().catch(() => undefined);
  let view = await scratch.reveal().catch(async () => scratch.snapshot());
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    view = await scratch.snapshot();
    const shown = parseMoney(view.amountText) ?? parseMoney(view.youWon) ?? 0;
    const paid = (view.totalWin ?? 0) > 0 ? view.totalWin ?? 0 : shown;
    if (view.allRevealed || paid > 0 || (view.settled && !view.scratching && view.revealed >= view.cellCount && view.cellCount > 0)) {
      return { paid, view };
    }
    await page.waitForTimeout(400);
  }
  const shown = parseMoney(view.amountText) ?? parseMoney(view.youWon) ?? 0;
  return { paid: (view.totalWin ?? 0) > 0 ? view.totalWin ?? 0 : shown, view };
}

async function settleRead(page: Page, frameHelper: GameFrameHelper, scratch: ScratchGame, http: HttpLog, playerId: string, since: number, fallback: number | null) {
  await page.waitForTimeout(800);
  const ui = await readUi(page, frameHelper, scratch);
  const backend = await readBackend(page, http, playerId, since, fallback);
  return { ui: ui.ui, ...backend };
}

async function spam(
  page: Page,
  frameHelper: GameFrameHelper,
  scratch: ScratchGame,
  http: HttpLog,
  game: { name: string; playerId: string },
  count: number,
  bet: number,
  backendBefore: number | null,
  addIssue: (issue: Issue) => void,
  addNote: (text: string) => void,
): Promise<{ scratch: ScratchGame; ui: number | null; backend: number | null; source: string; result: string; network: string }> {
  const startedAt = Date.now();
  const before = await readUi(page, frameHelper, scratch);
  const frame = await frameHelper.frame();
  const clicking = Promise.all(Array.from({ length: count }, () => scratch.clickBuy().catch(() => ({ ok: false, debug: "click failed" }))));
  const burst = await frame.evaluate((clicks) => {
    const gameWindow = window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { panel?: { newButtonImage?: { emit?: (name: string, pointer: unknown) => void; __disabled?: boolean }; scene?: { input?: { activePointer?: unknown } } } }; scratchPanel?: { newButtonImage?: { emit?: (name: string, pointer: unknown) => void; __disabled?: boolean }; scene?: { input?: { activePointer?: unknown } } } }> } } };
    const scene = (gameWindow.phaserGame?.scene?.scenes ?? []).find((item) => item?.slotController);
    const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
    const button = panel?.newButtonImage;
    const pointer = panel?.scene?.input?.activePointer;
    const disabled: boolean[] = [];
    for (let index = 0; index < clicks; index += 1) {
      disabled.push(!!button?.__disabled);
      button?.emit?.("pointerdown", pointer);
      button?.emit?.("pointerup", pointer);
    }
    return { disabled };
  }, count).catch(() => ({ disabled: [] as boolean[] }));
  await clicking;
  await page.waitForTimeout(2_000);
  const calls = await roundsSince(await frameHelper.frame(), startedAt).catch(() => [] as RoundCall[]);
  const readyDeadline = Date.now() + 8_000;
  while (Date.now() < readyDeadline) {
    const pending = http.since(startedAt).filter((record) => isWager(record.url) && !record.ready);
    const done = await roundsSince(await frameHelper.frame(), startedAt).catch(() => calls);
    if (!pending.length && done.every((call) => call.summary || call.error || call.ok === false)) break;
    await page.waitForTimeout(200);
  }
  const after = await readUi(page, frameHelper, scratch);
  const finalCalls = await roundsSince(await frameHelper.frame(), startedAt).catch(() => calls);
  const wire = http.since(startedAt).filter((record) => isWager(record.url));
  const backend = await readBackend(page, http, game.playerId, startedAt, backendBefore);
  const accepted = finalCalls.filter((call) => call.ok && !rejected(call, undefined));
  const network = networkEvidence(finalCalls, http.since(startedAt));
  const locked = burst.disabled.slice(1).some(Boolean);
  const result = `emitted ${count}; disabled-after-first ${locked}; startRound ${finalCalls.length}; http ${wire.length}; accepted ${accepted.length}`;
  console.log(`${game.name}  spam ${count}  ${result} UI ${money(before.ui)} -> ${money(after.ui)} backend ${money(backendBefore)} -> ${money(backend.balance)}`);
  if (accepted.length > 1) {
    const picture = await shot(page, game.name, `spam-${count}`);
    addIssue(baseIssue(game.name, "Critical", "Rapid Buy Scratch clicks created more than one accepted transaction", `${count} rapid clicks`, "A burst while the buy is processing produces one deduction.", result, before.ui, backendBefore, after.ui, backend.balance, bet, network, picture));
  }
  if (accepted.length === 0 && before.ui != null && after.ui != null && backendBefore != null && backend.balance != null) {
    const uiMoved = !same(before.ui, after.ui);
    const backendMoved = !same(backendBefore, backend.balance);
    if (uiMoved && !backendMoved) {
      addIssue(baseIssue(game.name, "Critical", "Rapid clicks changed the UI balance without an accepted buy", `${count} rapid clicks`, "Rejected or ignored clicks do not move the UI balance.", `UI ${money(before.ui)} -> ${money(after.ui)}. ${result}`, before.ui, backendBefore, after.ui, backend.balance, bet, network));
    } else if (backendMoved && !same(after.ui, backend.balance)) {
      addIssue(baseIssue(game.name, "Critical", "Rapid clicks changed the backend balance without an accepted buy", `${count} rapid clicks`, "Ignored clicks do not move the wallet away from the UI.", `Backend ${money(backendBefore)} -> ${money(backend.balance)}. UI ${money(after.ui)}. ${result}`, before.ui, backendBefore, after.ui, backend.balance, bet, network));
    } else if (uiMoved && backendMoved) {
      addNote(`${count} rapid clicks: no accepted buy, and the balance still moved from ${money(before.ui)} to ${money(after.ui)} on both UI and backend.`);
    }
  }
  const charged = Number(accepted[0]?.bet);
  const chargedBet = Number.isFinite(charged) ? charged : bet;
  if (accepted.length === 1 && backendBefore != null && backend.balance != null) {
    const win = summaryNumber(finalCalls, "totalWin") ?? summaryNumber(finalCalls, "winAmount") ?? summaryNumber(finalCalls, "payout") ?? wire.reduce((sum, record) => sum + (record.ready ? pickWin(record.body) : 0), 0);
    const priorWin = summaryNumber(finalCalls, "totalWinAmount");
    const allowed = acceptedBalances(backendBefore, chargedBet, win, priorWin);
    if (!allowed.some((value) => same(backend.balance, value))) {
      addIssue(baseIssue(game.name, "Critical", "One accepted burst buy did not deduct the stake once", `${count} rapid clicks`, `Backend becomes one of ${allowed.map((value) => money(value)).join(", ")} for request bet ${money(chargedBet)}.`, `Backend ${money(backendBefore)} -> ${money(backend.balance)}.`, before.ui, backendBefore, after.ui, backend.balance, chargedBet, network));
    }
  }
  judgePair(game.name, `${count} rapid Buy clicks`, "UI equals backend after the burst settles.", after.ui, backend.balance, after.ui, backend.balance, bet, network, addIssue);
  if (!locked && count >= 5) addNote(`${count} rapid clicks did not show the buy button locking after the first press. Accepted transactions: ${accepted.length}.`);
  void addNote;
  return { scratch, ui: after.ui, backend: backend.balance, source: backend.source, result, network };
}

async function forceAndWatch(
  page: Page,
  frameHelper: GameFrameHelper,
  scratch: ScratchGame,
  http: HttpLog,
  game: { name: string; playerId: string },
  step: string,
  bet: number,
  backendBefore: number | null,
  addIssue: (issue: Issue) => void,
  addNote: (text: string) => void,
): Promise<{ scratch: ScratchGame; ui: number | null; backend: number | null; result: string }> {
  const before = await readUi(page, frameHelper, scratch);
  const startedAt = Date.now();
  await forceBuy(await frameHelper.frame(), bet);
  await page.waitForTimeout(2_000);
  const after = await readUi(page, frameHelper, scratch);
  const calls = await roundsSince(await frameHelper.frame(), startedAt).catch(() => [] as RoundCall[]);
  const wire = http.since(startedAt).filter((record) => isWager(record.url));
  const readyDeadline = Date.now() + 4_000;
  while (Date.now() < readyDeadline && wire.some((record) => !record.ready)) await page.waitForTimeout(100);
  const backend = await readBackend(page, http, game.playerId, startedAt, backendBefore);
  const network = networkEvidence(calls, http.since(startedAt));
  const sentBet = calls[0] ? Number(calls[0].bet) : null;
  const popup = after.popup;
  const accepted = calls.filter((call) => call.ok && !rejected(call, wire[wire.length - 1]));
  const result = `popup=${popup || "none"}; sent bet=${money(sentBet)}; accepted=${accepted.length}`;
  console.log(`${game.name}  ${step}  ${result} UI ${money(before.ui)} -> ${money(after.ui)} backend ${money(backendBefore)} -> ${money(backend.balance)}`);
  if (sentBet != null && sentBet !== bet) addNote(`${step} asked for ${money(bet)} and the client sent ${money(sentBet)}.`);
  if (!accepted.length) {
    if (before.ui != null && after.ui != null && !same(before.ui, after.ui)) {
      const picture = await shot(page, game.name, step);
      addIssue(baseIssue(game.name, "Critical", "A rejected out-of-range bet changed the UI balance", step, "An invalid bet does not change the UI balance.", `UI ${money(before.ui)} -> ${money(after.ui)}. ${result}`, before.ui, backendBefore, after.ui, backend.balance, bet, network, picture));
    }
    if (backendBefore != null && backend.balance != null && !same(backendBefore, backend.balance)) {
      const picture = await shot(page, game.name, `${step}-backend`);
      addIssue(baseIssue(game.name, "Critical", "A rejected out-of-range bet changed the backend balance", step, "An invalid bet does not change the wallet.", `Backend ${money(backendBefore)} -> ${money(backend.balance)}. ${result}`, before.ui, backendBefore, after.ui, backend.balance, bet, network, picture));
    }
  } else if (bet > 55 || (backendBefore != null && bet > backendBefore)) {
    const picture = await shot(page, game.name, step);
    addIssue(baseIssue(game.name, "Critical", "An out-of-range scratch bet was accepted and could change the wallet", step, "A bet above the ladder maximum or above the wallet is rejected with no deduction.", result, before.ui, backendBefore, after.ui, backend.balance, bet, network, picture));
  }
  judgePair(game.name, step, "UI equals backend after the out-of-range bet settles.", after.ui, backend.balance, after.ui, backend.balance, bet, network, addIssue);
  void addNote;
  return { scratch, ui: after.ui, backend: backend.balance, result };
}

function writeReport(reports: GameReport[], issues: Issue[], notes: Note[], browserVersion: string): void {
  const folder = path.join(process.cwd(), "test-results", "scratch-balance");
  fs.mkdirSync(folder, { recursive: true });
  const generatedAt = new Date().toISOString();
  const safeReports = reports.map((report) => ({ ...report, gameUrl: report.gameUrl.split("?")[0] }));
  fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify({ generatedAt, browserVersion, reports: safeReports, issues, notes }, null, 2));
  const lines: string[] = [
    "# Scratch balance investigation",
    "",
    `Generated: ${generatedAt}`,
    "",
    `Environment: STG, Chromium ${browserVersion}, headless, viewport 1440×900, launcher https://stg-asset-tools.dijoker.com/game-launcher.`,
    "",
  ];
  for (const report of reports) {
    lines.push(`## ${report.game}`, "");
    lines.push(`Player: \`${report.playerId}\`. Currency: ${report.currency || "unread"}. Session: ${report.sessionId || "unread"}.`);
    lines.push(`Dimension: ${report.dimension || "unread"}. Bet: ${money(report.bet)}. Initial UI: ${money(report.initialUi)}. Initial backend: ${money(report.initialBackend)}.`);
    const safeUrl = report.gameUrl ? report.gameUrl.split("?")[0] : "unread";
    lines.push(`Game URL: ${safeUrl}`);
    lines.push("");
    lines.push("| Step | Action | UI Balance | Backend Balance | Bet | Result |");
    lines.push("| --- | --- | ---: | ---: | ---: | --- |");
    for (const item of report.rows) {
      lines.push(`| ${item.step} | ${item.action} | ${money(item.ui)} | ${money(item.backend)} | ${money(item.bet)} | ${item.result.replace(/\|/g, "/")} |`);
    }
    lines.push("");
    if (report.notes.length) {
      lines.push("Notes:");
      for (const note of report.notes) lines.push(`- ${note}`);
      lines.push("");
    }
    if (report.urls.length) {
      lines.push("Network URLs seen:");
      for (const url of report.urls) lines.push(`- ${url}`);
      lines.push("");
    }
  }
  if (!issues.length) {
    lines.push("## Result", "", "No settled UI/backend balance discrepancy was found on Kobo Ass or Felice in Space.", "");
  }
  for (const issue of issues) {
    lines.push(`## ${issue.severity} — ${issue.title}`, "");
    lines.push(`Game: ${issue.game}`);
    lines.push("");
    lines.push("### Environment");
    lines.push("");
    lines.push(`STG, Chromium ${browserVersion}, headless, viewport 1440×900.`);
    lines.push("");
    lines.push("### Initial / measured state");
    lines.push("");
    lines.push(`- Step: ${issue.step}`);
    lines.push(`- UI before: ${money(issue.beforeUi)}`);
    lines.push(`- Backend before: ${money(issue.beforeBackend)}`);
    lines.push(`- UI after: ${money(issue.afterUi)}`);
    lines.push(`- Backend after: ${money(issue.afterBackend)}`);
    lines.push(`- Bet: ${money(issue.bet)}`);
    lines.push(`- Screenshot: ${issue.screenshot || "not captured"}`);
    lines.push("");
    lines.push("### Expected");
    lines.push("");
    lines.push(issue.expected);
    lines.push("");
    lines.push("### Actual");
    lines.push("");
    lines.push(issue.actual);
    lines.push("");
    lines.push("### Balance evidence");
    lines.push("");
    lines.push(`\`${money(issue.beforeUi)} / ${money(issue.beforeBackend)} → ${issue.step} → UI ${money(issue.afterUi)} → backend ${money(issue.afterBackend)}\``);
    lines.push("");
    lines.push("### Network evidence");
    lines.push("");
    lines.push(issue.network || "No request captured.");
    lines.push("");
  }
  fs.writeFileSync(path.join(folder, "report.md"), lines.join("\n"));
}
