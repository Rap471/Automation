# Game Launcher QA — 2 October 2026

Target: https://stg-asset-tools.dijoker.com/game-launcher
Test user: `qa-codex-20261002`; brand: `waw-eu`; USD; English; default scenario; throttle 100 ms.

All 37 catalog games were launched through the UI. All created a session. 32 reached a visible canvas; four displayed nginx 404 pages; Fruit Attack reached a canvas then displayed a loading failure. Canvas appearance is not a gameplay pass. See `game-results.csv` for each game.

## P1 — Four catalog games launch to HTTP 404 pages

Affected: Turbo Wrath (`00131125`), Rangda (`00210126`), Fang Shui Fortunes (`00230126`), Illegaliens (`00310126`).

Steps: enter a test user and brand, search for the affected game ID, click Play in modal.

Actual: the launcher reports Session created and opens Game Player, but the iframe displays `404 Not Found` and `nginx/1.31.1`. Expected: the selected game's loading/start screen, or an actionable unavailable-game message before launch.

This confirms an externally observable hosting/routing failure. Deployment configuration and backend source were not available, so the precise root cause is unverified. Observed game paths include `/rangda/`, `/fangshui/`, and `/illegaliens/` on stg-games.dijoker.com. Evidence: `turbo-wrath-404.jpg`.

## P1 — Fruit Attack cannot finish loading

Affected: Fruit Attack (`00190126`), served from `/fruit_attack/`.

Steps: search `00190126`, click Play in modal, allow the loading screen to complete.

Actual: `Game loading failed. Please try again later.` with a Reload button. Expected: the game's start screen. The game header also says `King in Gold`, inconsistent with the selected catalog game. Evidence: `fruit-attack-load-failure.jpg`. Root cause unverified; no spin was submitted.

## P2 — Desktop toolbar overlaps first-row game controls

Observed at the default approximately 1101 × 828 viewport. Search for Sugar Wonderland (`00010525`), then click its gift/free-spin button.

Actual: no grant dialog opens; the bet-limit field gains focus. The gift button occupies y=170–198 while the toolbar occupies the same area. Expected: the gift button opens the grant dialog. At 390 × 844 the dialog opens; it also opens at 1440 × 900, supporting a breakpoint-dependent overlap. Evidence: `toolbar-overlap-and-limit-mismatch.jpg` and `mobile-free-spin-dialog.jpg`.

## P2 — Bet-limit input loses the active limit when launcher remounts

Steps: set bet limit to 5, verify Remaining: 5, navigate to another tool and return to Game Launcher, enter the same user/brand.

Actual: input displays 100 while Remaining and the next Game Player modal still display 5. No spins were performed between these observations. Expected: the input reflects the active configured limit. Evidence: `toolbar-overlap-and-limit-mismatch.jpg`.

## P2 — Modal controls have poor contrast in light mode

Steps: use light mode and open History or Game Player.

Actual: modal headings and Close/Copy button text are very faint against their white backgrounds. Buttons are enabled despite looking disabled. Expected: readable enabled controls and headings. Evidence: `turbo-wrath-404.jpg`.

## P3 — Invalid bet limit gives no visible feedback

Steps: reset the active bet limit, enter -1 in Bet limit, click Set.

Actual: no visible error or state change. Expected: an explicit valid-range message. A negative wallet balance is rejected with HTTP 400, but only the generic `Failed to update balance (400).` is shown. These are validation-feedback findings, not evidence that the backend accepts invalid values.

## Successful checks

- Empty username produces `User name is required.`
- Exact game-ID, game-name, mixed-case name, game-type, and no-result searches.
- Slot filter returns 35 games; crash filter returns Clockwork Crash and Chick N Lane.
- Valid sandbox wallet update: 10,000 → 12,345.
- Bet-limit setting to 5 and reset; session extension produces `TTL extended`.
- Empty history displays No transactions for this player.
- Game modal close and live-history show/hide controls.
- Theme toggle in both directions; mobile free-spin form opens and cancels.

## Gameplay coverage (in progress)

20 games have received normal spin, scratch purchase/reveal, turbo, autoplay and default feature-purchase checks. 19 purchased bonuses reached completion, including observed credits and several reload recovery checks. Jungle Fruity's USD100 purchase debited 9991.60 to 9891.60, then remained on the scatter result with no bonus start for more than three minutes. Evidence: jungle-feature-stuck.jpg. Recovery/reproduction is pending; this is a suspected gameplay defect, not yet a confirmed backend root cause.

Detailed per-game records: gameplay-progress.json. All 37 games received launch checks (game-results.csv). Gameplay remains for Aztec Lost Empire, Titanic Transport, Amazonians, Necronomicoin, Gnome Mansland, Mad Freaks, Bad Beach, Joker Ace, Clockwork Crash, King in Gold, Sugar Pals and Chick N Lane. Five games are blocked by the launch errors above. Additional feature variants and every bet/locale/error scenario have not been exhaustively tested.

The in-app browser displayed an Aztec tab crash after several games were open. Its generated data-URL crash page is blocked by browser safety policy, including automated close. User has been asked to close the crashed tab so testing can resume. This browser failure is not classified as an Aztec game bug without reproduction in isolation.

No source code or server logs were available. Backend conclusions are limited to observable responses and balances. QA gameplay uses separate qa-codex-<gameID> players with fake staging credits. Competing-session invalidation, temporary animation frames, and suspected click-through payout issues were excluded from confirmed bugs.
