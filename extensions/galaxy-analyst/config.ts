/**
 * Consolidated config file for gxy3 (~/.gxy3/config.json)
 *
 * Single source of truth for user-facing configuration: Galaxy server
 * profiles and LLM provider settings. Both sections are optional —
 * missing keys fall back to env vars / legacy files.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Gxy3Config {
  llm?: {
    provider?: string;
    apiKey?: string;
    model?: string;
  };
  galaxy?: {
    active: string | null;
    profiles: Record<string, { url: string; apiKey: string }>;
  };
  /** "local" = no Galaxy MCP server. "remote" = Galaxy MCP available. Default: "local". */
  executionMode?: "local" | "remote";
}

export function getConfigDir(): string {
  return path.join(os.homedir(), ".gxy3");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function loadConfig(): Gxy3Config {
  const p = getConfigPath();
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

export function saveConfig(config: Gxy3Config): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}
