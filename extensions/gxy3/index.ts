/**
 * gxy3 - AI-driven bioinformatics analysis extension for Pi.dev
 *
 * Provides plan-based analysis orchestration with local execution
 * and Galaxy integration for large-scale compute.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// In-memory plan state
let currentPlan: { title: string; content: string } | null = null;

export default function gxy3Extension(pi: ExtensionAPI): void {

  // ─────────────────────────────────────────────────────────────────────────────
  // Session initialization
  // ─────────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Plan tools
  // ─────────────────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "display_plan",
    label: "Display Plan",
    description: "Display an analysis plan in the artifact pane for user review and editing. " +
      "Call this whenever you create or update an analysis plan. " +
      "The plan will be shown in the right pane where the user can read and edit it. " +
      "After displaying, ask the user to review and approve before executing.",
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the plan" }),
      content: Type.String({
        description: "The full plan content in markdown format. Include numbered steps, " +
          "tool requirements, expected inputs/outputs, and any important notes."
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      currentPlan = { title: params.title, content: params.content };

      // Send plan to the artifact pane via widget
      const lines = params.content.split("\n");
      ctx.ui.setWidget("plan", lines);
      ctx.ui.setStatus("plan", `Plan: ${params.title}`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Plan "${params.title}" displayed in the artifact pane. The user can now review and edit it.`,
          }),
        }],
      };
    },
  });

  pi.registerTool({
    name: "get_plan",
    label: "Get Plan",
    description: "Get the current plan content (which the user may have edited in the artifact pane).",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!currentPlan) {
        return {
          content: [{ type: "text", text: "No plan has been created yet." }],
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify(currentPlan),
        }],
      };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Context injection — before each agent turn, inject plan state
  // ─────────────────────────────────────────────────────────────────────────────
  pi.on("before_agent_start", async (_event, _ctx) => {
    const planContext = currentPlan
      ? `\n\nCurrent plan: "${currentPlan.title}"\n${currentPlan.content}`
      : "\n\nNo plan created yet.";

    return {
      systemPromptSuffix: [
        "You are gxy3, an AI co-scientist for bioinformatics analysis.",
        "Your users are biologists and data analysts — they interact via natural language only.",
        "When asked to perform an analysis:",
        "1. Read any provided files (papers, data, existing workflows)",
        "2. Create a clear analysis plan using the display_plan tool — this shows it in the artifact pane",
        "3. ALWAYS use display_plan to show plans — never just write them in chat",
        "4. Only execute after the user approves",
        "5. Report progress and results clearly",
        "",
        "You can execute commands locally (bash, conda, containers) for small-medium tasks,",
        "and use Galaxy for large-scale compute or pre-built workflows.",
        planContext,
      ].join("\n"),
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Status bar updates after each turn
  // ─────────────────────────────────────────────────────────────────────────────
  pi.on("turn_end", async (_event, ctx) => {
    ctx.ui.setStatus("ready", "Ready");
  });
}
