import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const results = path.join(root, "test-results");
const liveDir = path.join(results, "live");
const eventsFile = path.join(liveDir, "events.jsonl");
const runsDir = path.join(liveDir, "runs");
const runnerFile = path.join(liveDir, "runner.json");
const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const port = Number(process.env.QA_LIVE_PORT ?? 4317);
const suites = {
  balance: { label: "Balance", args: ["test", "--config=playwright.balance.config.ts"] },
  scratch: { label: "Scratch", args: ["test", "--config=playwright.scratch.config.ts"] },
  regression: { label: "Regression", args: ["test", "--config=playwright.config.ts"] },
};
const dashboard = fs.readFileSync(path.join(here, "dashboard.html"), "utf8");

fs.mkdirSync(runsDir, { recursive: true });

const fileCache = new Map();
const seen = new Set();
const feed = [];
const clients = new Set();
let archived = false;
let startedAt = null;
const runner = {
  status: "idle",
  suite: "",
  label: "",
  pid: null,
  started: null,
  ended: null,
  exitCode: null,
  log: "",
  child: null,
};

function readJson(file) {
  try {
    const stat = fs.statSync(file);
    const hit = fileCache.get(file);
    if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.data;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    fileCache.set(file, { mtime: stat.mtimeMs, size: stat.size, data });
    if (!startedAt || stat.mtimeMs < startedAt) startedAt = stat.mtimeMs;
    return data;
  } catch {
    return null;
  }
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => path.join(dir, name));
}

const checklistFile = path.join(liveDir, "game-checklist.json");

function gameCatalog() {
  try {
    const text = fs.readFileSync(path.join(root, "src", "config", "regression.config.ts"), "utf8");
    const start = text.indexOf("gameNames:");
    const end = text.indexOf("],", start);
    const games = [];
    for (const line of text.slice(start, end).split("\n")) {
      const match = line.match(/"([^"]+)"/);
      if (!match) continue;
      games.push({ name: match[1], selected: !line.trim().startsWith("//") });
    }
    return games;
  } catch {
    return [];
  }
}

function gameChecklist() {
  const catalog = gameCatalog();
  const saved = readJson(checklistFile);
  if (!Array.isArray(saved)) return catalog;
  const chosen = new Set(saved.filter((name) => typeof name === "string"));
  return catalog.map((game) => ({ name: game.name, selected: chosen.has(game.name) }));
}

function saveGameChecklist(names) {
  const allowed = new Set(gameCatalog().map((game) => game.name));
  const chosen = [...new Set(names.filter((name) => allowed.has(name)))];
  fs.mkdirSync(liveDir, { recursive: true });
  fs.writeFileSync(checklistFile, JSON.stringify(chosen, null, 2));
  fileCache.delete(checklistFile);
  return gameChecklist();
}

function configuredGames() {
  return gameChecklist().filter((game) => game.selected).map((game) => game.name);
}

