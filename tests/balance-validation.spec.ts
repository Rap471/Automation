import { expect, test } from "@playwright/test";
import {
  buyScratch,
  captureTx,
  closeScratch,
  completeBalance,
  confirmBuyFeature,
  openScratch,
  popupText,
  readBackend,
  readSessionBalance,
  roundsSince,
  setScratchBet,
  setSlotBet,
  setWallet,
  sharedBet,
  shot,
  toolbarBalance,
  waitQuiet,
  Wire,
  type ActionCapture,
} from "../src/balance/actions";
import { BalanceBoard } from "../src/balance/board";
import { GameFrameHelper } from "../src/helpers/GameFrameHelper";
import { NetworkMonitor } from "../src/helpers/NetworkMonitor";
import { GameLauncherPage } from "../src/pages/GameLauncherPage";
import { ScratchGame } from "../src/scratch/ScratchGame";
import { regressionConfig } from "../src/config/regression.config";
import {
  balanceGame,
  balancePlayer,
  judge,
  type Checkpoint,
  type Evidence,
  type JudgeInput,
  type ScenarioStatus,
  matchLabel,
  money,
} from "../src/balance/model";

const BET_LIMIT = 100;
const gamesToTest = (process.env.QA_GAME_LIST ?? "")
  .split("|")
  .map((name) => name.trim())
  .filter(Boolean);
const selectedGames = gamesToTest.length ? gamesToTest : [balanceGame];

