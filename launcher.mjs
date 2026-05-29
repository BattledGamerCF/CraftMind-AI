#!/usr/bin/env node
/**
 * Mindcraft Launcher
 *
 * Starts the API server and dashboard, waits until both are healthy,
 * then opens the dashboard in the default browser.
 *
 * Usage:
 *   node launcher.mjs           — dev mode (Vite + ts-node)
 *   node launcher.mjs --prod    — production mode (build first, then serve)
 *
 * Environment overrides:
 *   API_PORT=8080    (default)
 *   DASH_PORT=3000   (default)
 */

import { spawn, exec } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { existsSync, copyFileSync } from "node:fs";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.argv.includes("--prod");
const API_PORT = parseInt(process.env.API_PORT ?? "8080");
const DASH_PORT = parseInt(process.env.DASH_PORT ?? "3000");

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const R = "\x1b[0m";
const bold = (s) => `\x1b[1m${s}${R}`;
const green = (s) => `\x1b[32m${s}${R}`;
const yellow = (s) => `\x1b[33m${s}${R}`;
const red = (s) => `\x1b[31m${s}${R}`;
const cyan = (s) => `\x1b[36m${s}${R}`;
const magenta = (s) => `\x1b[35m${s}${R}`;
const dim = (s) => `\x1b[2m${s}${R}`;

function ok(msg) { console.log(` ${green("✓")} ${msg}`); }
function warn(msg) { console.log(` ${yellow("!")} ${msg}`); }
function fail(msg) { console.log(` ${red("✗")} ${msg}`); }
function info(msg) { console.log(` ${cyan("›")} ${msg}`); }

function banner() {
  console.log(`
${bold("  ⛏  Mindcraft")}  ${dim("AI Companion for Minecraft")}
${dim("─".repeat(44))}
`);
}

// ── Pre-flight checks ─────────────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.version.slice(1));
  if (major < 18) {
    fail(`Node.js 18 or higher is required. You have ${process.version}.`);
    fail("Download the latest LTS from https://nodejs.org");
    process.exit(1);
  }
  ok(`Node.js ${process.version}`);
}

function checkDeps() {
  const nm = join(__dir, "node_modules");
  if (!existsSync(nm)) {
    fail("Dependencies are not installed yet.");
    info('Run this first:  pnpm install');
    info("(If you don't have pnpm: npm install -g pnpm)");
    process.exit(1);
  }
  ok("Dependencies installed");
}

function ensureEnv() {
  const envPath = join(__dir, ".env");
  const exPath = join(__dir, ".env.example");
  if (!existsSync(envPath) && existsSync(exPath)) {
    copyFileSync(exPath, envPath);
    warn(".env file created from .env.example");
    warn("  Edit it to add your API keys (OpenAI, Anthropic) if needed.");
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => { s.close(); resolve(true); });
    s.listen(port, "127.0.0.1");
  });
}

async function checkPorts() {
  const [apiFree, dashFree] = await Promise.all([
    isPortFree(API_PORT),
    isPortFree(DASH_PORT),
  ]);
  let ok_ = true;
  if (!apiFree) {
    fail(`Port ${API_PORT} is already in use.`);
    info(`  Another program is using port ${API_PORT}. Stop it, or set API_PORT=<other> before running the launcher.`);
    ok_ = false;
  }
  if (!dashFree) {
    fail(`Port ${DASH_PORT} is already in use.`);
    info(`  Another program is using port ${DASH_PORT}. Stop it, or set DASH_PORT=<other> before running the launcher.`);
    ok_ = false;
  }
  if (!ok_) process.exit(1);
  ok(`Ports ${API_PORT} (API) and ${DASH_PORT} (dashboard) are available`);
}

// ── Process management ────────────────────────────────────────────────────────

const children = [];

