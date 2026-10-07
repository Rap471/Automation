import fs from "node:fs";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { GameFrameHelper } from "../helpers/GameFrameHelper";
import { NetworkMonitor } from "../helpers/NetworkMonitor";
import { parseSpinResponse } from "../helpers/SpinResultParser";
import { ScratchGame, type ScratchView } from "../scratch/ScratchGame";
import type { FrontendSnapshot } from "../types";
import { parseMoney } from "../utils/money";
import { type Checkpoint, matchLabel, round2, same } from "./model";

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

export interface CapturedTxn {
  count: number;
  bet: number | null;
  win: number | null;
  balance: number | null;
  api: string;
  request: string;
  response: string;
  currency: string;
  transactionId: string;
  playerId: string;
  feature: string;
  rejected: boolean;
}

export interface ActionCapture {
  beforeUi: number | null;
  beforeBackend: number | null;
  afterUi: number | null;
  afterBackend: number | null;
  bet: number | null;
  baseBet: number | null;
  win: number | null;
  accepted: number;
  api: string;
  request: string;
  response: string;
  currency: string;
  feature: string;
  popup: string;
  checkpoints: Checkpoint[];
  note: string;
}

const POPUP = /insufficient|not enough|low balance|bet limit|wager limit|limit exceeded|invalid bet|unable to|something went wrong|already active/i;

export class Wire {
  private records: HttpRecord[] = [];

  constructor(private readonly page: Page) {
    page.on("response", (response) => {
      const url = response.url();
      if (!/\/api\/v1\/|\/api\/session\/(balance|bet-limit|transactions)/i.test(url)) return;
      const record: HttpRecord = {
        t: Date.now(),
        url,
        status: response.status(),
        method: response.request().method(),
        req: response.request().postData() ?? "",
        body: "",
        ready: false,
      };
      this.records.push(record);
      if (this.records.length > 200) this.records.splice(0, this.records.length - 200);
      void response.text().then((body) => {
        record.body = body.slice(0, 6000);
        record.ready = true;
      }).catch(() => {
        record.ready = true;
      });
    });
  }

  since(t: number): HttpRecord[] {
    return this.records.filter((record) => record.t >= t);
  }

  async ready(t: number, waitMs = 2500): Promise<void> {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && this.since(t).some((record) => !record.ready)) {
      await this.page.waitForTimeout(100);
    }
  }
}

