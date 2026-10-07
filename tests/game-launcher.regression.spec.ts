// import fs from "node:fs";
// import path from "node:path";
// import { expect, test, type APIResponse, type BrowserContext, type Page, type Route } from "@playwright/test";
// import { regressionConfig, playerIdForWorker } from "../src/config/regression.config";
// import { readPayloadFlag } from "../src/helpers/BetPayloadParser";
// import { compareSpin } from "../src/helpers/SpinComparator";
// import { ConsoleMonitor } from "../src/helpers/ConsoleMonitor";
// import { EvidenceCollector } from "../src/helpers/EvidenceCollector";
// import { GameFrameHelper } from "../src/helpers/GameFrameHelper";
// import { NetworkMonitor } from "../src/helpers/NetworkMonitor";
// import { parseSpinResponse } from "../src/helpers/SpinResultParser";
// import { GameLauncherPage } from "../src/pages/GameLauncherPage";
// import { chaosDashboardModel } from "../src/reporting/chaosDashboard";
// import { renderDashboard } from "../src/reporting/HtmlDashboard";
// import { openDashboard } from "../src/reporting/writeReports";
// import { writeReview } from "../src/reporting/writeReview";
// import type { FrontendSnapshot, GameInfo, SpinNetworkData } from "../src/types";
// import { moneyEqual } from "../src/utils/money";

// /**
//  * Bounded chaos tests for the authorized staging launcher only.
//  * Requests outside the STG allowlist are aborted. Extra bet calls past the
//  * per-scenario cap are aborted in the browser so a fault cannot fan out.
//  */

// const STG_HOSTS = new Set([
//   "stg-asset-tools.dijoker.com",
//   "stg-game-launcher.dijoker.com",
//   "stg-games.dijoker.com",
// ]);

// const BET_KEYS = ["bet", "betAmount", "bet_amount", "betSize", "bet_size", "wager", "stake", "totalBet", "total_bet"];
// const SECRET = /token|authorization|password|secret|cookie|session/i;
// const RAPID_CLICKS = 8;
// const REPORT_DIR = path.join(process.cwd(), "test-results", "chaos");

// type Severity = "Critical" | "High" | "Medium" | "Low";
// type CaseStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT APPLICABLE";

// interface ChaosCase {
//   scenario: string;
//   technique: string;
//   game: string;
//   playerId: string;
//   preconditions: string;
//   steps: string[];
//   expected: string;
//   actual: string;
//   severity: Severity | "None";
//   status: CaseStatus;
//   reproducibility: string;
//   spinNumber: number;
//   bet?: number;
//   balanceBefore?: number;
//   balanceAfter?: number;
//   frontend: unknown;
//   backend: unknown;
//   consoleErrors: string[];
//   networkErrors: string[];
//   screenshot?: string;
//   video?: string;
//   recommendedFix: string;
// }

// interface FaultCounts {
//   attempted: number;
//   real: number;
// }

// const severityRank: Record<ChaosCase["severity"], number> = {
//   Critical: 0,
//   High: 1,
//   Medium: 2,
//   Low: 3,
//   None: 4,
// };

// function assertAuthorizedTarget(rawUrl: string): void {
//   const url = new URL(rawUrl);
//   const bet = url.pathname.includes("/api/v1/slots/bet");
//   if (!STG_HOSTS.has(url.hostname) || !bet) {
//     throw new Error(`Refusing fault injection outside the authorized STG bet endpoint: ${url.origin}${url.pathname}`);
//   }
// }

// function authorizedBetUrl(url: URL): boolean {
//   return STG_HOSTS.has(url.hostname) && url.pathname.includes("/api/v1/slots/bet");
// }

// function redactText(value: string): string {
//   return value
//     .replace(/access_token=[^&\s'")]+/gi, "access_token=[redacted]")
//     .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
// }

// function redact(value: unknown): unknown {
//   if (typeof value === "string") return redactText(value);
//   if (Array.isArray(value)) return value.map(redact);
//   if (!value || typeof value !== "object") return value;
//   const out: Record<string, unknown> = {};
//   for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
//     out[key] = SECRET.test(key) ? "[redacted]" : redact(item);
//   }
//   return out;
// }

// function clip(value: unknown): unknown {
//   const safe = redact(value);
//   const text = JSON.stringify(safe);
//   if (!text || text.length <= 8000) return safe;
//   return { truncated: true, preview: text.slice(0, 8000) };
// }

// function slim(state?: FrontendSnapshot): unknown {
//   if (!state) return null;
//   return {
//     phase: state.phase,
//     idle: state.idle,
//     busy: state.busy,
//     bet: state.bet,
//     balance: state.balance,
//     balanceText: state.balanceText,
//     winDisplay: state.winDisplay,
//     feature: state.feature,
//     freeSpins: state.freeSpins,
//     multiplier: state.multiplier,
//     errorTexts: state.errorTexts,
//     canvas: state.canvas,
//     orientationBlocked: state.orientationBlocked,
//     flags: state.flags,
//   };
// }

// function healthProblems(state?: FrontendSnapshot): string[] {
//   if (!state) return ["Frontend state was not readable"];
//   const problems: string[] = [];
//   if (state.phase === "missing" || state.canvas.cssWidth < 2 || state.canvas.cssHeight < 2) problems.push("Blank or missing canvas");
//   if (state.balance != null && !Number.isFinite(state.balance)) problems.push(`Balance is ${String(state.balance)}`);
//   if (state.balance != null && state.balance < 0) problems.push(`Balance is negative (${state.balance})`);
//   if (state.balanceText && /nan|infinity/i.test(state.balanceText)) problems.push(`Balance text is "${state.balanceText}"`);
//   if (state.winDisplay != null && !Number.isFinite(state.winDisplay)) problems.push(`Win display is ${String(state.winDisplay)}`);
//   return problems;
// }

// function inFeature(state?: FrontendSnapshot): boolean {
//   if (!state) return false;
//   return state.feature === "free-spins" || state.feature === "scatter" || Boolean(state.flags._isInFreeSpinRound || state.flags._isBonus);
// }

// function rewriteBet(value: unknown, next: number): boolean {
//   if (!value || typeof value !== "object" || Array.isArray(value)) return false;
//   const record = value as Record<string, unknown>;
//   for (const key of BET_KEYS) {
//     if (key in record && (typeof record[key] === "number" || typeof record[key] === "string")) {
//       record[key] = next;
//       return true;
//     }
//   }
//   for (const nested of Object.values(record)) {
//     if (rewriteBet(nested, next)) return true;
//   }
//   return false;
// }

// function isFreeSpinRequest(route: Route): boolean {
//   const raw = route.request().postData();
//   if (!raw) return false;
//   try {
//     return readPayloadFlag(JSON.parse(raw), "isFs") === true;
//   } catch {
//     return /"isFs"\s*:\s*true/.test(raw);
//   }
// }

// function forceScatter(body: unknown, symbolId: number): unknown {
//   const clone = body && typeof body === "object" ? JSON.parse(JSON.stringify(body)) as Record<string, any> : {};
//   const data = clone.data && typeof clone.data === "object" && !Array.isArray(clone.data) ? clone.data : clone;
//   if (!data.slot || typeof data.slot !== "object" || Array.isArray(data.slot)) data.slot = {};
//   const slot = data.slot as Record<string, any>;
//   const area = Array.isArray(slot.area) ? slot.area as unknown[][] : undefined;
//   if (area) {
//     for (const column of area) {
//       if (!Array.isArray(column)) continue;
//       for (let row = 0; row < column.length; row += 1) column[row] = symbolId;
//     }
//   }
//   const awarded = 3;
//   data.fsCount = awarded;
//   data.fsTotal = awarded;
//   data.fsStatus = "active";
//   const previous = slot.freeSpin && typeof slot.freeSpin === "object" && !Array.isArray(slot.freeSpin) ? slot.freeSpin : {};
//   slot.freeSpin = {
//     ...previous,
//     multiplierValue: typeof previous.multiplierValue === "number" ? previous.multiplierValue : 0,
//     count: awarded,
//     items: Array.from({ length: awarded }, () => ({ area, totalWin: 0, win: 0 })),
//   };
//   slot.tumbles = [];
//   return clone;
// }