function remember(item) {
  const key = item.spin != null
    ? `${item.game}|spin|${item.spin}|${item.status}|${item.details || ""}`
    : `${item.game}|${item.message}|${item.status}|${item.details || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  feed.push({ ...item, t: new Date().toISOString() });
  if (feed.length > 400) feed.splice(0, feed.length - 400);
}

function loadEvents() {
  if (!fs.existsSync(eventsFile)) return [];
  const stat = fs.statSync(eventsFile);
  if (!startedAt || stat.mtimeMs < startedAt) startedAt = stat.birthtimeMs || stat.mtimeMs;
  return fs.readFileSync(eventsFile, "utf8").split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function slimSpin(spin) {
  return {
    spin: spin.spinNumber,
    trigger: spin.trigger,
    passed: Boolean(spin.passed),
    betUi: num(spin.frontend?.bet),
    betBe: num(spin.backend?.bet),
    winUi: num(spin.frontend?.totalWin),
    winBe: num(spin.backend?.totalWin),
    ui: num(spin.frontend?.balance),
    be: num(spin.backend?.balance),
    http: num(spin.network?.status),
    notes: Array.isArray(spin.notes) ? spin.notes.slice(0, 4) : [],
    mismatches: Array.isArray(spin.mismatches) ? spin.mismatches : [],
    comparisons: Array.isArray(spin.comparisons) ? spin.comparisons.map((row) => ({
      field: row.field,
      frontend: row.frontend,
      backend: row.backend,
      result: row.result,
    })) : [],
    screenshot: spin.failureScreenshot || spin.screenshot || "",
    responsePath: spin.network?.responsePath || "",
  };
}

function matchLabel(left, right) {
  if (left == null || right == null) return null;
  return Math.round(left * 100) === Math.round(right * 100);
}

const reportsDir = path.join(results, "reports");
const reportIndexFile = path.join(reportsDir, "index.json");

function savedReports() {
  const index = readJson(reportIndexFile);
  return Array.isArray(index) ? index : [];
}

function balanceGameReports() {
  const games = readJson(path.join(results, "balance-games.json"));
  if (Array.isArray(games) && games.length) {
    return games
      .filter((game) => game && typeof game.gameName === "string" && Array.isArray(game.checks))
      .map((game) => ({ gameName: game.gameName, scenarios: game.checks }));
  }
  const data = readJson(path.join(results, "balance-report.json"));
  if (!Array.isArray(data?.scenarios)) return [];
  return [{ gameName: data.game || "Balance", scenarios: data.scenarios }];
}

function reportTally(suite) {
  if (suite === "balance") {
    const scenarios = balanceGameReports().flatMap((game) => game.scenarios);
    return {
      passed: scenarios.filter((item) => item.status === "PASS").length,
      failed: scenarios.filter((item) => item.status === "FAIL").length,
    };
  }
  if (suite === "scratch") {
    const games = readJson(path.join(results, "scratch-report.json"));
    const checks = Array.isArray(games) ? games.flatMap((game) => game.checks || []) : [];
    return {
      passed: checks.filter((item) => item.status === "PASS").length,
      failed: checks.filter((item) => item.status === "FAIL").length,
    };
  }
  return { passed: 0, failed: 0 };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function savedPage(title, subtitle, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#10141c; --card:#1b2330; --text:#e7eef8; --muted:#93a1b5; --line:#2d3a4d; --ok:#1f8f4e; --bad:#c43838; }
    body { margin:0; font:15px/1.45 Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
    main { padding:24px; max-width:1100px; }
    h1, h2 { margin:0 0 8px; }
    h2 { margin-top:28px; }
    .muted { color:var(--muted); }
    table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:var(--muted); }
    tr.fail td:first-child { box-shadow: inset 3px 0 0 var(--bad); }
    tr.pass td:first-child { box-shadow: inset 3px 0 0 var(--ok); }
    .pill { display:inline-block; min-width:88px; text-align:center; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700; color:#fff; background:#66788d; }
    .fail { background:var(--bad); }
    .pass { background:var(--ok); }
    .warn, .blocked { background:#b8860b; }
    img { display:block; max-width:520px; margin-top:8px; border-radius:8px; }
    a { color:#9ec1ff; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="muted">${subtitle}</p>
    ${body}
  </main>
</body>
</html>`;
}

function renderSavedReport(suite) {
  const rank = { FAIL: 0, WARN: 1, BLOCKED: 2, RUNNING: 3, "NOT APPLICABLE": 4, PASS: 5 };
  const byStatus = (left, right) => (rank[left.status] ?? 9) - (rank[right.status] ?? 9);
  const pill = (status) => `<span class="pill ${escapeHtml(String(status || "").toLowerCase().replace(/\s/g, "-"))}">${escapeHtml(status)}</span>`;
  const row = (item, index) => {
    const tone = item.status === "FAIL" ? "fail" : item.status === "PASS" ? "pass" : "";
    const picture = item.screenshot ? `<br><a href="/artifacts/${escapeHtml(item.screenshot)}"><img src="/artifacts/${escapeHtml(item.screenshot)}" alt=""></a>` : "";
    return `<tr class="${tone}"><td>${index + 1}</td><td>${escapeHtml(item.name)}</td><td>${pill(item.status)}</td><td>${escapeHtml(item.details || "")}${picture}</td></tr>`;
  };
  if (suite === "balance") {
    const games = balanceGameReports();
    if (!games.length) return null;
    const tally = reportTally("balance");
    const sections = [...games].sort((left, right) => {
      const failed = (game) => game.scenarios.filter((item) => item.status === "FAIL").length;
      return failed(right) - failed(left) || left.gameName.localeCompare(right.gameName);
    }).map((game) => {
      const checks = [...game.scenarios].sort(byStatus);
      const failed = checks.filter((item) => item.status === "FAIL").length;
      const passed = checks.filter((item) => item.status === "PASS").length;
      return `<h2>${escapeHtml(game.gameName)}</h2><p class="muted">${failed} failed, ${passed} passed</p><table><thead><tr><th>#</th><th>Scenario</th><th>Status</th><th>What happened</th></tr></thead><tbody>${checks.map(row).join("")}</tbody></table>`;
    }).join("");
    return savedPage(
      "Balance results",
      `Saved after the run. ${tally.failed} failed, ${tally.passed} passed. Failed scenarios are listed first.`,
      sections,
    );
  }
  if (suite === "scratch") {
    const games = readJson(path.join(results, "scratch-report.json"));
    if (!Array.isArray(games)) return null;
    const tally = reportTally("scratch");
    const sections = games.map((game) => {
      const checks = [...(game.checks || [])].sort(byStatus);
      const failed = checks.filter((item) => item.status === "FAIL").length;
      const passed = checks.filter((item) => item.status === "PASS").length;
      return `<h2>${escapeHtml(game.gameName)}</h2><p class="muted">${failed} failed, ${passed} passed</p><table><thead><tr><th>#</th><th>Scenario</th><th>Status</th><th>What happened</th></tr></thead><tbody>${checks.map(row).join("")}</tbody></table>`;
    }).join("");
    return savedPage(
      "Scratch results",
      `Saved after the run. ${tally.failed} failed, ${tally.passed} passed. Failed scenarios are listed first.`,
      sections,
    );
  }
  return null;
}

