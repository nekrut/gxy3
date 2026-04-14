/**
 * UI Bridge — translates pi-galaxy-analyst state changes into gxy3
 * shell-compatible widget events.
 *
 * The gxy3 Electron shell expects:
 *   setWidget("plan", markdownLines[])           → Plan tab
 *   setWidget("steps", [JSON.stringify(steps)])   → React Flow DAG
 *   setWidget("results", [JSON.stringify(block)]) → Results tab
 *   setWidget("parameters", [JSON.stringify(spec)]) → Parameter form
 *
 * state.ts fires onPlanChange(plan) on every mutation. This module
 * converts AnalysisPlan → shell format and emits the widgets via the
 * most recently captured ExtensionContext.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AnalysisPlan, AnalysisStep } from "./types.js";
import { onPlanChange } from "./state.js";

/** The step shape the gxy3 renderer expects (step-graph-react.tsx). */
interface ShellStep {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  dependsOn: string[];
  result?: string;
  command?: string;
  explanation?: string;
}

/** Convert an AnalysisStep to the flat shape the DAG renderer expects. */
function toShellStep(step: AnalysisStep): ShellStep {
  return {
    id: step.id,
    name: step.name,
    description: step.description,
    status: step.status,
    dependsOn: step.dependsOn,
    result: step.result?.summary,
    command: step.execution.toolId || step.execution.workflowId,
    explanation: step.description,
  };
}

/** Convert all steps in a plan. Exported for testing. */
export function toShellSteps(plan: AnalysisPlan): ShellStep[] {
  return plan.steps.map(toShellStep);
}

/** Render a plan as markdown for the Plan tab. Exported for testing. */
export function planToMarkdown(plan: AnalysisPlan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push("");
  lines.push(`**Phase:** ${plan.phase.replace(/_/g, " ")}  `);
  lines.push(`**Status:** ${plan.status}  `);
  if (plan.galaxy.serverUrl) {
    lines.push(`**Galaxy:** ${plan.galaxy.serverUrl}  `);
  }
  lines.push("");

  if (plan.context.researchQuestion) {
    lines.push("## Research Question");
    lines.push("");
    lines.push(plan.context.researchQuestion);
    lines.push("");
  }

  if (plan.context.dataDescription) {
    lines.push("## Data");
    lines.push("");
    lines.push(plan.context.dataDescription);
    lines.push("");
  }

  if (plan.context.expectedOutcomes.length > 0) {
    lines.push("## Expected Outcomes");
    lines.push("");
    for (const outcome of plan.context.expectedOutcomes) {
      lines.push(`- ${outcome}`);
    }
    lines.push("");
  }

  if (plan.steps.length > 0) {
    lines.push("## Steps");
    lines.push("");
    for (const step of plan.steps) {
      const icon = step.status === "completed" ? "+" :
                   step.status === "in_progress" ? "~" :
                   step.status === "failed" ? "!" :
                   step.status === "skipped" ? "-" : " ";
      lines.push(`${icon} **${step.name}** — ${step.description}`);
      if (step.result?.summary) {
        lines.push(`  Result: ${step.result.summary}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Wire up the bridge. Captures the latest ExtensionContext from
 * before_agent_start so plan-change listeners can emit widgets.
 */
export function setupUIBridge(pi: ExtensionAPI): void {
  let latestCtx: ExtensionContext | null = null;

  // Capture the context on every agent turn start
  pi.on("before_agent_start", async (_event, ctx) => {
    latestCtx = ctx;
  });

  // Listen for plan mutations and emit shell widgets
  onPlanChange((plan) => {
    if (!plan || !latestCtx) return;

    const md = planToMarkdown(plan);
    latestCtx.ui.setWidget("plan", md.split("\n"));

    const steps = toShellSteps(plan);
    latestCtx.ui.setWidget("steps", [JSON.stringify(steps)]);
  });
}
