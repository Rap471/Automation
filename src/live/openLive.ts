import { spawn } from "node:child_process";
import net from "node:net";

export const liveUrl = "http://127.0.0.1:4317/";

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

export async function startAndOpenLive(pathname = "/"): Promise<void> {
  if (!(await portOpen(4317))) {
    const child = spawn(process.execPath, ["src/live/server.mjs"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && !(await portOpen(4317))) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const opened = await portOpen(4317);
  if (!opened) {
    console.log(`Live page did not start. Run npm run live, then open ${liveUrl}`);
    return;
  }
  const target = new URL(pathname, liveUrl).toString();
  console.log(`Live QA Center ${target}`);
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [target], { detached: true, stdio: "ignore" }).unref();
}