function archiveReport(suite) {
  const html = renderSavedReport(suite);
  if (!html) return null;
  const tally = reportTally(suite);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = `${stamp}-${suite}.html`;
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, file), html);
  const saved = {
    file,
    suite,
    saved: new Date().toISOString(),
    href: `/reports/${file}`,
    passed: tally.passed,
    failed: tally.failed,
  };
  const index = [saved, ...savedReports().filter((item) => item.file !== file)].slice(0, 40);
  fs.writeFileSync(reportIndexFile, JSON.stringify(index, null, 2));
  return saved;
}

function reportLabel(item, last) {
  const counts = `${item.failed ?? 0} failed, ${item.passed ?? 0} passed`;
  const when = String(item.saved || "").slice(0, 16).replace("T", " ");
  const name = item.suite === "balance" ? "Balance" : item.suite === "scratch" ? "Scratch" : item.suite;
  return last ? `Last report · ${name} · ${counts}` : `${name} ${when} · ${counts}`;
}

function reportLinks() {
  const saved = savedReports();
  const links = saved.slice(0, 8).map((item, index) => ({ href: item.href, label: reportLabel(item, index === 0) }));
  if (fs.existsSync(path.join(results, "balance-report.html"))) links.push({ href: "/balance", label: "Balance report" });
  if (fs.existsSync(path.join(results, "scratch-report.html"))) links.push({ href: "/scratch", label: "Scratch report" });
  return links;
}

function idleState() {
  return {
    status: "IDLE",
    started: null,
    now: new Date().toISOString(),
    counts: { games: 0, running: 0, passed: 0, failed: 0, pending: 0, blocked: 0 },
    spins: 0,
    wins: 0,
    errors: 0,
    health: { overall: null, functional: null, balance: null, network: null, ui: null },
    cards: [],
    feed: [],
    alerts: [],
    runs: fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((name) => name.endsWith(".json")).sort().reverse() : [],
    balance: null,
    runner: runnerView(),
    reports: reportLinks(),
    games: gameChecklist(),
  };
}

function liveCutoff() {
  if (runner.status !== "running" && runner.status !== "stopping") return null;
  const started = Date.parse(runner.started || "");
  return Number.isFinite(started) ? started : null;
}

