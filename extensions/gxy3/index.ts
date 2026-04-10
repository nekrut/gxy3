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
import { execSync, spawn, type ChildProcess } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PlanStep {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  dependsOn: string[];
  result?: string;
  command?: string;
  explanation?: string;
}

interface Plan {
  id: string;
  title: string;
  content: string;
  steps: PlanStep[];
  created: string;
  updated: string;
  condaEnv?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let currentPlan: Plan | null = null;
const runningProcesses = new Map<string, ChildProcess>();

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
  if (currentPlan.condaEnv) lines.push(`conda_env: ${currentPlan.condaEnv}`);
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
    if (step.command) {
      lines.push(`  \`\`\`\n  ${step.command}\n  \`\`\``);
    }
    if (step.result) {
      lines.push(`  > ${step.result}`);
    }
    lines.push("");
  }

  fs.writeFileSync(p, lines.join("\n"));

  try {
    const cwd = path.dirname(p);
    try { execSync("git rev-parse --git-dir", { cwd, stdio: "ignore" }); }
    catch { execSync("git init", { cwd, stdio: "ignore" }); }
    execSync(`git add "${path.basename(p)}"`, { cwd, stdio: "ignore" });
    execSync(`git commit -m "Update: ${currentPlan.title}" --allow-empty`, { cwd, stdio: "ignore" });
  } catch { /* git not available */ }
}

function emitSteps(ctx: { ui: { setWidget(key: string, lines: string[]): void } }): void {
  if (!currentPlan) return;
  const stepsJson = JSON.stringify(currentPlan.steps);
  ctx.ui.setWidget("steps", [stepsJson]);
}

