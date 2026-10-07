function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export const regressionConfig = {
  // Games scratch launches, in this order. Comment a line to skip that game.
  gameNames: [
    // "Sugar Wonderland",
    // "Kobo Ass",
    // "Felice in Space",
    // "Hustle The Blazing Horse",
    // "War Freaks",
    // "Rainbow Fist",
    // "That's Bait",
    // "Sk8leton",
    // "Grave Threat",
    // "Boobie Trap",
    // "Zero Law",
    // "Beelze-Bop",
    // // "Turbo Wrath",
    // "The Shuten Doji",
    // "Genghis Bao",
    // "Trippy Cat",
    // "Pastry Cub",
    // "Blockchain Blitz",
    // // "Fruit Attack",
    // "Oppals",
    // // "Rangda",
    // "Mars Triumph",
    // // "Fang Shui Fortunes",
    // "Jungle Fruity",
    // "Aztec Lost Empire",
    // "Titanic Transport",
    // "Amazonians",
    // "Necronomicoin",
    // // "Gnome Mansland",
    // "Mad Freaks",
    // // "Illegaliens",
    // "Bad Beach",
    // "Joker Ace",
    // "Clockwork Crash",
    "King in Gold",
    "Sugar Pals",
    // "Chick N Lane",
  ],
  launcherUrl: process.env.GAME_LAUNCHER_URL ?? "https://stg-asset-tools.dijoker.com/game-launcher",
  betEndpoint: "/api/v1/slots/bet",
  betEndpointOrigin: "https://stg-game-launcher.dijoker.com/api/v1/slots/bet",
  playerId: process.env.GAME_PLAYER_ID ?? "automation-0929",
  normalSpins: envNum("REGRESSION_NORMAL_SPINS", 10),
  spaceSpins: envNum("REGRESSION_SPACE_SPINS", 5),
  rapidSpinAttempts: envNum("REGRESSION_RAPID_SPIN_ATTEMPTS", 5),
  autoplaySpins: envNum("REGRESSION_AUTOPLAY_SPINS", 10),
  gameLimit: envNum("REGRESSION_GAME_LIMIT", 0),
  currencyDecimals: 2,
  launchTimeoutMs: envNum("REGRESSION_LAUNCH_TIMEOUT_MS", 50_000),
  spinTimeoutMs: envNum("REGRESSION_SPIN_TIMEOUT_MS", 40_000),
  networkDelayMs: envNum("REGRESSION_NETWORK_DELAY_MS", 2_000),
  enableAutoplay: envFlag("REGRESSION_AUTOPLAY", true),
  enableBuyPurchase: envFlag("REGRESSION_BUY_PURCHASE", true),
  enableTurbo: envFlag("REGRESSION_TURBO", true),
  enableRefresh: envFlag("REGRESSION_REFRESH", true),
  enableNetworkDelay: envFlag("REGRESSION_DELAY", true),
  enableMenu: envFlag("REGRESSION_MENU", true),
  enableMaxBetSelection: envFlag("REGRESSION_MAX_BET", true),
};

export type RegressionConfig = typeof regressionConfig;

export function playerIdForWorker(workerIndex: number): string {
  const base = (process.env.GAME_PLAYER_ID ?? "automation-0929").trim() || "automation-0929";
  return `${base}-${workerIndex + 1}`;
}