// function spoilPayload(body: unknown): unknown {
//   const clone = body && typeof body === "object" ? JSON.parse(JSON.stringify(body)) as Record<string, unknown> : { data: {} };
//   const data = clone.data && typeof clone.data === "object" && !Array.isArray(clone.data)
//     ? clone.data as Record<string, unknown>
//     : clone;
//   data.balance = null;
//   data.totalWin = null;
//   data.slot = {};
//   data.win = "";
//   return clone;
// }

// function writeChaosReport(cases: ChaosCase[], video?: string): void {
//   fs.mkdirSync(REPORT_DIR, { recursive: true });
//   const scrubbed = cases.map((item) => ({
//     ...item,
//     technique: redactText(item.technique),
//     preconditions: redactText(item.preconditions),
//     expected: redactText(item.expected),
//     actual: redactText(item.actual),
//     steps: item.steps.map(redactText),
//     consoleErrors: item.consoleErrors.map(redactText),
//     networkErrors: item.networkErrors.map(redactText),
//     frontend: redact(item.frontend),
//     backend: redact(item.backend),
//   }));
//   const ordered = [...scrubbed].sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.scenario.localeCompare(right.scenario));
//   const withVideo = video ? ordered.map((item) => ({ ...item, video: item.video || video })) : ordered;
//   fs.writeFileSync(path.join(REPORT_DIR, "chaos-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), cases: withVideo }, null, 2));
//   const defects = withVideo.filter((item) => item.status === "FAIL");
//   const lines: string[] = [
//     "# STG game launcher chaos report",
//     "",
//     `Generated: ${new Date().toISOString()}`,
//     "",
//     "Scope is the authorized staging launcher and its slot bet endpoint. Production, other sites, and unbounded traffic were out of scope.",
//     "",
//     `Scenarios: ${withVideo.length}. Defects: ${defects.length}. Critical/High: ${defects.filter((item) => item.severity === "Critical" || item.severity === "High").length}.`,
//     "",
//   ];
//   const section = (title: string, rows: ChaosCase[]) => {
//     lines.push(`## ${title}`, "");
//     if (!rows.length) {
//       lines.push("None.", "");
//       return;
//     }
//     for (const item of rows) {
//       lines.push(
//         `### ${item.scenario}`,
//         "",
//         `1. Test scenario: ${item.scenario}`,
//         `2. Attack/fault-injection technique: ${item.technique}`,
//         `3. Game/launcher: ${item.game}`,
//         `4. Preconditions: ${item.preconditions}`,
//         `5. Steps: ${item.steps.map((step, index) => `${index + 1}) ${step}`).join(" ")}`,
//         `6. Expected result: ${item.expected}`,
//         `7. Actual result: ${item.actual}`,
//         `8. Severity: ${item.severity}`,
//         `9. Reproducibility: ${item.reproducibility}`,
//         `10. Frontend evidence: player ${item.playerId}; spin ${item.spinNumber}; bet ${item.bet ?? "n/a"}; balance ${item.balanceBefore ?? "n/a"} -> ${item.balanceAfter ?? "n/a"}; ${JSON.stringify(item.frontend)}`,
//         `11. Backend evidence: ${JSON.stringify(item.backend)}`,
//         `12. Console/network errors: console ${JSON.stringify(item.consoleErrors)}; network ${JSON.stringify(item.networkErrors)}`,
//         `13. Screenshot/video evidence: ${item.screenshot ?? "none"}${item.video ? `; video ${item.video}` : ""}`,
//         `14. Recommended fix: ${item.recommendedFix}`,
//         "",
//       );
//     }
//   };
//   section("Defects", defects);
//   section("Passed, blocked, and not applicable", withVideo.filter((item) => item.status !== "FAIL"));
//   fs.writeFileSync(path.join(REPORT_DIR, "chaos-report.md"), lines.join("\n"));
//   const dashboardRoot = path.join(process.cwd(), "test-results");
//   const model = chaosDashboardModel(withVideo);
//   fs.mkdirSync(dashboardRoot, { recursive: true });
//   fs.writeFileSync(path.join(dashboardRoot, "index.html"), renderDashboard(model));
//   writeReview(model, dashboardRoot);
// }

// const chaosGameNames = process.env.CHAOS_GAME?.trim()
//   ? [process.env.CHAOS_GAME.trim()]
//   : regressionConfig.gameNames.map((name) => name.trim()).filter(Boolean);
// const selectedChaosGames = regressionConfig.gameLimit > 0 ? chaosGameNames.slice(0, regressionConfig.gameLimit) : chaosGameNames;
// const finishedCases: ChaosCase[] = [];

// test.describe("STG launcher chaos fault injection", () => {
//   test.describe.configure({ mode: "serial", timeout: 6 * 60 * 1000 });

//   if (selectedChaosGames.length === 0) {
//     test("game list is empty", async () => {
//       throw new Error("Uncomment game names in src/config/regression.config.ts so the chaos suite has games to launch.");
//     });
//   }

//   for (const [gameOrder, requestedGame] of selectedChaosGames.entries()) {
//   test.describe(requestedGame, () => {
//   test.describe.configure({ mode: "serial" });

//   const playerId = process.env.CHAOS_PLAYER_ID?.trim() || playerIdForWorker(gameOrder);
//   const cases: ChaosCase[] = [];
//   let context: BrowserContext;
//   let page: Page;
//   let launcher: GameLauncherPage;
//   let frame: GameFrameHelper;
//   let network: NetworkMonitor;
//   let consoleMonitor: ConsoleMonitor;
//   let evidence: EvidenceCollector;
//   let game: GameInfo | undefined;
//   let ready = false;
//   let blockReason = "The staging session was not ready.";
//   let videoPath: string | undefined;
//   let spinCursor = 0;
//   let featureSeen = false;

//   function errorText(error: unknown): string {
//     return error instanceof Error ? error.message : String(error);
//   }

//   function activeGame(): GameInfo {
//     if (!game) throw new Error(blockReason);
//     return game;
//   }

//   function recordsSince(start: number): SpinNetworkData[] {
//     return network.all().slice(start);
//   }

//   function consoleSince(mark: number): string[] {
//     return consoleMonitor.forGame(game?.gameName || "launcher").consoleErrors.slice(mark).map((entry) => redactText(`${entry.type}: ${entry.message}`));
//   }

//   function networkSince(mark: number): string[] {
//     return consoleMonitor.forGame(game?.gameName || "launcher").networkErrors.slice(mark).map((entry) => redactText(`${entry.type}: ${entry.message} ${entry.url ?? ""}`.trim()));
//   }

//   async function scatterBody(response: APIResponse): Promise<string> {
//     const text = await response.text();
//     let symbolId = 0;
//     try {
//       symbolId = await frame.scatterSymbolId();
//     } catch {
//       symbolId = 0;
//     }
//     try {
//       return JSON.stringify(forceScatter(JSON.parse(text), symbolId));
//     } catch {
//       return text;
//     }
//   }