/** Detect package manager: respects config.condaBin preference. */
function condaBin(): string {
  // Read config preference
  let pref: string = "auto";
  try {
    const cfgPath = path.join(process.env.HOME || "", ".gxy3", "config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      if (cfg.condaBin) pref = cfg.condaBin;
    }
  } catch { /* ignore */ }

  if (pref === "mamba" || pref === "conda") return pref;

  // auto: prefer mamba if available
  try {
    execSync("mamba --version", { stdio: "ignore" });
    return "mamba";
  } catch {
    return "conda";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default function gxy3Extension(pi: ExtensionAPI): void {

  // ── Session init ────────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setToolsExpanded(false);
    currentPlan = null;
    runningProcesses.clear();

    const hasGalaxy = process.env.GALAXY_URL && process.env.GALAXY_API_KEY;
    const connectInstr = hasGalaxy
      ? ` Call galaxy_connect(url="${process.env.GALAXY_URL}", api_key="${process.env.GALAXY_API_KEY}") in this response.` +
        ` ONLY call galaxy_connect — do NOT call any other Galaxy tools.`
      : "";

    const cwd = process.cwd();
    pi.sendUserMessage(
      `Session started. You are gxy3, an AI co-scientist for bioinformatics. ` +
      `You help users analyze biological data by creating analysis plans and executing them — ` +
      `locally for small-medium tasks, or on Galaxy for large-scale compute. ` +
      `Current analysis directory: ${cwd}\n` +
      `Give a brief welcome (2-3 sentences), mention the current analysis directory, ` +
      `and tell the user they can change it using the "change" button in the header. ` +
      `Ask what they would like to analyze.${connectInstr}`
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
      command: Type.Optional(Type.String({
        description: "Shell command(s) executed in this step. If running the same command on multiple files, show the command template once with a note like '(×N files)'."
      })),
      explanation: Type.Optional(Type.String({
        description: "Brief explanation of what the command does and why, in plain language for biologists."
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!currentPlan) {
        return { content: [{ type: "text", text: "No active plan." }] };
      }

      let target = currentPlan.steps.find(s => s.id === params.stepId);
      if (!target) {
        target = currentPlan.steps.find(s =>
          s.name.toLowerCase() === params.stepId.toLowerCase()
        );
      }
      if (!target) {
        return { content: [{ type: "text", text: `Step "${params.stepId}" not found.` }] };
      }
      target.status = params.status;
      if (params.result) target.result = params.result;
      if (params.command) target.command = params.command;
      if (params.explanation) target.explanation = params.explanation;

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
            condaEnv: currentPlan.condaEnv,
          }),
        }],
      };
    },
  });

  // ── install_tools ───────────────────────────────────────────────────────────
  pi.registerTool({
    name: "install_tools",
    label: "Install Tools",
    description:
      "Install bioinformatics tools into a conda environment using bioconda. " +
      "Creates a new env or installs into an existing one. " +
      "Uses mamba if available, falls back to conda. " +
      "The env is automatically activated for all subsequent run_command calls.",
    parameters: Type.Object({
      tools: Type.Array(Type.String(), {
        description: "List of tool/package names to install (e.g. ['bwa', 'samtools', 'fastp'])"
      }),
      envName: Type.Optional(Type.String({
        description: "Conda environment name. Defaults to gxy3-<plan-title-slug>."
      })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const bin = condaBin();
      const envName = params.envName ||
        (currentPlan ? `gxy3-${currentPlan.title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 40)}` : `gxy3-env`);
      const tools = params.tools.join(" ");

      // Check if env exists
      let envExists = false;
      try {
        execSync(`conda env list | grep -q "^${envName} "`, { stdio: "ignore", shell: "/bin/bash" });
        envExists = true;
      } catch { /* doesn't exist */ }

      const cmd = envExists
        ? `${bin} install -n ${envName} -c bioconda -c conda-forge ${tools} -y`
        : `${bin} create -n ${envName} -c bioconda -c conda-forge ${tools} -y`;

      return new Promise((resolve) => {
        let output = "";
        const proc = spawn("bash", ["-c", cmd], {
          cwd: process.cwd(),
          env: { ...process.env },
        });

        proc.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        proc.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });

        signal?.addEventListener("abort", () => {
          proc.kill("SIGTERM");
        });

        proc.on("close", (code) => {
          if (currentPlan) currentPlan.condaEnv = envName;

          if (code === 0) {
            resolve({
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  envName,
                  message: `Installed [${params.tools.join(", ")}] into conda env "${envName}" using ${bin}.`,
                  output: output.slice(-2000),
                }),
              }],
            });
          } else {
            resolve({
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `${bin} exited with code ${code}`,
                  output: output.slice(-3000),
                }),
              }],
            });
          }
        });
      });
    },
  });

  // ── run_command ──────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "run_command",
    label: "Run Command",
    description:
      "Execute a shell command locally. If a conda environment is set up (via install_tools), " +
      "the command runs inside that environment automatically. " +
      "Returns stdout, stderr, and exit code.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      background: Type.Optional(Type.Boolean({
        description: "If true, run in background and return immediately with a process ID. Use check_process to poll status."
      })),
      timeout: Type.Optional(Type.Number({
        description: "Timeout in seconds. Default: 300 (5 minutes)."
      })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const timeoutMs = (params.timeout || 300) * 1000;

      // Wrap with conda env if available
      let cmd = params.command;
      if (currentPlan?.condaEnv) {
        cmd = `conda run -n ${currentPlan.condaEnv} --no-banner bash -c ${shellQuote(cmd)}`;
      }

      if (params.background) {
        const procId = uuid().slice(0, 8);
        const proc = spawn("bash", ["-c", cmd], {
          cwd: process.cwd(),
          env: { ...process.env },
          detached: true,
        });
        runningProcesses.set(procId, proc);
        proc.on("close", () => runningProcesses.delete(procId));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              processId: procId,
              pid: proc.pid,
              message: `Command started in background. Use check_process("${procId}") to check status.`,
            }),
          }],
        };
      }

      // Foreground execution
      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const proc = spawn("bash", ["-c", cmd], {
          cwd: process.cwd(),
          env: { ...process.env },
        });

        const procId = uuid().slice(0, 8);
        runningProcesses.set(procId, proc);

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, timeoutMs);

        proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        signal?.addEventListener("abort", () => {
          proc.kill("SIGTERM");
          clearTimeout(timer);
        });

        proc.on("close", (code) => {
          clearTimeout(timer);
          runningProcesses.delete(procId);

          // Trim output to avoid blowing up context
          const maxOut = 8000;
          const trimmedStdout = stdout.length > maxOut ? `...(trimmed)...\n${stdout.slice(-maxOut)}` : stdout;
          const trimmedStderr = stderr.length > maxOut ? `...(trimmed)...\n${stderr.slice(-maxOut)}` : stderr;

          resolve({
            content: [{
              type: "text",
              text: JSON.stringify({
                success: code === 0 && !timedOut,
                exitCode: code,
                timedOut,
                stdout: trimmedStdout,
                stderr: trimmedStderr,
              }),
            }],
          });
        });
      });
    },
  });

  // ── check_process ───────────────────────────────────────────────────────────
  pi.registerTool({
    name: "check_process",
    label: "Check Process",
    description: "Check if a background process is still running.",
    parameters: Type.Object({
      processId: Type.String({ description: "Process ID returned by run_command with background=true" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proc = runningProcesses.get(params.processId);
      if (!proc) {
        return {
          content: [{ type: "text", text: JSON.stringify({ running: false, message: "Process not found or already completed." }) }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ running: !proc.killed, pid: proc.pid }) }],
      };
    },
  });

  // ── cancel_command ──────────────────────────────────────────────────────────
  pi.registerTool({
    name: "cancel_command",
    label: "Cancel Command",
    description: "Kill a running background process.",
    parameters: Type.Object({
      processId: Type.String({ description: "Process ID to cancel" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proc = runningProcesses.get(params.processId);
      if (!proc) {
        return { content: [{ type: "text", text: "Process not found." }] };
      }
      proc.kill("SIGTERM");
      runningProcesses.delete(params.processId);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Process cancelled." }) }] };
    },
  });

  // ── report_result ───────────────────────────────────────────────────────────
  pi.registerTool({
    name: "report_result",
    label: "Report Result",
    description:
      "Send a result to the Results tab in the artifact pane. " +
      "Use this to display analysis outputs: tables, text summaries, images, or file links. " +
      "Call once per result block — they accumulate in the Results tab.",
    parameters: Type.Object({
      stepName: Type.Optional(Type.String({ description: "Name of the step that produced this result" })),
      type: Type.Union([
        Type.Literal("markdown"),
        Type.Literal("table"),
        Type.Literal("image"),
        Type.Literal("file"),
      ], { description: "Result type" }),
      // markdown
      content: Type.Optional(Type.String({ description: "Markdown text (for type=markdown)" })),
      // table
      headers: Type.Optional(Type.Array(Type.String(), { description: "Column headers (for type=table)" })),
      rows: Type.Optional(Type.Array(Type.Array(Type.String()), { description: "Table rows (for type=table)" })),
      // image
      path: Type.Optional(Type.String({ description: "Absolute file path (for type=image or type=file)" })),
      caption: Type.Optional(Type.String({ description: "Caption for image or label for file link" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const resultBlock = JSON.stringify({
        stepName: params.stepName,
        type: params.type,
        content: params.content,
        headers: params.headers,
        rows: params.rows,
        path: params.path,
        caption: params.caption,
      });
      ctx.ui.setWidget("results", [resultBlock]);

      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message: "Result displayed." }) }],
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
      planContext = `\n\nCurrent plan: "${currentPlan.title}"`;
      if (currentPlan.condaEnv) planContext += `\nConda env: ${currentPlan.condaEnv}`;
      planContext += `\nSteps:\n${stepsSummary}`;
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
        "5. During execution, call update_step to track progress for each step.",
        "   Always include `command` (the shell command) and `explanation` (what it does, for biologists).",
        "   If running the same command on multiple files, show the template once with '(×N files)'.",
        "",
        "CRITICAL — chat output during execution:",
        "  The visual DAG in the right pane already shows step progress.",
        "  DO NOT narrate each step in chat. DO NOT write descriptions like 'Now I will...' or 'Next step...'.",
        "  During execution, keep chat output to a MINIMUM. Only write to chat when:",
        "    - A step fails and user input is needed",
        "    - The analysis is complete (give a brief 1-2 sentence summary)",
        "    - User asks a question",
        "  Use update_step and report_result to communicate progress/results — not chat.",
        "",
        "Execution workflow:",
        "1. First call install_tools with all bioinformatics tools needed. ALWAYS use bioconda packages.",
        "2. Then use run_command to execute each step. Commands run inside the conda env automatically.",
        "3. After each step completes, call report_result to display outputs in the Results tab.",
        "4. Use report_result with type='table' for tabular data, 'markdown' for text, 'image' for plots.",
        "",
        "When the user asks to modify a plan (e.g. 'add a visualization step'),",
        "call display_plan again with the updated content and steps.",
        "",
        "Tool installation: ALWAYS prefer bioconda packages. Use install_tools to set up a conda env.",
        "The env is auto-activated for all run_command calls. Do NOT manually activate envs.",
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
