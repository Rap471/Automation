import { startAndOpenLive } from "./src/live/openLive";
import { clearPartials } from "./src/reporting/parallelReports";

export default async function globalSetup(): Promise<void> {
  clearPartials();
  await startAndOpenLive();
}
