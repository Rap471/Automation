// import fs from "node:fs";
// import path from "node:path";
// import { test, expect } from "@playwright/test";
// import { renderDashboard } from "../src/reporting/HtmlDashboard";
// import type { ReportModel } from "../src/types";

// test("dashboard shows the exact frontend and backend mismatch values", async () => {
//   const model: ReportModel = {
//     generatedAt: "2026-09-28T00:00:00.000Z",
//     playerId: "automation",
//     launcherUrl: "https://stg-asset-tools.dijoker.com/game-launcher",
//     config: { fixture: true },
//     discovered: [{ gameName: "Joker Ace", gameId: "fixture", index: 0, locatorDescription: "fixture" }],
//     attempted: 1,
//     completed: 1,
//     games: [
//       {
//         gameName: "Joker Ace",
//         gameId: "fixture",
//         index: 0,
//         launch: "PASS",
//         result: "FAIL",
//         spinCount: 1,
//         winCount: 1,
//         feBeMismatches: 2,
//         notes: [],
//         critical: ["Joker Ace - Spin 14 - totalWin mismatch - FE 1200 vs BE 850"],
//         consoleErrors: [],
//         networkErrors: [],
//         checks: [
//           { id: "total-win-sync", name: "Total win synchronization", status: "FAIL", details: "Spin 14: FE 1200 vs BE 850", spinNumber: 14, gameName: "Joker Ace" },
//           { id: "balance-sync", name: "Balance synchronization", status: "FAIL", details: "Spin 14: FE 9500 vs BE 9650", spinNumber: 14, gameName: "Joker Ace" },
//         ],
//         spins: [
//           {
//             gameName: "Joker Ace",
//             spinNumber: 14,
//             trigger: "Spin button",
//             sampled: true,
//             correlation: "FAIL",
//             passed: false,
//             sawSpinning: true,
//             returnedToIdle: true,
//             duplicateRequests: 0,
//             notes: [],
//             win: true,
//             frontend: { bet: 10, balance: 9500, totalWin: 1200, feature: "base" },
//             backend: { bet: 10, balance: 9650, totalWin: 850, feature: "base" },
//             comparisons: [
//               { field: "bet", frontend: 10, backend: 10, result: "MATCH", difference: "0" },
//               { field: "balance", frontend: 9500, backend: 9650, result: "MISMATCH", difference: "-150" },
//               { field: "totalWin", frontend: 1200, backend: 850, result: "MISMATCH", difference: "+350" },
//             ],
//             mismatches: [
//               { field: "balance", frontend: 9500, backend: 9650, difference: "-150" },
//               { field: "totalWin", frontend: 1200, backend: 850, difference: "+350" },
//             ],
//             network: {
//               spinId: "fixture-14",
//               gameName: "Joker Ace",
//               timestamp: "2026-09-28T00:00:00.000Z",
//               requestPayload: { bet: 10 },
//               responseBody: { balance: 9650, totalWin: 850 },
//               status: 201,
//               betSize: 10,
//               balanceAfter: 9650,
//               totalWin: 850,
//             },
//           },
//         ],
//       },
//     ],
//   };

//   const html = renderDashboard(model);
//   expect(html).toContain("9500");
//   expect(html).toContain("9650");
//   expect(html).toContain("1200");
//   expect(html).toContain("850");
//   expect(html).toContain("MISMATCH");
//   expect(html).toContain("Joker Ace - Spin 14 - totalWin mismatch");
//   const preview = path.join(process.cwd(), "test-results", "failure-path-preview.html");
//   fs.mkdirSync(path.dirname(preview), { recursive: true });
//   fs.writeFileSync(preview, html);
// });
