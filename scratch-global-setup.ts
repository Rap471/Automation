import fs from "node:fs";
import path from "node:path";
import { startAndOpenLive } from "./src/live/openLive";
import { publishScratchReport } from "./src/scratch/scratchReport";

export default async function globalSetup(): Promise<void> {
  fs.rmSync(path.join(process.cwd(), "test-results", "scratch-partials"), { recursive: true, force: true });
  publishScratchReport();
  await startAndOpenLive();
}
