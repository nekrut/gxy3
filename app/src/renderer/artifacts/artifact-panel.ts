/**
 * ArtifactPanel manages the right pane: Plan, Steps, Results tabs.
 *
 * Plan has two modes:
 * - Rendered: markdown rendered as HTML (read-only, default)
 * - Raw: editable textarea for direct editing
 */

import { marked } from "marked";

export interface PlanStep {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  description?: string;
}

export class ArtifactPanel {
  private planEl: HTMLElement;
  private stepsEl: HTMLElement;
  private resultsEl: HTMLElement;

  private renderedEl: HTMLElement;
  private rawEl: HTMLTextAreaElement;
  private toolbarEl: HTMLElement;
  private actionsEl: HTMLElement;

  private planContent = "";
  private mode: "rendered" | "raw" = "rendered";

  constructor() {
    this.planEl = document.getElementById("tab-plan")!;
    this.stepsEl = document.getElementById("tab-steps")!;
    this.resultsEl = document.getElementById("tab-results")!;

    this.renderedEl = document.getElementById("plan-rendered")!;
    this.rawEl = document.getElementById("plan-raw") as HTMLTextAreaElement;
    this.toolbarEl = document.getElementById("plan-toolbar")!;
    this.actionsEl = document.getElementById("plan-actions")!;

    // Wire up mode toggle buttons
    this.toolbarEl.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const newMode = btn.dataset.mode as "rendered" | "raw";
        this.setMode(newMode);
      });
    });

    // When leaving raw mode, sync edits back
    this.rawEl.addEventListener("input", () => {
      this.planContent = this.rawEl.value;
    });
  }

  setPlanText(text: string): void {
    this.planContent = text;

    // Remove empty state
    const empty = this.planEl.querySelector(".empty-state");
    if (empty) empty.remove();

    // Show toolbar and actions
    this.toolbarEl.classList.remove("hidden");
    this.actionsEl.classList.remove("hidden");

    // Render into current mode
    this.render();
  }

  getPlanText(): string {
    return this.planContent;
  }

  private setMode(mode: "rendered" | "raw"): void {
    // If switching from raw, capture any edits
    if (this.mode === "raw") {
      this.planContent = this.rawEl.value;
    }

    this.mode = mode;

    // Update toggle buttons
    this.toolbarEl.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    this.render();
  }

  private render(): void {
    if (this.mode === "rendered") {
      this.renderedEl.innerHTML = marked.parse(this.planContent, { async: false }) as string;
      this.renderedEl.classList.remove("hidden");
      this.rawEl.classList.add("hidden");
    } else {
      this.rawEl.value = this.planContent;
      this.rawEl.classList.remove("hidden");
      this.renderedEl.classList.add("hidden");
    }
  }

  setSteps(steps: PlanStep[]): void {
    this.stepsEl.innerHTML = "";

    if (steps.length === 0) {
      this.stepsEl.innerHTML = '<div class="empty-state">No steps yet.</div>';
      return;
    }

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "8px";

    for (const step of steps) {
      const node = document.createElement("div");
      node.className = `step-node ${step.status}`;
      node.innerHTML = `
        <span class="step-icon ${step.status}"></span>
        <span>${escapeHtml(step.name)}</span>
      `;
      if (step.description) {
        node.title = step.description;
      }
      list.appendChild(node);

      if (step !== steps[steps.length - 1]) {
        const arrow = document.createElement("div");
        arrow.style.textAlign = "center";
        arrow.style.color = "var(--text-dim)";
        arrow.style.fontSize = "16px";
        arrow.textContent = "\u2193";
        list.appendChild(arrow);
      }
    }

    this.stepsEl.appendChild(list);
  }

  addResult(html: string): void {
    const empty = this.resultsEl.querySelector(".empty-state");
    if (empty) empty.remove();

    const el = document.createElement("div");
    el.style.marginBottom = "16px";
    el.innerHTML = html;
    this.resultsEl.appendChild(el);
  }

  clearResults(): void {
    this.resultsEl.innerHTML = '<div class="empty-state">Results will appear here as the analysis runs.</div>';
  }
}

function escapeHtml(text: string): string {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}