//   async function deliverScatter(route: Route, response?: APIResponse): Promise<void> {
//     const fetched = response ?? await route.fetch();
//     if (isFreeSpinRequest(route)) {
//       await route.fulfill({ response: fetched });
//       return;
//     }
//     const body = await scatterBody(fetched);
//     await route.fulfill({ response: fetched, body, contentType: "application/json" });
//   }

//   async function scatterHandler(route: Route): Promise<void> {
//     try {
//       assertAuthorizedTarget(route.request().url());
//     } catch {
//       await route.abort("failed").catch(() => undefined);
//       return;
//     }
//     try {
//       await deliverScatter(route);
//     } catch {
//       await route.abort("failed").catch(() => undefined);
//     }
//   }

//   async function passthrough(route: Route): Promise<void> {
//     await deliverScatter(route);
//   }

//   async function faultBets(maxReal: number, onReal: (route: Route, index: number) => Promise<void>, action: () => Promise<void>): Promise<FaultCounts> {
//     let attempted = 0;
//     let real = 0;
//     const handler = async (route: Route): Promise<void> => {
//       try {
//         assertAuthorizedTarget(route.request().url());
//       } catch (error) {
//         await route.abort("failed").catch(() => undefined);
//         throw error;
//       }
//       attempted += 1;
//       if (real >= maxReal) {
//         await route.abort("failed");
//         return;
//       }
//       real += 1;
//       try {
//         await onReal(route, real);
//       } catch {
//         await route.abort("failed").catch(() => undefined);
//       }
//     };
//     await page.route(authorizedBetUrl, handler);
//     try {
//       await action();
//     } finally {
//       await page.unroute(authorizedBetUrl, handler).catch(() => undefined);
//     }
//     return { attempted, real };
//   }

//   async function spinOnce(): Promise<void> {
//     await frame.clickControl("spin").catch(() => false);
//     await frame.invoke("spin").catch(() => false);
//   }

//   async function readOptional(): Promise<FrontendSnapshot | undefined> {
//     try {
//       return await frame.readState();
//     } catch {
//       return undefined;
//     }
//   }

//   async function settle(timeoutMs: number): Promise<FrontendSnapshot | undefined> {
//     const deadline = Date.now() + timeoutMs;
//     let last: FrontendSnapshot | undefined;
//     while (Date.now() < deadline) {
//       last = await readOptional();
//       if (!last) {
//         await page.waitForTimeout(400);
//         continue;
//       }
//       if (last.errorTexts.length && !last.busy) return last;
//       if (last.phase === "playing" && !last.busy && last.controls.spin) return last;
//       await frame.dismissPressAnywhere().catch(() => false);
//       await page.waitForTimeout(400);
//     }
//     return last;
//   }

//   async function relaunch(): Promise<FrontendSnapshot> {
//     await context.setOffline(false).catch(() => undefined);
//     await page.unroute(authorizedBetUrl).catch(() => undefined);
//     await launcher.closeGame().catch(() => undefined);
//     if (!page.url().includes("game-launcher")) await launcher.open();
//     const gridReady = await launcher.discoverGames().then((found) => found.length > 0).catch(() => false);
//     if (!gridReady) {
//       await launcher.open();
//       await launcher.setPlayer(playerId);
//     }
//     await launcher.openGame(activeGame());
//     await frame.waitForInteractive(regressionConfig.launchTimeoutMs);
//     const settled = await settle(20_000);
//     if (!settled || settled.phase !== "playing" || !settled.controls.spin) {
//       throw new Error("Game did not return to a playable idle state");
//     }
//     featureSeen = featureSeen || inFeature(settled);
//     return settled;
//   }

//   async function ensurePlaying(): Promise<FrontendSnapshot> {
//     const open = await page.locator('iframe[title="Game session"]').isVisible().catch(() => false);
//     if (open) {
//       const settled = await settle(8_000);
//       if (settled?.phase === "playing" && settled.controls.spin && !settled.busy && healthProblems(settled).length === 0) {
//         featureSeen = featureSeen || inFeature(settled);
//         return settled;
//       }
//     }
//     return relaunch();
//   }

//   async function shoot(label: string): Promise<string | undefined> {
//     spinCursor += 1;
//     return evidence.capture(page, activeGame().gameName, spinCursor, label).catch(() => undefined);
//   }

//   function blankCase(input: {
//     scenario: string;
//     technique: string;
//     preconditions: string;
//     steps: string[];
//     expected: string;
//     actual: string;
//     severity: ChaosCase["severity"];
//     status: CaseStatus;
//     reproducibility: string;
//     before?: FrontendSnapshot;
//     after?: FrontendSnapshot;
//     records?: SpinNetworkData[];
//     consoleErrors?: string[];
//     networkErrors?: string[];
//     screenshot?: string;
//     recommendedFix: string;
//   }): ChaosCase {
//     const records = input.records ?? [];
//     return {
//       scenario: input.scenario,
//       technique: input.technique,
//       game: `${game?.gameName ?? requestedGame} via ${regressionConfig.launcherUrl}`,
//       playerId,
//       preconditions: input.preconditions,
//       steps: input.steps,
//       expected: input.expected,
//       actual: input.actual,
//       severity: input.severity,
//       status: input.status,
//       reproducibility: input.reproducibility,
//       spinNumber: network?.count() ?? 0,
//       bet: input.before?.bet ?? records.at(-1)?.betSize,
//       balanceBefore: input.before?.balance,
//       balanceAfter: input.after?.balance ?? records.at(-1)?.balanceAfter,
//       frontend: slim(input.after ?? input.before),
//       backend: clip(records.map((record) => ({
//         status: record.status,
//         betSize: record.betSize,
//         balanceAfter: record.balanceAfter,
//         totalWin: record.totalWin,
//         request: record.requestPayload,
//         response: record.responseBody,
//       }))),
//       consoleErrors: input.consoleErrors ?? [],
//       networkErrors: input.networkErrors ?? [],
//       screenshot: input.screenshot,
//       recommendedFix: input.recommendedFix,
//     };
//   }

//   async function judge(input: {
//     scenario: string;
//     technique: string;
//     preconditions: string;
//     steps: string[];
//     expected: string;
//     before: FrontendSnapshot;
//     after?: FrontendSnapshot;
//     records: SpinNetworkData[];
//     attempted: number;
//     maxAttempts: number;
//     maxAccepted: number;
//     notes?: string[];
//     consoleMark: number;
//     networkMark: number;
//     recommendedFix: string;
//     flagBalanceWithoutServer?: boolean;
//     minimumAttempts?: number;
//   }): Promise<ChaosCase> {
//     const notes = [...(input.notes ?? [])];
//     const accepted = input.records.filter((record) => record.status >= 200 && record.status < 300);
//     let problems = healthProblems(input.after);
//     const beforeWin = input.before.winDisplay ?? 0;
//     const afterWin = input.after?.winDisplay ?? 0;
//     const paid = accepted.reduce((sum, record) => sum + (record.totalWin ?? 0), 0);
//     if (input.after && !input.after.busy && afterWin > beforeWin && (accepted.length === 0 || paid <= 0)) {
//       problems.push(`Frontend win moved from ${beforeWin} to ${afterWin} without a paid backend win`);
//     }
//     if (accepted.length > input.maxAccepted) {
//       problems.push(`${accepted.length} bet responses were accepted; cap for this scenario is ${input.maxAccepted}`);
//     }
//     if (input.attempted > input.maxAttempts) {
//       problems.push(`Client issued ${input.attempted} bet requests; ${Math.max(0, input.attempted - input.records.length)} extra request(s) were aborted locally`);
//     }
//     if (
//       input.flagBalanceWithoutServer
//       && input.before.balance != null
//       && input.after?.balance != null
//       && !moneyEqual(input.before.balance, input.after.balance)
//       && accepted.every((record) => record.balanceAfter == null)
//     ) {
//       problems.push(`Balance changed from ${input.before.balance} to ${input.after.balance} without a numeric backend balance`);
//     }
//     if (input.after?.busy) problems.push("Reels or controls were still busy after the settle window");
//     const pageErrors = consoleSince(input.consoleMark).filter((line) => /Page Error|unhandled/i.test(line));
//     if (pageErrors.length) notes.push(`Page errors: ${pageErrors.join(" | ")}`);
//     const failedEarly = problems.length > 0 || pageErrors.length > 0;
//     const screenshot = failedEarly ? await shoot("chaos-failure") : undefined;

