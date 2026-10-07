import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BalanceBoard } from "./board";
import { balanceGame, balancePlayer } from "./model";
import { startAndOpenLive } from "../live/openLive";

function stopLiveServer(): void {
  if (process.platform !== "win32") return;
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const pids = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      if (!/:4317\s/.test(line) || !/LISTENING/i.test(line)) continue;
      const pid = line.trim().split(/\s+/).at(-1);
      if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    for (const pid of pids) execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
  } catch {
    // The live page is not running yet.
  }
}

export default async function globalSetup(): Promise<void> {
  fs.rmSync(path.join(process.cwd(), "test-results", "balance-games.json"), { force: true });
  const board = new BalanceBoard(balanceGame, balancePlayer);
  board.publish();
  if (process.env.QA_LIVE_KEEP === "1") return;
  stopLiveServer();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await startAndOpenLive("/");
}
