import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { sanitizeFileName, spinFolder } from "../utils/sanitize";

export class EvidenceCollector {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  async capture(page: Page, gameName: string, spinNumber: number, label: string, payload?: unknown): Promise<string | undefined> {
    const folder = this.gameDir("screenshots", gameName, spinNumber);
    const base = `${label}.png`;
    const target = path.join(folder, base);
    const frame = page.locator('iframe[title="Game session"]');
    try {
      if (await frame.count()) await frame.first().screenshot({ path: target });
      else await page.screenshot({ path: target, fullPage: true });
      if (label === "failure") {
        await page.screenshot({ path: path.join(folder, "full-page.png"), fullPage: true }).catch(() => undefined);
      }
    } catch {
      return undefined;
    }
    if (payload !== undefined) {
      this.writeJson(gameName, spinNumber, label, payload);
    }
    return path.relative(this.root, target).replace(/\\/g, "/");
  }

  writeJson(gameName: string, spinNumber: number, label: string, payload: unknown): string {
    const folder = this.gameDir("network", gameName, spinNumber);
    const target = path.join(folder, `${label}.json`);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2));
    return path.relative(this.root, target).replace(/\\/g, "/");
  }

  writeFailure(gameName: string, spinNumber: number, label: string, payload: unknown): string {
    const folder = this.gameDir("failures", gameName, spinNumber);
    const target = path.join(folder, `${label}.json`);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2));
    return path.relative(this.root, target).replace(/\\/g, "/");
  }

  private gameDir(kind: string, gameName: string, spinNumber: number): string {
    const folder = path.join(this.root, kind, sanitizeFileName(gameName), spinFolder(spinNumber));
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  }
}