//     const unhealthy = healthProblems(input.after).length > 0 || !input.after || Boolean(input.after.busy);
//     let recovered = !unhealthy;
//     if (unhealthy) {
//       try {
//         await relaunch();
//         recovered = true;
//         notes.push("A fresh launch recovered a playable session.");
//       } catch (error) {
//         recovered = false;
//         notes.push(`Relaunch failed: ${errorText(error)}`);
//       }
//     }

//     const moneyBroken = problems.some((problem) => /balance|win display|paid backend win/i.test(problem));
//     const stuck = problems.some((problem) => /canvas|busy|not readable/i.test(problem));
//     let severity: ChaosCase["severity"] = "None";
//     let status: CaseStatus = "PASS";
//     if (moneyBroken) severity = "Critical";
//     else if (stuck && !recovered) severity = "Critical";
//     else if (accepted.length > input.maxAccepted || input.attempted > input.maxAttempts || (stuck && recovered)) severity = "High";
//     else if (pageErrors.length) severity = "Medium";
//     if (severity !== "None") status = "FAIL";
//     const freshErrors = (input.after?.errorTexts ?? []).filter((text) => !input.before.errorTexts.includes(text));
//     if (freshErrors.length && severity === "None") {
//       severity = "Medium";
//       status = "FAIL";
//       notes.push(`Visible error text: ${freshErrors.join(" | ")}`);
//     }
//     const minimum = input.minimumAttempts ?? 1;
//     if (minimum > input.attempted && status === "PASS") {
//       status = "BLOCKED";
//       notes.push(`The fault was not applied because only ${input.attempted} bet request(s) were sent.`);
//     }

//     const detail = notes.map(redactText).join(" ");
//     const actual = redactText(status === "PASS"
//       ? `No stuck session, false win, or balance corruption. Bet requests seen: ${input.attempted}. Accepted responses: ${accepted.length}. ${detail}`.trim()
//       : status === "BLOCKED"
//         ? detail
//         : `${problems.join("; ") || "Visible player-facing error"}. ${detail}`.trim());
//     return blankCase({
//       ...input,
//       actual,
//       severity,
//       status,
//       reproducibility: status === "FAIL" ? "Observed once this run" : status === "BLOCKED" ? "Fault was not delivered" : "Not reproduced",
//       consoleErrors: consoleSince(input.consoleMark),
//       networkErrors: networkSince(input.networkMark),
//       screenshot,
//     });
//   }

//   async function runScenario(name: string, body: () => Promise<ChaosCase>): Promise<ChaosCase> {
//     if (!ready || !game) {
//       return blankCase({
//         scenario: name,
//         technique: "Session setup",
//         preconditions: `Player ${playerId} on ${regressionConfig.launcherUrl}`,
//         steps: ["Open the staging launcher and launch the selected game."],
//         expected: "The game reaches a playable idle state before fault injection.",
//         actual: blockReason,
//         severity: "High",
//         status: "BLOCKED",
//         reproducibility: "Blocked before the fault was injected",
//         recommendedFix: "Restore the staging launcher session, then rerun this scenario.",
//       });
//     }
//     try {
//       return await body();
//     } catch (error) {
//       const screenshot = await shoot("chaos-exception").catch(() => undefined);
//       let recovered = false;
//       try {
//         await relaunch();
//         recovered = true;
//       } catch {
//         recovered = false;
//       }
//       return blankCase({
//         scenario: name,
//         technique: "Unhandled scenario exception",
//         preconditions: `${activeGame().gameName} was in a staging session for ${playerId}.`,
//         steps: ["Run the scenario until it threw."],
//         expected: "Faults are contained and the session stays usable.",
//         actual: `${errorText(error)} ${recovered ? "A relaunch recovered the session." : "A relaunch did not recover the session."}`,
//         severity: recovered ? "High" : "Critical",
//         status: "FAIL",
//         reproducibility: "Observed once this run",
//         screenshot,
//         recommendedFix: "Catch this failure in the client, keep the last committed balance, and return the controls to idle.",
//       });
//     }
//   }

//   test.beforeAll(async ({ browser }) => {
//     const launcherHost = new URL(regressionConfig.launcherUrl).hostname;
//     const betHost = new URL(regressionConfig.betEndpointOrigin).hostname;
//     if (!STG_HOSTS.has(launcherHost) || !STG_HOSTS.has(betHost)) {
//       throw new Error(`Chaos suite refuses to run outside STG. Launcher ${launcherHost}, bet host ${betHost}.`);
//     }
//     fs.mkdirSync(REPORT_DIR, { recursive: true });
//     context = await browser.newContext({
//       viewport: { width: 1440, height: 900 },
//       ignoreHTTPSErrors: true,
//       recordVideo: { dir: path.join(REPORT_DIR, "video"), size: { width: 1280, height: 720 } },
//     });
//     page = await context.newPage();
//     launcher = new GameLauncherPage(page);
//     frame = new GameFrameHelper(page);
//     network = new NetworkMonitor(page);
//     consoleMonitor = new ConsoleMonitor(page);
//     evidence = new EvidenceCollector(path.join(process.cwd(), "test-results"));
//     network.attach();
//     consoleMonitor.attach();
//     try {
//       await launcher.open();
//       await launcher.setPlayer(playerId);
//       const found = await launcher.discoverGames();
//       const match = found.find((item) => item.gameName.toLowerCase().includes(requestedGame.toLowerCase()));
//       if (!match) {
//         blockReason = `Game "${requestedGame}" was not on the launcher. Discovered: ${found.map((item) => item.gameName).join(", ")}`;
//         return;
//       }
//       game = match;
//       network.setGame(activeGame().gameName);
//       consoleMonitor.setContext(activeGame().gameName);
//       await launcher.openGame(activeGame());
//       const state = await frame.waitForInteractive(regressionConfig.launchTimeoutMs);
//       if (state.phase !== "playing" || !state.controls.spin) {
//         blockReason = `Game launched but was not interactive. Phase ${state.phase}.`;
//         return;
//       }
//       await page.route(authorizedBetUrl, scatterHandler);
//       ready = true;
//     } catch (error) {
//       blockReason = errorText(error);
//     }
//   });

//   test.afterAll(async () => {
//     const video = page ? page.video() : undefined;
//     await context?.setOffline(false).catch(() => undefined);
//     await context?.close().catch(() => undefined);
//     videoPath = await video?.path().catch(() => undefined);
//     finishedCases.push(...cases);
//     writeChaosReport(finishedCases, videoPath);
//   });

