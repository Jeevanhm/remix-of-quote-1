import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const children = [
  spawn(process.execPath, ["--env-file-if-exists=.env", resolve(projectRoot, "server", "index.js")], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(process.execPath, [resolve(projectRoot, "node_modules", "vite", "bin", "vite.js")], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  }),
];
let shuttingDown = false;

function stopChildren(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("Unable to start a development process:", error);
    stopChildren(1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) stopChildren(code ?? (signal ? 1 : 0));
  });
}

process.on("SIGINT", () => stopChildren(0));
process.on("SIGTERM", () => stopChildren(0));
