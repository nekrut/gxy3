#!/usr/bin/env node

import { main } from "@mariozechner/pi-coding-agent";
import { resolve, dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Suppress Pi's own update notifications
process.env.PI_SKIP_VERSION_CHECK = "1";

// Resolve extension path relative to this script
const extensionPath = resolve(__dirname, "../extensions/galaxy-analyst");

// pi-mcp-adapter teaches Pi how to use MCP servers from mcp.json
const require = createRequire(import.meta.url);
const mcpAdapterPath = dirname(require.resolve("pi-mcp-adapter/index.ts"));

const piEntryPointPath = fileURLToPath(import.meta.resolve("@mariozechner/pi-coding-agent"));
const piPackageDir = dirname(dirname(piEntryPointPath));
const piArgsModulePath = join(piPackageDir, "dist/cli/args.js");
const piListModelsModulePath = join(piPackageDir, "dist/cli/list-models.js");
const piConfigModulePath = join(piPackageDir, "dist/config.js");
const piAuthStorageModulePath = join(piPackageDir, "dist/core/auth-storage.js");
const piModelRegistryModulePath = join(piPackageDir, "dist/core/model-registry.js");

const userArgs = process.argv.slice(2);

function hasArg(flag) {
  return userArgs.includes(flag) || userArgs.some(arg => arg.startsWith(`${flag}=`));
}

// ─────────────────────────────────────────────────────────────────────────────
// Informational commands (--help, --version, --list-models)
// ─────────────────────────────────────────────────────────────────────────────

async function handleInformationalCommand() {
  if (hasArg("--help") || hasArg("-h")) {
    const { printHelp } = await import(pathToFileURL(piArgsModulePath).href);
    printHelp();
    return true;
  }
  if (hasArg("--version")) {
    const { VERSION } = await import(pathToFileURL(piConfigModulePath).href);
    console.log(VERSION);
    return true;
  }
  if (hasArg("--list-models")) {
    const { listModels } = await import(pathToFileURL(piListModelsModulePath).href);
    const { getModelsPath } = await import(pathToFileURL(piConfigModulePath).href);
    const { AuthStorage } = await import(pathToFileURL(piAuthStorageModulePath).href);
    const { ModelRegistry } = await import(pathToFileURL(piModelRegistryModulePath).href);
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = new ModelRegistry(authStorage, getModelsPath());
    const idx = userArgs.findIndex(a => a === "--list-models");
    const pattern = idx !== -1 && userArgs[idx + 1] && !userArgs[idx + 1].startsWith("-") ? userArgs[idx + 1] : undefined;
    await listModels(modelRegistry, pattern);
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config management (~/.gxy3/config.json)
// ─────────────────────────────────────────────────────────────────────────────

const gxy3ConfigDir = join(homedir(), ".gxy3");
const gxy3ConfigPath = join(gxy3ConfigDir, "config.json");

function loadConfig() {
  if (existsSync(gxy3ConfigPath)) {
    try {
      return JSON.parse(readFileSync(gxy3ConfigPath, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

const config = loadConfig();

// Provider name → env var mapping
const PROVIDER_ENV_MAP = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
};

// Set LLM API key from config if not already in env
if (config.llm?.apiKey) {
  const provider = config.llm.provider || "anthropic";
  const envVar = PROVIDER_ENV_MAP[provider] || "AI_GATEWAY_API_KEY";
  if (!process.env[envVar]) {
    process.env[envVar] = config.llm.apiKey;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensure Galaxy MCP is configured
// ─────────────────────────────────────────────────────────────────────────────

const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const mcpConfigPath = join(agentDir, "mcp.json");

const isInfoCmd = ["--help", "-h", "--version", "--list-models"].some(hasArg);

// ─────────────────────────────────────────────────────────────────────────────
// Legacy migration: pull ~/.gxypi/config.json into ~/.gxy3/ if it exists
// ─────────────────────────────────────────────────────────────────────────────

if (!isInfoCmd && !existsSync(gxy3ConfigPath)) {
  const legacyPath = join(homedir(), ".gxypi", "config.json");
  if (existsSync(legacyPath)) {
    try {
      const legacyConfig = JSON.parse(readFileSync(legacyPath, "utf-8"));
      mkdirSync(gxy3ConfigDir, { recursive: true });
      writeFileSync(gxy3ConfigPath, JSON.stringify(legacyConfig, null, 2) + "\n");
    } catch { /* ignore corrupt file */ }
  }
}

// Execution mode: "local" (default) skips Galaxy MCP entirely.
// "remote" registers Galaxy MCP server so the agent can use Galaxy tools.
const executionMode = config.executionMode || "local";

let mcpConfig = {};
if (!isInfoCmd) {
  if (existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
    } catch {
      mcpConfig = {};
    }
  }

  mcpConfig.mcpServers = mcpConfig.mcpServers || {};

  if (executionMode === "remote") {
    if (!mcpConfig.mcpServers.galaxy) {
      mcpConfig.mcpServers.galaxy = {
        command: "uvx",
        args: ["galaxy-mcp"],
      };
    }
    if (!mcpConfig.mcpServers.galaxy.directTools) {
      mcpConfig.mcpServers.galaxy.directTools = true;
    }

    // Apply Galaxy credentials from config
    if (config.galaxy?.active && config.galaxy.profiles) {
      const active = config.galaxy.profiles[config.galaxy.active];
      if (active) {
        if (!process.env.GALAXY_URL) process.env.GALAXY_URL = active.url;
        if (!process.env.GALAXY_API_KEY) process.env.GALAXY_API_KEY = active.apiKey;
        mcpConfig.mcpServers.galaxy.env = {
          GALAXY_URL: active.url,
          GALAXY_API_KEY: active.apiKey,
        };
      }
    }
  } else {
    // Local mode: ensure Galaxy MCP server is removed if it was previously registered
    delete mcpConfig.mcpServers.galaxy;
  }

  mkdirSync(dirname(mcpConfigPath), { recursive: true });
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Inject --provider / --model from config
// ─────────────────────────────────────────────────────────────────────────────

const providerArgs = [];
if (!hasArg("--provider") && config.llm?.provider) {
  providerArgs.push("--provider", config.llm.provider);
  if (config.llm.model && !hasArg("--model")) {
    providerArgs.push("--model", config.llm.model);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight: ensure at least one LLM provider is configured
// ─────────────────────────────────────────────────────────────────────────────

function checkLLMProvider() {
  const skipFlags = ["--version", "--help", "-h", "--api-key", "--list-models"];
  if (userArgs.some(a => skipFlags.some(f => a.startsWith(f)))) return;
  if (hasArg("--provider")) return;
  if (config.llm?.apiKey) return;

  const providerEnvVars = [
    "ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN",
    "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY",
    "MISTRAL_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY",
    "AI_GATEWAY_API_KEY",
  ];
  if (providerEnvVars.some(v => process.env[v])) return;

  console.error(`gxy3 requires an LLM provider to function.

Set up one of the following:

  1. Config file (recommended):
     Create ~/.gxy3/config.json:
     {
       "llm": {
         "provider": "anthropic",
         "apiKey": "sk-ant-..."
       }
     }

  2. Environment variable:
     export ANTHROPIC_API_KEY=sk-ant-...

  3. Use the Preferences dialog in the Electron app.
`);
  process.exit(1);
}

// Build args: inject extensions, pass through everything else
const args = ["-e", mcpAdapterPath, "-e", extensionPath, ...providerArgs, ...userArgs];

if (await handleInformationalCommand()) {
  process.exit(0);
}

checkLLMProvider();
main(args);
