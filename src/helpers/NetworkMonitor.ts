import type { Page, Request, Response } from "@playwright/test";
import { regressionConfig } from "../config/regression.config";
import { extractBetSize, parseRequestPayload } from "./BetPayloadParser";
import { parseSpinResponse } from "./SpinResultParser";
import type { SpinNetworkData } from "../types";

interface Waiter {
  count: number;
  resolve: (record: SpinNetworkData) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface UnresolvedComplete {
  id: string;
  status: number;
  responseBody: unknown;
  balance?: number;
}

export class NetworkMonitor {
  private records: SpinNetworkData[] = [];
  private completes: UnresolvedComplete[] = [];
  private waiters: Waiter[] = [];
  private gameName = "unknown";
  private attached = false;
  private pending = 0;

  constructor(private readonly page: Page) {}

  setGame(gameName: string): void {
    this.gameName = gameName;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.page.on("request", (request) => {
      if (this.isTracked(request)) this.pending += 1;
    });
    this.page.on("requestfailed", (request) => {
      if (this.isTracked(request)) this.pending = Math.max(0, this.pending - 1);
    });
    this.page.on("response", (response) => {
      if (this.isTracked(response.request())) this.pending = Math.max(0, this.pending - 1);
      void this.capture(response);
    });
  }

  inflight(): number {
    return this.pending;
  }

  private isBet(request: Request): boolean {
    return request.method() !== "OPTIONS" && request.url().includes(regressionConfig.betEndpoint);
  }

  private unresolvedId(url: string): string | undefined {
    const match = url.match(/\/api\/v1\/unresolved-spin\/([^/?#]+)\/complete(?:[?#]|$)/i);
    return match?.[1];
  }

  private isTracked(request: Request): boolean {
    return request.method() !== "OPTIONS" && (request.url().includes(regressionConfig.betEndpoint) || this.unresolvedId(request.url()) != null);
  }

  unresolvedComplete(id: string): UnresolvedComplete | undefined {
    return this.completes.find((item) => item.id === id);
  }

  count(): number {
    return this.records.length;
  }

  all(): SpinNetworkData[] {
    return [...this.records];
  }

  latest(n = 1): SpinNetworkData[] {
    return this.records.slice(-n);
  }

  async waitForCount(count: number, timeoutMs: number): Promise<SpinNetworkData> {
    if (this.records.length >= count) return this.records[count - 1];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for /slots/bet response #${count}`));
      }, timeoutMs);
      this.waiters.push({ count, resolve, reject, timer });
    });
  }

  private async capture(response: Response): Promise<void> {
    const unresolved = this.unresolvedId(response.url());
    if (unresolved && response.request().method() !== "OPTIONS") {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text().catch(() => null);
      }
      const parsed = parseSpinResponse(responseBody);
      this.completes.push({ id: unresolved, status: response.status(), responseBody, balance: parsed.balance });
      console.log(`Unresolved spin ${unresolved} complete HTTP ${response.status()} balance ${parsed.balance ?? "n/a"}`);
    }
    if (!response.url().includes(regressionConfig.betEndpoint)) return;
    if (response.request().method() === "OPTIONS") return;
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = await response.text().catch(() => null);
    }
    const requestPayload = parseRequestPayload(response.request().postData());
    const parsed = parseSpinResponse(responseBody);
    const record: SpinNetworkData = {
      spinId: `${this.gameName}-${this.records.length + 1}-${Date.now()}`,
      gameName: this.gameName,
      timestamp: new Date().toISOString(),
      requestPayload,
      responseBody,
      status: response.status(),
      betSize: extractBetSize(requestPayload),
      balanceAfter: parsed.balance,
      totalWin: parsed.totalWin,
      spinData: parsed,
    };
    this.records.push(record);
    for (const waiter of [...this.waiters]) {
      if (this.records.length >= waiter.count) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.records[waiter.count - 1]);
        this.waiters = this.waiters.filter((item) => item !== waiter);
      }
    }
  }
}
