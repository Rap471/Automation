import type { GameResult, RegressionCheck, ReportModel, SpinValidation } from "../types";
import { regressionPercent, summarize, syncLabel } from "./stats";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pill(status: string): string {
  const key = status.toLowerCase().replace(/[^a-z]+/g, "-");
  return `<span class="pill ${esc(key)}">${esc(status)}</span>`;
}

function money(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : esc(value ?? "");
}

function rawBlock(title: string, value: unknown): string {
  return `<details><summary>${esc(title)}</summary><pre>${esc(JSON.stringify(value ?? null, null, 2))}</pre></details>`;
}

function link(href: string | undefined, label: string): string {
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>` : "";
}

function brief(details: string): { short: string; full?: string } {
  const clean = visibleDetails(details).replace(/\s+/g, " ").trim();
  const steps = clean.split(";").map((part) => part.trim()).filter(Boolean);
  if (steps.length > 3) {
    const missed = steps.filter((step) => /did not/i.test(step)).length;
    const short = missed ? `${steps.length} steps, ${missed} did not match` : `${steps.length} steps matched`;
    return { short, full: clean };
  }
  if (clean.length <= 160) return { short: clean };
  return { short: `${clean.slice(0, 157)}…`, full: clean };
}

function visibleDetails(details: string): string {
  return details.replace(/\[\[stg\]\][\s\S]*?\[\[\/stg\]\]/g, "").trim();
}

function manipulation(details: string): { technique: string; preconditions: string; steps: string[] } | undefined {
  const match = details.match(/\[\[stg\]\]([\s\S]*?)\[\[\/stg\]\]/);
  if (!match) return undefined;
  let technique = "";
  let preconditions = "";
  const steps: string[] = [];
  for (const line of match[1].split("\n").map((item) => item.trim()).filter(Boolean)) {
    if (line.startsWith("How staging was manipulated:")) technique = line.slice("How staging was manipulated:".length).trim();
    else if (line.startsWith("Preconditions:")) preconditions = line.slice("Preconditions:".length).trim();
    else steps.push(line.replace(/^\d+\.\s*/, ""));
  }
  if (!technique && !steps.length) return undefined;
  return { technique, preconditions, steps };
}

function manipulationHtml(details: string): string {
  const staged = manipulation(details);
  if (!staged) return "";
  const steps = staged.steps.map((step) => `<li>${esc(step)}</li>`).join("");
  return `<div class="manipulation"><p><strong>How staging was manipulated</strong></p><p>${esc(staged.technique)}</p>${staged.preconditions ? `<p>Preconditions: ${esc(staged.preconditions)}</p>` : ""}${steps ? `<ol>${steps}</ol>` : ""}</div>`;
}

function detailCell(details: string): string {
  const text = brief(details);
  const steps = manipulationHtml(details);
  if (!text.full) return `${esc(text.short)}${steps}`;
  return `${esc(text.short)} <details class="inline"><summary>Full details</summary><p>${esc(text.full)}</p></details>${steps}`;
}

function checkGroup(title: string, rows: Array<{ game: GameResult; check: RegressionCheck }>): string {
  if (!rows.length) return "";
  const body = rows.map(({ game, check }) => {
    const search = `${check.name} ${game.gameName} ${check.status} ${check.details}`.toLowerCase();
    const spin = check.spinNumber
      ? `<button type="button" data-open="spin-${esc(game.gameId)}-${check.spinNumber}">${check.spinNumber}</button>`
      : "";
    return `<tr data-searchable data-search="${esc(search)}" data-status="${esc(check.status)}" data-game="${esc(game.gameName)}">
      <td>${esc(check.name)}</td><td>${esc(game.gameName)}</td><td>${pill(check.status)}</td><td>${spin}</td><td>${detailCell(check.details)}</td>
    </tr>`;
  }).join("");
  return `<section class="group">
    <h3>${esc(title)} <span class="muted">${rows.length}</span></h3>
    <table><thead><tr><th>Test case</th><th>Game</th><th>Status</th><th>Spin</th><th>Details</th></tr></thead><tbody>${body}</tbody></table>
  </section>`;
}

function spinBlock(game: GameResult, spin: SpinValidation): string {
  const rows = spin.comparisons.map((row) => `<tr class="${row.result === "MISMATCH" ? "bad" : ""}">
      <td>${esc(row.field)}</td>
      <td>${esc(typeof row.frontend === "object" ? JSON.stringify(row.frontend) : row.frontend)}</td>
      <td>${esc(typeof row.backend === "object" ? JSON.stringify(row.backend) : row.backend)}</td>
      <td>${esc(row.difference || "")}</td>
      <td>${row.result === "MATCH" ? "MATCH" : row.result === "MISMATCH" ? "MISMATCH" : "NOT COMPARED"}</td>
    </tr>`).join("");
  const check = game.checks.find((item) => item.spinNumber === spin.spinNumber);
  const search = `${game.gameName} ${spin.spinNumber} ${spin.trigger} ${spin.correlation} ${spin.mismatches.map((item) => item.field).join(" ")} ${spin.notes.join(" ")}`.toLowerCase();
  const evidence = [link(spin.screenshot, "Screenshot"), link(spin.failureScreenshot, "Failure screenshot"), link(spin.network?.requestPath, "Request"), link(spin.network?.responsePath, "Response")].filter(Boolean).join(" · ");
  return `<article class="spin" id="spin-${esc(game.gameId)}-${spin.spinNumber}" hidden data-searchable data-search="${esc(search)}">
    <h3>Spin ${spin.spinNumber} · ${esc(spin.trigger)} ${pill(spin.correlation)}</h3>
    <p>Frontend bet ${money(spin.frontend.bet)}, balance ${money(spin.frontend.balance)}, win ${money(spin.frontend.totalWin)}. Backend bet ${money(spin.backend.bet)}, balance ${money(spin.backend.balance)}, win ${money(spin.backend.totalWin)}.</p>
    ${spin.screenshot ? `<p><img alt="Spin ${spin.spinNumber}" src="${esc(spin.screenshot)}" /></p>` : ""}
    ${evidence ? `<p>${evidence}</p>` : ""}
    <table>
      <thead><tr><th>Field</th><th>Frontend</th><th>Backend</th><th>Difference</th><th>Result</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">No field comparison was recorded.</td></tr>`}</tbody>
    </table>
    ${rawBlock("Request", spin.network?.requestPayload)}
    ${rawBlock("Response", spin.network?.responseBody)}
    ${check ? manipulationHtml(check.details) : ""}
    ${spin.notes.length ? `<p>${esc(spin.notes.join(" "))}</p>` : ""}
  </article>`;
}

function gameSection(game: GameResult): string {
  const counts = {
    passed: game.checks.filter((check) => check.status === "PASS").length,
    failed: game.checks.filter((check) => check.status === "FAIL").length,
    blocked: game.checks.filter((check) => check.status === "BLOCKED").length,
  };
  const problems = game.checks.filter((check) => check.status === "FAIL" || check.status === "BLOCKED");
  const problemList = problems.map((check) => {
    const text = brief(check.details);
    return `<li>${pill(check.status)} ${esc(check.name)}${check.spinNumber ? `, spin ${check.spinNumber}` : ""}. ${esc(text.short)}${manipulationHtml(check.details)}</li>`;
  }).join("");
  const spinRows = game.spins.map((spin) => `<tr data-searchable data-search="${esc(`${game.gameName} ${spin.spinNumber} ${spin.correlation}`.toLowerCase())}">
      <td><button type="button" data-open="spin-${esc(game.gameId)}-${spin.spinNumber}">${spin.spinNumber}</button></td>
      <td>${esc(spin.trigger)}</td>
      <td>${money(spin.backend.bet)}</td>
      <td>${money(spin.backend.totalWin)}</td>
      <td>${money(spin.frontend.totalWin)}</td>
      <td>${money(spin.backend.balance)}</td>
      <td>${money(spin.frontend.balance)}</td>
      <td>${spin.correlation === "PASS" ? "Match" : spin.correlation === "FAIL" ? "Mismatch" : "Not sampled"}</td>
    </tr>`).join("");
  return `<section class="detail" id="game-${esc(game.gameId)}" hidden>
    <h2>${esc(game.gameName)} ${pill(game.result)}</h2>
    <p>Launch ${pill(game.launch)} · ${game.spinCount} spins · ${game.winCount} wins · ${counts.passed} passed · ${counts.failed} failed · ${counts.blocked} blocked</p>
    ${problemList ? `<ul class="problems">${problemList}</ul>` : "<p>No failed or blocked checks.</p>"}
    <h3>Spins</h3>
    <table>
      <thead><tr><th>Spin</th><th>Trigger</th><th>Bet</th><th>Backend win</th><th>Frontend win</th><th>Backend balance</th><th>Frontend balance</th><th>Match</th></tr></thead>
      <tbody>${spinRows || `<tr><td colspan="8">No spins were recorded.</td></tr>`}</tbody>
    </table>
    ${game.spins.map((spin) => spinBlock(game, spin)).join("")}
  </section>`;
}

function attentionList(model: ReportModel): string {
  const rows = model.games.flatMap((game) => game.checks
    .filter((check) => check.status === "FAIL" || check.status === "BLOCKED")
    .map((check) => ({ game, check })));
  if (!rows.length) return "<p>No failed or blocked checks.</p>";
  return `<ul class="problems">${rows.map(({ game, check }) => {
    const text = brief(check.details);
    const open = check.spinNumber
      ? ` <button type="button" data-open="spin-${esc(game.gameId)}-${check.spinNumber}">Spin ${check.spinNumber}</button>`
      : ` <button type="button" data-open="game-${esc(game.gameId)}">Open game</button>`;
    return `<li>${pill(check.status)} <strong>${esc(game.gameName)}</strong> · ${esc(check.name)}. ${esc(text.short)}${open}${manipulationHtml(check.details)}</li>`;
  }).join("")}</ul>`;
}

export function renderDashboard(model: ReportModel): string {
  const stats = summarize(model);
  const gameRows = model.games.map((game) => {
    const search = `${game.gameName} ${game.gameId} ${game.result} ${game.launch}`.toLowerCase();
    return `<tr data-searchable data-search="${esc(search)}" data-result="${esc(game.result)}" data-mismatch="${game.feBeMismatches ? "1" : "0"}" data-console="${game.consoleErrors.length}">
      <td><button type="button" data-open="game-${esc(game.gameId)}">${esc(game.gameName)}</button></td>
      <td>${pill(game.launch)}</td>
      <td>${game.spinCount}</td>
      <td>${game.winCount}</td>
      <td>${esc(syncLabel(game))}</td>
      <td>${esc(regressionPercent(game))}</td>
      <td>${game.consoleErrors.length}</td>
      <td>${pill(game.result)}</td>
    </tr>`;
  }).join("");
  const paired = model.games.flatMap((game) => game.checks.map((check) => ({ game, check })));
  const failed = paired.filter((row) => row.check.status === "FAIL");
  const blocked = paired.filter((row) => row.check.status === "BLOCKED");
  const passed = paired.filter((row) => row.check.status === "PASS");
  const quiet = paired.filter((row) => row.check.status === "MANUAL" || row.check.status === "NOT APPLICABLE" || row.check.status === "SKIPPED");
  const mismatchCards = model.games.flatMap((game) => game.spins.flatMap((spin) => spin.mismatches.map((mismatch) => `<button type="button" class="mismatch" data-open="spin-${esc(game.gameId)}-${spin.spinNumber}" data-searchable data-search="${esc(`${game.gameName} ${mismatch.field} ${spin.spinNumber}`.toLowerCase())}">
      ${esc(game.gameName)} spin ${spin.spinNumber}: ${esc(mismatch.field)} ${esc(mismatch.frontend)} vs ${esc(mismatch.backend)}
    </button>`))).join("");
  const wins = model.games.flatMap((game) => game.spins.filter((spin) => spin.win).map((spin) => `<li data-searchable data-search="${esc(`${game.gameName} win ${spin.spinNumber}`.toLowerCase())}">
      ${esc(game.gameName)} spin ${spin.spinNumber}: bet ${money(spin.backend.bet)}, win ${money(spin.backend.totalWin)}
      ${link(spin.screenshot, "Screenshot")} ${link(spin.network?.requestPath, "Request")} ${link(spin.network?.responsePath, "Response")}
    </li>`)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DIJOKER Game Regression</title>
  <style>
    :root { color-scheme: dark; --bg:#10141c; --card:#1b2330; --text:#e7eef8; --muted:#93a1b5; --line:#2d3a4d; --pass:#1f8f4e; --fail:#c43838; --blocked:#b8860b; --skip:#66788d; }
    * { box-sizing: border-box; }
    body { margin:0; font:15px/1.45 Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
    header, main { padding:24px; max-width:1100px; }
    h1,h2,h3 { margin:0 0 12px; }
    h2 { margin-top:28px; }
    a, button.linkish { color:#8ec5ff; }
    .cards { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin:16px 0; }
    .card, .detail, article, table, .problems { background:var(--card); border:1px solid var(--line); border-radius:12px; }
    .card { padding:14px; }
    .card strong { display:block; font-size:28px; }
    .muted { color:var(--muted); font-weight:400; }
    .toolbar { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; position:sticky; top:0; z-index:2; background:var(--bg); padding:12px 0; }
    input, button { background:#0f1520; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
    button { cursor:pointer; }
    table { width:100%; border-collapse:collapse; overflow:auto; display:block; margin:12px 0 8px; }
    th, td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    tr.bad { background:#3a1d1d; }
    .pill { display:inline-block; border-radius:999px; padding:2px 8px; font-size:12px; font-weight:700; }
    .pill.pass { background:var(--pass); }
    .pill.fail { background:var(--fail); }
    .pill.blocked { background:var(--blocked); }
    .pill.skipped, .pill.not-applicable, .pill.not-sampled, .pill.manual { background:var(--skip); }
    .critical { border:1px solid #c43838; border-radius:12px; padding:12px; margin:8px 0; }
    .detail, article { padding:16px; margin:16px 0; }
    .problems { list-style:none; margin:0; padding:8px 16px; }
    .problems li { padding:8px 0; border-bottom:1px solid var(--line); }
    .problems li:last-child { border-bottom:0; }
    .manipulation { margin-top:8px; padding:8px 10px; border-left:3px solid #8ec5ff; }
    .manipulation ol { margin:6px 0 0 18px; }
    img { max-width:280px; border-radius:8px; }
    pre { white-space:pre-wrap; word-break:break-word; }
    details.inline summary { cursor:pointer; color:#8ec5ff; }
    .group h3 { margin-top:20px; }
    button.mismatch { display:block; width:100%; text-align:left; margin:6px 0; }
  </style>
</head>
<body>
  <header>
    <h1>DIJOKER GAME REGRESSION</h1>
    <p class="muted">${esc(model.generatedAt)} · Player ${esc(model.playerId)} · ${esc(model.launcherUrl)}</p>
    <div class="cards">
      ${card("Games Tested", stats.tested)}
      ${card("Games Passed", stats.passed)}
      ${card("Games Failed", stats.failed)}
      ${card("Games Blocked", stats.blocked)}
      ${card("Total Spins", stats.spins)}
      ${card("Total Wins", stats.wins)}
      ${card("FE/BE Mismatches", stats.mismatchSpins)}
      ${card("Console Errors", stats.consoleErrors)}
      ${card("Network Errors", stats.networkErrors)}
    </div>
    <h2>Failed and blocked</h2>
    <p><a href="review.txt">Open the review record</a> · <a href="review.json">JSON</a></p>
    ${attentionList(model)}
    ${stats.critical.length ? `<h2>Critical</h2>${stats.critical.map((item) => `<p class="critical">${esc(item)}</p>`).join("")}` : ""}
  </header>
  <main>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search game, spin, or check" />
      <button type="button" data-filter="all">All games</button>
      <button type="button" data-filter="PASS">Passed</button>
      <button type="button" data-filter="FAIL">Failed</button>
      <button type="button" data-filter="BLOCKED">Blocked</button>
      <button type="button" data-filter="mismatch">FE/BE mismatch</button>
      <button type="button" id="show-all">Show all checks</button>
    </div>
    <h2>Games</h2>
    <table id="games">
      <thead><tr>
        <th data-sort="text">Game</th><th data-sort="text">Launch</th><th data-sort="number">Spins</th><th data-sort="number">Wins</th>
        <th data-sort="text">FE/BE</th><th data-sort="number">Regression</th><th data-sort="number">Console</th><th data-sort="text">Result</th>
      </tr></thead>
      <tbody>${gameRows}</tbody>
    </table>
    ${model.games.map((game) => gameSection(game)).join("")}
    <div id="all-checks" hidden>
      ${checkGroup("Failed", failed)}
      ${checkGroup("Blocked", blocked)}
      ${checkGroup("Passed", passed)}
      ${checkGroup("Manual and not applicable", quiet)}
    </div>
    <h2>Frontend and backend</h2>
    <p>${stats.comparisons} compared · ${stats.comparisons - stats.mismatchSpins} matched · ${stats.mismatchSpins} mismatched · ${stats.matchRate.toFixed(0)}%</p>
    <p class="muted">${stats.fieldBreakdown.map((item) => `${esc(item.field)} ${item.count}`).join(" · ") || "No field mismatches."}</p>
    ${mismatchCards || "<p>No frontend/backend mismatches.</p>"}
    <details>
      <summary>Winning spins (${model.games.reduce((sum, game) => sum + game.spins.filter((spin) => spin.win).length, 0)})</summary>
      <ul>${wins || "<li>No winning spins were captured.</li>"}</ul>
    </details>
    <details>
      <summary>Console errors (${stats.consoleErrors})</summary>
      ${model.games.flatMap((game) => game.consoleErrors.map((error) => errorCard(game.gameName, error))).join("") || "<p>No console errors.</p>"}
    </details>
    <details>
      <summary>Network errors (${stats.networkErrors})</summary>
      ${model.games.flatMap((game) => game.networkErrors.map((error) => errorCard(game.gameName, error))).join("") || "<p>No network errors.</p>"}
    </details>
  </main>
  <script>
    const search = document.querySelector('#search');
    const allChecks = document.querySelector('#all-checks');
    const showAll = document.querySelector('#show-all');
    let filter = 'all';
    function apply() {
      const query = search.value.trim().toLowerCase();
      document.querySelectorAll('#games tbody tr').forEach((row) => {
        const text = row.dataset.search || '';
        const result = row.dataset.result;
        let visible = !query || text.includes(query);
        if (filter === 'PASS' || filter === 'FAIL' || filter === 'BLOCKED') visible = visible && result === filter;
        if (filter === 'mismatch') visible = visible && row.dataset.mismatch === '1';
        row.hidden = !visible;
      });
      document.querySelectorAll('#all-checks tbody tr, [data-searchable]').forEach((node) => {
        if (node.closest('#games')) return;
        const text = node.dataset.search || '';
        node.hidden = !!query && !text.includes(query);
      });
    }
    search.addEventListener('input', apply);
    document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; apply(); }));
    showAll.addEventListener('click', () => {
      allChecks.hidden = !allChecks.hidden;
      showAll.textContent = allChecks.hidden ? 'Show all checks' : 'Hide passed and manual checks';
    });
    document.querySelectorAll('#games thead th').forEach((header) => header.addEventListener('click', () => {
      const table = document.querySelector('#games tbody');
      const index = [...header.parentElement.children].indexOf(header);
      const numeric = header.dataset.sort === 'number';
      const rows = [...table.querySelectorAll('tr')];
      const direction = header.dataset.direction === 'asc' ? 'desc' : 'asc';
      header.dataset.direction = direction;
      rows.sort((left, right) => {
        const a = left.children[index].innerText.trim();
        const b = right.children[index].innerText.trim();
        const result = numeric ? (parseFloat(a) || 0) - (parseFloat(b) || 0) : a.localeCompare(b);
        return direction === 'asc' ? result : -result;
      });
      rows.forEach((row) => table.appendChild(row));
    }));
    document.body.addEventListener('click', (event) => {
      const opener = event.target.closest('[data-open]');
      if (!opener) return;
      const id = opener.dataset.open;
      const target = document.getElementById(id);
      if (!target) return;
      if (id.startsWith('spin-')) {
        const game = target.closest('.detail');
        document.querySelectorAll('.detail').forEach((detail) => { detail.hidden = !game || detail.id !== game.id; });
        const open = target.hidden;
        document.querySelectorAll('.spin').forEach((spin) => { spin.hidden = true; });
        target.hidden = !open;
      } else if (id.startsWith('game-')) {
        document.querySelectorAll('.detail').forEach((detail) => { detail.hidden = detail.id !== id; });
        document.querySelectorAll('.spin').forEach((spin) => { spin.hidden = true; });
        target.hidden = false;
      }
      if (!target.hidden) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  </script>
</body>
</html>`;
}

function errorCard(gameName: string, error: { type: string; message: string; url?: string; timestamp: string; spinNumber?: number }): string {
  return `<article data-searchable data-search="${esc(`${gameName} ${error.type} ${error.message} ${error.url ?? ""}`.toLowerCase())}">
    <h3>${esc(error.type)} · ${esc(gameName)}</h3>
    <p>Spin: ${error.spinNumber ?? "n/a"} · ${esc(error.timestamp)}</p>
    <p>${esc(error.message)}</p>
    ${error.url ? `<p>${esc(error.url)}</p>` : ""}
  </article>`;
}

function card(label: string, value: number): string {
  return `<div class="card"><span class="muted">${esc(label)}</span><strong>${value}</strong></div>`;
}