function findNumber(value: unknown, keys: RegExp, depth = 0): number | null {
  if (!value || typeof value !== "object" || depth > 5) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNumber(item, keys, depth + 1);
      if (nested != null) return nested;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(record)) {
    if (!keys.test(key)) continue;
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  for (const child of Object.values(record)) {
    const nested = findNumber(child, keys, depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

function findText(value: unknown, keys: RegExp, depth = 0): string {
  if (!value || typeof value !== "object" || depth > 5) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findText(item, keys, depth + 1);
      if (nested) return nested;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(record)) {
    if (keys.test(key) && typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const child of Object.values(record)) {
    const nested = findText(child, keys, depth + 1);
    if (nested) return nested;
  }
  return "";
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function redact(value: string): string {
  return value
    .replace(/access_token=[^&\s'"]+/gi, "access_token=[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .slice(0, 1400);
}

function unresolvedId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const root = body as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : root;
  const value = data.unresolvedSpin ?? root.unresolvedSpin;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function completeBalance(network: NetworkMonitor, body: unknown): number | undefined {
  const id = unresolvedId(body);
  return id ? network.unresolvedComplete(id)?.balance : undefined;
}

function isWager(url: string): boolean {
  return /\/bet\b|scratch|start-?round|\/round\b/i.test(url) && !/bet-limit|betLevels|initialize/i.test(url);
}

function rejectedBody(body: string, status: number): boolean {
  if (status >= 400) return true;
  const parsed = parseJson(body);
  const message = `${findText(parsed, /message|error|reason/i)} ${body}`.slice(0, 500);
  const code = findText(parsed, /errorCode|code/i);
  if (code && !/^(ok|success|0)$/i.test(code)) return true;
  return POPUP.test(message);
}

export function currenciesIn(text: string): string[] {
  const found = new Set<string>();
  const parsed = parseJson(text);
  const code = findText(parsed, /^currency$/i).toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) found.add(code);
  for (const match of text.toUpperCase().matchAll(/"currency"\s*:\s*"([A-Z]{3})"/g)) found.add(match[1]);
  return [...found];
}

export function balanceUpdateButton(page: Page) {
  return page.locator("xpath=//button[normalize-space(text())='Update']");
}

export async function readSessionBalance(page: Page, playerId: string): Promise<number | null> {
  const body = await page.evaluate(async (id) => {
    const response = await fetch(`/api/session/balance?playerId=${encodeURIComponent(id)}`);
    return response.text();
  }, playerId).catch(() => "");
  return findNumber(parseJson(body), /^balance$/i);
}

export async function setWallet(page: Page, playerId: string, balance: number): Promise<string> {
  const update = balanceUpdateButton(page);
  await update.click();
  const field = page.getByPlaceholder("e.g. 10", { exact: true });
  await field.fill(String(balance));
  const apply = page.getByRole("button", { name: "Update wallet" });
  await apply.click();
  await apply.waitFor({ state: "hidden", timeout: 8_000 }).catch(() => undefined);
  return `Update wallet balance ${balance} for ${playerId}`;
}

export async function toolbarBalance(page: Page): Promise<number | null> {
  const beside = await balanceUpdateButton(page).locator("xpath=preceding-sibling::div[1]").innerText().catch(() => "");
  const pageText = beside || await page.locator("body").innerText().catch(() => "");
  const match = pageText.match(/balance:\s*(-?\d[\d,]*(?:\.\d+)?)/i);
  return match ? parseMoney(match[1]) ?? null : null;
}

async function latestLedger(page: Page, playerId: string, afterMs: number): Promise<number | null> {
  const body = await page.evaluate(async (id) => {
    const response = await fetch(`/api/session/transactions?playerId=${encodeURIComponent(id)}`);
    return response.text();
  }, playerId).catch(() => "");
  const parsed = parseJson(body) as { data?: { transactions?: unknown[] } | unknown[]; transactions?: unknown[] } | null;
  const data = parsed && typeof parsed === "object" ? parsed.data : undefined;
  const list = Array.isArray(data) ? data : data && typeof data === "object" && "transactions" in data ? data.transactions : parsed?.transactions;
  if (!Array.isArray(list)) return null;
  const fresh = list
    .filter((item): item is { createdAt?: string; balanceAfter?: number } => !!item && typeof item === "object")
    .filter((item) => typeof item.balanceAfter === "number" && item.createdAt != null && Date.parse(item.createdAt) >= afterMs - 5_000)
    .sort((left, right) => Date.parse(String(right.createdAt)) - Date.parse(String(left.createdAt)));
  return fresh[0]?.balanceAfter ?? null;
}

export async function readBackend(page: Page, wire: Wire, playerId: string, since: number, fallback: number | null): Promise<{ balance: number | null; source: string }> {
  await wire.ready(since);
  const rows = wire.since(since).filter((record) => record.ready);
  const wager = [...rows].reverse().find((record) => isWager(record.url) && findNumber(parseJson(record.body), /^balance$|balanceAfter|playerBalance/i) != null);
  const balanceCall = [...rows].reverse().find((record) => /\/slots\/balance\b/i.test(record.url) && findNumber(parseJson(record.body), /^balance$|balanceAfter|playerBalance/i) != null);
  const initCall = [...rows].reverse().find((record) => /initialize/i.test(record.url) && findNumber(parseJson(record.body), /^balance$|balanceAfter|playerBalance/i) != null);
  const chosen = wager ?? balanceCall ?? initCall;
  if (chosen) {
    return {
      balance: findNumber(parseJson(chosen.body), /^balance$|balanceAfter|playerBalance/i),
      source: chosen.url.split("?")[0],
    };
  }
  const ledger = await latestLedger(page, playerId, since);
  if (ledger != null) return { balance: ledger, source: "session transactions" };
  const toolbar = await toolbarBalance(page);
  if (toolbar != null) return { balance: toolbar, source: "launcher wallet" };
  return { balance: fallback, source: fallback == null ? "unread" : "previous balance" };
}

export function captureTx(wire: Wire, since: number, rounds: RoundCall[]): CapturedTxn {
  const http = wire.since(since).filter((record) => record.ready && isWager(record.url) && record.method !== "OPTIONS");
  const acceptedHttp = http.filter((record) => !rejectedBody(record.body, record.status));
  const acceptedRounds = rounds.filter((round) => round.ok && !POPUP.test(`${round.error ?? ""} ${JSON.stringify(round.summary ?? {})}`));
  const useHttp = acceptedHttp.length > 0;
  const count = useHttp ? acceptedHttp.length : acceptedRounds.length;
  const last = acceptedHttp.at(-1);
  const parsed = last ? parseJson(last.body) : null;
  const spin = parsed ? parseSpinResponse(parsed) : null;
  const summary = acceptedRounds.at(-1)?.summary;
  const roundBet = acceptedRounds.at(-1)?.bet;
  const bet: number | null = (last ? findNumber(parseJson(last.req), /^bet$|betAmount|baseBet|wager|stake|amount|price/i) : null)
    ?? (typeof roundBet === "number" ? roundBet : null);
  const win = spin?.totalWin ?? (last ? findNumber(parsed, /totalWin|winAmount|payout/i) : null) ?? (typeof summary?.winAmount === "number" ? summary.winAmount : typeof summary?.totalWin === "number" ? summary.totalWin : 0);
  const balance = spin?.balance ?? (last ? findNumber(parsed, /^balance$|balanceAfter|playerBalance/i) : null) ?? (typeof summary?.balance === "number" ? summary.balance : null);
  const feature = spin?.feature ?? "";
  const currency = [...acceptedHttp.flatMap((record) => currenciesIn(`${record.req}\n${record.body}`)), ...currenciesIn(JSON.stringify(summary ?? {}))][0] ?? "";
  const transactionId = findText(parsed, /transactionId|txId|spinId/i) || (typeof summary?.transactionId === "string" ? summary.transactionId : "");
  const playerId = findText(parsed, /^playerId$/i);
  const rejected = count === 0 && (http.some((record) => rejectedBody(record.body, record.status)) || rounds.some((round) => round.ok === false || POPUP.test(round.error ?? "")));
  return {
    count,
    bet,
    win: win ?? 0,
    balance,
    api: last?.url.split("?")[0] || (acceptedRounds.length ? "scratch startRound" : http.at(-1)?.url.split("?")[0] || ""),
    request: redact(last?.req || JSON.stringify(acceptedRounds.at(-1) ?? {})),
    response: redact(last?.body || JSON.stringify(summary ?? {})),
    currency,
    transactionId,
    playerId,
    feature,
    rejected,
  };
}

export async function armScratch(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const holder = window as Window & {
      __qaBalArmed?: boolean;
      __qaBalRounds?: RoundCall[];
      phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { panel?: { options?: { client?: { startRound?: (bet: unknown, size: unknown) => Promise<unknown> } } } }; scratchPanel?: { options?: { client?: { startRound?: (bet: unknown, size: unknown) => Promise<unknown> } } } }> } };
    };
    if (holder.__qaBalArmed) return;
    const scene = (holder.phaserGame?.scene?.scenes ?? []).find((item) => item?.slotController);
    const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
    const client = panel?.options?.client;
    if (!client?.startRound) return;
    const original = client.startRound.bind(client);
    const rounds: RoundCall[] = [];
    holder.__qaBalRounds = rounds;
    client.startRound = async (bet: unknown, size: unknown) => {
      const entry: RoundCall = { t: Date.now(), bet, size };
      rounds.push(entry);
      try {
        const result = await original(bet, size);
        entry.ok = true;
        const picked: Record<string, string | number> = {};
        const walk = (value: unknown, depth: number) => {
          if (!value || typeof value !== "object" || Array.isArray(value) || depth > 4) return;
          for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (typeof child === "number" && /balance|totalWin|winAmount|payout|^bet$/i.test(key) && !(key in picked)) picked[key] = child;
            if (typeof child === "string" && /message|error|currency|transaction|player/i.test(key) && child.length < 80 && !(key in picked)) picked[key] = child;
            if (child && typeof child === "object") walk(child, depth + 1);
          }
        };
        walk(result, 0);
        entry.summary = picked;
        return result;
      } catch (error) {
        entry.ok = false;
        entry.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };
    holder.__qaBalArmed = true;
  }).catch(() => undefined);
}

