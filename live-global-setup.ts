import { startAndOpenLive } from "./src/live/openLive";

export default async function globalSetup(): Promise<void> {
  await startAndOpenLive();
}
