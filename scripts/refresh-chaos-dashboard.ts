import fs from "node:fs";
import path from "node:path";
import { chaosDashboardModel, type ChaosDashboardCase } from "../src/reporting/chaosDashboard";
import { renderDashboard } from "../src/reporting/HtmlDashboard";
import { writeReview } from "../src/reporting/writeReview";

const source = path.join(process.cwd(), "test-results", "chaos", "chaos-report.json");
const raw = JSON.parse(fs.readFileSync(source, "utf8")) as { cases: ChaosDashboardCase[] };
const model = chaosDashboardModel(raw.cases);
const root = path.join(process.cwd(), "test-results");
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "index.html"), renderDashboard(model));
writeReview(model, root);
console.log(`Wrote ${path.join(root, "index.html")} for ${model.games.length} games.`);