export async function roundsSince(frame: Frame, t: number): Promise<RoundCall[]> {
  const rows = await frame.evaluate(() => ((window as Window & { __qaBalRounds?: RoundCall[] }).__qaBalRounds ?? []).map((row) => ({ ...row }))).catch(() => [] as RoundCall[]);
  return rows.filter((row) => row.t >= t);
}

export function inFeature(state: FrontendSnapshot): boolean {
  return state.feature === "free-spins" || state.feature === "scatter" || state.feature === "bonus" || !!state.flags._isInFreeSpinRound || !!state.flags._isBonus || !!state.flags._isScatter;
}

export async function shot(page: Page, name: string): Promise<string> {
  const folder = path.join(process.cwd(), "test-results", "balance-screenshots");
  fs.mkdirSync(folder, { recursive: true });
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}.png`;
  const target = path.join(folder, file);
  const saved = await page.screenshot({ path: target, fullPage: false }).then(() => fs.existsSync(target)).catch(() => false);
  return saved ? `balance-screenshots/${file}` : "";
}

async function scratchPoint(page: Page): Promise<{ x: number; y: number } | null> {
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

export function scratchOpen(view: ScratchView): boolean {
  return view.panelVisible || view.hostVisible || /scratch card/i.test(view.title);
}

export async function openScratch(page: Page, frame: GameFrameHelper, scratch: ScratchGame): Promise<ScratchView> {
  let panel = await scratch.snapshot();
  for (let attempt = 1; attempt <= 3 && !scratchOpen(panel); attempt += 1) {
    const point = await scratchPoint(page);
    if (!point) break;
    await frame.clickGamePoint(point.x, point.y);
    const deadline = Date.now() + 4_000;
    while (!scratchOpen(panel) && Date.now() < deadline) {
      await page.waitForTimeout(300);
      panel = await scratch.snapshot();
    }
  }
  if (scratchOpen(panel)) await armScratch(await frame.frame());
  return panel;
}

export async function closeScratch(page: Page, frame: GameFrameHelper, scratch: ScratchGame): Promise<void> {
  let panel = await scratch.snapshot();
  if (!scratchOpen(panel)) return;
  await (await frame.frame()).evaluate(() => {
    const game = (window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { hide?: () => void; close?: () => void; setVisible?: (value: boolean) => void; panel?: { hide?: () => void; close?: () => void; setVisible?: (value: boolean) => void } }; scratchPanel?: { hide?: () => void; close?: () => void; setVisible?: (value: boolean) => void } }> } } }).phaserGame;
    const scene = (game?.scene?.scenes ?? []).find((item) => item?.slotController);
    const host = scene?.scratchDesktopHost;
    host?.hide?.();
    host?.close?.();
    host?.setVisible?.(false);
    const panelNode = host?.panel || scene?.scratchPanel;
    panelNode?.hide?.();
    panelNode?.close?.();
    panelNode?.setVisible?.(false);
  }).catch(() => undefined);
  panel = await scratch.snapshot();
  if (!scratchOpen(panel)) return;
  const point = await scratchPoint(page);
  if (point) await frame.clickGamePoint(point.x, point.y);
  await page.waitForTimeout(400);
}

export async function setSlotBet(frame: GameFrameHelper, target: number): Promise<number | null> {
  await frame.clickText("^bet$").catch(() => false);
  let state = await frame.readState();
  const steps = (state.betLevels.length || 16) + 2;
  for (let index = 0; index < steps; index += 1) {
    if (state.bet != null && same(state.bet, target)) return state.bet;
    const control = state.bet != null && state.bet < target ? "increase" : "decrease";
    const clicked = await frame.clickControl(control);
    if (!clicked) break;
    const next = await frame.readState();
    if (same(next.bet, state.bet)) break;
    state = next;
  }
  return (await frame.readState()).bet ?? null;
}

export async function setScratchBet(scratch: ScratchGame, target: number): Promise<ScratchView> {
  let view = await scratch.snapshot();
  const steps = (view.levels.length || 16) + 2;
  for (let index = 0; index < steps; index += 1) {
    if (view.bet != null && same(view.bet, target)) return view;
    const delta = view.bet != null && view.bet < target ? 1 : -1;
    const next = await scratch.step(delta);
    if (same(next.bet, view.bet)) break;
    view = next;
  }
  return view;
}

export function sharedBet(slotLevels: number[], scratchLevels: number[]): number | null {
  const common = slotLevels.filter((level) => scratchLevels.some((other) => same(other, level)));
  const pool = common.length ? common : slotLevels.length ? slotLevels : scratchLevels;
  if (!pool.length) return null;
  return pool.reduce((lowest, level) => level < lowest ? level : lowest);
}

async function samplePoint(frame: GameFrameHelper, wire: Wire, page: Page, playerId: string, since: number, fallback: number | null, point: string): Promise<Checkpoint> {
  const state = await frame.readState().catch(() => null);
  const backend = await readBackend(page, wire, playerId, since, fallback);
  return {
    point,
    ui: state?.balance ?? null,
    backend: backend.balance,
    match: matchLabel(state?.balance, backend.balance),
  };
}

export async function waitQuiet(frame: GameFrameHelper, page: Page, timeoutMs: number): Promise<FrontendSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let quiet = 0;
  let last = await frame.readState();
  while (Date.now() < deadline) {
    if (await frame.dismissPressAnywhere().catch(() => false)) {
      quiet = 0;
      await page.waitForTimeout(250);
      continue;
    }
    last = await frame.readState();
    if (inFeature(last) || !last.idle) {
      quiet = 0;
      if (last.canvas.gameWidth > 0) {
        await frame.clickGamePoint(last.canvas.gameWidth / 2, last.canvas.gameHeight * 0.38, last).catch(() => undefined);
      }
      await page.waitForTimeout(200);
      continue;
    }
    quiet += 1;
    if (quiet >= 4) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

export async function playSpin(
  page: Page,
  frame: GameFrameHelper,
  wire: Wire,
  network: NetworkMonitor,
  playerId: string,
  options?: { spaces?: number; extraClicks?: number },
): Promise<ActionCapture> {
  await waitQuiet(frame, page, 20_000);
  const beforeState = await frame.readState();
  const started = Date.now();
  const beforeBackend = await readBackend(page, wire, playerId, started - 15_000, beforeState.balance ?? null);
  const checkpoints: Checkpoint[] = [{
    point: "Before action",
    ui: beforeState.balance ?? null,
    backend: beforeBackend.balance,
    match: matchLabel(beforeState.balance, beforeBackend.balance),
  }];
  const startCount = network.count();
  let clicked = await frame.clickControl("spin");
  if (!clicked) clicked = await frame.invoke("spin");
  const spinDeadline = Date.now() + 8_000;
  while (!clicked && Date.now() < spinDeadline) {
    await frame.dismissPressAnywhere().catch(() => false);
    await page.waitForTimeout(400);
    clicked = await frame.clickControl("spin");
    if (!clicked) clicked = await frame.invoke("spin");
  }
  await page.waitForTimeout(1_200);
  if (network.count() === startCount && !(options?.extraClicks)) {
    await frame.dismissPressAnywhere().catch(() => false);
    if (!(await frame.clickControl("spin"))) await frame.invoke("spin");
  }
  if (options?.extraClicks) {
    for (let index = 0; index < options.extraClicks; index += 1) {
      await frame.clickControl("spin").catch(() => false);
      await frame.invoke("spin").catch(() => false);
    }
  }
  if (options?.spaces) {
    for (let index = 0; index < options.spaces; index += 1) await frame.dispatchSpace();
  }
  const responseDeadline = Date.now() + 12_000;
  let sawRequest = false;
  while (Date.now() < responseDeadline && network.count() === startCount && wire.since(started).filter((record) => isWager(record.url)).length === 0) {
    if (!sawRequest) {
      checkpoints.push(await samplePoint(frame, wire, page, playerId, started, beforeBackend.balance, "Request sent"));
      sawRequest = true;
    }
    await page.waitForTimeout(350);
  }
  checkpoints.push(await samplePoint(frame, wire, page, playerId, started, beforeBackend.balance, "Transaction response"));
  await page.waitForTimeout(500);
  checkpoints.push(await samplePoint(frame, wire, page, playerId, started, beforeBackend.balance, "During animation"));
  let afterState = await waitQuiet(frame, page, 45_000);
  await wire.ready(started);
  const gameFrame = await frame.frame();
  const txn = captureTx(wire, started, await roundsSince(gameFrame, started));
  const record = network.all().find((item, index) => index >= startCount);
  const parsed = record ? parseSpinResponse(record.responseBody) : null;
  const pendingId = unresolvedId(record?.responseBody);
  if (pendingId) {
    const deadline = Date.now() + 20_000;
    while (!network.unresolvedComplete(pendingId) && Date.now() < deadline) await page.waitForTimeout(300);
    afterState = await frame.readState();
  }
  const complete = pendingId ? network.unresolvedComplete(pendingId) : undefined;
  const backendBalance = complete?.balance ?? parsed?.balance ?? txn.balance ?? (await readBackend(page, wire, playerId, started, beforeBackend.balance)).balance;
  const finalUi = afterState.balance ?? null;
  checkpoints.push({ point: "Final UI state", ui: finalUi, backend: backendBalance, match: matchLabel(finalUi, backendBalance) });
  const popup = [...afterState.errorTexts, ...afterState.texts].find((text) => POPUP.test(text)) ?? "";
  return {
    beforeUi: beforeState.balance ?? null,
    beforeBackend: beforeBackend.balance,
    afterUi: finalUi,
    afterBackend: backendBalance,
    bet: record?.betSize ?? txn.bet ?? beforeState.bet ?? null,
    baseBet: record?.betSize ?? txn.bet ?? beforeState.bet ?? null,
    win: parsed?.totalWin ?? txn.win ?? 0,
    accepted: Math.max(network.count() - startCount, txn.count),
    api: record ? "/api/v1/slots/bet" : txn.api,
    request: redact(JSON.stringify(record?.requestPayload ?? txn.request)),
    response: redact(JSON.stringify(record?.responseBody ?? txn.response)),
    currency: txn.currency || afterState.currency || "",
    feature: parsed?.feature || txn.feature || (inFeature(afterState) ? afterState.feature : "base"),
    popup,
    checkpoints,
    note: popup,
  };
}

export async function buyScratch(
  page: Page,
  frame: GameFrameHelper,
  scratch: ScratchGame,
  wire: Wire,
  playerId: string,
  clicks = 1,
): Promise<ActionCapture> {
  const beforeState = await frame.readState();
  const panelBefore = await scratch.snapshot();
  const started = Date.now();
  const beforeBackend = await readBackend(page, wire, playerId, started - 15_000, beforeState.balance ?? null);
  const checkpoints: Checkpoint[] = [{
    point: "Before action",
    ui: beforeState.balance ?? null,
    backend: beforeBackend.balance,
    match: matchLabel(beforeState.balance, beforeBackend.balance),
  }];
  for (let index = 0; index < clicks; index += 1) {
    await scratch.clickBuy().catch(() => undefined);
    if (index === 0) checkpoints.push(await samplePoint(frame, wire, page, playerId, started, beforeBackend.balance, "Request sent"));
  }
  await page.waitForTimeout(1200);
  checkpoints.push(await samplePoint(frame, wire, page, playerId, started, beforeBackend.balance, "Transaction response"));
  const gameFrame = await frame.frame();
  await wire.ready(started);
  const txn = captureTx(wire, started, await roundsSince(gameFrame, started));
  const afterBuy = await frame.readState();
  const backendAfterBuy = txn.balance ?? (await readBackend(page, wire, playerId, started, beforeBackend.balance)).balance;
  checkpoints.push({
    point: "After Buy Scratch",
    ui: afterBuy.balance ?? null,
    backend: backendAfterBuy,
    match: matchLabel(afterBuy.balance, backendAfterBuy),
  });
  return {
    beforeUi: beforeState.balance ?? null,
    beforeBackend: beforeBackend.balance,
    afterUi: afterBuy.balance ?? null,
    afterBackend: backendAfterBuy,
    bet: txn.bet ?? panelBefore.bet,
    baseBet: txn.bet ?? panelBefore.bet,
    win: txn.win ?? 0,
    accepted: txn.count,
    api: txn.api || "scratch startRound",
    request: txn.request,
    response: txn.response,
    currency: txn.currency || afterBuy.currency || "",
    feature: "scratch",
    popup: txn.rejected ? "rejected" : "",
    checkpoints,
    note: txn.rejected ? "rejected" : "",
  };
}

export async function revealScratch(
  page: Page,
  frame: GameFrameHelper,
  scratch: ScratchGame,
  wire: Wire,
  playerId: string,
  purchase: ActionCapture,
): Promise<ActionCapture> {
  const started = Date.now();
  await scratch.poke().catch(() => undefined);
  await scratch.reveal().catch(() => undefined);
  await (await frame.frame()).evaluate(async () => {
    const game = (window as Window & { phaserGame?: { scene?: { scenes?: Array<{ slotController?: unknown; scratchDesktopHost?: { panel?: { autoCollect?: () => Promise<unknown> } }; scratchPanel?: { autoCollect?: () => Promise<unknown> } }> } } }).phaserGame;
    const scene = (game?.scene?.scenes ?? []).find((item) => item?.slotController);
    const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
    if (typeof panel?.autoCollect === "function") await panel.autoCollect();
  }).catch(() => undefined);
  const deadline = Date.now() + 12_000;
  let view = await scratch.snapshot();
  while (Date.now() < deadline) {
    view = await scratch.snapshot();
    if (view.allRevealed || view.settled) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);
  await wire.ready(started);
  const after = await frame.readState();
  const backend = await readBackend(page, wire, playerId, purchase.checkpoints[0] ? started - 20_000 : started, purchase.afterBackend);
  const shown = (view.totalWin ?? 0) > 0 ? view.totalWin ?? 0 : parseMoney(view.amountText) ?? parseMoney(view.youWon) ?? purchase.win ?? 0;
  const checkpoints = [
    ...purchase.checkpoints,
    { point: "Scratch reveal", ui: after.balance ?? null, backend: backend.balance, match: matchLabel(after.balance, backend.balance) },
    { point: "Final UI state", ui: after.balance ?? null, backend: backend.balance, match: matchLabel(after.balance, backend.balance) },
  ];
  return {
    ...purchase,
    afterUi: after.balance ?? null,
    afterBackend: backend.balance,
    win: shown || purchase.win,
    checkpoints,
    note: `Revealed ${view.revealed}/${view.cellCount}. Prompt "${view.youWon} ${view.amountText}".`,
  };
}

export async function openBuyDialog(frame: GameFrameHelper, page: Page): Promise<FrontendSnapshot> {
  const before = await frame.readState();
  if (before.hasBuy) await frame.clickControl("buy");
  await page.waitForTimeout(700);
  return frame.readState();
}

export async function cancelBuyDialog(frame: GameFrameHelper): Promise<void> {
  await frame.clickText("^(close|cancel|back)$").catch(() => false);
}

export async function confirmBuyFeature(frame: GameFrameHelper, page: Page, network: NetworkMonitor, clicks = 1): Promise<boolean> {
  const start = network.count();
  const deadline = Date.now() + 10_000;
  let confirmed = 0;
  while (Date.now() < deadline && confirmed < clicks) {
    const clicked = await frame.clickText("^buy\\s*feature$");
    if (clicked) {
      confirmed += 1;
      const arrived = await network.waitForCount(start + 1, 2_000).then(() => true).catch(() => false);
      if (arrived && confirmed >= clicks) return true;
    }
    await page.waitForTimeout(250);
  }
  return network.count() > start;
}

export function popupText(state: FrontendSnapshot): string {
  return [...state.errorTexts, ...state.texts].find((text) => POPUP.test(text)) ?? "";
}

export function deductionOf(before: number | null, after: number | null): number | null {
  if (before == null || after == null) return null;
  return round2(before - after);
}
