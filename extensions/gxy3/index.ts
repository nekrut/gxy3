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
  // Phase 4: parameters configured by user via the parameter form
  parameters?: Record<string, unknown>;
  // Phase 4: test run state
  testMode?: boolean;
  testDataMap?: Record<string, string>;   // real path → test data path
}

// Phase 4: parameter form spec shape
interface ParameterFormSpec {
  planId: string;
  title: string;
  description: string;
  groups: ParameterGroup[];
}

interface ParameterGroup {
  title: string;
  description: string;
  params: FormParameter[];
}

interface FormParameter {
  name: string;
  type: "text" | "integer" | "float" | "boolean" | "select" | "file";
  label: string;
  help: string;
  value: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  fileFilter?: string;
  usedBy?: string[];
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
      `Session started. Current directory: ${cwd}\n` +
      `Output exactly ONE short sentence asking what to analyze. ` +
      `No welcome, no introduction, no mention of the directory or change button. ` +
      `Example: "What would you like to analyze?" or "What's the data?"${connectInstr}`
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
    description: "Update a plan step during execution. Use this to track progress " +
      "(in_progress when starting, completed when done, failed on error). You can also " +
      "update the description to reflect what's actually being done (e.g., '1 test sample' " +
      "instead of '270 samples' during a test run).",
    parameters: Type.Object({
      stepId: Type.String({ description: "Step ID (returned by display_plan)" }),
      status: Type.Union([
        Type.Literal("in_progress"),
        Type.Literal("completed"),
        Type.Literal("failed"),
        Type.Literal("skipped"),
      ], { description: "New status" }),
      description: Type.Optional(Type.String({
        description: "Optional: update the step description to reflect actual work " +
          "(especially useful in test mode when doing less than the full plan)."
      })),
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

      // On re-run transition (already completed/failed → in_progress), clear stale fields
      const wasCompleted = target.status === "completed" || target.status === "failed";
      if (params.status === "in_progress" && wasCompleted) {
        target.result = undefined;
        // Keep command/explanation — commands often repeat between runs.
        // Agent can overwrite them in this same call if they differ.
      }

      target.status = params.status;
      if (params.description) target.description = params.description;
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
            parameters: currentPlan.parameters,
          }),
        }],
      };
    },
  });

  // ── analyze_plan_parameters (Phase 4) ───────────────────────────────────────
  pi.registerTool({
    name: "analyze_plan_parameters",
    label: "Analyze Parameters",
    description:
      "Analyze the current plan and generate a consolidated parameter configuration form " +
      "for the user. You decide which parameters are critical (biologist-visible) vs automatic " +
      "(hidden — thread counts, paths, flags). Group by biology concept (Organism, Input data, " +
      "Quality thresholds, Output options) — NOT by tool. " +
      "Call this ONLY when the user has clicked 'Review parameters'. " +
      "The form is shown in the artifact pane replacing the plan view.",
    parameters: Type.Object({
      title: Type.String({
        description: "Form title, e.g., 'Parameters for S. aureus hybrid assembly'"
      }),
      description: Type.String({
        description: "1-2 sentence biologist-friendly summary of what these params control"
      }),
      groups: Type.Array(
        Type.Object({
          title: Type.String({ description: "Group heading, e.g., 'Organism & Reference'" }),
          description: Type.String({ description: "Plain-language explanation of this group" }),
          params: Type.Array(
            Type.Object({
              name: Type.String({ description: "Unique parameter id" }),
              type: Type.Union([
                Type.Literal("text"),
                Type.Literal("integer"),
                Type.Literal("float"),
                Type.Literal("boolean"),
                Type.Literal("select"),
                Type.Literal("file"),
              ]),
              label: Type.String({ description: "Widget label" }),
              help: Type.String({ description: "Biologist-centric help text explaining the biological meaning" }),
              value: Type.Union([Type.String(), Type.Number(), Type.Boolean()], {
                description: "Default value (sensible default for the organism/analysis type)"
              }),
              min: Type.Optional(Type.Number()),
              max: Type.Optional(Type.Number()),
              step: Type.Optional(Type.Number()),
              options: Type.Optional(Type.Array(
                Type.Object({ value: Type.String(), label: Type.String() })
              )),
              fileFilter: Type.Optional(Type.String({ description: "e.g., '.fastq,.fastq.gz'" })),
              usedBy: Type.Optional(Type.Array(Type.String(), {
                description: "Tools that use this parameter (for internal bookkeeping)"
              })),
            })
          ),
        }),
        { description: "Parameter groups organized by biology concept" }
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!currentPlan) {
        return { content: [{ type: "text", text: "No active plan — call display_plan first." }] };
      }

      const spec: ParameterFormSpec = {
        planId: currentPlan.id,
        title: params.title,
        description: params.description,
        groups: params.groups as ParameterGroup[],
      };

      // Seed currentPlan.parameters with defaults so get_plan returns them
      const defaults: Record<string, unknown> = {};
      for (const group of spec.groups) {
        for (const p of group.params) {
          defaults[p.name] = p.value;
        }
      }
      currentPlan.parameters = { ...defaults, ...(currentPlan.parameters || {}) };
      currentPlan.updated = new Date().toISOString();

      // Emit to renderer — Plan tab content will be replaced by the form
      ctx.ui.setWidget("parameters", [JSON.stringify(spec)]);
      saveNotebook();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Parameter form displayed with ${spec.groups.length} groups and ` +
                     `${spec.groups.reduce((n, g) => n + g.params.length, 0)} total params. ` +
                     `The user can now review, edit, and approve the parameters.`,
            paramNames: spec.groups.flatMap(g => g.params.map(p => p.name)),
          }),
        }],
      };
    },
  });

  // ── generate_test_data (Phase 4) ────────────────────────────────────────────
  pi.registerTool({
    name: "generate_test_data",
    label: "Generate Test Data",
    description:
      "Generate minimal test data for a dry-run of the current plan. " +
      "For each real input file the plan references, decide whether to SUBSAMPLE " +
      "(use seqkit sample / head / awk) or SYNTHESIZE (use wgsim / python / echo). " +
      "Prefer subsampling when real files exist. Target: let the full pipeline run in < 5 min. " +
      "Test files go in <analysis_dir>/test_data/. Returns the mapping of real path → test path. " +
      "After calling this, run_command automatically substitutes test paths when testMode is on. " +
      "Call this ONLY when the user has clicked 'Test run'.",
    parameters: Type.Object({
      mapping: Type.Array(
        Type.Object({
          realPath: Type.String({ description: "The original real file path referenced in the plan" }),
          testPath: Type.String({ description: "The generated test file path (inside <analysis_dir>/test_data/)" }),
          strategy: Type.Union([Type.Literal("subsample"), Type.Literal("synthesize")]),
          note: Type.Optional(Type.String({ description: "Brief note about how this file was generated" })),
        }),
        { description: "Mapping entries — one per real input file" }
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!currentPlan) {
        return { content: [{ type: "text", text: "No active plan." }] };
      }

      const map: Record<string, string> = {};
      for (const entry of params.mapping) {
        map[entry.realPath] = entry.testPath;
      }

      currentPlan.testMode = true;
      currentPlan.testDataMap = map;
      currentPlan.updated = new Date().toISOString();
      saveNotebook();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Test mode enabled. ${params.mapping.length} file(s) mapped. ` +
                     `run_command will now substitute test paths automatically. ` +
                     `Remember to disable test mode (call clear_test_mode) before the real run.`,
            testDataMap: map,
          }),
        }],
      };
    },
  });

  // ── reset_plan_steps (Phase 4) ──────────────────────────────────────────────
  pi.registerTool({
    name: "reset_plan_steps",
    label: "Reset Plan Steps",
    description: "Reset all step statuses to pending and clear their stale results. " +
      "Call this at the START of every execution (test run OR real run) so the DAG " +
      "starts from a clean slate. This prevents old results from a previous run showing " +
      "up in the step graph.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!currentPlan) {
        return { content: [{ type: "text", text: "No active plan." }] };
      }
      for (const step of currentPlan.steps) {
        step.status = "pending";
        step.result = undefined;
        // Keep command/explanation/description from the plan definition
      }
      currentPlan.updated = new Date().toISOString();
      emitSteps(ctx);
      saveNotebook();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, message: `Reset ${currentPlan.steps.length} steps to pending.` }),
        }],
      };
    },
  });

  // ── clear_test_mode (Phase 4) ───────────────────────────────────────────────
  pi.registerTool({
    name: "clear_test_mode",
    label: "Clear Test Mode",
    description:
      "Exit test-run mode. Call this after a test run completes and before running " +
      "on real data. Removes the test data path substitution.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!currentPlan) {
        return { content: [{ type: "text", text: "No active plan." }] };
      }
      currentPlan.testMode = false;
      currentPlan.testDataMap = undefined;
      saveNotebook();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, message: "Test mode cleared. Real data paths restored." }),
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

      let cmd = params.command;

      // Phase 4: test-mode path substitution — replace real paths with test paths
      if (currentPlan?.testMode && currentPlan.testDataMap) {
        for (const [realPath, testPath] of Object.entries(currentPlan.testDataMap)) {
          // Simple string replace — covers most cases. Quoted paths are handled too
          // because the replacement is a plain string.
          if (cmd.includes(realPath)) {
            cmd = cmd.split(realPath).join(testPath);
          }
        }
      }

      // Wrap with conda env if available
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

    let paramContext = "";
    if (currentPlan?.parameters && Object.keys(currentPlan.parameters).length > 0) {
      paramContext = "\n\nConfigured parameters (use these values when running commands):\n" +
        Object.entries(currentPlan.parameters)
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join("\n");
    }

    let testContext = "";
    if (currentPlan?.testMode && currentPlan.testDataMap) {
      testContext = "\n\nTEST MODE ACTIVE — run_command automatically substitutes real paths with test paths:\n" +
        Object.entries(currentPlan.testDataMap)
          .map(([real, test]) => `  ${real} -> ${test}`)
          .join("\n") +
        "\nWhen reporting results, tag them clearly as 'TEST RUN'. After the test completes, " +
        "call clear_test_mode before running on real data.";
    }

    return {
      systemPromptSuffix: [
        "You are gxy3, an AI co-scientist for bioinformatics analysis.",
        "Your users are biologists and data analysts — they interact via natural language only.",
        "",
        "═══════════════════════════════════════════════════════════════════════",
        "CRITICAL RULE — DO NOT WRITE NARRATION IN CHAT DURING EXECUTION.",
        "═══════════════════════════════════════════════════════════════════════",
        "The visual DAG in the right pane shows step progress. The Results tab",
        "shows all outputs. Chat narration is REDUNDANT and EXPENSIVE.",
        "",
        "FORBIDDEN chat output during execution (these phrases cost real money):",
        "  ✗ 'Let me run...', 'Now I will...', 'Next step...', 'Let me check...'",
        "  ✗ 'Step N: <name>' headings",
        "  ✗ 'Excellent!', 'Great!', 'Perfect!' reactions",
        "  ✗ Walls of bold text summarizing what just happened",
        "  ✗ Any prose that duplicates what update_step/report_result already shows",
        "",
        "ALLOWED chat output:",
        "  ✓ Error messages when user input is needed",
        "  ✓ A single 1-2 sentence final summary when ALL steps complete",
        "  ✓ Direct answers to user questions",
        "",
        "Use these tools — NOT chat — to communicate during execution:",
        "  • update_step → step progress, commands, explanations",
        "  • report_result → output tables, plots, files",
        "  • The DAG and Results tab are already visible to the user",
        "",
        "═══════════════════════════════════════════════════════════════════════",
        "Plan creation:",
        "═══════════════════════════════════════════════════════════════════════",
        "1. Read provided files (papers, data, existing workflows)",
        "2. Create a plan using display_plan — include both markdown content AND structured steps",
        "3. ALWAYS use display_plan to show plans — never just write plans in chat",
        "4. After calling display_plan, DO NOT write a plan summary or overview in chat.",
        "   The right pane already shows the full plan. Writing it again in chat is redundant,",
        "   wastes tokens, and clutters the conversation. Just say something brief like",
        "   'Here\\'s the plan — review it in the right pane and click Execute when ready.'",
        "",
        "═══════════════════════════════════════════════════════════════════════",
        "Execution workflow:",
        "═══════════════════════════════════════════════════════════════════════",
        "1. At the START of every execution (test OR real), call reset_plan_steps FIRST",
        "   to clear any stale results from a previous run.",
        "2. Call install_tools with all bioconda packages needed (if not already installed).",
        "3. For each step:",
        "   a. Call update_step(status='in_progress') BEFORE running the command",
        "      — include the command, explanation, and (if test mode) updated description",
        "      — e.g., in test mode: description='Downloading 1 test sample' not '270 samples'",
        "   b. Call run_command to execute (conda env is auto-activated)",
        "   c. Call update_step(status='completed' or 'failed') with the result summary",
        "   d. Call report_result for tables, plots, files the user needs to see",
        "4. NO chat output between steps. Let the DAG and Results tab do the talking.",
        "",
        "When the user asks to modify a plan (e.g. 'add a visualization step'),",
        "call display_plan again with the updated content and steps.",
        "",
        "Tool installation: ALWAYS prefer bioconda packages. Use install_tools to set up a conda env.",
        "The env is auto-activated for all run_command calls. Do NOT manually activate envs.",
        "",
        "You can execute commands locally (bash, conda, containers) for small-medium tasks,",
        "and use Galaxy for large-scale compute or pre-built workflows.",
        "",
        "─── Parameter configuration (Phase 4) ───",
        "When the user clicks 'Review parameters', call analyze_plan_parameters.",
        "Classify EVERY tool parameter as follows:",
        "",
        "INCLUDE as critical (visible in the form):",
        "  - Organism/species, reference genome, taxonomy",
        "  - Expected genome/transcriptome size",
        "  - Biological thresholds (coverage, identity, length, quality)",
        "  - Read types (paired/single, short/long)",
        "  - K-mer sizes, sensitivity modes",
        "  - Sample names or sample metadata",
        "  - Any parameter whose change would alter biological interpretation",
        "",
        "EXCLUDE as automatic (hidden, you decide at runtime):",
        "  - Thread/CPU count, memory limits",
        "  - File paths for intermediate outputs",
        "  - Verbose/progress/debug flags",
        "  - Tool versions, output formats",
        "  - Any parameter that only affects runtime or disk usage",
        "",
        "GROUP parameters by biology concept (not by tool). Typical groups:",
        "  'Organism & Reference', 'Input data', 'Coverage & Quality', 'Output options'.",
        "Write help text FOR BIOLOGISTS — explain what the parameter means biologically,",
        "not how the tool uses it. Defaults: use values from the source workflow if",
        "provided, otherwise pick sensible defaults for the organism/analysis type.",
        "",
        "─── Test run (Phase 4) ───",
        "When the user clicks 'Test run', call generate_test_data. For each real input file,",
        "decide strategy:",
        "  - SUBSAMPLE if real files exist: use seqkit sample / head / awk to take a tiny slice",
        "    (e.g., 1000 reads). Place in <analysis_dir>/test_data/.",
        "  - SYNTHESIZE if no real inputs yet: use wgsim / python / echo to create tiny files.",
        "Test data should let the full pipeline run in under 5 minutes. Preserve the original",
        "file extensions and formats. After generate_test_data, run the pipeline normally with",
        "run_command — paths are substituted automatically. When the test completes, call",
        "clear_test_mode before running on real data.",
        planContext,
        paramContext,
        testContext,
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
