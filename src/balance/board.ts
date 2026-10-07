import fs from "node:fs";
import path from "node:path";
import { qaEmit } from "../live/qaEvents";
import {
  type ComparisonRow,
  type Evidence,
  type Scenario,
  type ScenarioStatus,
  SCENARIO_NAMES,
  countersFor,
  money,
} from "./model";

const root = path.join(process.cwd(), "test-results");

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function writeAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents);
  try {
    fs.copyFileSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function pill(status: ScenarioStatus): string {
  return `<span class="pill ${status.toLowerCase().replace(/\s/g, "-")}">${escapeHtml(status)}</span>`;
}

function cell(value: number | null): string {
  return money(value);
}

function evidenceBlock(item: Evidence): string {
  const rows: Array<[string, string]> = [
    ["Classification", item.classification],
    ["Layer", item.layer],
    ["Severity", item.severity],
    ["Balance before", money(item.balanceBefore)],
    ["User action", item.action],
    ["Bet / cost", money(item.bet)],
    ["Backend deduction", money(item.deduction)],
    ["Win", money(item.win)],
    ["Expected balance", money(item.expected)],
    ["Actual backend balance", money(item.backend)],
    ["Actual UI balance", money(item.ui)],
    ["Difference (UI − backend)", money(item.difference)],
    ["Transaction difference (expected − backend)", money(item.transactionDifference)],
    ["First point of mismatch", item.firstMismatch],
    ["API / transaction", item.api],
    ["Reproduction", item.steps],
  ];
  const table = rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  const payload = `<pre>Request\n${escapeHtml(item.request)}\n\nResponse\n${escapeHtml(item.response)}</pre>`;
  const picture = item.screenshot ? `<a href="/artifacts/${escapeHtml(item.screenshot)}">Screenshot</a><img src="/artifacts/${escapeHtml(item.screenshot)}" alt="Screenshot" />` : "";
  return `<details open><summary>${escapeHtml(item.classification)}</summary><table class="evidence">${table}</table>${payload}${picture}</details>`;
}

function render(game: string, playerId: string, currency: string, bet: number | null, scenarios: Scenario[], comparison: ComparisonRow[]): string {
  const counters = countersFor(scenarios);
  const cards: Array<[string, number]> = [
    ["Total scenarios", counters.total],
    ["Passed", counters.passed],
    ["Failed", counters.failed],
    ["Balance mismatches", counters.balanceMismatches],
    ["Temporary UI mismatches", counters.temporaryUi],
    ["Double deductions", counters.doubleDeductions],
    ["Missing deductions", counters.missingDeductions],
    ["Duplicate wins", counters.duplicateWins],
    ["Buy Scratch issues", counters.buyScratchIssues],
    ["Bonus issues", counters.bonusIssues],
    ["Buy Feature issues", counters.buyFeatureIssues],
    ["Currency issues", counters.currencyIssues],
    ["Race-condition issues", counters.raceIssues],
  ];
  const stats = cards.map(([label, value]) => {
    const tone = label === "Passed" ? "pass" : value > 0 && label !== "Total scenarios" ? "fail" : "";
    return `<div class="card ${tone}"><span class="muted">${escapeHtml(label)}</span><strong>${value}</strong></div>`;
  }).join("");
  const statusRank: Record<string, number> = { FAIL: 0, WARN: 1, BLOCKED: 2, RUNNING: 3, "NOT APPLICABLE": 4, PASS: 5 };
  const orderedScenarios = [...scenarios].sort((left, right) => (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9) || left.name.localeCompare(right.name));
  const scenarioRows = orderedScenarios.map((item, index) => `<tr class="${item.status === "PASS" ? "pass-row" : item.status === "FAIL" ? "fail-row" : ""}">
    <td>${index + 1}</td>
    <td>${escapeHtml(item.name)}</td>
    <td>${pill(item.status)}</td>
    <td>${escapeHtml(item.classification || "—")}</td>
    <td>${escapeHtml(item.details)}${item.checkpoints.length ? `<div class="muted">${item.checkpoints.map((point) => `${escapeHtml(point.point)}: ${point.match} (UI ${money(point.ui)} / BE ${money(point.backend)})`).join(" · ")}</div>` : ""}${item.evidence ? evidenceBlock(item.evidence) : ""}</td>
  </tr>`).join("");
  const compareRows = comparison.map((row) => `<tr class="${row.match === "MATCH" ? "pass-row" : row.match === "MISMATCH" ? "fail-row" : ""}">
    <td>${escapeHtml(row.flow)}</td>
    <td>${cell(row.bet)}</td>
    <td>${cell(row.deduction)}</td>
    <td>${cell(row.win)}</td>
    <td>${cell(row.expected)}</td>
    <td>${cell(row.backend)}</td>
    <td>${cell(row.ui)}</td>
    <td>${pill(row.match === "MATCH" ? "PASS" : row.match === "MISMATCH" ? "FAIL" : "RUNNING")}</td>
  </tr>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="2" />
  <title>Balance validation · ${escapeHtml(game)}</title>
  <style>
    :root { color-scheme: dark; --bg:#10141c; --card:#1b2330; --text:#e7eef8; --muted:#93a1b5; --line:#2d3a4d; --ok:#1f8f4e; --bad:#c43838; --warn:#b8860b; --run:#2f6fed; }
    * { box-sizing: border-box; }
    body { margin:0; font:15px/1.45 Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
    main { padding:24px; max-width:1280px; }
    h1, h2 { margin:0 0 8px; }
    h2 { margin-top:28px; }
    .muted { color:var(--muted); }
    .cards { display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin:16px 0 8px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px; }
    .card strong { display:block; font-size:26px; }
    .card.pass strong { color:#8ee0ad; }
    .card.fail strong { color:#ffb4b4; }
    table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:var(--muted); font-weight:600; }
    tr.pass-row td:nth-child(2) { box-shadow: inset 3px 0 0 var(--ok); }
    tr.fail-row td:nth-child(2) { box-shadow: inset 3px 0 0 var(--bad); }
    .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700; color:#fff; background:#66788d; }
    .pass { background:var(--ok); }
    .fail { background:var(--bad); }
    .warn { background:var(--warn); }
    .running { background:var(--run); }
    .blocked, .not-applicable { background:#66788d; }
    pre { white-space:pre-wrap; word-break:break-word; background:#0d121a; padding:10px; border-radius:8px; }
    img { display:block; max-width:520px; margin-top:8px; border-radius:8px; border:1px solid var(--line); }
    .evidence th { width:280px; }
    a { color:#9ec1ff; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(game)} balance validation</h1>
    <p class="muted">Player ${escapeHtml(playerId)} · currency ${escapeHtml(currency || "unread")} · shared bet ${money(bet)} · backend transaction is the source of truth · ${new Date().toLocaleString()}</p>
    <section class="cards">${stats}</section>
    <p class="muted">Running ${counters.running} · blocked ${counters.blocked} · not applicable ${counters.notApplicable} · temporary warnings ${counters.warned}. This page refreshes every 2 seconds.</p>
    <h2>Scenarios</h2>
    <table>
      <thead><tr><th>#</th><th>Scenario</th><th>Status</th><th>Classification</th><th>Evidence</th></tr></thead>
      <tbody>${scenarioRows}</tbody>
    </table>
    <h2>Same bet amount</h2>
    <table>
      <thead><tr><th>Flow</th><th>Bet / cost</th><th>Backend deduction</th><th>Win</th><th>Expected balance</th><th>Backend balance</th><th>UI balance</th><th>Match</th></tr></thead>
      <tbody>${compareRows || `<tr><td colspan="8" class="muted">Rows appear as each flow finishes.</td></tr>`}</tbody>
    </table>
  </main>
</body>
</html>`;
}

export class BalanceBoard {
  readonly scenarios: Scenario[];
  readonly comparison: ComparisonRow[] = [];
  currency = "";
  bet: number | null = null;

  constructor(readonly game: string, readonly playerId: string) {
    this.scenarios = SCENARIO_NAMES.map((name) => ({
      name,
      status: "RUNNING" as const,
      details: "Waiting for this scenario.",
      classification: "",
      checkpoints: [],
    }));
  }

  private scenario(name: string): Scenario {
    const found = this.scenarios.find((item) => item.name === name);
    if (!found) throw new Error(`Unknown scenario ${name}`);
    return found;
  }

  mark(name: string, status: ScenarioStatus, details: string, classification = "", checkpoints: Scenario["checkpoints"] = [], evidence?: Evidence, screenshot = ""): void {
    const item = this.scenario(name);
    item.status = status;
    item.details = details;
    item.classification = classification;
    item.checkpoints = checkpoints;
    item.evidence = evidence;
    item.screenshot = screenshot || evidence?.screenshot || item.screenshot || "";
    this.publish(item);
  }

  blockRemaining(message: string): void {
    for (const item of this.scenarios) {
      if (item.status === "RUNNING") {
        item.status = "BLOCKED";
        item.details = message;
      }
    }
    this.publish();
  }

  addComparison(row: ComparisonRow): void {
    const index = this.comparison.findIndex((item) => item.flow === row.flow);
    if (index >= 0) this.comparison[index] = row;
    else this.comparison.push(row);
    this.publish();
  }

  publish(changed?: Scenario): void {
    const html = render(this.game, this.playerId, this.currency, this.bet, this.scenarios, this.comparison);
    writeAtomic(path.join(root, "balance-report.html"), html);
    writeAtomic(path.join(root, "balance-report.json"), JSON.stringify({
      game: this.game,
      playerId: this.playerId,
      currency: this.currency,
      bet: this.bet,
      updated: new Date().toISOString(),
      counters: countersFor(this.scenarios),
      scenarios: this.scenarios,
      comparison: this.comparison,
    }, null, 2));
    const slug = this.game.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "game";
    const partial = {
      gameName: this.game,
      checks: this.scenarios.map((item) => ({
        name: item.name,
        status: item.status,
        details: item.details,
        screenshot: item.screenshot || item.evidence?.screenshot || "",
      })),
    };
    writeAtomic(path.join(root, "balance-partials", `00-${slug}.json`), JSON.stringify(partial, null, 2));
    const gamesFile = path.join(root, "balance-games.json");
    let games: Array<{ gameName?: string }> = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(gamesFile, "utf8"));
      if (Array.isArray(parsed)) games = parsed;
    } catch {
      games = [];
    }
    const index = games.findIndex((item) => item.gameName === this.game);
    if (index >= 0) games[index] = partial;
    else games.push(partial);
    writeAtomic(gamesFile, JSON.stringify(games, null, 2));
    if (!changed) return;
    qaEmit({
      type: changed.status === "FAIL" ? "MISMATCH" : "CHECK",
      game: this.game,
      worker: 1,
      status: changed.status,
      message: changed.name,
      details: changed.details,
      bet: this.bet,
      uiBalance: changed.evidence?.ui,
      beBalance: changed.evidence?.backend,
      screenshot: changed.evidence?.screenshot,
      transaction: changed.classification,
    });
  }
}