function buildState() {
  const cutoff = liveCutoff();
  if (cutoff == null) {
    seen.clear();
    feed.length = 0;
    return idleState();
  }
  const events = loadEvents().filter((event) => Date.parse(event.t) >= cutoff);
  for (const event of events) {
    remember({
      t: event.t,
      game: event.game,
      status: event.status || "PASS",
      message: event.message,
      details: event.details || "",
      screenshot: event.screenshot || "",
      spin: event.spin,
      uiBalance: event.uiBalance,
      beBalance: event.beBalance,
    });
  }

  const workers = new Map();
  for (const event of events) {
    if (event.worker) workers.set(event.game, event.worker);
  }

  const cards = new Map();
  const ensure = (name) => {
    if (!cards.has(name)) {
      cards.set(name, {
        name,
        worker: workers.get(name) || null,
        status: "PENDING",
        spin: null,
        bet: null,
        win: null,
        ui: null,
        be: null,
        balanceMatch: null,
        betMatch: null,
        winMatch: null,
        responseValid: null,
        lastEvent: null,
        checks: [],
        spins: [],
        errors: 0,
      });
    }
    return cards.get(name);
  };

  for (const file of [...listJson(path.join(results, "scratch-partials")), ...listJson(path.join(results, "balance-partials"))]) {
    if (fs.statSync(file).mtimeMs < cutoff) continue;
    const parsed = readJson(file);
    if (!parsed || typeof parsed.gameName !== "string" || !Array.isArray(parsed.checks)) continue;
    const card = ensure(parsed.gameName);
    const checks = parsed.checks.filter((check) => !/still running/i.test(check.details || ""));
    card.checks = checks;
    const running = parsed.checks.length === 1 && /still running/i.test(parsed.checks[0].details || "");
    if (running) card.status = "RUNNING";
    else if (checks.some((check) => check.status === "FAIL")) card.status = "FAIL";
    else if (checks.some((check) => check.status === "BLOCKED")) card.status = "BLOCKED";
    else if (checks.length) card.status = "PASS";
    const latest = checks.at(-1);
    if (latest) card.lastEvent = latest.name;
    for (const check of checks) {
      remember({
        t: new Date(fs.statSync(file).mtimeMs).toISOString(),
        game: parsed.gameName,
        status: check.status,
        message: check.name,
        details: check.details,
        screenshot: check.screenshot || "",
      });
    }
  }

  let spinTotal = 0;
  let winTotal = 0;
  let networkErrors = 0;
  let balanceCompared = 0;
  let balanceMatched = 0;
  let httpCompared = 0;
  let httpOk = 0;
  const alerts = [];

  for (const file of listJson(path.join(results, "data", "partials"))) {
    if (fs.statSync(file).mtimeMs < cutoff) continue;
    const parsed = readJson(file);
    const result = parsed?.result;
    if (!result?.gameName) continue;
    const card = ensure(result.gameName);
    const spins = Array.isArray(result.spins) ? result.spins.map(slimSpin) : [];
    card.spins = spins.slice(-8);
    card.checks = (result.checks || []).map((check) => ({
      name: check.name,
      status: check.status,
      details: check.details,
      screenshot: "",
    }));
    spinTotal += result.spinCount || spins.length;
    winTotal += result.winCount || spins.filter((spin) => (spin.winBe ?? 0) > 0).length;
    networkErrors += (result.networkErrors || []).length;
    const failed = (result.checks || []).some((check) => check.status === "FAIL") || spins.some((spin) => !spin.passed);
    card.status = result.launch === "BLOCKED" ? "BLOCKED" : failed ? "FAIL" : "PASS";
    const last = spins.at(-1);
    if (last) {
      card.spin = last.spin;
      card.bet = last.betBe ?? last.betUi;
      card.win = last.winBe ?? last.winUi;
      card.ui = last.ui;
      card.be = last.be;
      card.balanceMatch = matchLabel(last.ui, last.be);
      card.betMatch = matchLabel(last.betUi, last.betBe);
      card.winMatch = matchLabel(last.winUi, last.winBe);
      card.responseValid = last.http == null ? null : last.http < 400;
      card.lastEvent = `Spin #${last.spin}`;
    }
    for (const spin of spins) {
      remember({
        t: new Date(fs.statSync(file).mtimeMs).toISOString(),
        game: result.gameName,
        status: spin.passed ? "PASS" : "FAIL",
        message: `Spin #${spin.spin}`,
        details: spin.mismatches.map((item) => `${item.field}: UI ${JSON.stringify(item.frontend)} / BE ${JSON.stringify(item.backend)}`).join("; "),
        screenshot: spin.screenshot,
        spin: spin.spin,
        uiBalance: spin.ui,
        beBalance: spin.be,
      });
      if (spin.ui != null && spin.be != null) {
        balanceCompared += 1;
        if (matchLabel(spin.ui, spin.be)) balanceMatched += 1;
        else {
          alerts.push({
            game: result.gameName,
            spin: spin.spin,
            ui: spin.ui,
            be: spin.be,
            difference: Math.round((spin.ui - spin.be) * 100) / 100,
            transaction: spin.passed ? "ok" : "failed",
            popup: spin.notes.find((note) => /insufficient|limit|popup/i.test(note)) || "",
            screenshot: spin.screenshot,
            details: spin.mismatches.map((item) => `${item.field}: UI ${JSON.stringify(item.frontend)} / BE ${JSON.stringify(item.backend)}`).join("; "),
            responsePath: spin.responsePath,
          });
        }
      }
      if (spin.http != null) {
        httpCompared += 1;
        if (spin.http < 400) httpOk += 1;
      }
    }
  }

  for (const event of events) {
    const card = ensure(event.game);
    if (event.worker) card.worker = event.worker;
    if (event.type === "GAME_STARTED") card.status = card.status === "PENDING" ? "RUNNING" : card.status;
    if (event.type === "GAME_COMPLETED" && event.status) card.status = event.status;
    if (event.spin != null) card.spin = event.spin;
    if (event.bet != null) card.bet = event.bet;
    if (event.win != null) card.win = event.win;
    if (event.uiBalance != null) card.ui = event.uiBalance;
    if (event.beBalance != null) card.be = event.beBalance;
    if (event.uiBalance != null && event.beBalance != null) card.balanceMatch = matchLabel(event.uiBalance, event.beBalance);
    card.lastEvent = event.message;
    if (event.type === "MISMATCH" && event.uiBalance != null && event.beBalance != null && !matchLabel(event.uiBalance, event.beBalance)) {
      alerts.push({
        game: event.game,
        spin: event.spin,
        ui: event.uiBalance,
        be: event.beBalance,
        difference: Math.round((event.uiBalance - event.beBalance) * 100) / 100,
        transaction: event.transaction || "failed",
        popup: event.popup || "",
        screenshot: event.screenshot || "",
        details: event.details || "",
        responsePath: "",
      });
    }
  }

  const names = configuredGames();
  for (const name of names) ensure(name);
  const ordered = [...cards.values()].sort((left, right) => {
    const rank = names.indexOf(left.name) - names.indexOf(right.name);
    if (names.includes(left.name) && names.includes(right.name)) return rank;
    return left.name.localeCompare(right.name);
  });

  const counts = {
    games: ordered.length,
    running: ordered.filter((card) => card.status === "RUNNING").length,
    passed: ordered.filter((card) => card.status === "PASS").length,
    failed: ordered.filter((card) => card.status === "FAIL").length,
    pending: ordered.filter((card) => card.status === "PENDING").length,
    blocked: ordered.filter((card) => card.status === "BLOCKED").length,
  };
  const checkRows = ordered.flatMap((card) => card.checks);
  const functionalTotal = checkRows.filter((check) => check.status === "PASS" || check.status === "FAIL").length;
  const functionalPass = checkRows.filter((check) => check.status === "PASS").length;
  const uiRows = checkRows.filter((check) => /button|panel|size|legend|scratch/i.test(check.name));
  const uiTotal = uiRows.filter((check) => check.status === "PASS" || check.status === "FAIL").length;
  const uiPass = uiRows.filter((check) => check.status === "PASS").length;
  const healthOf = (pass, total) => (total ? Math.round((pass / total) * 100) : null);
  const parts = [healthOf(functionalPass, functionalTotal), healthOf(balanceMatched, balanceCompared), healthOf(httpOk, httpCompared), healthOf(uiPass, uiTotal)].filter((value) => value != null);
  let overall = parts.length ? Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length) : null;
  if (alerts.length && overall != null) overall = Math.min(overall, healthOf(balanceMatched, balanceCompared) ?? overall);

  const active = counts.running > 0 || (counts.pending > 0 && (counts.passed + counts.failed + counts.blocked) > 0);
  const complete = counts.games > 0 && counts.running === 0 && counts.pending === 0;
  const status = complete ? "COMPLETE" : active || feed.length ? "RUNNING" : "IDLE";
  const state = {
    status,
    started: startedAt ? new Date(startedAt).toISOString() : null,
    now: new Date().toISOString(),
    counts,
    spins: spinTotal,
    wins: winTotal,
    errors: checkRows.filter((check) => check.status === "FAIL").length + alerts.length + networkErrors,
    health: {
      overall,
      functional: healthOf(functionalPass, functionalTotal),
      balance: healthOf(balanceMatched, balanceCompared),
      network: healthOf(httpOk, httpCompared),
      ui: healthOf(uiPass, uiTotal),
    },
    cards: ordered,
    feed: feed.slice(-80).reverse(),
    alerts: alerts.slice(-12).reverse(),
    runs: fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((name) => name.endsWith(".json")).sort().reverse() : [],
    balance: null,
    runner: runnerView(),
    reports: reportLinks(),
    games: gameChecklist(),
  };
  if (!archived && status === "COMPLETE") {
    archived = true;
    fs.writeFileSync(path.join(runsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(state));
    state.runs = fs.readdirSync(runsDir).filter((name) => name.endsWith(".json")).sort().reverse();
  }
  return state;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runnerView() {
  return {
    status: runner.status,
    suite: runner.suite,
    label: runner.label,
    pid: runner.pid,
    started: runner.started,
    ended: runner.ended,
    exitCode: runner.exitCode,
    log: runner.log.slice(-1500),
    suites: Object.entries(suites).map(([id, suite]) => ({ id, label: suite.label })),
  };
}

function saveRunner() {
  fs.mkdirSync(liveDir, { recursive: true });
  fs.writeFileSync(runnerFile, JSON.stringify(runnerView()));
}

function appendLog(chunk) {
  runner.log = `${runner.log}${chunk}`.slice(-8000);
}

function finishRunner(code, signal) {
  runner.exitCode = code;
  runner.ended = new Date().toISOString();
  runner.child = null;
  runner.pid = null;
  if (runner.status === "stopping" || signal) runner.status = "stopped";
  else runner.status = code === 0 ? "passed" : "failed";
  const saved = archiveReport(runner.suite);
  if (saved) appendLog(`\nSaved report ${saved.href} · ${saved.failed} failed, ${saved.passed} passed\n`);
  saveRunner();
  notify();
}

function startRun(id) {
  if (runner.child || (runner.pid && pidAlive(runner.pid) && (runner.status === "running" || runner.status === "stopping"))) {
    return { ok: false, error: "A test is already running. Stop it first." };
  }
  const suite = suites[id];
  if (!suite) return { ok: false, error: "Choose Balance, Scratch, or Regression." };
  if (!fs.existsSync(playwrightCli)) return { ok: false, error: "Playwright is not installed." };
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(process.env.USERPROFILE || "", "AppData", "Local", "ms-playwright");
  const selectedGames = gameChecklist().filter((game) => game.selected).map((game) => game.name);
  if (!selectedGames.length) return { ok: false, error: "Check at least one game to test." };
  const child = spawn(process.execPath, [playwrightCli, ...suite.args, "--headed"], {
    cwd: root,
    env: {
      ...process.env,
      QA_LIVE_KEEP: "1",
      PLAYWRIGHT_BROWSERS_PATH: browsers,
      FORCE_COLOR: "0",
      QA_GAME_LIST: selectedGames.join("|"),
      BALANCE_GAME: selectedGames[0],
    },
    detached: true,
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  runner.status = "running";
  runner.suite = id;
  runner.label = suite.label;
  runner.pid = child.pid;
  runner.started = new Date().toISOString();
  runner.ended = null;
  runner.exitCode = null;
  runner.log = "";
  runner.child = child;
  seen.clear();
  feed.length = 0;
  archived = false;
  startedAt = Date.now();
  child.stdout.on("data", (chunk) => appendLog(chunk.toString()));
  child.stderr.on("data", (chunk) => appendLog(chunk.toString()));
  child.on("exit", (code, signal) => {
    if (runner.child !== child) return;
    finishRunner(code, signal);
  });
  child.unref();
  saveRunner();
  notify();
  return { ok: true, runner: runnerView() };
}

function stopRun() {
  const pid = runner.pid;
  if (!pid || !pidAlive(pid)) {
    if (runner.status === "running" || runner.status === "stopping") finishRunner(null, "stopped");
    return { ok: true, runner: runnerView() };
  }
  runner.status = "stopping";
  appendLog("\nStopping the test.\n");
  saveRunner();
  notify();
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => undefined);
  else {
    try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); }
  }
  return { ok: true, runner: runnerView() };
}

