#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PORT_KEYS = ["PORT", "WEB_PORT", "STORYBOOK_PORT", "PREVIEW_PORT", "E2E_PORT"];
const PORT_BASES = {
  PORT: 3100,
  WEB_PORT: 5273,
  STORYBOOK_PORT: 6106,
  PREVIEW_PORT: 4273,
  E2E_PORT: 3310,
};
const PORT_FLAG_KEYS = {
  "--port": "PORT",
  "--web-port": "WEB_PORT",
  "--storybook-port": "STORYBOOK_PORT",
  "--preview-port": "PREVIEW_PORT",
  "--e2e-port": "E2E_PORT",
};
const VALUE_FLAGS = new Set(["--path", "--branch", "--from", ...Object.keys(PORT_FLAG_KEYS)]);

const USAGE = `Usage: pnpm worktree:create <name> [options]

Creates a git worktree with a fresh .env whose ports cannot collide with the
ports already assigned to other worktrees.

Options:
  --path <dir>            Worktree directory (default: .worktrees/<name>)
  --branch <branch>       Branch to check out (default: <name>)
  --from <ref>            Commit or branch to create the worktree from
  --port <n>              HTTP/Colyseus server port
  --web-port <n>          Vite dev server port
  --storybook-port <n>    Storybook dev server port
  --preview-port <n>      Vite preview server port
  --e2e-port <n>          Playwright E2E server port
  --no-install            Skip pnpm install in the new worktree
  --help                  Show this help`;

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}

const options = {
  branch: undefined,
  from: undefined,
  install: true,
  path: undefined,
  ports: {},
};
const positional = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (VALUE_FLAGS.has(arg)) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`Missing value for ${arg}`);
      process.exit(1);
    }
    index += 1;
    const portKey = PORT_FLAG_KEYS[arg];
    if (portKey !== undefined) {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`${arg} must be a port from 1 to 65535, got ${value}`);
        process.exit(1);
      }
      options.ports[portKey] = port;
    } else if (arg === "--path") {
      options.path = value;
    } else if (arg === "--branch") {
      options.branch = value;
    } else if (arg === "--from") {
      options.from = value;
    }
  } else if (arg === "--no-install") {
    options.install = false;
  } else if (arg.startsWith("--")) {
    console.error(`Unknown option: ${arg}`);
    console.error(USAGE);
    process.exit(1);
  } else {
    positional.push(arg);
  }
}

if (positional.length !== 1) {
  console.error(USAGE);
  process.exit(1);
}

const name = positional[0];

function gitSucceeds(gitArgs) {
  return spawnSync("git", gitArgs, { cwd: repoRoot, stdio: "ignore" }).status === 0;
}

function runGit(gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(1);
  }
  return result.stdout.trim();
}

const branch = options.branch ?? name;
if (!gitSucceeds(["check-ref-format", `refs/heads/${branch}`])) {
  console.error(`Invalid branch name: ${branch}`);
  process.exit(1);
}

const worktreePath = options.path ?? path.resolve(repoRoot, ".worktrees", name);
if (path.resolve(worktreePath) === repoRoot) {
  console.error("The worktree path must be different from the current repository");
  process.exit(1);
}
if (existsSync(worktreePath)) {
  console.error(`Worktree path already exists: ${worktreePath}`);
  process.exit(1);
}

const branchExists = gitSucceeds(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
if (branchExists && options.branch === undefined) {
  console.error(`Branch ${branch} already exists; use --branch to attach an existing branch`);
  process.exit(1);
}
if (branchExists && options.from !== undefined) {
  console.error("Cannot combine --branch with an existing branch and --from");
  process.exit(1);
}

function worktreePaths() {
  const output = runGit(["worktree", "list", "--porcelain"]);
  return output
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("worktree ")))
    .filter((line) => line !== undefined)
    .map((line) => unescapePath(line.slice("worktree ".length)));
}

function unescapePath(raw) {
  // Porcelain output backslash-escapes tab, newline, backslash, and quote
  // characters in paths.
  return raw.replace(/\\(.)/g, (_match, char) => {
    if (char === "t") {
      return "\t";
    }
    if (char === "n") {
      return "\n";
    }
    return char;
  });
}