for (const gameName of selectedGames) {
test(`Balance stays aligned with the backend after Buy Feature and Buy Scratch · ${gameName}`, async ({ page }) => {
  test.setTimeout(16 * 60 * 1000);
  const board = new BalanceBoard(gameName, balancePlayer);
  board.publish();
  const wire = new Wire(page);
  const network = new NetworkMonitor(page);
  network.attach();
  network.setGame(gameName);
  const launcher = new GameLauncherPage(page);
  const frame = new GameFrameHelper(page);

  const finish = async (name: string, input: Omit<JudgeInput, "steps"> & { steps?: string }, capture?: ActionCapture) => {
    const verdict = judge({ ...input, steps: input.steps || `1. Set bet limit ${BET_LIMIT}. 2. Record the balance before ${gameName} starts. 3. Buy Feature. 4. Buy Scratch. 5. Fail when the UI balance is not the backend balance.` });
    const picture = await shot(page, `${gameName} ${name}`);
    if (verdict.evidence) verdict.evidence.screenshot = picture;
    board.mark(name, verdict.status, verdict.details, verdict.classification, capture?.checkpoints ?? input.checkpoints, verdict.evidence, picture);
    return verdict;
  };

  const note = async (name: string, status: ScenarioStatus, details: string, classification = "", checkpoints: Checkpoint[] = [], evidence?: Evidence) => {
    const picture = status === "RUNNING" ? "" : await shot(page, `${gameName} ${name}`);
    board.mark(name, status, details, classification, checkpoints, evidence, picture);
  };

  try {
    console.log(`Balance live: ${gameName} player ${balancePlayer} bet limit ${BET_LIMIT}`);
    await launcher.open();
    await launcher.setPlayer(balancePlayer);
    const funded = await setWallet(page, balancePlayer, BET_LIMIT);
    console.log(`Balance set to ${BET_LIMIT} with Update. ${funded}`);
    const beforeUi = await toolbarBalance(page);
    const beforeBackend = (await readSessionBalance(page, balancePlayer)) ?? beforeUi;
    board.bet = BET_LIMIT;
    await finish("Balance before game start", {
      action: "Balance before game start",
      beforeUi,
      beforeBackend,
      bet: BET_LIMIT,
      win: null,
      afterUi: beforeUi,
      afterBackend: beforeBackend,
      accepted: 0,
      mode: "initial",
      checkpoints: [{ point: "Before game start", ui: beforeUi, backend: beforeBackend, match: matchLabel(beforeUi, beforeBackend) }],
      api: "/api/session/balance",
      request: `bet limit ${BET_LIMIT}`,
      response: funded,
    });

    const found = await launcher.discoverGames();
    const match = found.find((game) => game.gameName.toLowerCase().includes(gameName.toLowerCase()));
    expect(match, `Game not on the launcher: ${gameName}`).toBeTruthy();
    const launched = Date.now();
    await launcher.openGame(match!);
    await frame.waitForInteractive(regressionConfig.launchTimeoutMs);
    const scratch = new ScratchGame(await frame.frame());
    await closeScratch(page, frame, scratch);
    const panel = await openScratch(page, frame, scratch);
    const slotLevels = (await frame.readState()).betLevels;
    let chosenBet = sharedBet(slotLevels, panel.levels) ?? (await frame.readState()).bet ?? panel.bet;
    await closeScratch(page, frame, scratch);
    if (chosenBet != null) chosenBet = (await setSlotBet(frame, chosenBet)) ?? chosenBet;
    board.currency = (await frame.readState()).currency || "";
    board.publish();

    await note("Buy Feature", "RUNNING", `Bet limit ${BET_LIMIT}. Buying the feature once.`);
    await waitQuiet(frame, page, 25_000);
    const featureState = await frame.readState();
    const featureStarted = Date.now();
    const featureBackend = await readBackend(page, wire, balancePlayer, launched, beforeBackend);
    const featureStartCount = network.count();
    let featureCapture: ActionCapture | undefined;
    if (!featureState.hasBuy || !featureState.controls.buy?.visible) {
      await note("Buy Feature", "BLOCKED", "This game has no Buy Feature control.");
    } else {
      await frame.clickControl("buy");
      const confirmed = await confirmBuyFeature(frame, page, network, 1);
      const settled = confirmed ? await waitQuiet(frame, page, 90_000) : await frame.readState();
      await wire.ready(featureStarted);
      const featureRecords = network.all().slice(featureStartCount);
      const featureRecord = featureRecords.find((record) => Number((record.requestPayload as { buyFeat?: number } | null)?.buyFeat ?? 0) > 0) ?? featureRecords[0];
      const featureTxn = captureTx(wire, featureStarted, await roundsSince(await frame.frame(), featureStarted));
      const featureBet = featureRecord?.betSize ?? featureTxn.bet ?? featureState.bet ?? null;
      const displayedCost = featureState.buyAmount ?? settled.buyAmount ?? null;
      const featureBalance = completeBalance(network, featureRecord?.responseBody) ?? featureRecord?.balanceAfter ?? featureTxn.balance ?? (await readBackend(page, wire, balancePlayer, featureStarted, featureBackend.balance)).balance;
      const checkpoints: Checkpoint[] = [
        { point: "Before game start", ui: beforeUi, backend: beforeBackend, match: matchLabel(beforeUi, beforeBackend) },
        { point: "After Buy Feature", ui: settled.balance ?? null, backend: featureBalance, match: matchLabel(settled.balance, featureBalance) },
      ];
      featureCapture = {
        beforeUi: featureState.balance ?? beforeUi,
        beforeBackend: featureBackend.balance,
        afterUi: settled.balance ?? null,
        afterBackend: featureBalance,
        bet: displayedCost ?? featureBet,
        baseBet: featureBet,
        win: featureRecord?.totalWin ?? featureTxn.win ?? 0,
        accepted: featureRecords.filter((record) => Number((record.requestPayload as { buyFeat?: number } | null)?.buyFeat ?? 0) > 0).length,
        api: "/api/v1/slots/bet",
        request: featureRecord ? JSON.stringify(featureRecord.requestPayload).slice(0, 1400) : featureTxn.request,
        response: featureRecord ? JSON.stringify(featureRecord.responseBody).slice(0, 1400) : featureTxn.response,
        currency: featureTxn.currency || settled.currency || "",
        feature: "buy-feature",
        popup: popupText(settled),
        checkpoints,
        note: `Bet limit ${BET_LIMIT}. UI cost ${money(displayedCost)}.`,
      };
      if (!confirmed) {
        await note("Buy Feature", "BLOCKED", `BUY FEATURE did not send a request. Bet limit ${BET_LIMIT}.`, "", checkpoints);
      } else {
        await finish("Buy Feature", {
          action: "Buy Feature",
          beforeUi: featureCapture.beforeUi,
          beforeBackend: featureCapture.beforeBackend,
          bet: featureCapture.bet,
          win: featureCapture.win,
          afterUi: featureCapture.afterUi,
          afterBackend: featureCapture.afterBackend,
          accepted: featureCapture.accepted,
          mode: featureCapture.popup ? "unchanged" : "either",
          checkpoints,
          api: featureCapture.api,
          request: featureCapture.request,
          response: featureCapture.response,
        }, featureCapture);
      }
    }

    await note("Buy Scratch", "RUNNING", "Buying one scratch card after Buy Feature.");
    await closeScratch(page, frame, scratch);
    let scratchPanel = await openScratch(page, frame, scratch);
    if (chosenBet != null) scratchPanel = await setScratchBet(scratch, chosenBet);
    const bought = await buyScratch(page, frame, scratch, wire, balancePlayer);
    await finish("Buy Scratch", {
      action: "Buy Scratch",
      beforeUi: bought.beforeUi,
      beforeBackend: bought.beforeBackend,
      bet: bought.bet ?? scratchPanel.bet,
      win: bought.win,
      afterUi: bought.afterUi,
      afterBackend: bought.afterBackend,
      accepted: bought.accepted,
      mode: bought.popup ? "unchanged" : "either",
      checkpoints: bought.checkpoints,
      api: bought.api,
      request: bought.request,
      response: bought.response,
    }, bought);

    const finalUi = (await frame.readState()).balance ?? bought.afterUi;
    const finalBackend = await readBackend(page, wire, balancePlayer, launched, bought.afterBackend);
    const finalCheckpoints: Checkpoint[] = [
      { point: "Before game start", ui: beforeUi, backend: beforeBackend, match: matchLabel(beforeUi, beforeBackend) },
      { point: "After Buy Feature", ui: featureCapture?.afterUi ?? null, backend: featureCapture?.afterBackend ?? null, match: matchLabel(featureCapture?.afterUi, featureCapture?.afterBackend) },
      { point: "After Buy Scratch", ui: bought.afterUi, backend: bought.afterBackend, match: matchLabel(bought.afterUi, bought.afterBackend) },
      { point: "Final balance", ui: finalUi, backend: finalBackend.balance, match: matchLabel(finalUi, finalBackend.balance) },
    ];
    await finish("Balance matches backend", {
      action: "Balance after Buy Feature and Buy Scratch",
      beforeUi,
      beforeBackend,
      bet: (featureCapture?.bet ?? 0) + (bought.bet ?? 0),
      win: (featureCapture?.win ?? 0) + (bought.win ?? 0),
      afterUi: finalUi,
      afterBackend: finalBackend.balance,
      accepted: (featureCapture?.accepted ?? 0) + bought.accepted,
      maxAccepted: 4,
      mode: "count",
      checkpoints: finalCheckpoints,
      api: finalBackend.source,
      request: `bet limit ${BET_LIMIT}; feature ${featureCapture?.request ?? "none"}; scratch ${bought.request}`,
      response: `feature ${featureCapture?.response ?? "none"}; scratch ${bought.response}`,
    });

    const failed = board.scenarios.filter((item) => item.status === "FAIL").map((item) => item.name);
    expect(failed, failed.join(", ")).toEqual([]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    board.blockRemaining(message);
    throw error;
  } finally {
    board.publish();
    await launcher.closeGame().catch(() => undefined);
  }
});
}
