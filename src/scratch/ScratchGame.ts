import type { Frame } from "@playwright/test";

export interface ScratchView {
  buttonExists: boolean;
  buttonEnabled: boolean;
  buttonLabel: string;
  hostVisible: boolean;
  panelVisible: boolean;
  title: string;
  actionLabel: string;
  actionDisabled: boolean;
  selected: number | null;
  dims: string[];
  highlighted: string;
  legend: string[];
  bet: number | null;
  betText: string;
  minIndex: number | null;
  levels: number[];
  busy: boolean;
  settled: boolean;
  scratching: boolean;
  hasRound: boolean;
  revealed: number;
  cellCount: number;
  allRevealed: boolean;
  youWon: string;
  youWonVisible: boolean;
  amountText: string;
  amountVisible: boolean;
  winIndexes: number[];
  symbols: string[];
  matchCount: number;
  cellDump: string;
  totalWin: number | null;
  networkNote: string;
  lastClick: "pointer" | "fallback" | "none";
}

interface ScratchAction {
  op: "snapshot" | "open" | "show" | "size" | "step" | "poke" | "buy-prepare" | "buy-finish" | "collect" | "reveal";
  label?: string;
  delta?: number;
  pointer?: boolean;
}

interface ClickTarget {
  kind: "dom" | "canvas" | "none";
  x?: number;
  y?: number;
  debug: string;
}

export class ScratchGame {
  constructor(private readonly frame: Frame) {}

  snapshot(): Promise<ScratchView> {
    return this.act({ op: "snapshot" });
  }

  open(): Promise<ScratchView> {
    return this.act({ op: "open" });
  }

  show(): Promise<ScratchView> {
    return this.act({ op: "show" });
  }

  async pressSize(label: string): Promise<ScratchView> {
    const hit = await this.tapLabel(label);
    const view = await this.snapshot();
    view.lastClick = hit.ok ? "pointer" : "none";
    view.networkNote = hit.debug;
    return view;
  }

