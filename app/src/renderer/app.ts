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

const chat = new ChatPanel(messagesEl);
const artifacts = new ArtifactPanel();
const stepGraph = new StepGraph(document.getElementById("tab-steps")!);

let streaming = false;

// ── CWD Display ──────────────────────────────────────────────────────────────

async function refreshCwd(): Promise<void> {
  try {
    const cwd = await window.gxy3.getCwd();
    cwdPathEl.textContent = cwd;
    cwdPathEl.title = cwd;
  } catch { /* getCwd not available yet */ }
}

cwdChangeBtn.addEventListener("click", async () => {
  const dir = await window.gxy3.selectDirectory();
  if (dir) {
    cwdPathEl.textContent = dir;
    cwdPathEl.title = dir;
    window.gxy3.prompt(`[system] Analysis directory changed to: ${dir}`);
  }
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
        chat.startAssistantMessage();
      } else if (ameType === "text_delta") {
        chat.hideThinking();
        if (!streaming) {
          streaming = true;
          sendBtn.classList.add("hidden");
          abortBtn.classList.remove("hidden");
          chat.startAssistantMessage();
        }
        const delta = ame.delta as string;
        if (delta) chat.appendDelta(delta);
      } else if (ameType === "text_end") {
        // text block finished, but agent turn might continue
      }
      break;
    }

    case "message_end":
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

// ── Focus input on load ───────────────────────────────────────────────────────
inputEl.focus();
