#!/usr/bin/env node

import { main } from "@mariozechner/pi-coding-agent";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Suppress Pi's own update notifications
process.env.PI_SKIP_VERSION_CHECK = "1";

// Resolve extension path relative to this script
const extensionPath = resolve(__dirname, "../extensions/gxy3");

// pi-mcp-adapter teaches Pi how to use MCP servers from mcp.json
const require = createRequire(import.meta.url);
const mcpAdapterPath = dirname(require.resolve("pi-mcp-adapter/index.ts"));

const userArgs = process.argv.slice(2);

function hasArg(flag) {
  return userArgs.includes(flag) || userArgs.some(arg => arg.startsWith(`${flag}=`));
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

// Build args: inject extensions, pass through everything else
const args = ["-e", mcpAdapterPath, "-e", extensionPath, ...providerArgs, ...userArgs];

main(args);