//   test("baseline frontend and backend spin", async () => {
//     cases.push(await runScenario("Baseline frontend and backend spin", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       await spinOnce();
//       const record = await network.waitForCount(start + 1, regressionConfig.spinTimeoutMs);
//       const after = await settle(regressionConfig.spinTimeoutMs);
//       const parsed = parseSpinResponse(record.responseBody);
//       const compared = after
//         ? compareSpin({
//           gameName: activeGame().gameName,
//           spinNumber: network.count(),
//           trigger: "chaos-baseline",
//           network: record,
//           parsed,
//           frontend: after,
//           sawSpinning: true,
//           returnedToIdle: !after.busy,
//           duplicateRequests: 0,
//         })
//         : undefined;
//       const mismatches = compared?.mismatches ?? [];
//       const result = await judge({
//         scenario: "Baseline frontend and backend spin",
//         technique: "Capture one authorized bet and compare bet, balance, win, symbols, multiplier, free spins, and feature.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Read the frontend state.", "Press Spin once.", "Wait for /api/v1/slots/bet and for the reels to return to idle.", "Compare frontend and backend fields."],
//         expected: "One transaction completes, the reels return to idle, and the visible bet, balance, and win agree with the response.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: 1,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         notes: mismatches.map((row) => `${row.field} frontend ${JSON.stringify(row.frontend)} backend ${JSON.stringify(row.backend)} ${row.difference ?? ""}`.trim()),
//         consoleMark,
//         networkMark,
//         recommendedFix: "Treat the bet response as the source of truth and render balance and win only from that committed payload.",
//       });
//       if (mismatches.length && result.status === "PASS") {
//         result.status = "FAIL";
//         result.severity = "High";
//         result.actual = `Frontend and backend disagree. ${result.actual}`;
//         result.reproducibility = "Observed once this run";
//         result.screenshot = result.screenshot || await shoot("chaos-mismatch");
//       }
//       featureSeen = featureSeen || inFeature(after);
//       return result;
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("rapid spin clicks", async () => {
//     cases.push(await runScenario("Rapid spin clicks", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(2, passthrough, async () => {
//         for (let index = 0; index < RAPID_CLICKS; index += 1) {
//           await frame.clickControl("spin").catch(() => false);
//           await frame.invoke("spin").catch(() => false);
//         }
//         await settle(regressionConfig.spinTimeoutMs);
//       });
//       const after = await readOptional();
//       return judge({
//         scenario: "Rapid spin clicks",
//         technique: `${RAPID_CLICKS} spin clicks and pointer events while idle. At most two requests reach STG; further duplicates are aborted locally.`,
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}. Current bet ${before.bet ?? "unread"}.`,
//         steps: ["Read balance and bet.", `Click and invoke Spin ${RAPID_CLICKS} times without waiting.`, "Wait for the reels to settle.", "Count bet requests and compare balance."],
//         expected: "One bet is processed. Extra clicks do not create another debit, a false win, or a stuck spin button.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Ignore spin input while a bet is in flight and until the reels are idle.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("rapid space spins", async () => {
//     cases.push(await runScenario("Rapid Space spins", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(2, passthrough, async () => {
//         for (let index = 0; index < RAPID_CLICKS; index += 1) {
//           await frame.pressSpace(1);
//         }
//         await settle(regressionConfig.spinTimeoutMs);
//       });
//       return judge({
//         scenario: "Rapid Space spins",
//         technique: `${RAPID_CLICKS} Space presses. At most two requests reach STG.`,
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Focus the game canvas.", `Press Space ${RAPID_CLICKS} times.`, "Wait for idle.", "Compare request count with balance."],
//         expected: "Space starts one spin. Repeats are ignored until that transaction finishes.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Debounce Space the same way as the spin button, including key repeat.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("open and close the game repeatedly", async () => {
//     cases.push(await runScenario("Open and close the game repeatedly", async () => {
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const steps: string[] = [];
//       for (let index = 0; index < 3; index += 1) {
//         await launcher.closeGame();
//         steps.push(`Close session ${index + 1}.`);
//         await launcher.openGame(activeGame());
//         const state = await frame.waitForInteractive(regressionConfig.launchTimeoutMs);
//         steps.push(`Open session ${index + 1} and wait until phase ${state.phase}.`);
//         if (healthProblems(state).length) throw new Error(healthProblems(state).join("; "));
//       }
//       const after = await ensurePlaying();
//       return blankCase({
//         scenario: "Open and close the game repeatedly",
//         technique: "Three close/open cycles of the game iframe from the launcher.",
//         preconditions: `Launcher grid is available for ${playerId}.`,
//         steps,
//         expected: "Each cycle returns a visible canvas and a usable spin control. The launcher itself stays open.",
//         actual: `Three cycles completed. Last phase ${after.phase}, canvas ${after.canvas.cssWidth}x${after.canvas.cssHeight}.`,
//         severity: "None",
//         status: "PASS",
//         reproducibility: "Not reproduced",
//         before: after,
//         after,
//         consoleErrors: consoleSince(consoleMark),
//         networkErrors: networkSince(networkMark),
//         recommendedFix: "No launcher change indicated by this cycle.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("refresh during loading", async () => {
//     cases.push(await runScenario("Refresh during loading", async () => {
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       await launcher.closeGame();
//       const card = launcher.card(activeGame());
//       await card.scrollIntoViewIfNeeded();
//       await card.locator('button[aria-label="Play in modal"]').click({ force: true });
//       await page.waitForTimeout(600);
//       await page.reload({ waitUntil: "domcontentloaded" });
//       await launcher.setPlayer(playerId);
//       const after = await relaunch();
//       const problems = healthProblems(after);
//       return blankCase({
//         scenario: "Refresh during loading",
//         technique: "Browser reload about 600ms after Play is clicked, before the session is required to be interactive.",
//         preconditions: `Player ${playerId} can launch ${activeGame().gameName}.`,
//         steps: ["Close any open session.", "Click Play.", "Reload the launcher during load.", "Sign in again and launch the game."],
//         expected: "The reload does not leave a blank launcher or a game that cannot be started again.",
//         actual: problems.length ? problems.join("; ") : `Recovered to phase ${after.phase} with a spin control.`,
//         severity: problems.length ? "High" : "None",
//         status: problems.length ? "FAIL" : "PASS",
//         reproducibility: problems.length ? "Observed once this run" : "Not reproduced",
//         after,
//         consoleErrors: consoleSince(consoleMark),
//         networkErrors: networkSince(networkMark),
//         screenshot: problems.length ? await shoot("refresh-loading") : undefined,
//         recommendedFix: "Make launcher boot idempotent so a reload during iframe startup always returns to the game grid.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("refresh during spin or win animation", async () => {
//     cases.push(await runScenario("Refresh during spin or win animation", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       let observed = "spin";
//       const counts = await faultBets(1, passthrough, async () => {
//         await spinOnce();
//         const deadline = Date.now() + 8_000;
//         while (Date.now() < deadline) {
//           const current = await readOptional();
//           if (!current) break;
//           if (current.flags._isShowingWinlines || (current.winDisplay ?? 0) > (before.winDisplay ?? 0)) {
//             observed = "win-animation";
//             break;
//           }
//           if (current.flags._isReelSpinning || current.busy) {
//             observed = "busy-spin";
//             if (Date.now() > deadline - 6_500) break;
//           }
//           await page.waitForTimeout(150);
//         }
//         await page.reload({ waitUntil: "domcontentloaded" });
//       });
//       await launcher.setPlayer(playerId);
//       const after = await relaunch();
//       const result = await judge({
//         scenario: "Refresh during spin or win animation",
//         technique: `Reload the browser while the game is in ${observed}.`,
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Start one spin.", `Reload as soon as state "${observed}" is seen.`, "Sign in and launch the same game.", "Confirm the canvas, balance, and spin control."],
//         expected: "The reloaded session restores a finite balance and a usable game. It does not replay a win or leave the reels spinning.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         notes: [`Interrupted state observed before reload: ${observed}.`],
//         consoleMark,
//         networkMark,
//         recommendedFix: "On load, resolve any open transaction before enabling Spin, and restore balance from the server.",
//       });
//       return result;
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("close the iframe during a spin", async () => {
//     cases.push(await runScenario("Close the iframe during a spin", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(1, async (route) => {
//         try {
//           const response = await route.fetch();
//           await deliverScatter(route, response);
//         } catch {
//           await route.abort("failed").catch(() => undefined);
//         }
//       }, async () => {
//         await spinOnce();
//         await page.waitForTimeout(400);
//         await launcher.closeGame();
//       });
//       const after = await relaunch();
//       return judge({
//         scenario: "Close the iframe during a spin",
//         technique: "Close the game modal while the bet response is briefly held, then open the game again.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Start a spin.", "Close the iframe while the bet is in flight.", "Launch the game again.", "Read balance and controls."],
//         expected: "Closing the iframe does not crash the launcher. The next session is playable and the balance stays finite.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Complete or explicitly roll back the open bet when the iframe is destroyed, then boot the next session from server state.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("switch away during a spin", async () => {
//     cases.push(await runScenario("Switch away during a spin", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const other = await context.newPage();
//       const counts = await faultBets(1, passthrough, async () => {
//         await spinOnce();
//         await other.goto("about:blank");
//         await other.bringToFront();
//         await page.waitForTimeout(1500);
//         await page.bringToFront();
//       });
//       await other.close();
//       const after = await settle(regressionConfig.spinTimeoutMs);
//       return judge({
//         scenario: "Switch away during a spin",
//         technique: "Open a blank tab and move focus away for 1.5s while one bet is in flight.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Start a spin.", "Open about:blank and focus it.", "Return to the launcher.", "Wait for idle."],
//         expected: "The spin finishes or recovers. Focus loss does not freeze the canvas or invent a win.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Keep the spin state machine running when the document is hidden, and reconcile the result when the tab is visible again.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("change viewport during a spin", async () => {
//     cases.push(await runScenario("Change viewport during a spin", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(1, passthrough, async () => {
//         await spinOnce();
//         await page.setViewportSize({ width: 390, height: 844 });
//         await page.waitForTimeout(800);
//         await page.setViewportSize({ width: 1440, height: 900 });
//       });
//       const after = await settle(regressionConfig.spinTimeoutMs);
//       const orientationNote = after?.orientationBlocked ? "Portrait showed the orientation gate." : "Portrait did not block the canvas.";
//       return judge({
//         scenario: "Change viewport during a spin",
//         technique: "Switch from 1440x900 to 390x844 and back while one bet is in flight.",
//         preconditions: `${activeGame().gameName} is running in a landscape viewport.`,
//         steps: ["Start a spin.", "Set a phone portrait viewport.", "Restore 1440x900.", "Confirm the canvas is measurable and Spin works."],
//         expected: "After returning to landscape the game is visible and the in-flight transaction does not corrupt balance.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         notes: [orientationNote],
//         consoleMark,
//         networkMark,
//         recommendedFix: "Relayout the canvas on resize and keep the active transaction independent from viewport changes.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("disconnect and reconnect during a bet", async () => {
//     cases.push(await runScenario("Disconnect and reconnect during a bet", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       try {
//         await spinOnce();
//         await context.setOffline(true);
//         await page.waitForTimeout(1500);
//       } finally {
//         await context.setOffline(false);
//       }
//       const after = await settle(regressionConfig.spinTimeoutMs);
//       return judge({
//         scenario: "Disconnect and reconnect during a bet",
//         technique: "Browser-context offline for 1.5s after Spin. This does not generate traffic to other hosts.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Press Spin.", "Set this browser context offline.", "Restore the connection.", "Wait for idle or a recoverable error."],
//         expected: "The game shows a recoverable error or finishes the spin. Balance stays finite and the controls come back.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: Math.max(0, network.count() - start),
//         maxAttempts: 2,
//         maxAccepted: 1,
//         minimumAttempts: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "On reconnect, query the unresolved transaction once and unlock the controls even when the original request failed.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("high latency and a second spin", async () => {
//     cases.push(await runScenario("High latency and a second spin", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       let busyWhileLocked = false;
//       const counts = await faultBets(2, async (route, index) => {
//         if (index > 1) {
//           await route.abort("failed");
//           return;
//         }
//         const response = await route.fetch();
//         await page.waitForTimeout(8_000);
//         await deliverScatter(route, response);
//       }, async () => {
//         await spinOnce();
//         await page.waitForTimeout(500);
//         const mid = await readOptional();
//         busyWhileLocked = Boolean(mid?.busy);
//         await spinOnce();
//         await settle(regressionConfig.spinTimeoutMs);
//       });
//       return judge({
//         scenario: "High latency and a second spin",
//         technique: "Hold the first STG bet response for 8 seconds, then press Spin again. A third request is aborted locally.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Press Spin.", "While the response is held, read whether the game is busy.", "Press Spin again.", "Release the first response and wait for idle."],
//         expected: "The second press does not start another debit. The first result still settles and the button unlocks.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         notes: [busyWhileLocked ? "Controls reported busy during the delay." : "Controls did not report busy during the delay."],
//         consoleMark,
//         networkMark,
//         recommendedFix: "Disable Spin, Space, and Buy until the delayed bet resolves or times out once.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("abort one bet before it reaches STG", async () => {
//     cases.push(await runScenario("Abort one bet before it reaches STG", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(1, async (route) => {
//         await route.abort("timedout");
//       }, async () => {
//         await spinOnce();
//         await settle(20_000);
//       });
//       return judge({
//         scenario: "Abort one bet before it reaches STG",
//         technique: "Abort the next bet in the browser with a timeout error so the staging API is not called.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}. Balance ${before.balance ?? "unread"}.`,
//         steps: ["Arm a one-shot timeout abort on the STG bet URL.", "Press Spin.", "Wait up to 20s for an error or idle state."],
//         expected: "The spin does not hang forever and the displayed balance does not change to a win.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 2,
//         maxAccepted: 0,
//         consoleMark,
//         networkMark,
//         flagBalanceWithoutServer: true,
//         recommendedFix: "Surface a timeout, keep the previous balance, and re-enable Spin without retrying in a loop.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("interrupted transaction then resume", async () => {
//     cases.push(await runScenario("Interrupted transaction then resume", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       let serverBalance: number | undefined;
//       let serverWin: number | undefined;
//       const counts = await faultBets(1, async (route) => {
//         const response = await route.fetch();
//         try {
//           const parsed = parseSpinResponse(await response.json());
//           serverBalance = parsed.balance;
//           serverWin = parsed.totalWin;
//         } catch {
//           serverBalance = undefined;
//         }
//         try {
//           await route.abort("failed");
//         } catch {
//           await route.fulfill({ status: 504, body: "" });
//         }
//       }, async () => {
//         await spinOnce();
//         await page.waitForTimeout(1000);
//       });
//       await page.reload({ waitUntil: "domcontentloaded" });
//       await launcher.setPlayer(playerId);
//       const after = await relaunch();
//       const notes = [`Server balance at interrupt: ${serverBalance ?? "unread"}. Server win: ${serverWin ?? "unread"}. UI balance after resume: ${after.balance ?? "unread"}.`];
//       if (serverBalance != null && after.balance != null && !moneyEqual(serverBalance, after.balance) && (serverWin ?? 0) >= 0) {
//         notes.push("Resumed UI balance does not match the balance already committed on STG.");
//       }
//       const result = await judge({
//         scenario: "Interrupted transaction then resume",
//         technique: "Let one STG bet commit, drop the response, reload, and compare the restored balance with the committed balance.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Press Spin.", "Read the staging response in the test and do not deliver it to the game.", "Reload and launch the game.", "Compare UI balance with the committed balance."],
//         expected: "Resume shows the committed balance, does not pay the win twice, and returns to a usable idle state.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         notes,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Persist the transaction before acknowledging it, and on the next launch display that committed balance exactly once.",
//       });
//       if (notes.some((note) => note.includes("does not match")) && result.severity === "None") {
//         result.status = "FAIL";
//         result.severity = "Critical";
//         result.actual = notes.join(" ");
//         result.reproducibility = "Observed once this run";
//         result.screenshot = await shoot("resume-mismatch");
//       }
//       return result;
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("malformed bet response", async () => {
//     cases.push(await runScenario("Malformed bet response", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(1, async (route) => {
//         await route.fulfill({ status: 200, contentType: "application/json", body: "{\"balance\":" });
//       }, async () => {
//         await spinOnce();
//         await settle(15_000);
//       });
//       return judge({
//         scenario: "Malformed bet response",
//         technique: "Return a truncated JSON body for one bet without calling STG.",
//         preconditions: `${activeGame().gameName} is idle. Balance ${before.balance ?? "unread"}.`,
//         steps: ["Fulfill the next bet with truncated JSON.", "Press Spin.", "Read balance, win, and errors."],
//         expected: "The game reports an error or stays on the previous balance. It does not display NaN or a win.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 2,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         flagBalanceWithoutServer: true,
//         recommendedFix: "Parse defensively and discard a bet result that is not valid JSON.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("empty bet response", async () => {
//     cases.push(await runScenario("Empty bet response", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(1, async (route) => {
//         await route.fulfill({ status: 200, contentType: "application/json", body: "" });
//       }, async () => {
//         await spinOnce();
//         await settle(15_000);
//       });
//       return judge({
//         scenario: "Empty bet response",
//         technique: "Return an empty HTTP 200 body for one bet without calling STG.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Fulfill the next bet with an empty body.", "Press Spin.", "Wait for an error or idle."],
//         expected: "Empty data does not become a win, a bonus, or a NaN balance.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 2,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         flagBalanceWithoutServer: true,
//         recommendedFix: "Treat an empty body as a failed transaction and keep the last good balance.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("missing and null bet fields", async () => {
//     cases.push(await runScenario("Missing and null bet fields", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(1, async (route) => {
//         const response = await route.fetch();
//         let body: unknown = {};
//         try {
//           body = await response.json();
//         } catch {
//           body = {};
//         }
//         await route.fulfill({
//           status: 200,
//           contentType: "application/json",
//           body: JSON.stringify(spoilPayload(body)),
//         });
//       }, async () => {
//         await spinOnce();
//         await settle(regressionConfig.spinTimeoutMs);
//       });
//       return judge({
//         scenario: "Missing and null bet fields",
//         technique: "One real STG bet is committed, then balance, totalWin, and slot are replaced with null or empty before the game sees them.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Press Spin.", "Strip balance, totalWin, and slot from the response.", "Read the HUD."],
//         expected: "The HUD does not invent a win or show NaN when those fields are null. A later launch can still recover the committed balance.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Require balance and totalWin before updating the HUD, and recover from the server if either field is missing.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("duplicate request while the first is delayed", async () => {
//     cases.push(await runScenario("Duplicate request while the first is delayed", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(2, async (route, index) => {
//         const response = await route.fetch();
//         if (index === 1) await page.waitForTimeout(3_000);
//         await deliverScatter(route, response);
//       }, async () => {
//         await spinOnce();
//         await page.waitForTimeout(400);
//         await spinOnce();
//         await settle(regressionConfig.spinTimeoutMs);
//       });
//       return judge({
//         scenario: "Duplicate request while the first is delayed",
//         technique: "Delay the first STG response by 3 seconds and press Spin again. At most two real bets are allowed.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}. Bet ${before.bet ?? "unread"}.`,
//         steps: ["Press Spin.", "Press Spin again while the first response is held.", "Compare both responses with the balance delta."],
//         expected: "The second press does not create a second debit.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Keep a single in-flight bet token and reject overlapping spin calls.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("bounded invalid bet values", async () => {
//     cases.push(await runScenario("Bounded invalid bet values", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const notes: string[] = [];
//       for (const invalid of [0, -1]) {
//         const counts = await faultBets(1, async (route) => {
//           const raw = route.request().postData();
//           let payload: unknown = raw;
//           try {
//             payload = raw ? JSON.parse(raw) : {};
//           } catch {
//             await route.abort("failed");
//             notes.push(`Bet ${invalid} was not sent because the body was not JSON.`);
//             return;
//           }
//           if (!rewriteBet(payload, invalid)) {
//             await route.abort("failed");
//             notes.push(`Bet ${invalid} was not sent because no bet field was found.`);
//             return;
//           }
//           notes.push(`Rewrote one STG bet field to ${invalid}.`);
//           await route.continue({ postData: JSON.stringify(payload) });
//         }, async () => {
//           await spinOnce();
//           await settle(15_000);
//         });
//         notes.push(`Invalid ${invalid}: attempted ${counts.attempted}, reached STG ${counts.real}.`);
//       }
//       const after = await readOptional();
//       const records = recordsSince(start);
//       const accepted = records.filter((record) => record.status >= 200 && record.status < 300);
//       if (accepted.length) notes.push(`${accepted.length} invalid bet value(s) were accepted by STG.`);
//       if (before.balance != null && after?.balance != null && after.balance > before.balance) {
//         notes.push(`Balance increased from ${before.balance} to ${after.balance} after non-positive bets.`);
//       }
//       const result = await judge({
//         scenario: "Bounded invalid bet values",
//         technique: "Rewrite two separate bet payloads to 0 and -1. No larger stake is sent.",
//         preconditions: `${activeGame().gameName} is idle. Starting balance ${before.balance ?? "unread"}.`,
//         steps: ["Rewrite the next bet to 0 and press Spin.", "Rewrite the next bet to -1 and press Spin.", "Compare balance and HTTP status."],
//         expected: "STG rejects a non-positive bet. The client keeps a finite balance and does not show a win.",
//         before,
//         after,
//         records,
//         attempted: records.length,
//         maxAttempts: 2,
//         maxAccepted: 0,
//         notes,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Reject bet values less than or equal to zero on the server and in the client before the request is sent.",
//       });
//       if (accepted.length || (before.balance != null && after?.balance != null && after.balance > before.balance)) {
//         result.status = "FAIL";
//         result.severity = "Critical";
//         result.actual = notes.join(" ");
//         result.reproducibility = "Observed once this run";
//         result.screenshot = result.screenshot || await shoot("invalid-bet");
//       }
//       return result;
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("clear client session during idle", async () => {
//     cases.push(await runScenario("Clear client session during idle", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       await context.clearCookies();
//       await page.evaluate(() => {
//         localStorage.clear();
//         sessionStorage.clear();
//       });
//       await spinOnce().catch(() => undefined);
//       const after = await settle(15_000);
//       const result = await judge({
//         scenario: "Clear client session during idle",
//         technique: "Clear cookies and web storage for this browser context, then press Spin. Tokens are not read or stored.",
//         preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//         steps: ["Clear cookies, localStorage, and sessionStorage.", "Press Spin.", "Relaunch if the launcher asks for the player again."],
//         expected: "The game either asks for a session again or finishes with the existing in-memory session. Balance does not become NaN and a win is not shown for a rejected call.",
//         before,
//         after,
//         records: recordsSince(start),
//         attempted: Math.max(0, network.count() - start),
//         maxAttempts: 1,
//         maxAccepted: 1,
//         minimumAttempts: 0,
//         consoleMark,
//         networkMark,
//         recommendedFix: "If stored credentials disappear, stop the round and return to the launcher instead of spinning with a half-open session.",
//       });
//       return result;
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("mash controls while a spin is busy", async () => {
//     cases.push(await runScenario("Mash controls while a spin is busy", async () => {
//       const before = await ensurePlaying();
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const otherBet = before.betLevels.find((level) => !moneyEqual(level, before.bet));
//       const counts = await faultBets(2, passthrough, async () => {
//         await spinOnce();
//         await page.waitForTimeout(300);
//         await frame.pressSpace(1).catch(() => undefined);
//         await frame.invoke("spin").catch(() => false);
//         if (otherBet != null) await frame.clickText(String(otherBet)).catch(() => false);
//         await frame.clickControl("buy").catch(() => false);
//         await settle(regressionConfig.spinTimeoutMs);
//       });
//       return judge({
//         scenario: "Mash controls while a spin is busy",
//         technique: "During one spin, send Space, another spin event, a bet-label click, and Buy. At most two STG bets are allowed.",
//         preconditions: `${activeGame().gameName} is idle. Alternate bet ${otherBet ?? "not available"}.`,
//         steps: ["Press Spin.", "While busy, press Space, invoke Spin, click another bet level when one exists, and click Buy.", "Wait for idle."],
//         expected: "Locked controls do not start a second transaction or change the stake of the open round.",
//         before,
//         after: await readOptional(),
//         records: recordsSince(start),
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Disable bet changes, Buy, Space, and Spin for the whole time a round is unresolved.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("repeated buy feature", async () => {
//     cases.push(await runScenario("Repeated Buy Feature", async () => {
//       const before = await ensurePlaying();
//       if (!before.hasBuy || !before.controls.buy?.visible) {
//         return blankCase({
//           scenario: "Repeated Buy Feature",
//           technique: "Repeated Buy clicks.",
//           preconditions: `${activeGame().gameName} is idle for player ${playerId}.`,
//           steps: ["Look for the Buy control."],
//           expected: "If Buy exists, a second confirmation does not send a second purchase.",
//           actual: "This game has no visible Buy control, so no purchase was sent.",
//           severity: "None",
//           status: "NOT APPLICABLE",
//           reproducibility: "Not applicable",
//           before,
//           recommendedFix: "No Buy control to change on this title.",
//         });
//       }
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       const counts = await faultBets(1, passthrough, async () => {
//         await frame.clickControl("buy");
//         await frame.clickControl("buy");
//         await frame.clickText("^buy\\s*feature$");
//         await frame.clickText("^buy\\s*feature$");
//         await settle(regressionConfig.spinTimeoutMs);
//       });
//       const records = recordsSince(start);
//       const purchases = records.filter((record) => Number(readPayloadFlag(record.requestPayload, "buyFeat") ?? 0) > 0);
//       const after = await readOptional();
//       featureSeen = featureSeen || inFeature(after);
//       const result = await judge({
//         scenario: "Repeated Buy Feature",
//         technique: "Open Buy twice and press the confirm label twice. Only one STG request is allowed; a second purchase is aborted locally.",
//         preconditions: `${activeGame().gameName} shows Buy. Displayed buy amount ${before.buyAmount ?? before.buyText ?? "unread"}.`,
//         steps: ["Click Buy twice.", "Click the Buy Feature confirmation twice.", "Count buyFeat requests."],
//         expected: "At most one purchase is sent. The second click does not queue another paid feature.",
//         before,
//         after,
//         records,
//         attempted: counts.attempted,
//         maxAttempts: 1,
//         maxAccepted: 1,
//         notes: [`buyFeat requests that reached the monitor: ${purchases.length}.`],
//         consoleMark,
//         networkMark,
//         recommendedFix: "Disable the Buy confirmation while a purchase request is outstanding.",
//       });
//       if (purchases.length > 1) {
//         result.status = "FAIL";
//         result.severity = "High";
//         result.actual = `${purchases.length} buy-feature requests were captured. ${result.actual}`;
//         result.screenshot = result.screenshot || await shoot("repeat-buy");
//       }
//       return result;
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   test("refresh or disconnect during bonus", async () => {
//     cases.push(await runScenario("Refresh or disconnect during bonus", async () => {
//       const before = await ensurePlaying();
//       const current = inFeature(before) || featureSeen;
//       if (!current && !inFeature(before)) {
//         return blankCase({
//           scenario: "Refresh or disconnect during bonus",
//           technique: "Refresh and a short offline window during bonus or free spins.",
//           preconditions: `${activeGame().gameName} session for player ${playerId}.`,
//           steps: ["Check whether a bonus or free-spin round is active."],
//           expected: "An interrupted feature resumes without a second payout or a stuck reel.",
//           actual: "No bonus or free-spin state was reached in this bounded run, so the feature was not interrupted.",
//           severity: "None",
//           status: "NOT APPLICABLE",
//           reproducibility: "Not applicable",
//           before,
//           recommendedFix: "Cover this path when a feature is naturally active; do not force extra paid bonuses in this suite.",
//         });
//       }
//       const consoleMark = consoleSince(0).length;
//       const networkMark = networkSince(0).length;
//       const start = network.count();
//       await page.reload({ waitUntil: "domcontentloaded" });
//       await launcher.setPlayer(playerId);
//       const after = await relaunch();
//       try {
//         await context.setOffline(true);
//         await page.waitForTimeout(1000);
//       } finally {
//         await context.setOffline(false);
//       }
//       const settled = await settle(regressionConfig.spinTimeoutMs);
//       return judge({
//         scenario: "Refresh or disconnect during bonus",
//         technique: "Reload during an observed feature, relaunch, then take this browser offline for 1 second.",
//         preconditions: `${activeGame().gameName} had entered a feature state for player ${playerId}.`,
//         steps: ["Reload during the feature.", "Launch the game again.", "Disconnect and reconnect this browser for 1 second."],
//         expected: "The feature resumes or ends cleanly. Balance stays finite and the player can continue.",
//         before,
//         after: settled || after,
//         records: recordsSince(start),
//         attempted: Math.max(0, network.count() - start),
//         maxAttempts: 3,
//         maxAccepted: 3,
//         minimumAttempts: 0,
//         consoleMark,
//         networkMark,
//         recommendedFix: "Store feature progress server-side and restore it on launch after a dropped connection.",
//       });
//     }));
//     writeChaosReport(cases, videoPath);
//   });

//   });
//   }

//         ("chaos report", async () => {
//     writeChaosReport(finishedCases);
//     openDashboard(path.join(process.cwd(), "test-results"));
//     const blocking = finishedCases.filter((item) => item.status === "FAIL" && (item.severity === "Critical" || item.severity === "High"));
//     expect(
//       blocking.map((item) => `${item.severity}: ${item.game} — ${item.scenario} — ${item.actual}`),
//       `Dashboard: ${path.join(process.cwd(), "test-results", "index.html")}`,
//     ).toEqual([]);
//   });
// });
