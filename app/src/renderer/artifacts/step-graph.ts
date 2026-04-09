/**
 * StepGraph renders a visual DAG of plan steps with status indicators.
 * Steps are displayed as a vertical flow with colored status nodes.
 */

interface Step {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  dependsOn: string[];
  result?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#8888a0",
  in_progress: "#4fc3f7",
  completed: "#66bb6a",
  failed: "#ef5350",
  skipped: "#666680",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  failed: "✗",
  skipped: "◌",
};

export class StepGraph {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  render(steps: Step[]): void {
    this.container.innerHTML = "";

    if (steps.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No steps yet.</div>';
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "step-dag";

    // Build a map for dependency lookup
    const stepMap = new Map(steps.map(s => [s.id, s]));

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const color = STATUS_COLORS[step.status];

      // Step node
      const node = document.createElement("div");
      node.className = `dag-node dag-${step.status}`;

      // Status indicator
      const indicator = document.createElement("div");
      indicator.className = `dag-indicator dag-indicator-${step.status}`;
      indicator.textContent = STATUS_ICONS[step.status];

      // Content
      const content = document.createElement("div");
      content.className = "dag-content";

      const title = document.createElement("div");
      title.className = "dag-title";
      title.textContent = step.name;

      const desc = document.createElement("div");
      desc.className = "dag-desc";
      desc.textContent = step.description;

      content.appendChild(title);
      content.appendChild(desc);

      // Result badge (if completed/failed)
      if (step.result) {
        const result = document.createElement("div");
        result.className = `dag-result dag-result-${step.status}`;
        result.textContent = step.result;
        content.appendChild(result);
      }

      // Dependencies
      if (step.dependsOn.length > 0) {
        const deps = document.createElement("div");
        deps.className = "dag-deps";
        const depNames = step.dependsOn
          .map(id => stepMap.get(id)?.name || id)
          .join(", ");
        deps.textContent = `after: ${depNames}`;
        content.appendChild(deps);
      }

      node.appendChild(indicator);
      node.appendChild(content);
      wrapper.appendChild(node);

      // Arrow connector (except after last)
      if (i < steps.length - 1) {
        const arrow = document.createElement("div");
        arrow.className = "dag-arrow";

        // Color the arrow based on whether the current step is done
        if (step.status === "completed") {
          arrow.classList.add("dag-arrow-done");
        }

        wrapper.appendChild(arrow);
      }
    }

    // Progress summary
    const completed = steps.filter(s => s.status === "completed").length;
    const failed = steps.filter(s => s.status === "failed").length;
    const inProgress = steps.filter(s => s.status === "in_progress").length;

    const summary = document.createElement("div");
    summary.className = "dag-summary";
    const parts: string[] = [];
    if (completed > 0) parts.push(`${completed} done`);
    if (inProgress > 0) parts.push(`${inProgress} running`);
    if (failed > 0) parts.push(`${failed} failed`);
    parts.push(`${steps.length} total`);
    summary.textContent = parts.join(" · ");
    wrapper.appendChild(summary);

    this.container.appendChild(wrapper);
  }
}
