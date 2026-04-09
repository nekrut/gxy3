/**
 * gxy3 - AI-driven bioinformatics analysis extension for Pi.dev
 *
 * Provides plan-based analysis orchestration with local execution
 * and Galaxy integration for large-scale compute.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { v4 as uuid } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PlanStep {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  dependsOn: string[];  // step IDs
  result?: string;
}

interface Plan {
  id: string;
  title: string;
  content: string;     // markdown plan text
  steps: PlanStep[];
  created: string;
  updated: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let currentPlan: Plan | null = null;

function notebookPath(): string | null {
  if (!currentPlan) return null;
  const cwd = process.cwd();
  const safeName = currentPlan.title.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  return path.join(cwd, `${safeName}-notebook.md`);
}

function saveNotebook(): void {
  const p = notebookPath();
  if (!p || !currentPlan) return;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: "${currentPlan.title}"`);
  lines.push(`id: ${currentPlan.id}`);
  lines.push(`created: ${currentPlan.created}`);
  lines.push(`updated: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push(currentPlan.content);
  lines.push("");
  lines.push("## Steps");
  lines.push("");

  for (const step of currentPlan.steps) {
    const icon = { pending: "○", in_progress: "◐", completed: "●", failed: "✗", skipped: "◌" }[step.status];
    lines.push(`- ${icon} **${step.name}** [${step.status}]`);
    lines.push(`  ${step.description}`);
    if (step.dependsOn.length > 0) {
      lines.push(`  depends on: ${step.dependsOn.join(", ")}`);
    }
    if (step.result) {
      lines.push(`  > ${step.result}`);
    }
    lines.push("");
  }

  fs.writeFileSync(p, lines.join("\n"));

  // Auto git commit
  try {
    const cwd = path.dirname(p);
    try { execSync("git rev-parse --git-dir", { cwd, stdio: "ignore" }); }
    catch { execSync("git init", { cwd, stdio: "ignore" }); }
    execSync(`git add "${path.basename(p)}"`, { cwd, stdio: "ignore" });
    execSync(`git commit -m "Update: ${currentPlan.title}" --allow-empty`, { cwd, stdio: "ignore" });
  } catch {
    // git not available or commit failed — not critical
  }
}

function emitSteps(ctx: { ui: { setWidget(key: string, lines: string[]): void } }): void {
  if (!currentPlan) return;
  // Emit steps as JSON for the renderer to parse
  const stepsJson = JSON.stringify(currentPlan.steps);
  ctx.ui.setWidget("steps", [stepsJson]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default function gxy3Extension(pi: ExtensionAPI): void {

  // ── Session init ────────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setToolsExpanded(false);
    currentPlan = null;

    const hasGalaxy = process.env.GALAXY_URL && process.env.GALAXY_API_KEY;
    const connectInstr = hasGalaxy
      ? ` Call galaxy_connect(url="${process.env.GALAXY_URL}", api_key="${process.env.GALAXY_API_KEY}") in this response.` +
        ` ONLY call galaxy_connect — do NOT call any other Galaxy tools.`
      : "";

    pi.sendUserMessage(
      `Session started. You are gxy3, an AI co-scientist for bioinformatics. ` +
      `You help users analyze biological data by creating analysis plans and executing them — ` +
      `locally for small-medium tasks, or on Galaxy for large-scale compute. ` +
      `Give a brief welcome (2-3 sentences) and ask what the user would like to analyze.${connectInstr}`
    );
  });

  // ── display_plan ────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "display_plan",
    label: "Display Plan",
    description: "Display an analysis plan in the artifact pane for user review. " +
      "Call this whenever you create or update a plan. The plan is shown as rendered markdown. " +
      "After displaying, ask the user to review before executing.",
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the plan" }),
      content: Type.String({
        description: "Full plan in markdown. Include numbered steps with descriptions."
      }),
      steps: Type.Array(
        Type.Object({
          name: Type.String({ description: "Short step name" }),
          description: Type.String({ description: "What this step does" }),
          dependsOn: Type.Optional(Type.Array(Type.String({
            description: "Names of steps this depends on"
          }))),
        }),
        { description: "Structured list of plan steps for the visual DAG" }
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const steps: PlanStep[] = params.steps.map((s: { name: string; description: string; dependsOn?: string[] }) => ({
        id: uuid().slice(0, 8),
        name: s.name,
        description: s.description,
        status: "pending" as const,
        dependsOn: s.dependsOn || [],
      }));

      // Resolve dependsOn names to IDs
      for (const step of steps) {
        step.dependsOn = step.dependsOn.map((dep: string) => {
          const found = steps.find(s => s.name === dep);
          return found ? found.id : dep;
        });
      }

      currentPlan = {
        id: uuid().slice(0, 8),
        title: params.title,
        content: params.content,
        steps,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      ctx.ui.setWidget("plan", params.content.split("\n"));
      emitSteps(ctx);
      ctx.ui.setStatus("plan", `Plan: ${params.title}`);
      saveNotebook();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            planId: currentPlan.id,
            message: `Plan "${params.title}" with ${steps.length} steps displayed. User can review, edit, and execute.`,
            stepIds: steps.map(s => ({ id: s.id, name: s.name })),
          }),
        }],
      };
    },
  });

  // ── update_step ─────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "update_step",
    label: "Update Step",
    description: "Update the status of a plan step. Use this during execution to track progress. " +
      "Set status to in_progress when starting a step, completed when done, or failed on error.",
    parameters: Type.Object({
      stepId: Type.String({ description: "Step ID (returned by display_plan)" }),
      status: Type.Union([
        Type.Literal("in_progress"),
        Type.Literal("completed"),
        Type.Literal("failed"),
        Type.Literal("skipped"),
      ], { description: "New status" }),
      result: Type.Optional(Type.String({ description: "Result summary or error message" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!currentPlan) {
        return { content: [{ type: "text", text: "No active plan." }] };
      }

      const step = currentPlan.steps.find(s => s.id === params.stepId);
      if (!step) {
        // Try matching by name
        const byName = currentPlan.steps.find(s =>
          s.name.toLowerCase() === params.stepId.toLowerCase()
        );
        if (!byName) {
          return { content: [{ type: "text", text: `Step "${params.stepId}" not found.` }] };
        }
        byName.status = params.status;
        if (params.result) byName.result = params.result;
      } else {
        step.status = params.status;
        if (params.result) step.result = params.result;
      }

      currentPlan.updated = new Date().toISOString();
      emitSteps(ctx);
      saveNotebook();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, message: `Step updated to ${params.status}` }),
        }],
      };
    },
  });

  // ── get_plan ────────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "get_plan",
    label: "Get Plan",
    description: "Get the current plan content and step statuses.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!currentPlan) {
        return { content: [{ type: "text", text: "No plan created yet." }] };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            title: currentPlan.title,
            content: currentPlan.content,
            steps: currentPlan.steps,
          }),
        }],
      };
    },
  });

  // ── Context injection ───────────────────────────────────────────────────────
  pi.on("before_agent_start", async (_event, _ctx) => {
    let planContext = "\n\nNo plan created yet.";
    if (currentPlan) {
      const stepsSummary = currentPlan.steps
        .map(s => `  ${s.id}: ${s.name} [${s.status}]`)
        .join("\n");
      planContext = `\n\nCurrent plan: "${currentPlan.title}"\nSteps:\n${stepsSummary}`;
    }

    return {
      systemPromptSuffix: [
        "You are gxy3, an AI co-scientist for bioinformatics analysis.",
        "Your users are biologists and data analysts — they interact via natural language only.",
        "",
        "When asked to perform an analysis:",
        "1. Read any provided files (papers, data, existing workflows)",
        "2. Create a plan using display_plan — include both markdown content AND structured steps",
        "3. ALWAYS use display_plan to show plans — never just write them in chat",
        "4. Only execute after the user approves (clicks Execute or says 'go ahead')",
        "5. During execution, call update_step to track progress for each step",
        "",
        "When the user asks to modify a plan (e.g. 'add a visualization step'),",
        "call display_plan again with the updated content and steps.",
        "",
        "You can execute commands locally (bash, conda, containers) for small-medium tasks,",
        "and use Galaxy for large-scale compute or pre-built workflows.",
        planContext,
      ].join("\n"),
    };
  });

  // ── Status bar ──────────────────────────────────────────────────────────────
  pi.on("turn_end", async (_event, ctx) => {
    ctx.ui.setStatus("ready", "Ready");
  });
}
