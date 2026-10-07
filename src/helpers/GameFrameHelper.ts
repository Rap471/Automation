import type { Frame, Page } from "@playwright/test";
import type { ControlPoint, FrontendSnapshot } from "../types";

const BRIDGE_VERSION = 19;

export class GameFrameHelper {
  constructor(private readonly page: Page) {}

  async frame(): Promise<Frame> {
    await this.page.locator('iframe[title="Game session"]').waitFor({ state: "attached", timeout: 20_000 });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const match = this.page.frames().find((item) => /stg-games\.dijoker\.com/.test(item.url()));
      if (match) return match;
      await this.page.waitForTimeout(200);
    }
    throw new Error("Game iframe was not found");
  }

  async installBridge(): Promise<void> {
    const frame = await this.frame();
    await frame.waitForLoadState("domcontentloaded");
    await frame.evaluate((version) => {
      const holder = window as unknown as { __dijokerQa?: { version: number } };
      if (holder.__dijokerQa?.version === version) return;

      const parseMoney = (value: unknown): number | undefined => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value !== "string") return undefined;
        const match = value.replace(/\s/g, "").match(/-?\d[\d,]*\.?\d*/);
        if (!match) return undefined;
        let token = match[0];
        if (token.includes(",") && token.includes(".")) token = token.replace(/,/g, "");
        else if (/,\d{1,2}$/.test(token)) token = token.replace(",", ".");
        else token = token.replace(/,/g, "");
        const parsed = Number(token);
        return Number.isFinite(parsed) ? parsed : undefined;
      };

      const walk = (obj: any, visit: (node: any) => void) => {
        if (!obj || typeof obj !== "object") return;
        visit(obj);
        const list = obj.list || obj.children?.list;
        if (!list) return;
        for (const child of list) walk(child, visit);
      };

      const shown = (obj: any): boolean => {
        let current = obj;
        while (current) {
          if (current.visible === false || current.alpha === 0) return false;
          current = current.parentContainer;
        }
        return true;
      };

      const pointOf = (obj: any): ControlPoint | null => {
        if (!obj) return null;
        try {
          const bounds = typeof obj.getBounds === "function" ? obj.getBounds() : null;
          if (bounds && Number.isFinite(bounds.centerX) && Number.isFinite(bounds.centerY)) {
            return { x: bounds.centerX, y: bounds.centerY, visible: shown(obj) && bounds.width > 1 && bounds.height > 1 };
          }
        } catch {
          /* Phaser objects can throw while a scene is shutting down. */
        }
        return { x: Number(obj.x) || 0, y: Number(obj.y) || 0, visible: shown(obj) };
      };

      const textsOf = (scene: any): string[] => {
        const texts: string[] = [];
        if (!scene) return texts;
        walk(scene.children, (node) => {
          if (typeof node.text === "string" && shown(node)) texts.push(node.text);
        });
        return texts.slice(0, 250);
      };

      const balanceFromLabel = (): string | undefined => {
        let labelX = 0;
        let labelY = Number.POSITIVE_INFINITY;
        let foundLabel = false;
        for (const scene of scenes()) {
          walk(scene?.children, (node) => {
            if (typeof node.text !== "string" || !shown(node)) return;
            if (!/^balance\b/i.test(String(node.text).trim())) return;
            const point = pointOf(node);
            if (!point?.visible || point.y >= labelY) return;
            foundLabel = true;
            labelX = point.x;
            labelY = point.y;
          });
        }
        if (!foundLabel) return undefined;
        let bestText: string | undefined;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const scene of scenes()) {
          walk(scene?.children, (node) => {
            if (typeof node.text !== "string" || !shown(node)) return;
            const raw = String(node.text).trim();
            if (parseMoney(raw) == null) return;
            const point = pointOf(node);
            if (!point?.visible) return;
            const dy = point.y - labelY;
            const dx = Math.abs(point.x - labelX);
            if (dy < -8 || dy > 90 || dx > 140) return;
            const score = Math.abs(dy - 22) + dx;
            if (score < bestScore) {
              bestScore = score;
              bestText = raw;
            }
          });
        }
        return bestText;
      };

      const findTextPoint = (scene: any, pattern: RegExp): ControlPoint | null => {
        let found: any = null;
        if (!scene) return null;
        walk(scene.children, (node) => {
          if (!found && typeof node.text === "string" && pattern.test(node.text)) found = node;
        });
        return pointOf(found);
      };

      const findTexturePoint = (scene: any, pattern: RegExp): ControlPoint | null => {
        let found: any = null;
        if (!scene) return null;
        walk(scene.children, (node) => {
          const key = `${node.texture?.key || ""} ${node.name || ""}`;
          if (!found && pattern.test(key)) found = node;
        });
        return pointOf(found);
      };

      const boundsOf = (node: any): { width: number; height: number } | null => {
        try {
          const bounds = typeof node?.getBounds === "function" ? node.getBounds() : null;
          if (!bounds) return null;
          return { width: Number(bounds.width) || 0, height: Number(bounds.height) || 0 };
        } catch {
          return null;
        }
      };

      const findLabel = (scene: any, pattern: RegExp): any => {
        let found: any = null;
        if (!scene) return null;
        walk(scene.children, (node) => {
          if (!found && typeof node.text === "string" && pattern.test(String(node.text).trim()) && shown(node)) found = node;
        });
        return found;
      };

      const buttonAround = (node: any): any => {
        let current = node;
        while (current) {
          const size = boundsOf(current);
          if (current.input && size && size.width >= 40 && size.height >= 24 && size.width <= 420 && size.height <= 180) return current;
          current = current.parentContainer;
        }
        return node;
      };

      const buyHudNode = (slot: any): any => {
        if (slot?.featureAmountText && pointOf(slot.featureAmountText)?.visible) return buttonAround(slot.featureAmountText);
        let best: any = null;
        let bestY = Number.POSITIVE_INFINITY;
        for (const scene of scenes()) {
          walk(scene?.children, (node) => {
            if (typeof node.text !== "string" || !shown(node)) return;
            const text = String(node.text).trim();
            if (!/^buy\b/i.test(text) || /feature/i.test(text)) return;
            const point = pointOf(node);
            if (!point?.visible || point.y >= bestY) return;
            best = node;
            bestY = point.y;
          });
        }
        return best ? buttonAround(best) : null;
      };

      const buyHudButton = (slot: any): ControlPoint | null => pointOf(buyHudNode(slot));

      // The visible control is the circle above the caption. Clicking the caption misses the hit zone.
      const iconAboveLabel = (scene: any, pattern: RegExp): ControlPoint | null => {
        const label = findLabel(scene, pattern);
        const labelPoint = pointOf(label);
        if (!labelPoint?.visible) return null;
        let best: ControlPoint | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        walk(scene.children, (node) => {
          if (node === label || typeof node.text === "string") return;
          const point = pointOf(node);
          const size = boundsOf(node);
          if (!point?.visible || !size) return;
          if (size.width < 18 || size.height < 18 || size.width > 150 || size.height > 150) return;
          const dx = Math.abs(point.x - labelPoint.x);
          const dy = labelPoint.y - point.y;
          if (dx > 60 || dy < 10 || dy > 130) return;
          const interactive = !!node.input;
          const score = dx + Math.abs(dy - 48) + (interactive ? 0 : 20);
          if (score < bestScore) {
            bestScore = score;
            best = point;
          }
        });
        return best ?? { x: labelPoint.x, y: Math.max(8, labelPoint.y - 54), visible: true };
      };

      // Round Amplify icon. The picture behind it changes per game, so this uses the caption and the badge, not the color.
      const amplifyGap = (scene: any): { labelPoint: ControlPoint; top: number; bottom: number } | null => {
        const label = findLabel(scene, /^amplify\b/i);
        const labelPoint = pointOf(label);
        if (!labelPoint?.visible) return null;
        const labelSize = boundsOf(label);
        const captionTop = labelPoint.y - Math.max(8, (labelSize?.height ?? 16) / 2) - 4;
        let badgeBottom = Number.NEGATIVE_INFINITY;
        walk(scene?.children, (node) => {
          if (typeof node.text !== "string" || !shown(node)) return;
          if (!/double\s*chance|for\s*feature/i.test(String(node.text))) return;
          const point = pointOf(node);
          const size = boundsOf(node);
          if (!point?.visible || Math.abs(point.x - labelPoint.x) > 120 || point.y >= captionTop) return;
          const bottom = point.y + (size?.height ?? 16) / 2;
          if (bottom > badgeBottom) badgeBottom = bottom;
        });
        const top = badgeBottom > captionTop - 220 ? badgeBottom + 2 : captionTop - 110;
        return { labelPoint, top, bottom: captionTop };
      };

      const amplifyCircle = (scene: any): any => {
        const gap = amplifyGap(scene);
        if (!gap || gap.bottom <= gap.top) return null;
        let best: any = null;
        let bestScore = Number.POSITIVE_INFINITY;
        const visit = (node: any) => {
          if (!node || typeof node.text === "string") return;
          const point = pointOf(node);
          const size = boundsOf(node);
          if (!point?.visible || !size) return;
          if (size.width < 32 || size.height < 32 || size.width > 180 || size.height > 180) return;
          if (Math.abs(size.width - size.height) > 55) return;
          const dx = Math.abs(point.x - gap.labelPoint.x);
          if (dx > 90 || point.y <= gap.top || point.y >= gap.bottom) return;
          const score = dx + Math.abs(point.y - (gap.top + gap.bottom) / 2) + (node.input ? 0 : 30);
          if (score < bestScore) {
            bestScore = score;
            best = node;
          }
        };
        walk(scene?.children, visit);
        const slot = scene?.slotController;
        if (slot && typeof slot === "object") {
          for (const key of Object.keys(slot)) {
            if (!/amplify|doublechance|enhancedbet/i.test(key)) continue;
            visit(slot[key]);
            walk(slot[key], visit);
          }
        }
        return best;
      };

      const amplifyTarget = (scene: any): ControlPoint | null => {
        const gap = amplifyGap(scene);
        const circle = pointOf(amplifyCircle(scene));
        // The green badge overlaps the top of the circle. A point near that badge does not toggle Amplify.
        if (circle?.visible && gap && circle.y > gap.top + 28 && circle.y < gap.labelPoint.y - 16) return circle;
        if (!gap) return null;
        const y = gap.labelPoint.y - 30;
        return { x: gap.labelPoint.x, y, visible: y > gap.top && y < gap.labelPoint.y };
      };

      const findBottomSpin = (scene: any): ControlPoint | null => {
        const height = (window as any).phaserGame?.scale?.height || 0;
        if (!scene || height <= 0) return null;
        let best: ControlPoint | null = null;
        let bestArea = 0;
        walk(scene.children, (node) => {
          if (!node.input || typeof node.text === "string") return;
          const point = pointOf(node);
          const size = boundsOf(node);
          if (!point?.visible || !size) return;
          if (point.y < height * 0.6) return;
          if (size.width < 48 || size.height < 48 || size.width > 240 || size.height > 240) return;
          if (Math.abs(size.width - size.height) > 50) return;
          const area = size.width * size.height;
          if (area > bestArea) {
            bestArea = area;
            best = point;
          }
        });
        return best;
      };

      const symbolGrid = (value: any): unknown => {
        if (!Array.isArray(value)) return null;
        return value.map((column) => {
          if (!Array.isArray(column)) return column;
          return column.map((cell) => {
            if (cell == null || typeof cell !== "object") return cell;
            return cell.symbol ?? cell.symbolId ?? cell.id ?? cell.value ?? null;
          });
        });
      };

      const scenes = (): any[] => {
        const game = (window as any).phaserGame;
        return game?.scene?.scenes || [];
      };

      const playingScene = () => scenes().find((scene) => scene.slotController) || scenes().find((scene) => scene.scene?.key === "Game");
      const preloaderScene = () => scenes().find((scene) => scene.buttonSpin) || scenes().find((scene) => scene.scene?.key === "Preloader");

      (window as any).__dijokerQa = {
        version,
        listHud(): string[] {
          const slotScene = playingScene();
          const slot = slotScene?.slotController;
          const roots = [slot, slot?.header, slotScene?.header, slot?.footer, slotScene?.footer];
          const rows: string[] = [];
          roots.forEach((root, index) => {
            if (!root || typeof root !== "object") return;
            for (const key of Object.keys(root)) {
              if (!/win|balance|amount|bet/i.test(key)) continue;
              const value = root[key];
              const text = value != null && (typeof value === "string" || typeof value === "number")
                ? String(value)
                : value && (typeof value.text === "string" || typeof value.text === "number")
                  ? String(value.text)
                  : "";
              if (text.trim() === "") continue;
              rows.push(`${index}:${key}=${JSON.stringify(text).slice(0, 80)}`);
            }
          });
          return rows.slice(0, 40);
        },
        getState(): FrontendSnapshot {
          const game = (window as any).phaserGame;
          const canvas = document.querySelector("canvas");
          const rect = canvas?.getBoundingClientRect();
          const gate = document.querySelector(".mobile-orientation-gate");
          const gateBox = gate?.getBoundingClientRect();
          const empty: FrontendSnapshot = {
            phase: game ? "loading" : "missing",
            idle: false,
            busy: false,
            feature: "base",
            winTexts: [],
            errorTexts: [],
            texts: [],
            displayedWins: [],
            betLevels: [],
            displayedBetLevels: [],
            flags: {},
            controls: {},
            canvas: {
              cssWidth: rect?.width || 0,
              cssHeight: rect?.height || 0,
              gameWidth: game?.scale?.width || 0,
              gameHeight: game?.scale?.height || 0,
            },
            spriteCount: 0,
            domCount: document.querySelectorAll("*").length,
            orientationBlocked: !!gateBox && gateBox.height > 120 && gateBox.width > 120,
            hasBuy: false,
            hasAutoplay: false,
            hasTurbo: false,
            hasMenu: false,
            buyEnabled: false,
            skipConsumed: false,
          };
          if (!game) return empty;

          const preloader = preloaderScene();
          const slotScene = playingScene();
          const slot = slotScene?.slotController;
          const activePlaying = !!(slotScene?.scene?.isActive?.() && slot);
          const texts = textsOf(activePlaying ? slotScene : preloader);
          const errorTexts = texts.filter((text) => /error|failed to|unable to|insufficient|token expired|something went wrong/i.test(text) && !/win up to/i.test(text));
          const flags: Record<string, boolean | number> = {};
          const gsm = slotScene?.gameStateManager;
          if (gsm) {
            for (const key of Object.keys(gsm)) {
              if (key.startsWith("_is") || key === "_scatterIndex") flags[key] = gsm[key];
            }
          }
          const busy = !!(flags._isReelSpinning || flags._isProcessingSpin || flags._isShowingWinlines || flags._isShowingWinDialog || flags._isAutoPlaying || slot?.manualSpinClickInFlight);
          const readNodeNumber = (node: any): number | undefined => {
            if (node == null) return undefined;
            if (typeof node === "number") return parseMoney(node);
            return parseMoney(node?.text)
              ?? parseMoney(node?._text)
              ?? parseMoney(typeof node?.getText === "function" ? node.getText() : null)
              ?? parseMoney(node?.value)
              ?? parseMoney(node?.amount);
          };
          const header = slotScene?.header || slot?.header;
          const footer = slotScene?.footer || slot?.footer;
          const scanHudNumber = (roots: any[], pattern: RegExp): { value?: number; source: string } => {
            for (const root of roots) {
              if (!root || typeof root !== "object") continue;
              for (const key of Object.keys(root)) {
                if (!pattern.test(key) || /token|pending|anim|captured/i.test(key)) continue;
                const value = readNodeNumber(root[key]);
                if (value != null) return { value, source: key };
              }
            }
            return { source: "" };
          };
          const balanceCandidates: Array<{ value?: number; source: string }> = [
            { value: readNodeNumber(slot?.balanceAmountText), source: "slotController.balanceAmountText" },
            { value: readNodeNumber(slot?.balanceText), source: "slotController.balanceText" },
            { value: readNodeNumber(slot?.balanceAmount), source: "slotController.balanceAmount" },
            { value: readNodeNumber(slot?.balance), source: "slotController.balance" },
            { value: readNodeNumber(slot?.creditText), source: "slotController.creditText" },
            { value: readNodeNumber(slot?.walletText), source: "slotController.walletText" },
            { value: readNodeNumber(header?.balanceAmountText), source: "header.balanceAmountText" },
            { value: readNodeNumber(header?.balanceText), source: "header.balanceText" },
            { value: readNodeNumber(footer?.balanceAmountText), source: "footer.balanceAmountText" },
            { value: readNodeNumber(footer?.balanceText), source: "footer.balanceText" },
            { value: readNodeNumber(slotScene?.balanceManager?.balance), source: "balanceManager.balance" },
            { value: readNodeNumber(slotScene?.walletManager?.balance), source: "walletManager.balance" },
          ];
          const scannedBalance = scanHudNumber([slot, header, footer, slotScene?.balanceManager, slotScene?.walletManager], /balance|wallet|credit|cash/i);
          if (scannedBalance.value != null && scannedBalance.source) balanceCandidates.push(scannedBalance);
          const labeledBalance = parseMoney(balanceFromLabel());
          if (labeledBalance != null) balanceCandidates.push({ value: labeledBalance, source: "balance label" });
          const balanceHit = balanceCandidates.find((candidate) => candidate.value != null) ?? null;
          const winCandidates: Array<{ value?: number; source: string }> = [
            { value: readNodeNumber(slot?.winAmountText), source: "slotController.winAmountText" },
            { value: readNodeNumber(slot?.totalWinText), source: "slotController.totalWinText" },
            { value: readNodeNumber(slot?.winText), source: "slotController.winText" },
            { value: readNodeNumber(header?.winAmountText), source: "header.winAmountText" },
            { value: readNodeNumber(header?.winText), source: "header.winText" },
            { value: readNodeNumber(header?.currentWinnings), source: "header.currentWinnings" },
            { value: readNodeNumber(header?.amountText), source: "header.amountText" },
            { value: readNodeNumber(footer?.winAmountText), source: "footer.winAmountText" },
            { value: readNodeNumber(footer?.winText), source: "footer.winText" },
            { value: readNodeNumber(footer?.currentWinnings), source: "footer.currentWinnings" },
            { value: readNodeNumber(slot?.currentWinnings), source: "slotController.currentWinnings" },
            { value: readNodeNumber(footer?.amountText), source: "footer.amountText" },
          ];
          const winHit = winCandidates.find((candidate) => candidate.value != null) ?? null;
          const readNodeText = (node: any): string | undefined => {
            if (node == null) return undefined;
            if (typeof node === "string" || typeof node === "number") return String(node);
            if (typeof node.text === "string" || typeof node.text === "number") return String(node.text);
            if (typeof node._text === "string" || typeof node._text === "number") return String(node._text);
            return undefined;
          };
          const betText = typeof slot?.betAmountText?.text === "string" || typeof slot?.betAmountText?.text === "number" ? String(slot.betAmountText.text) : undefined;
          const balanceText = balanceFromLabel()
            ?? readNodeText(slot?.balanceAmountText)
            ?? readNodeText(slot?.balanceText)
            ?? (balanceHit?.value != null ? String(balanceHit.value) : undefined);
          const winDisplay = winHit?.value;
          const buyText = slot?.featureAmountText?.text;
          const freeText = slot?.freeSpinNumber?.text;
          const winTexts = texts.filter((text) => /win/i.test(text) && !/win up to/i.test(text)).slice(0, 12);
          const multiplierText = texts.find((text) => /^x\s*\d+/i.test(text.trim()));
          const init = slot?.gameAPI?.initializationData || preloader?.gameAPI?.initializationData || {};
          const betLevels = Array.isArray(init.betLevels) ? init.betLevels.map(Number).filter((value: number) => Number.isFinite(value)) : [];
          const displayedBetLevels = texts.map(parseMoney).filter((value): value is number => value != null && betLevels.includes(value));
          let sprites = 0;
          if (slotScene) {
            walk(slotScene.children, (node) => {
              if (["Image", "Sprite", "Mesh"].includes(node.type) || String(node.type || "").includes("Spine")) sprites += 1;
            });
          }
          const feature = flags._isInFreeSpinRound || flags._isBonus ? "free-spins" : flags._isScatter ? "scatter" : "base";
          const displayedWins: number[] = [];
          const symbolsRoot = slot?.symbols;
          if (typeof symbolsRoot?.cachedTotalWin === "number" && symbolsRoot.cachedTotalWin > 0) displayedWins.push(symbolsRoot.cachedTotalWin);
          if (symbolsRoot) {
            for (const [key, value] of Object.entries(symbolsRoot)) {
              if (typeof value === "number" && /win/i.test(key) && value > 0) displayedWins.push(value);
              if (value && typeof value === "object" && typeof (value as { text?: string }).text === "string" && /win/i.test(key)) {
                const parsed = parseMoney((value as { text: string }).text);
                if (parsed && parsed > 0) displayedWins.push(parsed);
              }
            }
          }
          return {
            phase: activePlaying ? "playing" : preloader?.scene?.isActive?.() ? "preloader" : "loading",
            idle: activePlaying && !busy,
            busy: activePlaying && busy,
            bet: parseMoney(betText),
            betText,
            balance: balanceHit?.value,
            balanceText,
            balanceDisplay: balanceHit?.value,
            balanceSource: balanceHit?.source,
            winDisplay,
            winDisplayText: winDisplay != null ? String(winDisplay) : undefined,
            winSource: winHit?.source,
            buyAmount: parseMoney(buyText),
            buyText,
            freeSpins: freeText != null && freeText !== "" ? Number.parseInt(String(freeText), 10) : undefined,
            multiplier: multiplierText ? parseMoney(multiplierText.replace(/x/i, "")) : undefined,
            feature,
            symbols: symbolGrid(slot?.symbols?.currentSymbolData),
            cachedTotalWin: typeof slot?.symbols?.cachedTotalWin === "number" ? slot.symbols.cachedTotalWin : undefined,
            winTexts,
            errorTexts,
            texts: texts.slice(0, 80),
            displayedWins,
            maxWinText: texts.find((text) => /win up to/i.test(text)),
            currency: init.currency,
            currencyDecimals: init.currencyDecimalPlaces,
            betLevels,
            displayedBetLevels: [...new Set(displayedBetLevels)],
            buyMultiplier: slot?.buyFeature?.BET_MULTIPLIER,
            flags,
            controls: {
              play: pointOf(preloader?.buttonSpin) || findTextPoint(preloader, /^(play|start|continue|tap)$/i),
              spin: pointOf(slot?.spinHitZone) || pointOf(slot?.spinIcon) || pointOf(slot?.spinButton) || iconAboveLabel(slotScene, /^spin$/i) || findBottomSpin(slotScene),
              buy: buyHudButton(slot),
              autoplay: iconAboveLabel(slotScene, /^autoplay$/i),
              turbo: iconAboveLabel(slotScene, /^turbo$/i),
              menu: iconAboveLabel(slotScene, /^menu$/i),
              increase: findTexturePoint(slotScene, /increase|plus/i),
              decrease: findTexturePoint(slotScene, /decrease|minus/i),
              amplify: amplifyTarget(slotScene),
            },
            canvas: empty.canvas,
            spriteCount: sprites,
            domCount: empty.domCount,
            orientationBlocked: empty.orientationBlocked,
            hasBuy: texts.some((text) => /^buy\b/i.test(text.trim()) && !/feature/i.test(text.trim())) || !!slot?.buyFeature || !!slot?.featureButtonHitbox,
            hasAutoplay: !!slot?.autoplayButtonAnimation || texts.some((text) => /^autoplay$/i.test(text.trim())),
            hasTurbo: !!slot?.turboButtonAnimation || texts.some((text) => /^turbo$/i.test(text.trim())),
            hasMenu: texts.some((text) => /^menu$/i.test(text.trim())),
            buyEnabled: slot?.featureButtonHitbox?.input ? slot.featureButtonHitbox.input.enabled !== false && shown(slot.featureButtonHitbox) : undefined,
            enhancedBet: !!(slot?.isEnhancedBet || slot?.enhancedBet || gsm?._isEnhancedBet || gsm?._isAmplifyBet),
            maxWinMultiplier: typeof init.maxWin === "number" ? init.maxWin : undefined,
            skipConsumed: !!slot?.manualSpinSkipConsumedForCurrentSpin,
          };
        },
        debugTexts(source: string): string[] {
          const pattern = new RegExp(source, "i");
          const rows: string[] = [];
          for (const scene of scenes()) {
            walk(scene?.children, (node) => {
              if (typeof node.text !== "string" || !shown(node) || !pattern.test(String(node.text))) return;
              const point = pointOf(node);
              rows.push(`${JSON.stringify(String(node.text).trim())} @ ${Math.round(point?.x || 0)},${Math.round(point?.y || 0)} visible=${point?.visible === true}`);
            });
          }
          const slot = playingScene()?.slotController;
          const amount = pointOf(slot?.featureAmountText);
          rows.push(`featureAmountText ${JSON.stringify(slot?.featureAmountText?.text ?? "")} @ ${Math.round(amount?.x || 0)},${Math.round(amount?.y || 0)} visible=${amount?.visible === true}`);
          return rows.slice(0, 40);
        },
        locateText(source: string): ControlPoint | null {
          const pattern = new RegExp(source, "i");
          let best: ControlPoint | null = null;
          for (const scene of scenes()) {
            walk(scene?.children, (node) => {
              if (typeof node.text !== "string" || !pattern.test(String(node.text).trim()) || !shown(node)) return;
              const point = pointOf(node);
              if (point?.visible && (best == null || point.y >= best.y)) best = point;
            });
          }
          return best;
        },
        locateDialogText(source: string): ControlPoint | null {
          const pattern = new RegExp(source, "i");
          const slotScene = playingScene();
          const hudLabels = ["menu", "autoplay", "turbo", "amplify"].map((label) => pointOf(findLabel(slotScene, new RegExp(`^${label}`, "i"))));
          const hudTop = hudLabels.reduce((top, point) => point?.visible ? Math.min(top, point.y) : top, Number.POSITIVE_INFINITY);
          const ceiling = Number.isFinite(hudTop) ? hudTop - 36 : Number.POSITIVE_INFINITY;
          let best: ControlPoint | null = null;
          for (const scene of scenes()) {
            walk(scene?.children, (node) => {
              if (typeof node.text !== "string" || !pattern.test(String(node.text).trim()) || !shown(node)) return;
              const point = pointOf(buttonAround(node));
              if (!point?.visible || point.y > ceiling) return;
              if (best == null || point.y >= best.y) best = point;
            });
          }
          return best;
        },
        locateLaunchButton(): ControlPoint | null {
          const game = (window as any).phaserGame;
          const width = game?.scale?.width || 0;
          const height = game?.scale?.height || 0;
          const onCanvas = (point: ControlPoint | null): point is ControlPoint => !!point?.visible && width > 0 && height > 0 && point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
          const pattern = /^(play(\s+now)?|start|continue|tap(\s+to\s+play)?|click\s+to\s+(start|play|continue)|let'?s\s+play)$/i;
          let best: ControlPoint | null = null;
          for (const scene of scenes()) {
            walk(scene?.children, (node) => {
              if (typeof node.text !== "string" || !shown(node)) return;
              const text = String(node.text).trim();
              if (!pattern.test(text) || /autoplay|feature/i.test(text)) return;
              const point = pointOf(buttonAround(node));
              if (!onCanvas(point)) return;
              if (best == null || point.y >= best.y) best = point;
            });
          }
          if (best) return best;
          const preloaderButton = pointOf(preloaderScene()?.buttonSpin);
          return onCanvas(preloaderButton) ? preloaderButton : null;
        },
        pressAnywhere(): ControlPoint | null {
          const game = (window as any).phaserGame;
          const width = game?.scale?.width || 0;
          const height = game?.scale?.height || 0;
          let found = false;
          for (const scene of scenes()) {
            walk(scene?.children, (node) => {
              if (found || typeof node.text !== "string" || !shown(node)) return;
              if (/press\s+anywhere/i.test(String(node.text))) found = true;
            });
          }
          if (!found || width <= 0 || height <= 0) return null;
          return { x: width / 2, y: height / 2, visible: true };
        },
        invoke(name: string): boolean {
          const slotScene = playingScene();
          const preloader = preloaderScene();
          const slot = slotScene?.slotController;
          const target = name === "spin"
            ? slot?.spinHitZone || slot?.spinIcon || slot?.spinButton
            : name === "play"
              ? preloader?.buttonSpin
              : name === "buy"
                ? buyHudNode(slot) || slot?.featureButtonHitbox
                : name === "turbo"
                  ? findLabel(slotScene, /^turbo$/i)
                  : name === "amplify"
                    ? buttonAround(amplifyCircle(slotScene))
                    : null;
          if (!target?.emit) return false;
          const pointer = (slotScene || preloader)?.input?.activePointer;
          target.emit("pointerdown", pointer, target.x, target.y);
          target.emit("pointerup", pointer, target.x, target.y);
          return true;
        },
      };
    }, BRIDGE_VERSION);
  }

  async listHud(): Promise<string[]> {
    await this.installBridge();
    return this.frame().then((frame) => frame.evaluate(() => (window as any).__dijokerQa.listHud() as string[]));
  }

  async readState(): Promise<FrontendSnapshot> {
    await this.installBridge();
    return this.frame().then((frame) => frame.evaluate(() => (window as any).__dijokerQa.getState() as FrontendSnapshot));
  }

  async invoke(name: string): Promise<boolean> {
    await this.installBridge();
    return this.frame().then((frame) => frame.evaluate((control) => Boolean((window as any).__dijokerQa.invoke(control)), name));
  }

  async clickControl(name: string): Promise<boolean> {
    const state = await this.readState();
    const point = state.controls[name];
    if (!point?.visible) return false;
    const measured = state.canvas.gameWidth > 0 && (point.x < 0 || point.y < 0 || point.x > state.canvas.gameWidth || point.y > state.canvas.gameHeight);
    if (measured) return false;
    await this.clickGamePoint(point.x, point.y, state);
    return true;
  }

  async clickGamePoint(gameX: number, gameY: number, known?: FrontendSnapshot): Promise<void> {
    const state = known ?? await this.readState();
    const canvas = (await this.frame()).locator("canvas").first();
    await canvas.waitFor({ state: "visible" });
    const box = await canvas.boundingBox();
    if (!box || state.canvas.gameWidth <= 0 || state.canvas.gameHeight <= 0) {
      throw new Error("Game canvas is not measurable");
    }
    const scaleX = box.width / state.canvas.gameWidth;
    const scaleY = box.height / state.canvas.gameHeight;
    const x = Math.min(Math.max(gameX * scaleX, 2), box.width - 2);
    const y = Math.min(Math.max(gameY * scaleY, 2), box.height - 2);
    await canvas.click({ position: { x, y }, force: true });
  }

  async textDump(pattern: string): Promise<string[]> {
    await this.installBridge();
    return (await this.frame()).evaluate((source) => (window as any).__dijokerQa.debugTexts(source) as string[], pattern);
  }

  async dismissPressAnywhere(): Promise<boolean> {
    await this.installBridge();
    const point = await (await this.frame()).evaluate(() => (window as any).__dijokerQa.pressAnywhere() as ControlPoint | null);
    if (!point?.visible) return false;
    const state = await this.readState();
    if (!this.insideCanvas(point, state)) return false;
    await this.clickGamePoint(point.x, point.y, state);
    console.log("Clicked Press anywhere to continue");
    return true;
  }

  async clickLaunchButton(): Promise<boolean> {
    await this.installBridge();
    const point = await (await this.frame()).evaluate(() => (window as any).__dijokerQa.locateLaunchButton() as ControlPoint | null);
    const state = await this.readState();
    if (!point?.visible || !this.insideCanvas(point, state)) return false;
    await this.clickGamePoint(point.x, point.y, state);
    console.log(`Clicked green launch button at ${Math.round(point.x)},${Math.round(point.y)}`);
    return true;
  }

  async clickText(pattern: string): Promise<boolean> {
    return this.clickLocatedText(pattern, "locateText");
  }

  async clickDialogText(pattern: string): Promise<boolean> {
    return this.clickLocatedText(pattern, "locateDialogText");
  }

  private async clickLocatedText(pattern: string, locator: "locateText" | "locateDialogText"): Promise<boolean> {
    await this.installBridge();
    const point = await (await this.frame()).evaluate(([source, method]) => (window as any).__dijokerQa[method](source) as ControlPoint | null, [pattern, locator] as const);
    const state = await this.readState();
    if (!point?.visible || !this.insideCanvas(point, state)) return false;
    await this.clickGamePoint(point.x, point.y, state);
    return true;
  }

  private insideCanvas(point: ControlPoint, state: FrontendSnapshot): boolean {
    if (state.canvas.gameWidth <= 0 || state.canvas.gameHeight <= 0) return true;
    return point.x >= 0 && point.y >= 0 && point.x <= state.canvas.gameWidth && point.y <= state.canvas.gameHeight;
  }

  async pressSpace(times = 1): Promise<void> {
    const state = await this.readState();
    if (state.canvas.gameWidth > 0 && state.canvas.gameHeight > 0) {
      await this.clickGamePoint(state.canvas.gameWidth / 2, state.canvas.gameHeight * 0.42, state);
    }
    for (let index = 0; index < times; index += 1) {
      await this.page.keyboard.press("Space");
      if (times > 1) await this.page.waitForTimeout(40);
    }
  }

  async dispatchSpace(): Promise<boolean> {
    const frame = await this.frame();
    await frame.evaluate(() => {
      for (const type of ["keydown", "keyup"]) {
        const event = new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true, cancelable: true });
        Object.defineProperty(event, "keyCode", { get: () => 32 });
        Object.defineProperty(event, "which", { get: () => 32 });
        window.dispatchEvent(event);
        document.dispatchEvent(event);
      }
    });
    return true;
  }

  async scatterSymbolId(): Promise<number> {
    const frame = await this.frame();
    const id = await frame.evaluate(() => {
      const game = (window as any).phaserGame;
      const scenes = game?.scene?.scenes || [];
      const scene = scenes.find((item: any) => item.slotController) || scenes.find((item: any) => item.scene?.key === "Game");
      const slot = scene?.slotController;
      const init = slot?.gameAPI?.initializationData || scene?.gameAPI?.initializationData || {};
      const asId = (value: any): number | undefined => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (!value || typeof value !== "object") return undefined;
        const raw = value.id ?? value.symbol ?? value.symbolId ?? value.index ?? value.value;
        return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
      };
      const direct = [
        init.scatterSymbol, init.scatterId, init.scatter, init.scatterSymbolId,
        slot?.scatterSymbol, slot?.scatterId, slot?.symbols?.scatterSymbol, slot?.symbols?.scatterId,
      ];
      for (const item of direct) {
        const hit = asId(item);
        if (hit != null) return hit;
      }
      const lists = [init.symbols, init.symbolList, init.paytable, slot?.symbols?.symbols, slot?.symbols?.list];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          const label = String(entry?.name ?? entry?.key ?? entry?.type ?? entry?.code ?? "");
          if (!/scatter/i.test(label)) continue;
          const hit = asId(entry);
          if (hit != null) return hit;
        }
      }
      const queue = [init, slot?.symbols];
      const seen = new Set<any>();
      let steps = 0;
      while (queue.length && steps < 200) {
        const node = queue.shift();
        steps += 1;
        if (!node || typeof node !== "object" || seen.has(node)) continue;
        seen.add(node);
        for (const [key, value] of Object.entries(node)) {
          if (/scatter/i.test(key)) {
            const hit = asId(value);
            if (hit != null) return hit;
          }
          if (value && typeof value === "object" && !Array.isArray(value) && steps < 80) queue.push(value);
        }
      }
      return 0;
    });
    return typeof id === "number" && Number.isFinite(id) ? id : 0;
  }

  async waitForInteractive(timeoutMs: number): Promise<FrontendSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let last = await this.readState();
    while (Date.now() < deadline) {
      last = await this.readState();
      if (last.errorTexts.length) return last;
      if (await this.dismissPressAnywhere().catch(() => false)) {
        await this.page.waitForTimeout(400);
        continue;
      }
      const launched = await this.clickLaunchButton().catch(() => false);
      if (launched) {
        await this.page.waitForTimeout(600);
        continue;
      }
      if (last.phase === "playing" && last.bet != null && last.controls.spin) return last;
      if ((last.phase === "preloader" || last.phase === "loading") && last.canvas.gameWidth > 0) {
        await this.clickGamePoint(last.canvas.gameWidth / 2, last.canvas.gameHeight * 0.62, last).catch(() => undefined);
      }
      await this.page.waitForTimeout(400);
    }
    return last;
  }
}
