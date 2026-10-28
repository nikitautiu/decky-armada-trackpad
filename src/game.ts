import { Router } from "@decky/ui";
import { gameReport, type ReportedGame, readReportedGame } from "./logic/reportedGame";

/**
 * Where {@link trackGame} reports the game: the running game, else the game whose library page is open; `appid` 0
 * means neither. Resolves once the backend took it in.
 */
export type ReportGame = (appid: number, name: string, running: boolean) => Promise<unknown>;

// Steam UI workaround: the app id and the name come from two Steam objects, and the name can arrive after the id, so
// both are polled; so is the main window's route, for the library page. They are plain property reads.
const POLL_MS = 250;

function mainRunningApp(): unknown {
  try {
    return Router.MainRunningApp;
  } catch {
    // Steam UI workaround: Router comes from a webpack lookup that can fail on another Steam build; the store still
    // gives the app id.
    return undefined;
  }
}

function readSteam(): ReportedGame | null {
  try {
    return readReportedGame(globalThis.SteamUIStore, mainRunningApp(), globalThis.appStore);
  } catch {
    // Steam UI workaround: a getter in Steam's stores threw: the tick counts as unreadable, which `gameReport` skips.
    return null;
  }
}

/**
 * Report the game, now and on every change, until the returned function is called.
 *
 * Reports go out one at a time; a report that fails is sent again on the next tick.
 */
export function trackGame(report: ReportGame): () => void {
  let reported: ReportedGame | null = null;
  let inFlight = false;
  let failing = false;
  const deliver = async (game: ReportedGame): Promise<void> => {
    try {
      await report(game.appid, game.name, game.running);
    } catch (error: unknown) {
      // Logged once per run of failures: the next tick retries every 250 ms.
      if (!failing) console.error("Touch Trackpad: a game report failed, retrying", error);
      failing = true;
      return;
    }
    failing = false;
    reported = game;
  };
  const poll = (): void => {
    // A tick during a delivery waits for the next one, which compares against what the delivery achieved.
    if (inFlight) return;
    const game = gameReport(reported, readSteam());
    if (game === null) return;
    inFlight = true;
    void deliver(game).finally(() => {
      inFlight = false;
    });
  };
  poll();
  const timer = setInterval(poll, POLL_MS);
  return () => clearInterval(timer);
}
