import type { Frame, Page } from "@playwright/test";
import { regressionConfig } from "../config/regression.config";
import type { GameInfo } from "../types";

const PLAYER_INPUT = "xpath=//input[@placeholder='e.g. player-123']";
const GAME_GRID = "xpath=//div[contains(@class,'grid grid-cols-2')]";

export class GameLauncherPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto(regressionConfig.launcherUrl, { waitUntil: "domcontentloaded" });
    const input = this.page.locator(PLAYER_INPUT);
    const ready = await input.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
    if (!ready) {
      await this.page.getByRole("button", { name: "Change user" }).click();
      await input.waitFor({ state: "visible" });
    }
  }

  async setPlayer(playerId = regressionConfig.playerId): Promise<void> {
    const input = this.page.locator(PLAYER_INPUT);
    const alreadyOpen = await input.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
    if (!alreadyOpen) {
      await this.page.getByRole("button", { name: "Change user" }).click();
      await input.waitFor({ state: "visible" });
    }
    await input.fill("");
    await input.fill(playerId);
    await this.page.getByRole("button", { name: "Continue" }).click();
    await input.waitFor({ state: "hidden" });
    await this.waitForGrid();
  }

  async waitForGrid(): Promise<void> {
    await this.page.waitForFunction(() => {
      const grids = [...document.querySelectorAll("div")].filter((node) => String(node.className).includes("grid grid-cols-2"));
      return grids.some((grid) => grid.querySelector('button[aria-label="Play in modal"]'));
    });
  }

  async discoverGames(): Promise<GameInfo[]> {
    await this.waitForGrid();
    const games = await this.page.evaluate(() => {
      const grids = [...document.querySelectorAll("div")].filter((node) => String(node.className).includes("grid grid-cols-2"));
      const grid = grids.find((node) => node.querySelector('button[aria-label="Play in modal"]'));
      if (!grid) return [];
      return [...grid.children].map((card, index) => {
        const image = card.querySelector("img");
        const text = ((card as HTMLElement).innerText || card.textContent || "").replace(/\s+/g, " ").trim();
        const gameId = text.match(/\b\d{6,}\b/)?.[0] || `index-${index + 1}`;
        const alt = (image?.getAttribute("alt") || "").trim();
        const gameName = alt && alt !== "?" ? alt : text.replace(gameId, "").replace(/[?]/g, " ").replace(/\s+/g, " ").trim() || `Game ${index + 1}`;
        return { gameName, gameId, index };
      });
    });

    const seen = new Set<string>();
    const unique: GameInfo[] = [];
    for (const game of games) {
      const key = `${game.gameId}::${game.gameName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        ...game,
        locatorDescription: `${GAME_GRID} card ${game.gameId}`,
      });
    }
    return unique;
  }

  card(game: GameInfo) {
    return this.page.locator("div.group").filter({ hasText: game.gameId }).first();
  }

  async openGame(game: GameInfo): Promise<void> {
    const card = this.card(game);
    await card.scrollIntoViewIfNeeded();
    const play = card.locator('button[aria-label="Play in modal"]');
    const iframe = this.page.locator('iframe[title="Game session"]');
    await play.click({ force: true });
    const opened = await iframe.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false);
    if (!opened) {
      await play.click({ force: true });
      await iframe.waitFor({ state: "visible" });
    }
  }

  async closeGame(): Promise<void> {
    const iframe = this.page.locator('iframe[title="Game session"]');
    const sessionOpen = await iframe.isVisible().catch(() => false);
    const button = this.page.locator("xpath=//button[@title='Close']").filter({ visible: true }).first();
    const ready = await button.waitFor({ state: "visible", timeout: sessionOpen ? 15_000 : 3_000 }).then(() => true).catch(() => false);
    if (!ready) return;
    await button.click();
    await iframe.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
    await button.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  }

  async historyText(): Promise<string> {
    const panel = this.page.getByText("Live history").locator("xpath=ancestor::*[contains(@class,'rounded') or self::div][1]");
    if (await this.page.getByText("Live history").count()) {
      return this.page.locator("body").innerText().then((text) => {
        const index = text.indexOf("Live history");
        return index >= 0 ? text.slice(index, index + 500) : "";
      }).catch(() => "");
    }
    return panel.innerText().catch(() => "");
  }

  frame(): Frame {
    const frame = this.page.frames().find((item) => /stg-games\.dijoker\.com/.test(item.url()));
    if (!frame) throw new Error("Game iframe was not found");
    return frame;
  }
}
