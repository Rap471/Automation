import type { Page } from "@playwright/test";
import type { CapturedError } from "../types";

export class ConsoleMonitor {
  private errors: CapturedError[] = [];
  private networkErrors: CapturedError[] = [];
  private gameName = "launcher";
  private spinNumber: number | undefined;
  private attached = false;

  constructor(private readonly page: Page) {}

  setContext(gameName: string, spinNumber?: number): void {
    this.gameName = gameName;
    this.spinNumber = spinNumber;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.page.on("console", (message) => {
      if (message.type() !== "error") return;
      this.errors.push(this.entry("Console Error", message.text(), message.location().url));
    });
    this.page.on("pageerror", (error) => {
      this.errors.push(this.entry("Page Error", error.message));
    });
    this.page.on("requestfailed", (request) => {
      const failure = request.failure();
      if (["image", "font", "media", "stylesheet"].includes(request.resourceType())) return;
      if (failure?.errorText === "net::ERR_ABORTED") return;
      this.networkErrors.push(this.entry("Failed Request", failure?.errorText || "request failed", request.url()));
    });
  }

  forGame(gameName: string): { consoleErrors: CapturedError[]; networkErrors: CapturedError[] } {
    return {
      consoleErrors: this.errors.filter((error) => error.gameName === gameName),
      networkErrors: this.networkErrors.filter((error) => error.gameName === gameName),
    };
  }

  private entry(type: string, message: string, url?: string): CapturedError {
    return {
      gameName: this.gameName,
      timestamp: new Date().toISOString(),
      type,
      message,
      url,
      spinNumber: this.spinNumber,
    };
  }
}