function spawnProcess(label, color, cmd, args, env) {
  const prefix = color(`[${label}]`);
  const proc = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    cwd: __dir,
  });

  proc.stdout.on("data", (d) => {
    d.toString().split("\n").filter(Boolean).forEach((line) => {
      process.stdout.write(`${prefix} ${line}\n`);
    });
  });
  proc.stderr.on("data", (d) => {
    d.toString().split("\n").filter(Boolean).forEach((line) => {
      process.stderr.write(`${prefix} ${line}\n`);
    });
  });
  proc.on("exit", (code) => {
    if (code !== null && code !== 0 && code !== null) {
      fail(`${label} process exited unexpectedly (code ${code})`);
    }
  });

  children.push(proc);
  return proc;
}

function shutdownAll() {
  console.log();
  info("Shutting down Mindcraft…");
  for (const p of children) {
    try { p.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => {
    info("Goodbye.");
    process.exit(0);
  }, 1500);
}

// ── Health checks ─────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function waitForService(url, name, maxMs = 90_000) {
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < maxMs) {
    try {
      const code = await httpGet(url);
      if (code > 0 && code < 500) return true;
    } catch { /* not ready yet */ }
    if (attempts % 6 === 0) {
      process.stdout.write(`\r   ${cyan("›")} Waiting for ${name}…   `);
    }
    attempts++;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

// ── Browser ───────────────────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) info(`Open your browser and go to: ${bold(url)}`);
  });
}

// ── Build step (production mode) ──────────────────────────────────────────────

function buildProject() {
  return new Promise((resolve, reject) => {
    console.log();
    info("Building for production…");
    const proc = spawn(
      "pnpm",
      ["--filter", "@workspace/api-server", "--filter", "@workspace/dashboard", "run", "build"],
      { stdio: "inherit", shell: process.platform === "win32", cwd: __dir }
    );
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed with exit code ${code}`));
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  console.log(bold("Checking requirements…"));
  checkNodeVersion();
  checkDeps();
  ensureEnv();
  await checkPorts();
  console.log();

  if (IS_PROD) {
    await buildProject().catch((e) => { fail(e.message); process.exit(1); });
  }

  console.log(bold("Starting services…"));

  if (IS_PROD) {
    spawnProcess(
      "API", cyan,
      "node",
      ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
      { PORT: String(API_PORT), NODE_ENV: "production" }
    );
    spawnProcess(
      "UI", magenta,
      "pnpm",
      ["exec", "serve", "-s", "artifacts/dashboard/dist/public", "-l", String(DASH_PORT)],
      {}
    );
  } else {
    spawnProcess(
      "API", cyan,
      "pnpm",
      ["--filter", "@workspace/api-server", "run", "dev"],
      { PORT: String(API_PORT) }
    );
    spawnProcess(
      "UI", magenta,
      "pnpm",
      ["--filter", "@workspace/dashboard", "run", "dev"],
      {
        PORT: String(DASH_PORT),
        BASE_PATH: "/",
        VITE_API_BASE: `http://localhost:${API_PORT}/api`,
      }
    );
  }

  console.log();
  console.log(bold("Waiting for services to start…"));

  const apiOk = await waitForService(
    `http://localhost:${API_PORT}/api/healthz`,
    "API server"
  );
  process.stdout.write("\n");
  if (!apiOk) {
    fail("API server did not become ready within 90 seconds.");
    fail("Check the [API] output above for errors.");
    shutdownAll();
    return;
  }
  ok("API server is ready");

  const dashUrl = `http://localhost:${DASH_PORT}/`;
  const dashOk = await waitForService(dashUrl, "dashboard");
  process.stdout.write("\n");
  if (!dashOk) {
    fail("Dashboard did not become ready within 90 seconds.");
    fail("Check the [UI] output above for errors.");
    shutdownAll();
    return;
  }
  ok("Dashboard is ready");

  console.log();
  console.log(`${green("✓")} ${bold("Mindcraft is running!")}`);
  console.log(`  ${dim("Dashboard:")} ${bold(dashUrl)}`);
  console.log(`  ${dim("API:")}       ${bold(`http://localhost:${API_PORT}/api`)}`);
  console.log();
  console.log(dim("  Press Ctrl+C to stop all services"));
  console.log();

  openBrowser(dashUrl);

  process.on("SIGINT", shutdownAll);
  process.on("SIGTERM", shutdownAll);
}

main().catch((e) => {
  fail(e.message ?? String(e));
  process.exit(1);
});