function restoreRunner() {
  const saved = readJson(runnerFile);
  if (!saved?.pid || !pidAlive(saved.pid)) return;
  if (saved.status !== "running" && saved.status !== "stopping") return;
  runner.status = "running";
  runner.suite = saved.suite || "";
  runner.label = saved.label || "";
  runner.pid = saved.pid;
  runner.started = saved.started || null;
  runner.log = saved.log || "";
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function notify() {
  for (const client of clients) client.write("data: update\n\n");
}

let lastSig = "";
setInterval(() => {
  try {
    const state = buildState();
    const sig = [
      state.status,
      state.errors,
      state.runner?.status,
      state.runner?.pid,
      state.runner?.log?.slice(-80),
      state.feed[0]?.t,
      state.feed[0]?.message,
      state.balance?.updated,
      ...(state.balance?.scenarios || []).map((item) => `${item.name}:${item.status}`),
      ...state.cards.map((card) => `${card.name}:${card.status}:${card.checks.length}:${card.lastEvent}:${card.spin}`),
    ].join("|");
    if (sig !== lastSig) {
      lastSig = sig;
      notify();
    }
  } catch (error) {
    console.error(error);
  }
}, 800);

setInterval(() => {
  for (const client of clients) client.write(": ping\n\n");
}, 15000);

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

restoreRunner();

setInterval(() => {
  if ((runner.status === "running" || runner.status === "stopping") && runner.pid && !runner.child && !pidAlive(runner.pid)) {
    finishRunner(null, runner.status === "stopping" ? "stopped" : null);
  }
}, 1000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/games" && req.method === "POST") {
    const body = await readBody(req);
    const games = saveGameChecklist(Array.isArray(body.names) ? body.names.map(String) : []);
    notify();
    return send(res, 200, JSON.stringify({ ok: true, games }), "application/json");
  }
  if (url.pathname === "/api/run" && req.method === "POST") {
    const body = await readBody(req);
    const result = startRun(String(body.suite || "balance"));
    return send(res, result.ok ? 200 : 409, JSON.stringify(result), "application/json");
  }
  if (url.pathname === "/api/stop" && req.method === "POST") {
    return send(res, 200, JSON.stringify(stopRun()), "application/json");
  }
  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("data: update\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/api/state") {
    const run = url.searchParams.get("run");
    if (run) {
      const file = path.join(runsDir, path.basename(run));
      if (!file.endsWith(".json") || !fs.existsSync(file)) return send(res, 404, "{}", "application/json");
      return send(res, 200, fs.readFileSync(file), "application/json");
    }
    return send(res, 200, JSON.stringify(buildState()), "application/json");
  }
  if (url.pathname.startsWith("/reports/")) {
    const file = path.resolve(reportsDir, path.basename(decodeURIComponent(url.pathname.slice("/reports/".length))));
    if (!file.startsWith(path.resolve(reportsDir)) || !file.endsWith(".html") || !fs.existsSync(file)) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, fs.readFileSync(file), "text/html; charset=utf-8");
  }
  if (url.pathname === "/balance" || url.pathname === "/scratch") {
    const file = path.join(results, url.pathname === "/balance" ? "balance-report.html" : "scratch-report.html");
    const title = url.pathname === "/balance" ? "Balance validation" : "Scratch results";
    const html = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8")
      : `<!doctype html><title>${title}</title><p>Waiting for a saved run.</p>`;
    return send(res, 200, html, "text/html; charset=utf-8");
  }
  if (url.pathname.startsWith("/artifacts/")) {
    const relative = decodeURIComponent(url.pathname.slice("/artifacts/".length));
    const file = path.resolve(results, relative);
    if (!file.startsWith(results) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found", "text/plain");
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".json" ? "application/json" : "application/octet-stream";
    return send(res, 200, fs.readFileSync(file), type);
  }
  return send(res, 200, fs.readFileSync(path.join(here, "dashboard.html")), "text/html; charset=utf-8");
});

if (!savedReports().length) {
  const existing = [
    ["balance", path.join(results, "balance-report.html")],
    ["scratch", path.join(results, "scratch-report.html")],
  ].filter(([, file]) => fs.existsSync(file)).sort((left, right) => fs.statSync(left[1]).mtimeMs - fs.statSync(right[1]).mtimeMs);
  for (const [suite] of existing) archiveReport(suite);
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Live QA Center http://127.0.0.1:${port}`);
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) console.log(`Phone (same Wi-Fi) http://${entry.address}:${port}`);
    }
  }
});
