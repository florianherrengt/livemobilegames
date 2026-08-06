#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "../..");

// The Storybook CLI resolves its port before Vite loads the repository-root
// .env, so load it here first. A value already exported in the shell wins
// because process.loadEnvFile does not override existing variables.
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const rawPort = process.env.STORYBOOK_PORT ?? "6006";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid STORYBOOK_PORT: ${rawPort}`);
  process.exit(1);
}

// pnpm forwards its `--` argument separator to the script; Storybook's dev
// command takes no positional arguments, so drop separators.
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const portOptions = new Set(["-p", "--port"]);
const hasPortOption = args.some(
  (arg, index) =>
    portOptions.has(arg) ||
    arg.startsWith("--port=") ||
    (index > 0 && portOptions.has(args[index - 1])),
);
const hasExactPort = args.includes("--exact-port");

if (!hasPortOption) {
  args.unshift("--port", String(port));
}
if (!hasExactPort) {
  // Fail loudly when the configured port is taken; worktrees must not drift
  // onto a port owned by another worktree.
  args.push("--exact-port");
}

const binary = process.platform === "win32" ? "storybook.cmd" : "storybook";
const child = spawn(binary, ["dev", ...args], { stdio: "inherit" });

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
