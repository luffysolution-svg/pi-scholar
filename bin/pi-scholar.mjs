#!/usr/bin/env node
// Zero-dependency diagnostic CLI, runnable via `npx pi-scholar` or `npx @<scope>/pi-scholar`
// without installing Pi or any dev dependency. It never talks to Zotero/MinerU except a
// bounded read-only reachability probe, and never installs or configures the Pi extension
// itself -- that step is always `pi install npm:<package name>` inside Pi.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-")) ?? "doctor";

function readPackageJson() {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return {};
  }
}
const PKG = readPackageJson();
const PKG_NAME = PKG.name ?? "pi-scholar";
function readPackageVersion() {
  return PKG.version ?? "unknown";
}

function printHelp() {
  console.log(`pi-scholar ${readPackageVersion()} -- setup/diagnostic helper (not the Pi extension itself)

Usage:
  npx pi-scholar doctor      Check Node, config, Zotero, MinerU, and Ai4Scholar (default)
  npx pi-scholar --version   Print the package version
  npx pi-scholar --help      Show this message

This package is a Pi extension. It only runs inside Pi once installed with:
  pi install npm:${PKG_NAME}
This CLI is a standalone helper for verifying your environment before/after that step.`);
}

function nodeVersionOk() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

// Mirrors src/config.ts's discovery order without importing TypeScript sources, so this
// diagnostic runs on plain Node. Keep in sync with discoverConfigPath() in src/config.ts.
function discoverConfigPath(env, cwd, home) {
  if (env.PI_SCHOLAR_CONFIG) {
    const explicit = path.resolve(cwd, env.PI_SCHOLAR_CONFIG);
    return { path: existsSync(explicit) ? explicit : null, source: "PI_SCHOLAR_CONFIG" };
  }
  let current = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(current, "pi-scholar.config.json");
    if (existsSync(candidate)) return { path: candidate, source: "project" };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const candidate of [path.join(env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"), "pi-scholar.json"), path.join(home, ".config", "pi-scholar", "config.json"), path.join(home, ".pi-scholar.json")]) {
    if (existsSync(candidate)) return { path: candidate, source: "user" };
  }
  return { path: null, source: null };
}

async function probeZotero(baseUrl, timeoutMs = 2000) {
  try {
    const response = await fetch(`${baseUrl}/users/0/collections?limit=1`, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 403) return { ok: false, detail: "reachable, but Local API communication is disabled in Zotero settings" };
    if (!response.ok) return { ok: false, detail: `unexpected HTTP ${response.status}` };
    return { ok: true, detail: `reachable (Zotero-API-Version ${response.headers.get("zotero-api-version") ?? "unknown"})` };
  } catch (error) {
    return { ok: false, detail: `unreachable (${error instanceof Error ? error.message : String(error)})` };
  }
}

function readJsonSafely(file) {
  try {
    if (statSync(file).size > 64 * 1024) return { error: "exceeds 64 KB" };
    return { value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function doctor() {
  console.log(`pi-scholar doctor (helper v${readPackageVersion()})\n`);

  console.log(`Node.js: ${process.versions.node} ${nodeVersionOk() ? "(OK, >=22.19)" : "(TOO OLD, requires >=22.19)"}`);
  console.log(`Platform: ${process.platform} ${os.arch()}`);

  const home = process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
  const { path: configPath, source } = discoverConfigPath(process.env, process.cwd(), home);
  let scholarConfig = {};
  if (configPath) {
    console.log(`Config file: ${configPath} (source: ${source})`);
    const parsed = readJsonSafely(configPath);
    if (parsed.error) console.log(`  Could not read config: ${parsed.error}`);
    else {
      scholarConfig = parsed.value ?? {};
      console.log(`  Sections present: ${Object.keys(scholarConfig).join(", ") || "(none)"}`);
    }
  } else {
    console.log("Config file: none found (using built-in defaults; see pi-scholar.config.example.json)");
  }

  const baseUrl = process.env.ZOTERO_BASE_URL ?? "http://127.0.0.1:23119/api";
  console.log(`Zotero base URL: ${baseUrl}`);
  const zotero = await probeZotero(baseUrl);
  console.log(`  ${zotero.ok ? "OK" : "FAILED"}: ${zotero.detail}`);

  const tokenEnv = scholarConfig?.mineru?.apiKeyEnv ?? "MINERU_API_TOKEN";
  const hasToken = Boolean(scholarConfig?.mineru?.apiKey ?? process.env[tokenEnv] ?? process.env.MINERU_API_TOKEN);
  console.log(`MinerU token (${tokenEnv}): ${hasToken ? "set" : "not set (MinerU parsing will be unavailable)"}`);

  const ai4Env = scholarConfig?.ai4scholar?.apiKeyEnv ?? "AI4SCHOLAR_API_KEY";
  const hasAi4Token = Boolean(scholarConfig?.ai4scholar?.apiKey || process.env[ai4Env] || process.env.AI4SCHOLAR_API_KEY);
  console.log(`Ai4Scholar token (${ai4Env}): ${hasAi4Token ? "set" : "not set (use ai4scholar.apiKey/apiKeyEnv or AI4SCHOLAR_API_KEY)"}`);

  const configuredSources = [];
  for (const [id, provider] of Object.entries(scholarConfig?.research?.providers ?? {})) {
    const envName = provider?.apiKeyEnv;
    if (provider?.enabled) configuredSources.push(`${id}:${provider.apiKey || (envName && process.env[envName]) ? "key set" : "enabled"}`);
  }
  for (const [id, provider] of Object.entries(scholarConfig?.data?.providers ?? {})) {
    const envName = provider?.apiKeyEnv;
    if (provider?.enabled) configuredSources.push(`${id}:${provider.apiKey || (envName && process.env[envName]) ? "key set" : "enabled"}`);
  }
  console.log(`Research/data sources: ${configuredSources.join(", ") || "none explicitly enabled"}`);

  console.log(`\nNext steps:`);
  console.log(`  1. In Zotero: Settings > Advanced > enable "Allow other applications to communicate with Zotero".`);
  console.log(`  2. In Pi: pi install npm:${PKG_NAME}   (or the exact scoped/pinned name from the README)`);
  console.log(`  3. Restart Pi or run /reload, then try /pi-scholar.`);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log(readPackageVersion());
} else if (args.includes("--help") || args.includes("-h")) {
  printHelp();
} else if (command === "doctor") {
  await doctor();
} else {
  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exitCode = 1;
}
