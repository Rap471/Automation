import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ScratchCheck {
  name: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "NOT APPLICABLE";
  details: string;
  screenshot?: string;
}

const ORDER = [
  "Button is existing and clickable",
  "Scratch Card Panel",
  "Bet + increases correctly",
  "Bet – decreases correctly",
  "Bet locked during scratching",
  "Size locked during scratching",
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
  "Can scratch manually",
  "Scratch all button",
  "Buy Card returns after scratch all",
  "Win can only have three or more symbols",
  "Total win prompts",
];

function failedFirst(checks: ScratchCheck[]): ScratchCheck[] {
  const rank: Record<string, number> = { FAIL: 0, BLOCKED: 1, "NOT APPLICABLE": 2, PASS: 3 };
  return orderChecks(checks).sort((left, right) => (rank[left.status] ?? 9) - (rank[right.status] ?? 9));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface ScratchGameReport {
  gameName: string;
  checks: ScratchCheck[];
}

export function writeScratchReport(checks: ScratchCheck[], gameName: string, order = 0, root = path.join(process.cwd(), "test-results")): string {
  const dir = path.join(root, "scratch-partials");
  fs.mkdirSync(dir, { recursive: true });
  const slug = gameName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "game";
  fs.writeFileSync(path.join(dir, `${String(order).padStart(2, "0")}-${slug}.json`), JSON.stringify({ gameName, checks }, null, 2));
  return publishScratchReport(root);
}

export function publishScratchReport(root = path.join(process.cwd(), "test-results")): string {
  const dir = path.join(root, "scratch-partials");
  const games = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().flatMap((name) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ScratchGameReport;
        return parsed && typeof parsed.gameName === "string" && Array.isArray(parsed.checks) ? [parsed] : [];
      } catch {
        return [];
      }
    })
    : [];
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "scratch-report.json"), JSON.stringify(games, null, 2));
  const review = games.map((game) => {
    const ordered = failedFirst(game.checks);
    const lines = ordered.map((check, index) => `${index + 1}. ${check.status}  ${check.name}\n${check.details}`);
    return `${game.gameName}\n${lines.join("\n\n")}`;
  }).join("\n\n");
  fs.writeFileSync(path.join(root, "scratch-review.txt"), `${review}\n`);
  const sections = games.map((game) => {
    const ordered = failedFirst(game.checks);
    const count = (status: ScratchCheck["status"]) => ordered.filter((check) => check.status === status).length;
    const rows = ordered.map((check, index) => `<tr>
    <td>${index + 1}</td>
    <td>${escapeHtml(check.name)}</td>
    <td><span class="pill ${check.status.toLowerCase().replace(/\s/g, "-")}">${escapeHtml(check.status)}</span></td>
    <td>${escapeHtml(check.details)}${check.screenshot ? `<img src="${escapeHtml(check.screenshot)}" alt="Screenshot of ${escapeHtml(check.name)}" />` : ""}</td>
  </tr>`).join("");
    return `<section>
    <h2>${escapeHtml(game.gameName)}</h2>
    <section class="cards">
      <div class="card"><span class="muted">Cases</span><strong>${ordered.length}</strong></div>
      <div class="card"><span class="muted">Passed</span><strong>${count("PASS")}</strong></div>
      <div class="card"><span class="muted">Failed</span><strong>${count("FAIL")}</strong></div>
      <div class="card"><span class="muted">Blocked</span><strong>${count("BLOCKED")}</strong></div>
      <div class="card"><span class="muted">Not applicable</span><strong>${count("NOT APPLICABLE")}</strong></div>
    </section>
    <table>
      <thead><tr><th>#</th><th>Case</th><th>Status</th><th>What was checked</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
  }).join("");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="2" />
  <title>Scratch results</title>
  <style>
    :root { color-scheme: dark; --bg:#10141c; --card:#1b2330; --text:#e7eef8; --muted:#93a1b5; --line:#2d3a4d; }
    body { margin:0; font:15px/1.45 Segoe UI, sans-serif; background:var(--bg); color:var(--text); }
    main { padding:24px; max-width:1100px; }
    h1, h2 { margin:0 0 8px; }
    section + section { margin-top:28px; }
    .muted { color:var(--muted); }
    .cards { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin:16px 0; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; }
    .card strong { display:block; font-size:28px; }
    table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:var(--muted); font-weight:600; }
    .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:700; }
    .pass { background:#1f8f4e; }
    .fail { background:#c43838; }
    .blocked { background:#b8860b; }
    .not-applicable { background:#66788d; }
    img { display:block; max-width:520px; margin-top:8px; border-radius:8px; border:1px solid var(--line); }
  </style>
</head>
<body>
  <main>
    <h1>Scratch results</h1>
    <p class="muted">${games.length} game${games.length === 1 ? "" : "s"} · each finished check is saved here, not only in the terminal · ${new Date().toLocaleString()}</p>
    <table>
      <thead><tr><th>Game</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Not applicable</th></tr></thead>
      <tbody>${games.map((game) => {
        const ordered = orderChecks(game.checks);
        const count = (status: ScratchCheck["status"]) => ordered.filter((check) => check.status === status).length;
        return `<tr><td>${escapeHtml(game.gameName)}</td><td>${count("PASS")}</td><td>${count("FAIL")}</td><td>${count("BLOCKED")}</td><td>${count("NOT APPLICABLE")}</td></tr>`;
      }).join("")}</tbody>
    </table>
    ${sections}
  </main>
</body>
</html>`;
  const file = path.join(root, "scratch-report.html");
  writeFileAtomic(file, html);
  writeFileAtomic(path.join(root, "scratch-live.html"), liveShell());
  return file;
}

function writeFileAtomic(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents);
  try {
    fs.copyFileSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function liveShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Scratch results</title>
  <style>
    html, body { margin: 0; height: 100%; background: #10141c; }
    iframe { border: 0; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <iframe id="view" title="Scratch results" src="scratch-report.html"></iframe>
  <script>
    setInterval(() => {
      document.getElementById("view").src = "scratch-report.html?t=" + Date.now();
    }, 2000);
  </script>
</body>
</html>`;
}

function orderChecks(checks: ScratchCheck[]): ScratchCheck[] {
  return [...checks].sort((left, right) => ORDER.indexOf(left.name) - ORDER.indexOf(right.name));
}

export function openScratchReport(file: string): void {
  const live = path.join(path.dirname(file), "scratch-live.html");
  if (fs.existsSync(live)) file = live;
  if (!fs.existsSync(file)) return;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", file], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [file], { detached: true, stdio: "ignore" }).unref();
}
