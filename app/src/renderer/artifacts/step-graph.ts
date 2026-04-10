/**
 * StepGraph renders a visual DAG of plan steps with status indicators.
 * Steps are laid out in layers based on dependencies — parallel steps
 * (same depth) appear side-by-side with SVG connectors.
 */

interface Step {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  dependsOn: string[];
  result?: string;
  command?: string;
  explanation?: string;
}

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  failed: "✗",
  skipped: "◌",
};

export class StepGraph {
  private container: HTMLElement;
  private currentWrapper: HTMLElement | null = null;
  private currentSteps: Step[] = [];
  private currentNodeEls = new Map<string, HTMLElement>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Topological layer assignment by dependency depth. */
  private computeLayers(steps: Step[]): Step[][] {
    const stepMap = new Map(steps.map(s => [s.id, s]));
    const depth = new Map<string, number>();

    const getDepth = (id: string): number => {
      if (depth.has(id)) return depth.get(id)!;
      const step = stepMap.get(id);
      if (!step || step.dependsOn.length === 0) {
        depth.set(id, 0);
        return 0;
      }
      const maxParent = Math.max(
        ...step.dependsOn.map(dep => stepMap.has(dep) ? getDepth(dep) + 1 : 0)
      );
      depth.set(id, maxParent);
      return maxParent;
    };

    for (const s of steps) getDepth(s.id);

    const maxDepth = Math.max(0, ...Array.from(depth.values()));
    const layers: Step[][] = [];
    for (let d = 0; d <= maxDepth; d++) {
      layers.push(steps.filter(s => depth.get(s.id) === d));
    }
    return layers;
  }

  render(steps: Step[]): void {
    this.container.innerHTML = "";

    if (steps.length === 0) {
      this.container.innerHTML = '<div class="empty-state">No steps yet.</div>';
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "step-dag";

    const stepMap = new Map(steps.map(s => [s.id, s]));
    const layers = this.computeLayers(steps);

    // Store refs to node elements for SVG connector positioning
    const nodeEls = new Map<string, HTMLElement>();

    for (const layer of layers) {
      const row = document.createElement("div");
      row.className = "dag-row";

      for (const step of layer) {
        const node = this.createNode(step, stepMap);
        nodeEls.set(step.id, node);
        row.appendChild(node);
      }
      wrapper.appendChild(row);
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

    // Store for redraw on expand/collapse
    this.currentWrapper = wrapper;
    this.currentSteps = steps;
    this.currentNodeEls = nodeEls;

    // Draw SVG connectors after layout
    requestAnimationFrame(() => this.drawConnectors(wrapper, steps, nodeEls));
  }

  /** Redraw connectors (call after node size changes). */
  private redrawConnectors(): void {
    if (!this.currentWrapper) return;
    // Double rAF ensures layout has fully recalculated after expand/collapse
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.drawConnectors(this.currentWrapper!, this.currentSteps, this.currentNodeEls);
      });
    });
  }

  private drawConnectors(
    wrapper: HTMLElement,
    steps: Step[],
    nodeEls: Map<string, HTMLElement>
  ): void {
    // Remove old SVG if any
    wrapper.querySelector(".dag-svg")?.remove();

    const wrapperRect = wrapper.getBoundingClientRect();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("dag-svg");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.width = wrapperRect.width + "px";
    svg.style.height = wrapperRect.height + "px";
    svg.style.pointerEvents = "none";
    svg.setAttribute("viewBox", `0 0 ${wrapperRect.width} ${wrapperRect.height}`);

    for (const step of steps) {
      if (step.dependsOn.length === 0) continue;
      const toEl = nodeEls.get(step.id);
      if (!toEl) continue;

      for (const depId of step.dependsOn) {
        const fromEl = nodeEls.get(depId);
        if (!fromEl) continue;

        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();

        const x1 = fromRect.left + fromRect.width / 2 - wrapperRect.left;
        const y1 = fromRect.bottom - wrapperRect.top;
        const x2 = toRect.left + toRect.width / 2 - wrapperRect.left;
        const y2 = toRect.top - wrapperRect.top;

        const midY = (y1 + y2) / 2;

        // Determine color based on source step status (Galaxy state colors)
        const fromStep = steps.find(s => s.id === depId);
        const color = fromStep?.status === "completed"
          ? "var(--state-ok-border)"
          : "var(--state-new-border)";

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", "2");
        svg.appendChild(path);
      }
    }

    wrapper.style.position = "relative";
    wrapper.appendChild(svg);
  }

  private createNode(step: Step, stepMap: Map<string, Step>): HTMLElement {
    const node = document.createElement("div");
    node.className = `dag-node dag-${step.status}`;

    const indicator = document.createElement("div");
    indicator.className = `dag-indicator dag-indicator-${step.status}`;
    indicator.textContent = STATUS_ICONS[step.status];

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

    if (step.result) {
      const result = document.createElement("div");
      result.className = `dag-result dag-result-${step.status}`;
      result.textContent = step.result;
      content.appendChild(result);
    }

    // Expandable detail panel (command + explanation)
    const hasDetail = step.command || step.explanation;
    if (hasDetail) {
      node.classList.add("dag-clickable");

      const detail = document.createElement("div");
      detail.className = "dag-detail";

      if (step.command) {
        const cmdBlock = document.createElement("pre");
        cmdBlock.className = "dag-command";
        cmdBlock.textContent = step.command;
        detail.appendChild(cmdBlock);
      }

      if (step.explanation) {
        const explEl = document.createElement("div");
        explEl.className = "dag-explanation";
        explEl.textContent = step.explanation;
        detail.appendChild(explEl);
      }

      content.appendChild(detail);

      node.addEventListener("click", (e) => {
        e.stopPropagation();
        node.classList.toggle("dag-expanded");
        this.redrawConnectors();
      });
    }

    node.appendChild(indicator);
    node.appendChild(content);
    return node;
  }
}
