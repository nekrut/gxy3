import { ChatPanel } from "./chat/chat-panel.js";
import { ArtifactPanel } from "./artifacts/artifact-panel.js";
import { StepGraph } from "./artifacts/step-graph.js";

declare global {
  interface Window {
    gxy3: import("../preload/preload.js").Gxy3API;
  }
}

// ── Components ────────────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages")!;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn")!;
const abortBtn = document.getElementById("abort-btn")!;
const statusBadge = document.getElementById("agent-status")!;

const cwdPathEl = document.getElementById("cwd-path")!;
const cwdChangeBtn = document.getElementById("cwd-change")!;
const usageTokensEl = document.getElementById("usage-tokens")!;
const usageCostEl = document.getElementById("usage-cost")!;

const chat = new ChatPanel(messagesEl);
const artifacts = new ArtifactPanel();
const stepGraph = new StepGraph(document.getElementById("tab-steps")!);

let streaming = false;

// ── Usage Tracking ────────────────────────────────────────────────────────────

// Per-1M-token pricing (USD). null = unknown → cost hidden.
// Update as providers change pricing or add models.
const PRICING: Record<string, { in: number; out: number; cacheRead?: number; cacheWrite?: number }> = {
  // Anthropic
  "claude-opus-4-6":      { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-5":      { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4-6":    { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5":    { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5":     { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // OpenAI
  "gpt-4o":               { in: 2.5, out: 10, cacheRead: 1.25 },
  "gpt-4o-mini":          { in: 0.15, out: 0.6, cacheRead: 0.075 },
  "gpt-4-turbo":          { in: 10, out: 30 },
  "o1":                   { in: 15, out: 60, cacheRead: 7.5 },
  "o1-mini":              { in: 3, out: 12, cacheRead: 1.5 },
  // Google
  "gemini-2.5-pro":       { in: 1.25, out: 10 },
  "gemini-2.5-flash":     { in: 0.15, out: 0.6 },
};

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const sessionUsage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const turnUsage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
let currentModel: string | null = null;

/** Match a model ID against the pricing table (handles date suffixes). */
function findPricing(model: string): { in: number; out: number; cacheRead?: number; cacheWrite?: number } | null {
  // Exact match first
  if (PRICING[model]) return PRICING[model];
  // Strip date suffix (e.g. claude-opus-4-6-20250514)
  const stripped = model.replace(/-\d{8}$/, "");
  if (PRICING[stripped]) return PRICING[stripped];
  // Prefix match
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function computeCost(u: Usage, model: string | null): number | null {
  if (!model) return null;
  const p = findPricing(model);
  if (!p) return null;
  const cost =
    (u.input * p.in) / 1_000_000 +
    (u.output * p.out) / 1_000_000 +
    (u.cacheRead * (p.cacheRead ?? p.in)) / 1_000_000 +
    (u.cacheWrite * (p.cacheWrite ?? p.in)) / 1_000_000;
  return cost;
}

function renderUsage(): void {
  const total = sessionUsage.input + sessionUsage.output + sessionUsage.cacheRead + sessionUsage.cacheWrite;
  usageTokensEl.textContent = `${formatTokens(total)} tok`;
  usageTokensEl.title =
    `Session usage:\n` +
    `  input: ${sessionUsage.input.toLocaleString()}\n` +
    `  output: ${sessionUsage.output.toLocaleString()}\n` +
    `  cache read: ${sessionUsage.cacheRead.toLocaleString()}\n` +
    `  cache write: ${sessionUsage.cacheWrite.toLocaleString()}` +
    (currentModel ? `\nmodel: ${currentModel}` : "");

  const cost = computeCost(sessionUsage, currentModel);
  if (cost !== null) {
    usageCostEl.textContent = cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
    usageCostEl.classList.remove("hidden");
  } else {
    usageCostEl.textContent = "";
    usageCostEl.classList.add("hidden");
  }
}

function captureUsage(event: Record<string, unknown>): void {
  // message_start carries model info; message updates carry rolling usage
  const msg = event.message as Record<string, unknown> | undefined;
  if (!msg) return;

  if (msg.model && typeof msg.model === "string") {
    currentModel = msg.model;
  }

  const u = msg.usage as Partial<Usage> | undefined;
  if (!u) return;

  // turnUsage tracks the in-progress turn's cumulative values
  turnUsage.input = u.input ?? turnUsage.input;
  turnUsage.output = u.output ?? turnUsage.output;
  turnUsage.cacheRead = u.cacheRead ?? turnUsage.cacheRead;
  turnUsage.cacheWrite = u.cacheWrite ?? turnUsage.cacheWrite;
}

function commitTurnUsage(): void {
  sessionUsage.input += turnUsage.input;
  sessionUsage.output += turnUsage.output;
  sessionUsage.cacheRead += turnUsage.cacheRead;
  sessionUsage.cacheWrite += turnUsage.cacheWrite;
  turnUsage.input = 0;
  turnUsage.output = 0;
  turnUsage.cacheRead = 0;
  turnUsage.cacheWrite = 0;
  renderUsage();
}

renderUsage();

// ── CWD Display ──────────────────────────────────────────────────────────────

async function refreshCwd(): Promise<void> {
  try {
    const cwd = await window.gxy3.getCwd();
    cwdPathEl.textContent = cwd;
    cwdPathEl.title = cwd;
  } catch { /* getCwd not available yet */ }
}

function applyCwdChange(dir: string): void {
  cwdPathEl.textContent = dir;
  cwdPathEl.title = dir;
  window.gxy3.prompt(`[system] Analysis directory changed to: ${dir}`);
}

cwdChangeBtn.addEventListener("click", async () => {
  const dir = await window.gxy3.selectDirectory();
  if (dir) applyCwdChange(dir);
});

// File > Open Analysis Directory menu triggers this
window.gxy3.onCwdChanged((dir) => {
  applyCwdChange(dir);
});

refreshCwd();

// ── Chat Input ────────────────────────────────────────────────────────────────

function submit(): void {
  const text = inputEl.value.trim();
  if (!text || streaming) return;

  chat.addUserMessage(text);
  chat.showThinking();
  statusBadge.textContent = "thinking...";
  statusBadge.className = "status-badge thinking";
  window.gxy3.prompt(text);
  inputEl.value = "";
  inputEl.style.height = "auto";
}

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
});

sendBtn.addEventListener("click", submit);

abortBtn.addEventListener("click", () => {
  window.gxy3.abort();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && streaming) {
    window.gxy3.abort();
  }
});

// ── Agent Events ──────────────────────────────────────────────────────────────

window.gxy3.onAgentEvent((event) => {
  const type = event.type as string;
  console.log("[gxy3-ui] event:", type, JSON.stringify(event).slice(0, 150));

  // Capture usage from any event that carries a message with usage
  if (type === "message_start" || type === "message_update" || type === "message_end" || type === "turn_end") {
    captureUsage(event as Record<string, unknown>);
  }

  switch (type) {
    case "agent_start":
      streaming = true;
      sendBtn.classList.add("hidden");
      abortBtn.classList.remove("hidden");
      // Don't hide thinking yet — wait for actual text content
      break;

    case "message_update": {
      // Pi.dev wraps events in assistantMessageEvent
      const ame = (event as { assistantMessageEvent?: Record<string, unknown> }).assistantMessageEvent;
      if (!ame) break;

      const ameType = ame.type as string;

      if (ameType === "text_start") {
        chat.hideThinking();
        statusBadge.textContent = "responding...";
        statusBadge.className = "status-badge running";
        if (!streaming) {
          streaming = true;
          sendBtn.classList.add("hidden");
          abortBtn.classList.remove("hidden");
        }
        // Only start a new message if there isn't one active
        if (!chat.hasActiveMessage()) {
          chat.startAssistantMessage();
        }
      } else if (ameType === "text_delta") {
        chat.hideThinking();
        if (!streaming) {
          streaming = true;
          sendBtn.classList.add("hidden");
          abortBtn.classList.remove("hidden");
        }
        if (!chat.hasActiveMessage()) {
          chat.startAssistantMessage();
        }
        const delta = ame.delta as string;
        if (delta) chat.appendDelta(delta);
      } else if (ameType === "text_end") {
        // text block finished, but agent turn might continue
      }
      break;
    }

    case "message_end": {
      // Commit per-assistant-message usage to the session total
      // Each assistant message = one LLM call billed separately
      const msg = (event as { message?: { role?: string } }).message;
      if (msg?.role === "assistant") {
        commitTurnUsage();
      }
      break;
    }

    case "turn_end":
      // Turn might not be fully done until agent_end
      break;

    case "tool_start": {
      chat.hideThinking();
      const name = (event as { tool?: string }).tool || "tool";
      const id = (event as { id?: string }).id || name;
      chat.addToolCard(id, name);
      statusBadge.textContent = `running: ${name}`;
      statusBadge.className = "status-badge running";
      break;
    }

    case "tool_end": {
      const id = (event as { id?: string }).id || "";
      const result = (event as { result?: string }).result;
      const error = (event as { error?: string }).error;
      chat.updateToolCard(id, error ? "error" : "done", result || error);
      break;
    }

    case "agent_end":
      chat.hideThinking();
      streaming = false;
      statusBadge.textContent = "Ready";
      statusBadge.className = "status-badge";
      sendBtn.classList.remove("hidden");
      abortBtn.classList.add("hidden");
      chat.finishAssistantMessage();
      break;

    case "error": {
      const msg = (event as { message?: string }).message || "Unknown error";
      chat.hideThinking();
      chat.addErrorMessage(msg);
      streaming = false;
      statusBadge.textContent = "error";
      statusBadge.className = "status-badge error";
      sendBtn.classList.remove("hidden");
      abortBtn.classList.add("hidden");
      break;
    }
  }
});

// ── UI Requests (from extension via Pi.dev) ──────────────────────────────────

window.gxy3.onUiRequest((request) => {
  const method = request.method;

  if (method === "setWidget") {
    const key = request.widgetKey as string;
    const lines = request.widgetLines as string[] | undefined;

    if (key === "plan" && lines) {
      artifacts.setPlanText(lines.join("\n"));
      // Auto-switch to plan tab
      switchTab("plan");
    }

    if (key === "steps" && lines) {
      try {
        const steps = JSON.parse(lines[0]);
        stepGraph.render(steps);
        if (steps.some((s: { status: string }) => s.status === "in_progress")) {
          switchTab("steps");
        }
      } catch { /* ignore parse errors */ }
    }

    if (key === "results" && lines) {
      try {
        const block = JSON.parse(lines[0]);
        artifacts.addResultBlock(block);
        switchTab("results");
      } catch { /* ignore parse errors */ }
    }
  }
});

function switchTab(name: string): void {
  tabs.forEach((t) => t.classList.remove("active"));
  panels.forEach((p) => p.classList.remove("active"));
  document.querySelector(`[data-tab="${name}"]`)?.classList.add("active");
  document.getElementById(`tab-${name}`)?.classList.add("active");
}

// ── Agent Status ──────────────────────────────────────────────────────────────

window.gxy3.onAgentStatus((status, msg) => {
  statusBadge.textContent = msg || status;
  statusBadge.className = "status-badge " + status;
});

// ── Draggable Divider ─────────────────────────────────────────────────────────

const divider = document.getElementById("divider")!;
const chatPane = document.getElementById("chat-pane")!;

let dragging = false;

divider.addEventListener("mousedown", (e) => {
  e.preventDefault();
  dragging = true;
  divider.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const appWidth = document.getElementById("app")!.clientWidth;
  const pct = (e.clientX / appWidth) * 100;
  const clamped = Math.max(25, Math.min(75, pct));
  chatPane.style.flex = `0 0 ${clamped}%`;
});

document.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove("dragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

// ── Artifact Tabs ─────────────────────────────────────────────────────────────

const tabs = document.querySelectorAll<HTMLButtonElement>("#artifact-tabs .tab");
const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${target}`)?.classList.add("active");
  });
});

// ── Plan Actions ──────────────────────────────────────────────────────────────

const executePlanBtn = document.getElementById("execute-plan-btn")!;

executePlanBtn.addEventListener("click", () => {
  const text = artifacts.getPlanText();
  if (!text) return;

  artifacts.clearResults();
  chat.addUserMessage("Execute the plan");

  // Send the current plan content (may have been edited in raw mode) + execute command
  window.gxy3.prompt(
    `The user has approved the following plan and wants you to execute it step by step. ` +
    `Report progress as you go.\n\nPlan:\n${text}`
  );
});

// ── Preferences ──────────────────────────────────────────────────────────────

const prefsOverlay = document.getElementById("prefs-overlay")!;
const prefsClose = document.getElementById("prefs-close")!;
const prefsCancel = document.getElementById("prefs-cancel")!;
const prefsSave = document.getElementById("prefs-save")!;
const prefsBrowseCwd = document.getElementById("prefs-browse-cwd")!;

const prefsProvider = document.getElementById("prefs-provider") as HTMLSelectElement;
const prefsModel = document.getElementById("prefs-model") as HTMLInputElement;
const prefsApiKey = document.getElementById("prefs-api-key") as HTMLInputElement;
const prefsGalaxyUrl = document.getElementById("prefs-galaxy-url") as HTMLInputElement;
const prefsGalaxyKey = document.getElementById("prefs-galaxy-key") as HTMLInputElement;
const prefsDefaultCwd = document.getElementById("prefs-default-cwd") as HTMLInputElement;
const prefsCondaBin = document.getElementById("prefs-conda-bin") as HTMLSelectElement;

async function openPreferences(): Promise<void> {
  const config = await window.gxy3.getConfig() as {
    llm?: { provider?: string; apiKey?: string; model?: string };
    galaxy?: { active: string | null; profiles: Record<string, { url: string; apiKey: string }> };
    defaultCwd?: string;
    condaBin?: string;
  };

  prefsProvider.value = config.llm?.provider || "anthropic";
  prefsModel.value = config.llm?.model || "";
  prefsApiKey.value = config.llm?.apiKey || "";

  // Galaxy: use active profile
  const activeProfile = config.galaxy?.active
    ? config.galaxy.profiles?.[config.galaxy.active]
    : null;
  prefsGalaxyUrl.value = activeProfile?.url || "";
  prefsGalaxyKey.value = activeProfile?.apiKey || "";

  prefsDefaultCwd.value = config.defaultCwd || "";
  prefsCondaBin.value = config.condaBin || "auto";

  prefsOverlay.classList.remove("hidden");
}

function closePreferences(): void {
  prefsOverlay.classList.add("hidden");
}

async function savePreferences(): Promise<void> {
  // Preserve existing config (galaxy profiles) and merge
  const current = await window.gxy3.getConfig() as {
    llm?: { provider?: string; apiKey?: string; model?: string };
    galaxy?: { active: string | null; profiles: Record<string, { url: string; apiKey: string }> };
    defaultCwd?: string;
    condaBin?: string;
  };

  const config: typeof current = { ...current };

  config.llm = {
    provider: prefsProvider.value,
    model: prefsModel.value.trim() || undefined,
    apiKey: prefsApiKey.value.trim() || undefined,
  };

  // Galaxy: save as "default" profile
  if (prefsGalaxyUrl.value.trim() || prefsGalaxyKey.value.trim()) {
    config.galaxy = {
      active: "default",
      profiles: {
        ...(current.galaxy?.profiles || {}),
        default: {
          url: prefsGalaxyUrl.value.trim(),
          apiKey: prefsGalaxyKey.value.trim(),
        },
      },
    };
  } else {
    delete config.galaxy;
  }

  config.defaultCwd = prefsDefaultCwd.value.trim() || undefined;
  config.condaBin = (prefsCondaBin.value as "auto" | "mamba" | "conda") || undefined;

  const result = await window.gxy3.saveConfig(config as Record<string, unknown>);
  if (result.success) {
    closePreferences();
    chat.addUserMessage("[system] Preferences saved. Agent restarted.");
  } else {
    alert(`Failed to save preferences: ${result.error}`);
  }
}

prefsClose.addEventListener("click", closePreferences);
prefsCancel.addEventListener("click", closePreferences);
prefsSave.addEventListener("click", savePreferences);
prefsOverlay.addEventListener("click", (e) => {
  if (e.target === prefsOverlay) closePreferences();
});

prefsBrowseCwd.addEventListener("click", async () => {
  const dir = await window.gxy3.browseDirectory();
  if (dir) prefsDefaultCwd.value = dir;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !prefsOverlay.classList.contains("hidden")) {
    closePreferences();
  }
});

window.gxy3.onOpenPreferences(() => {
  openPreferences();
});

// ── Focus input on load ───────────────────────────────────────────────────────
inputEl.focus();