  async size(label: string): Promise<ScratchView> {
    await this.clickScratchAllIfShown();
    let hit = { ok: false, debug: `No ${label} click` };
    let view = await this.snapshot();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.act({ op: "collect" });
      hit = await this.tapLabel(label);
      view = await this.act({ op: "size", label, pointer: hit.ok });
      view.networkNote = hit.debug;
      if (view.lastClick === "pointer") return view;
    }
    return view;
  }

  async step(delta: number, options?: { keepCard?: boolean }): Promise<ScratchView> {
    if (!options?.keepCard) await this.clickScratchAllIfShown();
    return this.act({ op: "step", delta });
  }

  poke(): Promise<ScratchView> {
    return this.act({ op: "poke" });
  }

  clickBuy(): Promise<{ ok: boolean; debug: string }> {
    return this.tapLabel("buy");
  }

  async buy(): Promise<ScratchView> {
    await this.clickScratchAllIfShown();
    await this.act({ op: "buy-prepare" });
    let hit = { ok: false, debug: "Buy button was not clicked" };
    try {
      hit = await this.tapLabel("buy");
      if (hit.ok) await this.frame.waitForTimeout(700);
    } finally {
      const view = await this.act({ op: "buy-finish", pointer: hit.ok });
      view.networkNote = `${hit.debug} ${view.networkNote}`.trim();
      return view;
    }
  }

  reveal(): Promise<ScratchView> {
    return this.act({ op: "reveal" });
  }

  async clickScratchAllIfShown(): Promise<ScratchView> {
    if (!(await this.scratchAllVisible())) return this.snapshot();
    console.log("SCRATCH ALL button is visible. Clicking it before bet, size, or buy.");
    let hit = await this.tapLabel("scratch all");
    let view = await this.snapshot();
    if (await this.scratchAllVisible()) {
      hit = await this.tapLabel("scratch all");
      view = await this.reveal();
    }
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      view = await this.snapshot();
      if (!(await this.scratchAllVisible()) && (view.settled || /buy\s*card/i.test(view.actionLabel))) {
        console.log(`SCRATCH ALL finished. Button is now "${view.actionLabel || "hidden"}".`);
        return view;
      }
      await this.frame.waitForTimeout(300);
    }
    view.networkNote = `${hit.debug} The green SCRATCH ALL button stayed visible.`.trim();
    console.log(view.networkNote);
    return view;
  }

  private scratchAllVisible(): Promise<boolean> {
    return this.frame.evaluate(() => {
      const textIsScratchAll = (value: string) => /^scratch\s*all$/i.test(value.replace(/\s+/g, " ").trim());
      const game = (window as any).phaserGame;
      const scene = (game?.scene?.scenes ?? []).find((item: any) => item?.slotController);
      const panel = scene?.scratchDesktopHost?.panel || scene?.scratchPanel;
      if (textIsScratchAll(String(panel?.newButtonLabel?.text || ""))) return true;
      return [...document.querySelectorAll("button, a, div, span")].some((el) => {
        const box = (el as HTMLElement).getBoundingClientRect();
        return textIsScratchAll(el.textContent || "") && box.width >= 48 && box.height >= 16 && box.width <= 520;
      });
    }).catch(() => false);
  }

  private async tapLabel(label: string): Promise<{ ok: boolean; debug: string }> {
    const target = await this.frame.evaluate((wanted): ClickTarget => {
      const game = (window as any).phaserGame;
      const scene = (game?.scene?.scenes ?? []).find((item: any) => item?.slotController);
      const host = scene?.scratchDesktopHost;
      const panel = host?.panel || scene?.scratchPanel;
      const wantedNorm = String(wanted).replace(/×/g, "x").replace(/\s/g, "").toLowerCase();
      const textsOf = (node: any): string[] => {
        const rows: string[] = [];
        const visit = (current: any) => {
          if (!current || rows.length > 12) return;
          if (typeof current.text === "string" && current.text.trim()) rows.push(current.text.trim());
          const list = current.list || current.children?.list;
          if (!list) return;
          for (const child of list) visit(child);
        };
        visit(node);
        return rows;
      };
      const roots = wantedNorm === "scratchall"
        ? [document.body]
        : [host?.hostEl, host?.clipEl].filter((el: any) => el?.querySelectorAll);
      for (const root of roots) {
        root.querySelectorAll("[data-qa-click]").forEach((el: Element) => el.removeAttribute("data-qa-click"));
        const matches = [...root.querySelectorAll("*")].filter((el: Element) => {
          const text = (el.textContent || "").replace(/×/g, "x").replace(/\s/g, "").toLowerCase();
          if (wantedNorm === "scratchall") return text === "scratchall";
          return text === wantedNorm || (wantedNorm === "buy" && /^(buycard|scratchall)$/.test(text));
        });
        const sized = matches.filter((el: Element) => {
          const box = el.getBoundingClientRect();
          return box.width >= 48 && box.height >= 16 && box.width <= 520;
        });
        const pool = sized.length ? sized : matches;
        const el = pool.sort((left: Element, right: Element) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0];
        const box = el?.getBoundingClientRect();
        if (el && box && box.width > 8 && box.height > 8) {
          el.setAttribute("data-qa-click", "1");
          return { kind: "dom", debug: `dom ${el.tagName} ${Math.round(box.width)}x${Math.round(box.height)}` };
        }
      }
      document.querySelectorAll("[data-qa-canvas]").forEach((el) => el.removeAttribute("data-qa-canvas"));
      const button = wantedNorm === "buy" || wantedNorm === "scratchall"
        ? panel?.newButtonImage || panel?.newButtonLabel
        : (panel?.dimButtons || []).find((item: any) => textsOf(item).join(" ").replace(/×/g, "x").replace(/\s/g, "").toLowerCase().includes(wantedNorm));
      const bounds = button?.getBounds?.();
      const sceneOf = button?.scene || panel?.scene;
      const canvas = sceneOf?.sys?.game?.canvas as HTMLCanvasElement | undefined;
      const cam = sceneOf?.cameras?.main;
      const rect = canvas?.getBoundingClientRect();
      if (!bounds || !canvas || !rect || rect.width < 2 || rect.height < 2 || bounds.width < 2) {
        return { kind: "none", debug: `No clickable ${wantedNorm} button. Bounds ${bounds ? Math.round(bounds.width) : 0}x${bounds ? Math.round(bounds.height) : 0}.` };
      }
      const zoom = cam?.zoom || 1;
      const originX = cam?.worldView?.x ?? cam?.scrollX ?? 0;
      const originY = cam?.worldView?.y ?? cam?.scrollY ?? 0;
      const screenX = (bounds.centerX - originX) * zoom;
      const screenY = (bounds.centerY - originY) * zoom;
      const x = Math.min(Math.max(screenX * (rect.width / (cam?.width || rect.width)), 2), rect.width - 2);
      const y = Math.min(Math.max(screenY * (rect.height / (cam?.height || rect.height)), 2), rect.height - 2);
      canvas.setAttribute("data-qa-canvas", "target");
      return {
        kind: "canvas",
        x,
        y,
        debug: `canvas ${Math.round(rect.width)}x${Math.round(rect.height)} click ${Math.round(x)},${Math.round(y)} world ${Math.round(bounds.centerX)},${Math.round(bounds.centerY)}`,
      };
    }, label);
    if (!target || target.kind === "none" || (target.kind === "canvas" && (target.x == null || target.y == null))) {
      return { ok: false, debug: target?.debug || `No ${label} button` };
    }
    try {
      if (target.kind === "dom") {
        const handle = await this.frame.evaluateHandle(() => document.querySelector("[data-qa-click='1']"));
        const element = handle.asElement();
        if (!element) {
          await handle.dispose();
          return { ok: false, debug: target.debug };
        }
        await element.click({ force: true, timeout: 5_000 });
        await handle.dispose();
        return { ok: true, debug: target.debug };
      }
      await this.frame.locator("canvas[data-qa-canvas='target']").click({
        position: { x: target.x, y: target.y },
        force: true,
        timeout: 5_000,
      });
      return { ok: true, debug: target.debug };
    } catch (error) {
      return { ok: false, debug: `${target.debug} ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private act(action: ScratchAction): Promise<ScratchView> {
    return this.frame.evaluate(async (request) => {
      const game = (window as any).phaserGame;
      const scene = (game?.scene?.scenes ?? []).find((item: any) => item?.slotController);
      const slot = scene?.slotController;
      const host = scene?.scratchDesktopHost;
      const panel = host?.panel || scene?.scratchPanel;

      const textsOf = (node: any): string[] => {
        const rows: string[] = [];
        const visit = (current: any) => {
          if (!current || rows.length > 12) return;
          if (typeof current.text === "string" && current.text.trim()) rows.push(current.text.trim());
          const list = current.list || current.children?.list;
          if (!list) return;
          for (const child of list) visit(child);
        };
        visit(node);
        return rows;
      };

      const view = (): ScratchView => {
        const round = panel?.lastSnap?.round;
        const card = round?.scratchCard || round?.card || round?.result;
        const cells = Array.isArray(card?.cells) ? card.cells : [];
        const collectionCount = (raw: unknown): number | undefined => {
          if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 64) return Math.round(raw);
          if (typeof Set !== "undefined" && raw instanceof Set) return raw.size <= 64 ? raw.size : undefined;
          if (Array.isArray(raw)) {
            if (raw.length > 64) return undefined;
            if (raw.every((item) => typeof item === "boolean")) return raw.filter(Boolean).length;
            return raw.length;
          }
          if (raw && typeof raw === "object") {
            const values = Object.values(raw as Record<string, unknown>);
            if (!values.length || values.length > 64) return undefined;
            if (values.every((item) => typeof item === "boolean")) return values.filter(Boolean).length;
            return values.filter((item) => item !== false && item != null).length;
          }
          return undefined;
        };
        const cellRevealed = (cell: any): boolean => {
          if (!cell || typeof cell !== "object") return false;
          return cell.revealed === true || cell.scratched === true || cell.opened === true || cell.isRevealed === true;
        };
        const revealedCounts = [panel?.revealed, panel?.revealedCells, panel?.revealedIndexes, panel?.scratchedCells, panel?.scratchedIndexes]
          .map(collectionCount)
          .filter((item): item is number => item != null);
        const symbolId = (cell: any): string => {
          if (cell == null || typeof cell !== "object") return String(cell ?? "");
          for (const key of ["symbol", "symbolId", "icon", "id", "key", "name", "type"]) {
            const value = cell[key];
            if (typeof value === "string" || typeof value === "number") return String(value);
            if (value && typeof value === "object") {
              const inner = value.id ?? value.key ?? value.symbol ?? value.name;
              if (typeof inner === "string" || typeof inner === "number") return String(inner);
            }
          }
          return "";
        };
        const cellDump = cells.slice(0, 4).map((cell: any) => {
          if (cell == null || typeof cell !== "object") return String(cell ?? "");
          return Object.entries(cell)
            .filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value))
            .slice(0, 8)
            .map(([key, value]) => `${key}=${value}`)
            .join(" ");
        }).join(" || ");
        const symbols = cells.map(symbolId).filter((item: string) => item !== "");
        const counts = new Map<string, number>();
        for (const symbol of symbols) {
          if (/^(blank|empty|none|null|-|0)$/i.test(symbol.trim())) continue;
          counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
        }
        let matchCount = counts.size ? Math.max(...counts.values()) : 0;
        let winIndexes: number[] = [];
        try {
          const indexes = typeof panel?.getWinLineIndexes === "function" ? panel.getWinLineIndexes() : [];
          winIndexes = Array.isArray(indexes) ? indexes.map(Number) : [];
        } catch {
          winIndexes = [];
        }
        if (winIndexes.length > matchCount) matchCount = winIndexes.length;
        try {
          const matched = typeof panel?.getWinningMatchSymbol === "function" ? panel.getWinningMatchSymbol() : null;
          const matchedCount = Array.isArray(matched) ? matched.length : 0;
          if (matchedCount > matchCount) matchCount = matchedCount;
        } catch {
          /* A card with no settled match throws. The cell symbols are the count. */
        }
        const findWin = (obj: any, depth: number): number | null => {
          if (!obj || typeof obj !== "object" || depth > 4) return null;
          for (const [key, value] of Object.entries(obj)) {
            if (/totalWin|winAmount|payout/i.test(key) && typeof value === "number" && value > 0) return value;
            if (value && typeof value === "object") {
              const nested = findWin(value, depth + 1);
              if (nested != null) return nested;
            }
          }
          return null;
        };
        const amount = findWin(round, 0) ?? Number(round?.totalWin ?? card?.totalWin);
        const dims = Array.isArray(panel?.dimButtons) ? panel.dimButtons.map((button: any) => textsOf(button).join(" ")) : [];
        let highlighted = "";
        let bestAlpha = -1;
        if (Array.isArray(panel?.dimButtons)) {
          for (const button of panel.dimButtons) {
            const alpha = Number(button?.alpha ?? 0);
            if (alpha > bestAlpha) {
              bestAlpha = alpha;
              highlighted = textsOf(button).join(" ");
            }
          }
        }
        return {
          buttonExists: !!slot?.scratchCardButton,
          buttonEnabled: slot?.scratchCardButton?.input?.enabled !== false && !!slot?.scratchCardButton,
          buttonLabel: String(slot?.scratchCardLabel?.text || ""),
          hostVisible: !!host?.visible,
          panelVisible: typeof panel?.isVisible === "function" ? !!panel.isVisible() : !!panel?.visible,
          title: String(panel?.titleText?.text || ""),
          actionLabel: String(panel?.newButtonLabel?.text || ""),
          actionDisabled: !!panel?.newButtonImage?.__disabled,
          selected: panel?.selectedGridSize ?? null,
          dims,
          highlighted,
          legend: textsOf(panel?.legendContainer),
          bet: typeof panel?.getScratchBetAmount === "function" ? panel.getScratchBetAmount() : panel?.scratchBetAmount ?? null,
          betText: String(panel?.betDisplay?.text || ""),
          minIndex: typeof panel?.minBetIndexForSelectedGrid === "function" ? panel.minBetIndexForSelectedGrid() : null,
          levels: typeof panel?.getResolvedBetLevels === "function" ? panel.getResolvedBetLevels() : [],
          busy: !!panel?.busy,
          settled: !panel?.busy && !panel?.foilGenerating && !panel?.explodingReveal,
          scratching: !!panel?.scratching,
          hasRound: Array.isArray(card?.cells) && card.cells.length > 0,
          revealed: Math.max(cells.filter(cellRevealed).length, ...revealedCounts, 0),
          cellCount: cells.length,
          allRevealed: typeof panel?.areAllSymbolsRevealed === "function" ? !!panel.areAllSymbolsRevealed() : false,
          youWon: String(panel?.modalYouWonText?.text || ""),
          youWonVisible: !!panel?.modalYouWonText?.visible,
          amountText: String(panel?.modalAmountText?.text || ""),
          amountVisible: !!panel?.modalAmountText?.visible,
          winIndexes,
          symbols,
          matchCount,
          cellDump,
          totalWin: Number.isFinite(amount) ? amount : null,
          networkNote: "",
          lastClick: "none",
        };
      };

      if (!scene || request.op === "snapshot") return view();

      if (request.op === "open" || request.op === "show") {
        if (request.op === "open") {
          const listeners = slot?.scratchCardButton?.listeners?.("pointerdown") ?? [];
          if (typeof listeners[0] === "function") listeners[0]();
        }
        if (host?.show) await host.show();
        const deadline = Date.now() + 8_000;
        let current = view();
        while (!current.panelVisible && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          current = view();
        }
        return current;
      }

      if (!panel) return view();

      if (request.op === "collect") {
        const openCard = () => Array.isArray(panel.lastSnap?.round?.scratchCard?.cells) && panel.lastSnap.round.scratchCard.cells.length > 0;
        const deadline = Date.now() + 8_000;
        while ((openCard() || panel.busy || panel.foilGenerating || panel.explodingReveal) && Date.now() < deadline) {
          panel.clearScratchWinPresentation?.();
          if (typeof panel.autoCollect === "function") await panel.autoCollect();
          panel.setBusy?.(false);
          if (panel.newButtonImage) panel.newButtonImage.__disabled = false;
          if (!openCard() && !panel.busy) break;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return view();
      }

      if (request.op === "size") {
        const wanted = String(request.label || "").replace(/×/g, "x").toLowerCase();
        const size = wanted.startsWith("3") ? 0 : wanted.startsWith("4") ? 1 : 2;
        if (request.pointer) {
          const deadline = Date.now() + 1_200;
          while (panel.selectedGridSize !== size && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        if (panel.selectedGridSize === size) {
          const current = view();
          current.lastClick = request.pointer ? "pointer" : "none";
          return current;
        }
        if (typeof panel.setSelectedGridSize === "function") panel.setSelectedGridSize(size);
        const after = view();
        after.lastClick = "fallback";
        return after;
      }

      if (request.op === "step") {
        const button = (request.delta || 0) > 0 ? panel.betIncButton : panel.betDecButton;
        let fired = false;
        for (const type of ["pointerdown", "pointerup"]) {
          for (const fn of button?.listeners?.(type) || []) {
            if (typeof fn !== "function" || !/bet|step|adjust/i.test(String(fn))) continue;
            fn();
            fired = true;
          }
        }
        if (!fired && typeof panel.adjustScratchBetByStep === "function") panel.adjustScratchBetByStep(request.delta || 0);
        return view();
      }

      if (request.op === "poke") {
        const pointer = panel.scene?.input?.activePointer;
        const bounds = panel.gridContainer?.getBounds?.();
        const cardCells = panel?.lastSnap?.round?.scratchCard?.cells;
        const hasCard = Array.isArray(cardCells) && cardCells.length > 0;
        if (pointer && bounds) {
          const place = (x: number, y: number) => {
            pointer.x = x;
            pointer.y = y;
            pointer.worldX = x;
            pointer.worldY = y;
            if (pointer.position) {
              pointer.position.x = x;
              pointer.position.y = y;
            }
            if (pointer.worldPosition) {
              pointer.worldPosition.x = x;
              pointer.worldPosition.y = y;
            }
          };
          const scratch = () => {
            panel.scratchAtPointer?.(pointer);
            panel.scratchSandSimAtPointer?.(pointer);
            panel.pointerMoveHandler?.(pointer);
          };
          if (!hasCard) {
            const points = [
              [bounds.centerX, bounds.centerY],
              [bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.35],
              [bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.65],
            ];
            for (const [x, y] of points) {
              place(x, y);
              panel.pointerDownHandler?.(pointer);
              scratch();
            }
          } else {
            const columns = Math.round(Math.sqrt(cardCells.length)) || 3;
            const cellW = bounds.width / columns;
            const cellH = bounds.height / columns;
            const left = bounds.x + cellW * 0.2;
            const right = bounds.x + cellW * 0.8;
            const top = bounds.y + cellH * 0.2;
            const bottom = bounds.y + cellH * 0.8;
            pointer.isDown = true;
            place(left, (top + bottom) / 2);
            panel.pointerDownHandler?.(pointer);
            for (let row = 0; row <= 14; row += 1) {
              const y = top + ((bottom - top) * row) / 14;
              const fromX = row % 2 === 0 ? left : right;
              const toX = row % 2 === 0 ? right : left;
              for (let step = 0; step <= 18; step += 1) {
                place(fromX + ((toX - fromX) * step) / 18, y);
                scratch();
              }
            }
          }
        }
        return view();
      }

      const scratchWindow = window as Window & {
        __qaScratch?: {
          cap: Array<{ url: string; body: string | null }>;
          fetch: typeof fetch;
          open: typeof XMLHttpRequest.prototype.open;
          send: typeof XMLHttpRequest.prototype.send;
          client: { startRound?: (...args: unknown[]) => unknown };
          originalStart?: (...args: unknown[]) => unknown;
        };
      };

      if (request.op === "buy-prepare") {
        const hadCard = Array.isArray(panel.lastSnap?.round?.scratchCard?.cells) && panel.lastSnap.round.scratchCard.cells.length > 0;
        panel.clearScratchWinPresentation?.();
        if (hadCard && typeof panel.autoCollect === "function") await panel.autoCollect();
        panel.setBusy?.(false);
        if (panel.newButtonImage) panel.newButtonImage.__disabled = false;
        if (!scratchWindow.__qaScratch) {
          const cap: Array<{ url: string; body: string | null }> = [];
          const originalFetch = window.fetch.bind(window);
          const xhrOpen = XMLHttpRequest.prototype.open;
          const xhrSend = XMLHttpRequest.prototype.send;
          const client = panel.options?.client;
          const originalStart = client?.startRound?.bind(client);
          window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            cap.push({ url: String(input), body: init?.body == null ? null : String(init.body) });
            return originalFetch(input, init);
          };
          XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
            (this as XMLHttpRequest & { __scratchUrl?: string }).__scratchUrl = String(url);
            return xhrOpen.call(this, method, url, async ?? true, username, password);
          };
          XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
            const url = (this as XMLHttpRequest & { __scratchUrl?: string }).__scratchUrl || "";
            cap.push({ url, body: body == null ? null : String(body) });
            return xhrSend.call(this, body);
          };
          if (client && originalStart) {
            client.startRound = async (bet: unknown, size: unknown) => {
              cap.push({ url: "startRound", body: JSON.stringify({ bet, size }) });
              return originalStart(bet, size);
            };
          }
          scratchWindow.__qaScratch = { cap, fetch: originalFetch, open: xhrOpen, send: xhrSend, client, originalStart };
        }
        return view();
      }

      if (request.op === "buy-finish") {
        const state = scratchWindow.__qaScratch;
        const cap = state?.cap ?? [];
        const started = () => cap.some((item) => item.url === "startRound");
        if (request.pointer) {
          const deadline = Date.now() + 2_000;
          while (!started() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        let direct = false;
        if (!started()) {
          direct = true;
          if (typeof panel.onNewCard === "function") await panel.onNewCard();
          else await panel.onPrimaryAction?.();
        }
        if (state) {
          window.fetch = state.fetch;
          XMLHttpRequest.prototype.open = state.open;
          XMLHttpRequest.prototype.send = state.send;
          if (state.client && state.originalStart) state.client.startRound = state.originalStart;
          delete scratchWindow.__qaScratch;
        }
        const current = view();
        current.lastClick = request.pointer && !direct ? "pointer" : "fallback";
        current.networkNote = `click=${current.lastClick} busy=${panel?.busy} disabled=${panel?.newButtonImage?.__disabled} ${cap.filter((item) => item.url === "startRound").map((item) => `${item.url} ${item.body ?? ""}`).join(" | ")}`.trim();
        return current;
      }

      if (request.op === "reveal") {
        if (typeof panel.onRevealAll === "function") panel.onRevealAll();
        else await panel.onPrimaryAction?.();
        return view();
      }

      return view();
    }, action);
  }
}
