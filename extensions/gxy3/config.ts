import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
  defaultCwd?: string;
  condaBin?: "mamba" | "conda" | "auto";
}

function getConfigPath(): string {
  return path.join(os.homedir(), ".gxy3", "config.json");
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
  const dir = path.dirname(getConfigPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}
