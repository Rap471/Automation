import fs from "node:fs";
import path from "node:path";

export type QaStatus = "PASS" | "FAIL" | "BLOCKED" | "RUNNING" | "WARN" | "NOT APPLICABLE";

export interface QaEvent {
  id: string;
  t: string;
  type: "GAME_STARTED" | "CHECK" | "SPIN_RESULT" | "MISMATCH" | "SCREENSHOT" | "GAME_COMPLETED" | "ERROR_DETECTED";
  game: string;
  worker?: number;
  status?: QaStatus;
  message: string;
  spin?: number;
  bet?: number | null;
  win?: number | null;
  uiBalance?: number | null;
  beBalance?: number | null;
  popup?: string;
  screenshot?: string;
  details?: string;
  http?: number;
  transaction?: string;
}

const file = path.join(process.cwd(), "test-results", "live", "events.jsonl");

export function qaEmit(event: Omit<QaEvent, "id" | "t">): void {
  try {
    const full: QaEvent = {
      ...event,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      t: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`);
  } catch {
    // The live page is optional. A reporting failure must not fail the game.
  }
}