function readEnvValues(dir) {
  const envPath = path.join(dir, ".env");
  if (!existsSync(envPath)) {
    return {};
  }
  const values = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    if (equals === -1) {
      continue;
    }
    values[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
  }
  return values;
}

function allocatePorts() {
  const used = new Map(PORT_KEYS.map((key) => [key, new Set()]));
  for (const dir of worktreePaths()) {
    const values = readEnvValues(dir);
    for (const key of PORT_KEYS) {
      const raw = values[key];
      if (raw !== undefined && /^\d+$/.test(raw)) {
        used.get(key).add(Number(raw));
      }
    }
  }

  const ports = {};
  for (const key of PORT_KEYS) {
    if (options.ports[key] !== undefined) {
      ports[key] = options.ports[key];
      continue;
    }
    let candidate = PORT_BASES[key];
    while (used.get(key).has(candidate)) {
      candidate += 1;
    }
    ports[key] = candidate;
  }

  const assigned = Object.values(ports);
  if (new Set(assigned).size !== assigned.length) {
    console.error("Allocated ports must be distinct; override the colliding port");
    process.exit(1);
  }
  return ports;
}

function writeEnvFile(ports) {
  const template = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
  const values = {
    NODE_ENV: "development",
    PORT: String(ports.PORT),
    HOST: "0.0.0.0",
    WEB_PORT: String(ports.WEB_PORT),
    STORYBOOK_PORT: String(ports.STORYBOOK_PORT),
    PREVIEW_PORT: String(ports.PREVIEW_PORT),
    E2E_PORT: String(ports.E2E_PORT),
    COOKIE_SECRET: randomBytes(32).toString("hex"),
    PUBLIC_ORIGIN: `http://localhost:${ports.WEB_PORT}`,
    COLYSEUS_PATH: "/colyseus",
    LOBBY_MAX_CLIENTS: "8",
    E2E_TEST_MODE: "false",
    CAPITAL_PIN_TRANSITION_TIMEOUT_MS: "15000",
    LOG_LEVEL: "info",
    VITE_COLYSEUS_PATH: "/colyseus",
    VITE_MAP_STYLE_URL: "",
  };

  const seen = new Set();
  const lines = template.split("\n").map((line) => {
    const equals = line.indexOf("=");
    if (equals === -1) {
      return line;
    }
    const key = line.slice(0, equals).trim();
    if (!(key in values)) {
      return line;
    }
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }
  writeFileSync(path.join(worktreePath, ".env"), `${lines.join("\n").trimEnd()}\n`);
}

const addArgs = ["worktree", "add"];
if (!branchExists) {
  addArgs.push("-b", branch);
} else {
  addArgs.push(branch);
}
addArgs.push(worktreePath);
if (options.from !== undefined) {
  addArgs.push(options.from);
}

console.log(`Creating worktree ${worktreePath} on branch ${branch}...`);
runGit(addArgs);

const ports = allocatePorts();
writeEnvFile(ports);
console.log(`Wrote ${path.join(worktreePath, ".env")} with a generated COOKIE_SECRET.`);
console.log("");
console.log("Ports:");
console.log(`  HTTP/Colyseus: http://localhost:${ports.PORT}`);
console.log(`  Web dev:       http://localhost:${ports.WEB_PORT}`);
console.log(`  Storybook:     http://localhost:${ports.STORYBOOK_PORT}`);
console.log(`  Vite preview:  http://localhost:${ports.PREVIEW_PORT}`);
console.log(`  E2E:           http://127.0.0.1:${ports.E2E_PORT}`);
console.log("");

if (options.install) {
  console.log("Installing dependencies...");
  const install = spawnSync("pnpm", ["install"], { cwd: worktreePath, stdio: "inherit" });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
} else {
  console.log("Run pnpm install inside the worktree before starting it.");
}

console.log("");
console.log(`cd ${worktreePath}`);
console.log("pnpm dev");
