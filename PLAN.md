# Goal

To develop a lightweight desktop app that would be able to execute data analyses using local compute for small-to-medium tasks and usegalaxy.org infrastrcture for large tasks. 

# Details

The app's interface should have two halves: the first half is similar to calude code - users types queries and recieves answers. The right pane is similat to current claude artifacts. It will allow user to see and edit plans. Once plans are accepted it will showsd graphical representation of plan's setps and reflect their completion. 

As a prototype analysis use analsys performed in /media/anton/data/git/S_aureus. It should work something like this:

- Start app. Both panes are empty. The left pane shows prompt
- In the right pane I type: "analyze the following paper: /media/anton/data/git/S_aureus/ms/s41467-025-57575-2.pdf". Identify samples that have both Illumina and ONT data and assemble them with autocycler. Before doimg anything create a plan and show it to me"
- Once I hit enter the agents thinks, analyzes teh paper (essentially comes up with a plna like the one you can see in /media/anton/data/git/S_aureus/hybrid_assemblies/PLAN.md). This plan is shown in the left pane that acts as a simple text editor. There I can edit it and save. 
- Then in the right pane I type: execute
- Left pane shows graphical representation of steps from the plan and shows the progress.
- Once the analysis is done, it text and graphical artifacts are shown in the right pane. 

# Things to consider:

- The app should connect to a galaxy instance via API key (see /media/anton/data/git/galaxy-skills and /media/anton/data/git/galaxy-mcp)
- For information about galaxy see: /media/anton/data/git/galaxy-brain and /media/anton/data/git/galaxy
- You can resuse iseas for building an app from /media/anton/data/git/pi-galaxy-analyst

---

# Conceptual Rethink (2026-04-15, simplified)

An earlier version of this section proposed a 3-step welcome wizard, an explicit
chat/plan UI mode toggle, and a session-level execution mode (`local` / `hybrid`
/ `remote`). After review, all three were dropped as friction without clear
benefit. The simpler model:

## Application flow

### 1. First-run welcome screen (single page)

On first launch (no `~/.gxy3/config.json`, or `config.llm?.apiKey` is missing),
the renderer shows a `#welcome-overlay` full-screen form instead of the chat UI.
Single page, two collapsed-by-default sections:

- **LLM Provider** (required): provider dropdown + API key + model dropdown.
  Reuses the field set from the existing Preferences dialog
  (`app/src/renderer/index.html:125-154`).
- **Galaxy server** (optional, collapsed): URL + API key. Same fields as
  Preferences (`app/src/renderer/index.html:156-166`).
- **Working directory** (optional, collapsed): path picker.

On Save → `window.gxy3.saveConfig()` → existing IPC handler at
`app/src/main/ipc-handlers.ts:88-103` writes `~/.gxy3/config.json` and restarts
the agent → renderer hides the welcome overlay → shows chat.

No 3-step wizard; one page, all fields visible at once with sensible defaults.

### 2. Single-pane default + collapsible artifact pane

There is no `chat` vs `plan` UI mode. The agent decides whether a request
warrants a structured plan based on its complexity. The artifact pane is shown
when there's something to show.

**Initial layout**: chat fills the window. Artifact pane is hidden.

**Auto-show on plan creation**: when the agent calls `analysis_plan_create`
the bridge fires `setWidget("plan", ...)` and `setWidget("steps", ...)`. The
renderer (`app/src/renderer/app.ts:557-602`) already handles these; we just
add a one-time auto-reveal of the artifact pane on the first such event.

**Manual collapse/expand**:
- Button on the divider (or in the masthead) toggles `body.artifact-collapsed`
- `Cmd/Ctrl+\` keyboard shortcut (familiar from VS Code)
- CSS: `body.artifact-collapsed #artifact-pane { display: none }`
- State persists to `localStorage` so the layout is remembered across launches

No `/chat` or `/plan` slash commands. No masthead segmented control.

### 3. Local / Remote mode toggle

Two-mode toggle in the masthead, simpler than the original three-mode proposal:

| Mode | Behavior |
|------|----------|
| **Local** | Galaxy tools NOT exposed to the agent. Everything runs locally via `run_command`. Hard kill switch. |
| **Remote** | Galaxy tools ARE exposed. Agent decides per-job (default policy: prefer Galaxy for large jobs >5min/>10GB). User overrides in conversation. |

**Masthead UI**: segmented control `[Local|Remote]` next to the model indicator.
Persists per-session, last choice saved in `Gxy3Config.executionMode`. If Galaxy
is not configured, Remote is disabled and locked on Local with a tooltip
pointing to Preferences.

**Tool gating**: in Local mode, `bin/gxy3.js` skips the Galaxy MCP server
registration entirely (the block at `bin/gxy3.js:130-145`), so Galaxy tools
are simply not in the agent's tool list. Switching modes restarts the agent
(existing config-change behavior).

**Agent awareness via system prompt** (in
`extensions/galaxy-analyst/context.ts`):

```
## Execution mode: {{mode}}

[Local mode]
You are in Local mode. Galaxy tools are NOT available. All execution
must be local via run_command. If the user asks for Galaxy, explain
that Local mode is on and they can switch to Remote in the masthead.

[Remote mode]
You are in Remote mode. Both backends are available:
- local: run_command (for quick tasks <5min, <10GB)
- galaxy: galaxy_run_tool, galaxy_invoke_workflow ({{galaxyUrl}})
  (for large/long-running jobs, reproducibility-critical work)

Default: prefer Galaxy for jobs estimated >5min or >10GB. Use local
otherwise. Honor user overrides ("run this locally", "use Galaxy
for everything").
```

The agent decides per-job in Remote mode; the user gets a hard kill switch in
Local mode.

## What changes

### Files to create

| File | Role |
|------|------|
| `app/src/renderer/welcome.ts` | NEW — welcome form logic, mirrors `openPreferences` / `savePreferences` |

### Files to modify

| File | Change |
|------|--------|
| `app/src/renderer/index.html` | Add `#welcome-overlay` div with the welcome form. Add divider collapse button. |
| `app/src/renderer/styles.css` | Welcome screen styles. `body.artifact-collapsed` rules. Collapse button hover. |
| `app/src/renderer/app.ts` | First-run detection (no API key → show welcome). Auto-reveal artifact pane on first plan event. Collapse/expand toggle handler. `Cmd/Ctrl+\` shortcut. localStorage persistence. |
| `extensions/galaxy-analyst/config.ts` | Add `executionMode?: "local" \| "remote"` to `Gxy3Config`. Default `"local"`. |
| `extensions/galaxy-analyst/context.ts` | Inject execution mode + Galaxy URL into system prompt with mode-specific guidance. |
| `bin/gxy3.js` | Conditionally register Galaxy MCP server based on `executionMode`. In Local mode, skip the `mcpConfig.mcpServers.galaxy` block. |
| `app/src/renderer/index.html` | Add `[Local\|Remote]` segmented control in `#chat-header`. |
| `app/src/renderer/app.ts` (additional) | Wire mode toggle: click → save config → restart agent. Disable when Galaxy unconfigured. |

### Existing functions to reuse

| Function | Location |
|----------|----------|
| `openPreferences()` | `app/src/renderer/app.ts:948` |
| `savePreferences()` | `app/src/renderer/app.ts:977` |
| `window.gxy3.getConfig()` / `saveConfig()` | `app/src/preload/preload.ts` |
| `loadConfig()` / `saveConfig()` | `extensions/galaxy-analyst/config.ts:33` |
| `formatPlanSummary()` | `extensions/galaxy-analyst/state.ts:832` |
| `openExternalUrlWindow()` | `app/src/main/main.ts:80` |
| `setWidget("plan", ...)` handler | `app/src/renderer/app.ts:565` |

### What we are NOT building

- Chat/plan UI mode toggle. No `/chat`, `/plan` slash commands. No masthead segmented control.
- Session execution mode (`local` / `hybrid` / `remote`). No masthead dropdown.
- 3-step welcome wizard.
- Inline plotly charts in chat (defer; agent can write HTML to disk and use `report_result` with type=file → `openExternalUrlWindow`).
- Multiple LLM provider keys at once (one active provider; user switches in Preferences).

## Verification

1. `rm ~/.gxy3/config.json && cd app && npm start` → welcome overlay appears, NOT chat
2. Fill in Anthropic key only, leave Galaxy/working dir collapsed, click Save → welcome hides, chat fills window
3. Type "what is FastQC?" → quick markdown answer in chat, artifact pane stays hidden
4. Type "create a plan for QC of these FASTQs" → agent calls `analysis_plan_create`, artifact pane slides in with Plan tab populated
5. Click divider collapse button → artifact pane hides
6. Press `Cmd+\` → artifact pane reappears
7. Reload app → comes up in last layout state
8. Open Preferences, configure Galaxy URL + key, set "prefer Galaxy for large jobs" → save → restart agent
9. Ask agent "is Galaxy configured?" → agent confirms via context injection
10. Ask agent to "run this on Galaxy" → uses `galaxy_run_tool` from Galaxy MCP
11. Without Galaxy configured, ask agent to "use Galaxy" → agent says it's not configured, points to Preferences

## Why the chat/plan toggle and session execution mode were dropped

**Chat/plan toggle**: real bioinformatics requests don't cleanly split into
"conversational" vs "structured" — "show me read length distribution" is a quick
question that requires running a tool. Forcing the user to classify their
question before asking is friction the agent should absorb. Compare Claude Code,
ChatGPT, Cursor — none make you pick a mode. The artifact pane appears
contextually when there's a plan to show; users can collapse it like a sidebar.

**Session execution mode**: per-session is the wrong granularity. "Hybrid" was
undefined ("large jobs" — measured how?), and locking the mode at session start
can't accommodate mid-session "actually run this on Galaxy" overrides. Treating
Galaxy as a capability (with one default-bias setting) gives the agent
flexibility and the user control where they want it, without a UI toggle.

## Out of scope (future improvements)

- Inline plotly / Vega-Lite chart rendering in chat
- Multi-account Galaxy profiles
- Per-message "send to Galaxy" override button
- Welcome screen tutorial / sample analyses
- **Plan switcher dropdown** in masthead — currently only one plan is visible
  in the artifact pane at a time; creating a new plan replaces the view (the
  old plan is preserved on disk as `<title>-notebook.md`). Previous plans can
  only be brought back by asking the agent ("switch to my MRSA plan"). A
  dropdown listing notebooks in the current working directory would let the
  user click to switch directly. ~60 lines: `notebooks:list` IPC handler in
  main, masthead `<select>` element, renderer wiring that on selection sends
  a programmatic prompt to call `analysis_notebook_open`. The findNotebooks(),
  analysis_notebook_open, and analysis_notebook_list pieces already exist in
  `extensions/galaxy-analyst/`.

- **Font upgrade** — chat currently uses Atkinson Hyperlegible (accessibility-
  focused, prioritizes letter distinction over visual rhythm; reads as uneven).
  Replace with Inter (body) + JetBrains Mono (code blocks, tool output, shell
  panel). Inter is geometric, neutral, designed for screens; pairs well with
  the dark Galaxy palette. JetBrains Mono has tall x-height and ligatures
  (`=>`, `!=`, `>=`) that improve readability of code at small sizes.
  Implementation: download woff2 files (Inter Regular/Medium/SemiBold/Bold,
  JetBrains Mono Regular/Bold) into `app/src/renderer/assets/fonts/`, add
  `@font-face` rules to a new `app/src/renderer/fonts.css`, import from
  `index.html`, update two CSS variables in `styles.css` (`--font` and
  `--font-sans`). ~15 minutes. Alternative pairings: IBM Plex Sans + Mono
  (humanist, warmer), Geist + Geist Mono (sharper, more compact).

- **Missing spaces between text blocks after tool calls** — when the agent
  produces text, calls a tool, then produces more text, the chat-panel
  concatenates the two text blocks without a separator. Example:
  `"...find its associated sequencing data.Found the data!"` — no space
  between `data.` and `Found`. Root cause: in `chat-panel.ts` the
  `appendDelta()` path keeps adding to the current message; when a tool
  call interrupts and a new `text_start` fires, the renderer either
  starts a new message (losing visual continuity) or continues the same
  message without inserting whitespace. Fix options:
    1. In `chat-panel.ts`, on `text_start` after a tool call (within the
       same assistant message), prepend `\n\n` to the new text block.
    2. Track `lastWasToolCall` in the message state; if true, insert a
       separator before the next text delta.
    3. Have the extension tell the agent in the system prompt to always
       begin post-tool text with a space or newline. Less reliable — the
       LLM may forget.
  Recommended: option 1 or 2 (renderer-side). ~10 lines in
  `app/src/renderer/chat/chat-panel.ts`.

- **Step kill button (×) on DAG nodes** — let the user cancel a running step
  (and its descendants) directly from the Steps tab without going through
  the agent. Add a small × button to each `StepNode` in
  `app/src/renderer/artifacts/step-graph-react.tsx`, visible on hover or
  always for `in_progress` steps. Click → confirm dialog → kill.

  **Cascade logic** (shared): walk `dependsOn` in reverse from the killed
  step to find all dependents transitively. Mark them `skipped`. Don't touch
  sibling branches.

  **Two implementation paths:**

  - *Path A — LLM-mediated (MVP, ~25 lines).* On click, send a programmatic
    prompt: `"Cancel step <name> (id: <id>) and mark all its dependents as
    skipped"`. Agent calls `cancel_command` + `analysis_plan_update_step` in
    its next turn. Pros: minimal code, no new IPC, no extension changes.
    Cons: LLM round-trip adds 2-5s latency; relies on the agent to correctly
    compute the cascade.

  - *Path B — Direct kill with step→PID tracking (~120 lines).* Extension
    tracks `stepId → pid[]` when `run_command` is invoked while a step is
    `in_progress`. New IPC `step:kill {stepId, cascade: true}` → main →
    agent stdin (new JSON-RPC method) → extension kills PID, walks the
    dependsOn graph, marks statuses, fires `onPlanChange`. DAG updates
    immediately via the existing bridge. Pros: instant and reliable, no
    LLM round-trip. Cons: requires new IPC method and step→PID association
    in the extension.

  **Recommendation**: ship Path A first. Upgrade to Path B if the LLM
  round-trip feels laggy in practice.

- **Process monitor pane** — small collapsible strip showing live stats for
  every command currently spawned by the agent (backgrounded or foreground).
  Fields: PID, command (truncated), CPU %, memory (RSS + %), runtime,
  thread count. Data source: main process walks the agent process tree
  (`pgrep --parent <agent_pid>` recursively, or `ps --forest -p <agent_pid>`)
  every 2-3 seconds, parses `ps -o pid,pcpu,pmem,rss,etime,nlwp,comm`,
  emits `proc:update` IPC events. Renderer subscribes and renders a table.
  No extension cooperation needed — main already knows the agent PID from
  `AgentManager`. Stop polling when the process list is empty to save CPU.

  Placement options: strip at the top of the artifact pane, or bottom of
  the chat pane (mirroring the existing `#agent-shell` pattern). Collapsible.

  Files: `app/src/main/proc-monitor.ts` (new, ~50 lines), `app/src/renderer/
  proc-monitor-panel.ts` (new, ~40 lines), HTML+CSS additions (~30 lines).
  Total ~120 lines, 1-2 hours.

  Platform notes: Linux+macOS share the `ps -o` format. Windows (native)
  would need `wmic` or `tasklist` — skip for now since Windows users run
  via WSL2 which is Linux. RSS is KB on Linux, blocks on macOS; add a
  platform check.

- **Ask-while-running ("/btw" pattern)** — let the user check job status
  without waiting for the current turn to finish. Two complementary pieces:

    1. **Default to background mode for long jobs.** Update the agent's
       system prompt (in `extensions/galaxy-analyst/context.ts`) to instruct
       the LLM: "For commands you estimate will run >30 seconds, use
       background mode. Return the process ID, end the turn, and let the
       user check status with check_process when they ask." This means
       `streaming` becomes false quickly and the user can interject any
       time. ~10 lines (prompt edit only — `run_command` background mode
       already exists).

    2. **Queue-while-streaming UX.** When the agent is mid-turn and the
       user types a message, stash it instead of dropping it. On `agent_end`,
       auto-submit the queued message. Add `pendingMessage: string \| null`
       to renderer state, modify `submit()` to check streaming, modify the
       `agent_end` handler to flush. Show a "queued ↓" indicator near the
       send button so the user knows it's waiting. ~30 lines in
       `app/src/renderer/app.ts`.

  Together these give a Claude-Code-like "/btw" feel without needing a
  side-channel worker or parallel agent runs. True parallel side-channel
  queries (Case 3 in the design discussion) are out of scope — Pi.dev runs
  one turn at a time.

- **Two-model configuration** (planner / executor split) — most cost in the
  app comes from creating plans (reasoning-heavy) versus executing them
  (mostly mechanical: call tool → check result → update step). Today the
  user can switch models manually with `/model sonnet` after the plan is
  approved, but it's a manual step. Add to Preferences:
    - `llm.plannerModel` (default: claude-opus-4-6) — used during plan
      creation / refinement
    - `llm.executorModel` (default: claude-sonnet-4-6) — used after the
      plan is approved or when "Execute" is clicked
  Auto-switch trigger: when the user clicks the Execute button (or when the
  agent transitions a step from `pending` → `in_progress` for the first
  time after plan approval), call the existing `switchModelByAlias()` flow
  with the executor model. The `--continue` flag preserves chat history
  across the switch. The user can override with `/model <name>` at any time.
  Cost impact: ~5x reduction on execution turns (Opus $15/$75 → Sonnet
  $3/$15). ~40 lines: two model fields in Preferences, one config check
  in the execute-plan button handler, one call to `switchModelByAlias`.

---

# Implementation Plan

## Vision

gxy3 replaces Galaxy's user-facing interface. Most bioinformatics analyses can be done locally via an AI agent. Galaxy becomes "headless" — its infrastructure used for large-scale compute and serving foundation models (e.g., AlphaGenome). Target users: the entire Galaxy community (biologists and data analysts).

**Core interaction model**: Chat-only. Biologists describe what they want in natural language. The AI agent handles all technical details. The agent always creates a plan and shows it for approval before executing.

**Workflow understanding**: "Learn by example" — users point at existing pipelines (Snakemake, Nextflow, CWL, WDL, bash) and say "do something like this for my data." The agent reads, understands, and adapts.

## Architecture

```
Electron App
├── Main Process (Node.js)
│   ├── Pi.dev Agent Runtime (LLM interaction, tool-use loop)
│   ├── gxy3 Extension (fresh, references pi-galaxy-analyst patterns)
│   │   ├── Plan Manager (state, notebook persistence, git)
│   │   ├── Execution Engine (shell, conda/containers, process pool)
│   │   ├── Galaxy Bridge (MCP client → galaxy-mcp subprocess)
│   │   └── Workflow Reader (multi-language → agent understanding)
│   └── IPC Layer (typed channels to renderer)
├── Preload (contextBridge)
└── Renderer
    ├── Left: Chat (streaming messages, input bar)
    └── Right: Artifacts (plan text, visual DAG, rendered results, PDF)
```

Key decisions:
1. **Pi.dev as agent runtime** — handles LLM interaction, tool-use loop, streaming. Fresh extension (clean slate, reference pi-galaxy-analyst for patterns).
2. **MCP client** — spawns galaxy-mcp as subprocess via stdio for Galaxy operations.
3. **Agent decides execution** — local (conda, containers, bare shell) vs Galaxy vs hybrid, per step.
4. **Plan-then-execute** — agent always shows plan, waits for user approval before running anything.
5. **State stored locally + optionally on Galaxy server** — user chooses directory or dedicated location.

## Technology Stack

| Component | Technology |
|---|---|
| Desktop | Electron 35+ |
| Build | Vite + electron-forge |
| Language | TypeScript (strict) |
| Agent runtime | Pi.dev (`@mariozechner/pi-coding-agent`) |
| MCP bridge | `pi-mcp-adapter` |
| Markdown | `marked` + `highlight.js` |
| Step graph | SVG + dagre or elkjs |
| Shell exec | `node-pty` |
| Galaxy | `galaxy-mcp` via MCP stdio |
| Testing | Vitest |

## File Structure

```
gxy3/
  package.json
  tsconfig.json
  PLAN.md
  bin/
    gxy3.js                      # CLI entry point (like pi-galaxy-analyst/bin/gxypi.js)

  extensions/
    gxy3/
      index.ts                   # Extension registration, hooks, context injection
      config.ts                  # ~/.gxy3/config.json management
      types.ts                   # Plan data model (reference pi-galaxy-analyst)
      state.ts                   # Plan state machine
      tools.ts                   # All LLM-callable tools
      notebook-writer.ts         # Markdown+YAML persistence
      notebook-parser.ts         # Parse notebooks back to state
      git.ts                     # Auto-commit tracking
      galaxy-api.ts              # Galaxy API helpers
      workflow-reader.ts         # Multi-language workflow reading

  app/                           # Electron shell
    forge.config.ts
    vite.main.config.ts
    vite.preload.config.ts
    vite.renderer.config.ts
    src/
      main/
        main.ts                  # Electron lifecycle, window, menu
        agent.ts                 # AgentManager (spawns gxy3 CLI as RPC subprocess)
        ipc-handlers.ts          # IPC channel registration
      preload/
        preload.ts               # contextBridge API
      renderer/
        index.html
        styles.css
        app.ts                   # Root layout (two-pane)
        chat/
          chat-panel.ts          # Message list, streaming, tool cards
          input-bar.ts           # User input + file attach
        artifacts/
          artifact-panel.ts      # Tab container
          plan-view.ts           # Plan as readable text (not raw YAML)
          step-graph.ts          # Visual DAG (dagre/elkjs + SVG)
          result-viewer.ts       # Tables, images, text
          pdf-viewer.ts          # pdf.js embedded

  tests/
    *.test.ts
```

## LLM Tools (Pi.dev Extension)

Registered via Pi.dev's `ExtensionAPI.registerTool()`:

**Plan tools**:
- `analysis_plan_create` — create plan from user request, show for approval
- `analysis_plan_add_step` — add step to plan
- `analysis_step_update` — update step status/results
- `analysis_checkpoint` — QC checkpoint, pause for user review
- `analysis_set_phase` — transition lifecycle phase

**Execution tools**:
- `run_command` — execute shell command (agent decides conda/container/bare)
- `install_tools` — install bioinformatics tools (agent picks method)
- `check_process` — check running process status

**Galaxy tools** (via MCP bridge to galaxy-mcp):
- `galaxy_connect` — connect to Galaxy instance
- `galaxy_run_tool` — run a Galaxy tool
- `galaxy_invoke_workflow` — run a Galaxy workflow
- `galaxy_upload` — upload data to Galaxy
- `galaxy_get_results` — retrieve results from Galaxy

**File tools**:
- `read_file` — read any file
- `read_pdf` — extract text from PDF
- `write_file` — write output files

**Workflow tools**:
- `read_workflow` — read an existing pipeline in any language, understand its structure and purpose
- `adapt_workflow` — adapt a workflow pattern to new data/parameters

## Artifact Pane Design

```
+----------------------------+-+---------------------------+
| CHAT                       | | ARTIFACTS                 |
|                            | | [Plan] [Steps] [Results]  |
| Agent: I've analyzed the   | |                           |
| paper and identified 59    | | ┌─────────┐  ┌─────────┐ |
| samples with hybrid data.  | | │Download │→│Assemble │ |
| Here's the plan:           | | │ ● done  │  │ ◐ 30/59 │ |
|                            | | └─────────┘  └────┬────┘ |
| [Plan created ✓]           | |              ┌────▼────┐  |
|                            | |              │ Polish  │  |
| Shall I proceed?           | |              │ ○ wait  │  |
|                            | |              └────┬────┘  |
| ┌────────────────────────┐ | |              ┌────▼────┐  |
| │ Yes, go ahead          │ | |              │  QC     │  |
| └────────────────────────┘ | |              │ ○ wait  │  |
+----------------------------+-+---------------------------+
```

**Plan tab**: Readable text summary of what the agent will do. Not raw YAML — a human-friendly rendering. User approves/rejects via chat.

**Steps tab**: Visual DAG with nodes colored by status:
- ○ pending (gray)
- ◐ in progress (blue, with progress count)
- ● completed (green)
- ✗ failed (red)

**Results tab**: Rendered outputs — assembly statistics as formatted tables, QC plots as images, summary text with syntax highlighting.

## Execution Flow

1. User describes analysis in chat (natural language)
2. Agent reads relevant files (PDFs, data, existing workflows)
3. Agent creates plan → shown in artifact pane for approval
4. User approves (via chat: "go ahead" / "looks good" / etc.)
5. Agent executes step by step:
   - Decides tool installation method per tool
   - Decides local vs Galaxy per step
   - Streams progress to step graph
   - Pauses at QC checkpoints for user review
6. Results displayed in artifact pane
7. State saved locally (notebook + git) and optionally to Galaxy server

## Workflow Reading (Learn by Example)

The agent reads existing workflows by:
1. User provides path to workflow files (e.g., S_aureus scripts, nf-core pipeline, Snakemake rules)
2. Agent reads the files directly (using `read_file` tool)
3. Agent understands the structure via its own reasoning — no formal parser needed for MVP
4. Agent uses this understanding to create an adapted plan for new data

For the prototype: the agent reads `/media/anton/data/git/S_aureus/hybrid_assemblies/scripts/*.sh` and the PLAN.md, understands the autocycler assembly pipeline, and can recreate it for different samples.

**Later**: structured parsers for Snakemake/Nextflow/CWL/WDL to extract step dependencies, tool invocations, and resource requirements more reliably.

## Implementation Phases (ASAP Prototype)

### Phase 1: Skeleton
- Electron + Vite + forge setup
- Pi.dev extension skeleton with CLI entry point
- Two-pane layout (chat left, artifacts right)
- Pi.dev agent running in Electron (RPC subprocess pattern from pi-galaxy-analyst)
- Basic chat working (type message, get response)
- **Test**: Launch app, chat with agent

### Phase 2: Plan + Artifacts
- Plan tools (create, add step, update)
- Plan rendering in artifact pane (human-readable text)
- Step graph (visual DAG with dagre/elkjs)
- Plan approval flow (agent shows plan, waits for "go ahead")
- Notebook persistence (markdown+YAML) + git tracking
- **Test**: Ask "plan an assembly for S. aureus", see plan + DAG in artifacts

### Phase 3: Local Execution

#### 3a: Analysis directory setup
When the user starts an analysis (clicks Execute or says "go ahead"), the system prompts for a working directory before anything runs. All execution, outputs, and artifacts live inside this directory.

- On plan approval, show a **directory picker dialog** (default: `~/.gxy3/analyses/<plan-title-slug>/`)
- Agent cwd switches to chosen directory; agent subprocess restarts with new cwd
- The notebook file, all command outputs, and result files are written here
- Directory path shown in a status bar element so user always knows where they are
- If user already set a directory via File > Open Analysis Directory, skip the prompt

Implementation:
- Add IPC call `agent:set-analysis-dir` that picks dir + restarts agent with new cwd
- Extension's `display_plan` emits a `ui:confirm-directory` request before execution begins
- Renderer shows the dialog, sends chosen path back via `agent:ui-response`

#### 3b: Tool installation via bioconda
The agent uses **conda/mamba with bioconda channel** as the default method for installing bioinformatics tools. Each analysis gets its own conda environment.

- `install_tools` tool: takes a list of tool names, creates/reuses a conda env named after the analysis (e.g., `gxy3-mrsa-align`), installs from bioconda+conda-forge
- Agent always runs `install_tools` before first execution step; plan should include an install step
- Uses `mamba` if available, falls back to `conda`
- The env is activated before every `run_command` call (prepend `conda run -n <env>` or source activate)
- System prompt instructs agent to prefer bioconda packages and include install steps in plans

Implementation:
- New tool `install_tools` in extension: params `{tools: string[], envName?: string}`
- Runs `mamba create -n <env> -c bioconda -c conda-forge <tools> -y` (or conda fallback)
- Stores env name in plan state so `run_command` can reference it
- `run_command` tool: params `{command: string, background?: boolean}`
- Wraps command with `conda run -n <env> --no-banner` if env exists
- Uses `child_process.spawn` with shell (not node-pty for v1 — simpler)
- Streams stdout/stderr back via `ctx.ui.setWidget("steps", ...)` updates
- Process management: track PIDs, support `cancel_command` tool

#### 3c: Result rendering in Results tab
When steps complete, the agent sends results (tables, images, text, files) to the Results tab. Results accumulate as the analysis progresses.

- Extension emits results via `ctx.ui.setWidget("results", lines)` where lines contain typed result blocks
- Result types:
  - **text/markdown**: rendered via `marked` (reports, summaries)
  - **table**: JSON `{type:"table", headers:[], rows:[[]]}` → rendered as styled HTML table
  - **image**: `{type:"image", path:"/abs/path.png", caption:"..."}` → rendered as `<img>` with file:// URL
  - **file**: `{type:"file", path:"...", label:"..."}` → clickable link that opens in system viewer
- Results tab auto-switches to visible when new results arrive
- Each result block tagged with the step name that produced it
- `clearResults()` on new analysis start

Implementation:
- Extend `artifact-panel.ts` `addResult()` to parse typed JSON blocks
- Add result block renderer: switch on type, produce HTML
- Extension adds `report_result` tool: agent calls it per step with structured output
- Wire `setWidget("results", ...)` in app.ts `onUiRequest` handler → parse + render

#### 3d: Supporting pieces
- `run_command` tool with `child_process.spawn` (shell mode, streams output)
- `read_pdf` tool: extract text from PDF for the agent to analyze papers
- Real-time step graph updates during execution (already works via `update_step`)
- Process management: track running processes, `cancel_command` tool for kill/cancel

- **Test**: Execute a plan that installs tools via bioconda, runs commands, produces results. See conda env creation, DAG progress updates, and results rendered in Results tab.

### Phase 4: Parameter Configuration & Test Run

#### Context
After a plan is created and shown, the current flow jumps straight to execution. For real bioinformatics pipelines biologists need to review and adjust **critical biological parameters** (organism, expected genome size, coverage thresholds) without being buried in **automatic parameters** (thread counts, file paths, verbose flags). They also need confidence the pipeline actually works before committing to a full run — hence a test run on minimal data.

This phase adds a parameter configuration step between plan display and execution. After the plan is approved "in principle," the agent analyzes every tool the plan uses, identifies critical biological parameters across all tools, and generates a **single consolidated form** (per plan, not per tool) with Galaxy-tool-form-style widgets and biologist-friendly explanations. The user can then optionally run a test with minimal synthetic/subsampled data before the real execution.

#### UX flow
1. Agent creates plan → shown in Plan tab as rendered markdown (existing Phase 2 behavior)
2. Plan tab now has two buttons at the bottom:
   - **"Review parameters"** (primary) — triggers parameter analysis, form **replaces** Plan view
   - **"Execute anyway"** (secondary) — skips parameter review, runs with agent defaults
3. "Review parameters" → agent analyzes every tool, generates `ParameterFormSpec`, emits via `setWidget("parameters", ...)`. The Plan tab content is replaced by the form
4. Form shows parameter groups by **biology concept** (Organism, Input data, Quality thresholds, Output options), not by tool
5. Form has:
   - "← Back to plan" link at top (returns to Plan view, preserves values)
   - **"Test run (minimal data)"** button at bottom
   - **"Execute (real data)"** button at bottom
6. "Test run" → agent generates test data (subsample or synthesize, agent decides per input) in `<analysis_dir>/test_data/`, runs full pipeline with test data, results marked "TEST RUN"
7. "Execute" → full run with configured parameters

#### Parameter form spec shape

```typescript
interface ParameterFormSpec {
  planId: string;
  title: string;                // "Parameters for S. aureus hybrid assembly"
  description: string;          // 1-2 sentences, biologist-friendly
  groups: ParameterGroup[];
}

interface ParameterGroup {
  title: string;                // "Organism & Reference"
  description: string;          // plain-language group explanation
  params: Parameter[];
}

interface Parameter {
  name: string;
  type: "text" | "integer" | "float" | "boolean" | "select" | "file";
  label: string;
  help: string;                 // biologist-centric explanation
  value: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  fileFilter?: string;
  usedBy?: string[];            // tools that use this param (internal)
}
```

Widgets supported (subset of Galaxy): **text, integer, float, boolean, select, file**. Skip `conditional`, `repeat`, `data_collection`, `section` nesting, `drill_down` — agent flattens nested params and uses groups for organization.

#### New tools in extension

1. **`analyze_plan_parameters`** — called when user clicks "Review parameters". Agent inspects the current plan, reasons about each tool's parameters, classifies critical vs automatic, produces the form spec. Emits via `ctx.ui.setWidget("parameters", [JSON.stringify(spec)])`. Returns the spec as the tool result.
2. **`generate_test_data`** — called when user clicks "Test run". Agent decides strategy per input: subsample real files with `seqkit sample` / `head`, or synthesize with `wgsim` / `python`. Creates files in `<analysis_dir>/test_data/`. Returns a map of original path → test data path.
3. **Plan state additions** — extend the in-memory `Plan`:
   ```typescript
   interface Plan {
     ...existing...
     parameters?: Record<string, unknown>;   // configured values
     testMode?: boolean;                      // true during test run
     testDataMap?: Record<string, string>;   // real path → test path
   }
   ```
   `run_command` substitutes test paths when `testMode` is true.

#### UI changes

- `app/src/renderer/index.html`: add `<div id="plan-parameters">` inside `#tab-plan`, rename "Execute" → "Execute anyway", add "Review parameters" button
- `app/src/renderer/artifacts/parameter-form.ts` (NEW): `class ParameterForm` with `render(spec)`, `getValues()`, `clear()`, `setDisabled()` and widget renderers per type
- `app/src/renderer/artifacts/artifact-panel.ts`: add `showParameters(spec)`, `hideParameters()`, `getParameterValues()` methods
- `app/src/renderer/app.ts`: handle `setWidget("parameters", ...)`, wire new buttons, send configured params back to agent via prompts
- `app/src/renderer/styles.css`: form field, group, widget styles; TEST RUN banner for results

#### System prompt additions

Add to `before_agent_start` systemPromptSuffix:
```
When calling analyze_plan_parameters, classify every tool parameter as follows:
- INCLUDE as critical (user-visible):
  * Organism/species, reference genome, taxonomy
  * Expected genome/transcriptome size
  * Biological thresholds (coverage, identity, length, quality)
  * Read types (paired/single, short/long)
  * K-mer sizes, sensitivity modes
  * Sample names or sample metadata
  * Any parameter whose change alters biological interpretation
- EXCLUDE as automatic (hidden):
  * Thread/CPU count, memory limits
  * Intermediate output file paths
  * Verbose/progress/debug flags
  * Tool versions, output formats
  * Any parameter that only affects runtime or disk usage
Group parameters by biology concept (not by tool). Write help text for
biologists — explain what the parameter means biologically, not how the
tool uses it. Use defaults from the source workflow if provided, otherwise
pick sensible defaults for the organism/analysis type.

When generate_test_data is called:
- If the plan references existing real files, subsample them with
  seqkit/head/awk into <analysis_dir>/test_data/
- If no real inputs exist yet, synthesize tiny files using wgsim/python/echo
- Test data should let the full pipeline run in under 5 minutes
- Preserve original file extensions and formats
```

#### Test
1. Ask agent: "Plan an S. aureus hybrid assembly with autocycler"
2. Plan appears → click **"Review parameters"** → form replaces plan view with groups (Organism & Reference, Coverage & Quality, etc.) and biologist-friendly help text
3. Edit a value (min ONT coverage 15 → 20), click "← Back to plan", click "Review parameters" again → value preserved
4. Click **"Test run"** → agent creates test subdir, runs full pipeline on subsample/synthetic data, results tagged "TEST RUN"
5. Click **"Execute"** from form → full run with configured params
6. From plan view, click **"Execute anyway"** → skips param review, runs with defaults

### Phase 5: Plan-First Workflow

#### Context

For real reproducibility every analysis must start with a written plan that the user explicitly approves before any execution. Today the agent can call `run_command` directly, the renderer has an "Execute anyway" button that bypasses parameter review entirely, and Pi.dev's built-in `bash`/`write`/`edit` tools sit outside any gxy3 control. Nothing in the system enforces a "plan → review → approve → execute" flow.

User decision: **soft warning, never hard-block**. The system prompt strictly enforces plan-first; tools emit warnings when executed without an approved plan; but no tool refuses to run. This preserves freedom for ad-hoc exploration while making the "right path" visually obvious.

#### Plan state machine

Extend the `Plan` interface in `extensions/gxy3/index.ts`:

```typescript
interface Plan {
  ...existing fields...
  approvalState: "draft" | "approved" | "executing" | "completed";
  approvedAt?: string;
  approvedParameters?: Record<string, unknown>;
  approvalEvents: ApprovalEvent[];   // append-only log
}

interface ApprovalEvent {
  timestamp: string;
  action: "draft_created" | "approved" | "execution_started" |
          "execution_completed" | "plan_modified_after_approval";
  details?: string;
}
```

Transitions:
- `display_plan` → `draft`. If a previously-approved plan is replaced, log `plan_modified_after_approval`.
- User clicks Execute / Test run → renderer sends approval prompt → agent calls new `mark_plan_approved` tool → state becomes `approved`, snapshot taken.
- First `run_command`/`install_tools` after approval → `executing`.
- Last `update_step(completed)` → `completed`.
- All transitions append to `approvalEvents`, persisted in the notebook.

#### New tool: `mark_plan_approved`

Called by the agent when the user clicks Execute. Parameters: `parameters: Record<string, unknown>`. Sets state to `approved`, snapshots params, appends event. Returns reminder to call `reset_plan_steps` next.

#### Soft warning on un-approved execution

In `run_command` and `install_tools`, before executing, compute a warning string based on `currentPlan?.approvalState`:

- No plan → "⚠ No plan exists. This command runs ungoverned and won't appear in the DAG."
- `draft` → "⚠ Plan not approved. The user has not clicked Execute. Reproducibility broken."
- `completed` → "⚠ Plan marked completed. This command runs after the plan finished."

The warning is:
- Prepended to the tool result text (so the agent sees it on the next turn)
- Persisted into the notebook
- Emitted to the **agent shell** as a red `tool-error` line
- Counted in a session counter for the RO-Crate metadata

Execution still happens — soft enforcement.

#### System prompt rewrite

Replace the execution-workflow guidance in `before_agent_start` with a strict plan-first contract:

```
PLAN-FIRST CONTRACT (CRITICAL):

1. EVERY analysis MUST start with display_plan. Your FIRST response to any
   request that requires execution is a plan via display_plan — NEVER a
   direct tool call to run_command, bash, install_tools, etc.

2. After display_plan, WAIT. Do not execute anything until you receive an
   explicit message that the plan was approved ("User clicked Execute...").

3. When approved, your FIRST tool call MUST be mark_plan_approved with the
   configured parameters. Then reset_plan_steps. Then execute step by step.

4. NEVER use Pi.dev's built-in bash/write/edit for execution work. ALWAYS
   use gxy3's run_command. The bash tool is only for trivial informational
   queries (e.g., "ls" to peek at a directory).

5. If you need to modify the plan mid-run, call display_plan again. This
   resets approval — STOP and ask the user to re-approve.

6. If you find yourself wanting to run a command and no approved plan
   exists, STOP. Call display_plan first.

The plan is the contract. Without an approved plan there is no reproducibility.
```

#### Renderer changes

- **Remove "Execute anyway" button entirely.** No path bypasses plan creation.
- "Review parameters" still triggers `analyze_plan_parameters`.
- "Test run" / "Execute" buttons send a structured approval prompt that asks the agent to call `mark_plan_approved` first, then `reset_plan_steps`, then execute.
- **New approval indicator** in the masthead between the model badge and the usage bar:
  - `● Plan: none` (grey) — no plan yet
  - `● Plan: draft` (orange) — shown, not approved
  - `● Plan: approved` (blue) — approved, not running
  - `● Plan: executing` (animated blue)
  - `● Plan: completed` (green)
- The badge updates via a new `setStatus("approval_state", ...)` widget key emitted by the extension on every state transition.

#### Files to modify

| Path | Action |
|---|---|
| `extensions/gxy3/index.ts` | Add `approvalState` + `ApprovalEvent` to Plan; new `mark_plan_approved` tool; warning logic in `run_command` / `install_tools`; rewritten system prompt; emit `setStatus("approval_state", ...)` on transitions |
| `app/src/renderer/index.html` | Remove "Execute anyway" button; add approval badge in masthead |
| `app/src/renderer/app.ts` | Remove Execute Anyway handler; update Test/Execute handlers to send approval prompt; listen for `setStatus("approval_state", ...)` and update badge |
| `app/src/renderer/styles.css` | Approval badge styles |

#### Test

1. Fresh instance + `/new`
2. "Plan an S. aureus assembly" → agent calls `display_plan` → masthead **● Plan: draft** (orange)
3. Without clicking Execute, type "now run it" → agent should refuse and ask to approve. If it cheats, the warning appears in the result + agent shell + notebook
4. Click "Review parameters" → form appears
5. Click "Execute" → agent calls `mark_plan_approved` → masthead **● Plan: approved** (blue) → execution begins → **● Plan: executing**
6. Notebook now contains `approvalEvents` with timestamps
7. While executing, ask "add a visualization step" → agent calls `display_plan` again → masthead drops back to **● Plan: draft** with `plan_modified_after_approval` event

### Phase 6: Galaxy Bridge
- MCP bridge to galaxy-mcp subprocess
- Galaxy tools (connect, run, upload, get results)
- Mixed execution (some steps local, some on Galaxy)
- State sync to Galaxy server
- **Test**: Connect to usegalaxy.org, run a tool, retrieve results

### Phase 7: End-to-End Prototype
- Full S_aureus scenario: "analyze this paper, assemble with autocycler"
- Agent reads PDF, reads existing S_aureus scripts as examples
- Agent creates plan, user approves, agent executes
- Results displayed in artifact pane
- **Test**: Complete the prototype scenario from the Goal section

### Phase 8: Artifact sharing via GitHub

Agent-driven git operations. No new Preferences UI — keep settings simple.

- New `git_push` tool (or the agent just uses `run_command`):
  - Detects available auth in this order:
    1. `gh` CLI authenticated (`gh auth status`) → use it
    2. SSH key configured (`ssh -T git@github.com`) → use it
    3. Neither → ask the user in chat what to do (create PAT, install gh, etc.)
  - Runs git init/add/commit/push in the analysis directory
  - Creates the remote repo on demand via `gh repo create` if needed
- Usage: user says "push this analysis to GitHub" → agent handles everything
- Author name/email: read from global git config (`git config user.name`); if unset,
  agent asks the user once and saves via `git config --global`
- Notebook auto-commit already happens locally (Phase 2); push is a separate action
- **Test**: After running an analysis, say "push to github" — agent pushes to a new
  or existing repo, reports the URL in chat

### Phase 9: RO-Crate Session Packaging (LAST)

#### Context

Once an analysis is complete the user needs a portable, standards-compliant container of everything that happened: plan, parameters, environment, commands, results, provenance. Without this, sharing means sending a tarball with no metadata; replay is impossible.

User decision: **Workflow Run RO-Crate** (the WorkflowHub / Bioschemas standard, <https://www.researchobject.org/workflow-run-crate/>). JSON-LD metadata + the full analysis directory, optionally zipped. Supported by WorkflowHub, Galaxy, nf-core.

#### What gets captured

1. **Plan** — markdown content + structured steps + commands/results
2. **Parameters** — raw form spec, configured values, the approved snapshot
3. **Approval events** — full timeline of `draft → approved → executing → completed`
4. **Conda environment** — `conda env export -n <env>` YAML output
5. **Commands** — every shell command that ran with stdout/stderr summaries
6. **Result files** — anything written to the analysis directory
7. **Chat history** — the full LLM conversation (Pi.dev already writes this to `~/.pi/agent/sessions/`)
8. **Tool versions** — package versions from the conda env
9. **Provenance** — model used, costs, timestamps, gxy3 version
10. **Warnings** — count of unapproved commands, errors

#### Output structure

```
<analysis_dir>/
├── ro-crate-metadata.json           # JSON-LD root descriptor
├── ro-crate-preview.html            # human-readable summary
├── plan.md                          # the plan (existing notebook)
├── parameters.json                  # configured parameters
├── approval-log.json                # approval events
├── environment.yaml                 # conda env export
├── chat-history.jsonl               # LLM conversation
├── commands.jsonl                   # every command + result
├── reference/                       # input data (existing)
├── results/                         # output files (existing)
└── ...
```

The `ro-crate-metadata.json` is JSON-LD declaring:
- The directory as a `Dataset` with `conformsTo` Workflow Run Crate profile
- Every file with MIME type and role (input/output/intermediate)
- The workflow as a `ComputationalWorkflow` with steps as `HowToStep`
- Each tool execution as a `CreateAction` with start/end times, agent, IO refs
- The agent as a `SoftwareAgent` with model id and provider

#### Implementation

**New tool: `package_session`**

```typescript
pi.registerTool({
  name: "package_session",
  description: "Package the current analysis as a Workflow Run RO-Crate. " +
    "Creates ro-crate-metadata.json and optional .crate.zip in the analysis " +
    "directory. Call when user asks to 'package', 'export', 'share', 'wrap up'.",
  parameters: Type.Object({
    zip: Type.Optional(Type.Boolean({ description: "Also create a .crate.zip" })),
  }),
  // ... walks the analysis dir, snapshots conda env, exports approval log + 
  // parameters + commands, generates JSON-LD + preview HTML, optionally zips
});
```

**New file: `extensions/gxy3/ro-crate-builder.ts`** — `class ROCrateBuilder` with methods to scan files, classify them, build the JSON-LD `@graph`, and emit the metadata + preview HTML.

**New slash command: `/package`** — user-facing shortcut that sends a prompt asking the agent to call `package_session(zip: true)`.

#### Files to modify / create

| Path | Action |
|---|---|
| `extensions/gxy3/index.ts` | Add `package_session` tool |
| `extensions/gxy3/ro-crate-builder.ts` | **NEW** — JSON-LD generator + file scanner |
| `app/src/renderer/app.ts` | Add `/package` slash command |
| `app/src/renderer/index.html` | Update input hint to mention `/package` |

#### Test

1. Run a complete S_aureus analysis (Phases 5–8 done)
2. Type `/package` → agent calls `package_session(zip: true)`
3. Verify `<analysis_dir>/ro-crate-metadata.json` exists and is valid JSON-LD
4. Verify `<analysis_dir>/<title>.crate.zip` exists and unpacks cleanly
5. Validate with the `rocrate-validator` Python package
6. Open `ro-crate-preview.html` → shows plan title, steps, files, agent info
7. Upload the `.crate.zip` to WorkflowHub → accepted

### UI refresh: Step graph → React Flow

The current step DAG (`app/src/renderer/artifacts/step-graph.ts`, ~252 lines of hand-rolled SVG + DOM) is hard to look at: nodes overlap with parallel siblings, SVG connectors don't always reach the right anchors, and in-place expand causes visible layout jitter. Replace it with **React Flow** (`@xyflow/react`).

**Architecture: React island in a vanilla TS app.** The renderer stays vanilla TypeScript except for the Steps tab, which mounts a single React root via `createRoot()`. The new file `step-graph-react.tsx` exports a class `StepGraph` with the **same interface** (`new StepGraph(container)`, `render(steps)`) so `app.ts` only needs a one-line import path change. The extension and step data shape are unchanged.

**Layout direction**: top → bottom (vertical), matching current style (user choice).
**Node detail**: click → side panel slides in from the right; graph area shrinks. No layout reflow on expand/collapse (user choice — cleaner than inline expand).

**Dependencies to add** (`app/package.json`):
- `react@^18`, `react-dom@^18`
- `@xyflow/react@^12` (React Flow core)
- `@dagrejs/dagre@^1` (vertical DAG layout)
- Dev: `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`

Bundle impact: ~150 KB gzipped — fine for an Electron desktop app.

**Build config changes:**
- `app/vite.renderer.config.ts` — add `react()` plugin
- `app/tsconfig.json` — add `"jsx": "react-jsx"`

**Component design** (`step-graph-react.tsx`):
- Class `StepGraph` wraps a React root, exposes `render(steps: Step[])` with the existing interface
- Inner React component:
  - State: `steps`, `selectedId` (which node is showing detail)
  - Computes nodes/edges via `useMemo` from steps
  - Custom `StepNode` component (status icon, title, description, optional result badge)
  - Smooth-step edges colored by source-step status; animated when source is `in_progress`
  - `<ReactFlow>` configured: `fitView`, no draggable nodes, no manual connections, controls visible, attribution hidden
- `StepDetailPanel` slides in when a node is clicked, shows description / explanation / command (in monospace block) / result; close button to dismiss
- Layout via dagre `rankdir: "TB"`, fixed node width (280px) so spacing is predictable

**CSS changes** (`app/src/renderer/styles.css`):
- Remove `.dag-*`, `.step-dag`, `.dag-row` rules (~190 lines, lines ~1122–1309)
- Add `.sg-*` rules (~120 lines): node, status variants, indicator, content, result badge, side panel, command pre block
- Reuse existing palette vars (`--state-ok-bg`, `--state-running-bg`, `--state-error-bg`, etc.)
- In-progress nodes get a pulsing box-shadow animation

**Files modified:**

| Path | Action |
|---|---|
| `app/package.json` | Add React + React Flow + dagre + plugin-react |
| `app/vite.renderer.config.ts` | Add `react()` plugin |
| `app/tsconfig.json` | Add `"jsx": "react-jsx"` |
| `app/src/renderer/artifacts/step-graph-react.tsx` | **NEW** — class wrapper, React component, custom node, side panel, dagre layout |
| `app/src/renderer/artifacts/step-graph.ts` | **DELETE** |
| `app/src/renderer/app.ts` | One-line import path change |
| `app/src/renderer/styles.css` | Remove `.dag-*` rules; add `.sg-*` rules |

**Verification:**
1. `cd app && npm install` — pulls deps
2. `npx tsc --noEmit` — typechecks cleanly
3. `node dev.mjs` — app starts, no JSX errors in DevTools console
4. Ask agent: "Plan an S. aureus assembly with autocycler" → plan with 6+ steps appears
5. Steps tab → React Flow renders top-to-bottom DAG with smooth-step edges
6. Status colors: pending=grey, in_progress=orange + pulse + animated edge, completed=green, failed=red
7. Click a node → side panel slides in with description / command / result / explanation
8. Click again → panel closes
9. Pan/zoom with mouse; Controls "fit view" re-frames
10. Trigger an update from the agent (test run) — DAG re-renders without losing pan/zoom inappropriately

### Multi-window sessions + Recent Analyses

Today gxy3 is one window, one session. There's no easy way to return to a previous analysis and no way to run two analyses concurrently in the same app. The chosen approach (user's choice: **Option A**, not a Claude-style chat-list sidebar) is:

- **Each gxy3 window is a fully-isolated session.** Multi-window already gives true parallel execution — two conda installs, two pipelines side-by-side.
- **File → New Session Window** (⇧⌘N) spawns a second window in the same Electron process, independent agent and cwd
- **File → Open Recent** dynamic submenu lists the last ~10 analyses with relative timestamps; click → current window switches cwd, agent restarts with `--continue`, extension re-hydrates the plan from the notebook
- **Session picker on first launch**: a non-blocking modal that shows recent analyses and lets the user continue one or start fresh
- **NO state-swapping without restart** — switching sessions = stop current agent + start new one. No mid-execution switches. This removes the nastiest edge cases and makes the feature simple.

#### Blocker to fix first

The current main process has a global `mainWindow` and `agentManager`, and `registerIpcHandlers()` uses `ipcMain.handle()` which silently overwrites handlers. Calling `createWindow()` twice would double-register handlers and orphan the first window. Fix: **per-window state map + IPC dispatch by sender**:

```typescript
interface WindowState { window: BrowserWindow; agent: AgentManager; }
const windows = new Map<number, WindowState>();  // keyed by window.id

function getAgentForEvent(event: Electron.IpcMainInvokeEvent): AgentManager | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? windows.get(win.id)?.agent ?? null : null;
}

ipcMain.handle("agent:prompt", async (event, message) => {
  getAgentForEvent(event)?.send({ type: "prompt", message });
});
// ...all other handlers use the same pattern
```

IPC registration runs **once at app startup**, not per window.

#### Global session registry: `~/.gxy3/recent-analyses.json`

**This file is the single source of truth for "all sessions gxy3 knows about."** It's a flat list of absolute paths, so sessions can live anywhere on disk — under `~/.gxy3/analyses/` (the default location for new sessions), under `~/projects/paper/mrsa-data/`, `/scratch/bio/rnaseq/`, or any arbitrary path the user picks.

**Format:**
```json
{
  "entries": [
    {
      "path": "/scratch/bio/kaku2022-variants",
      "title": "MRSA variant calling — Kaku et al. 2022",
      "planId": "abc12345",
      "updated": "2026-04-10T13:45:00Z",
      "status": "completed"
    },
    {
      "path": "/home/anton/.gxy3/analyses/s-aureus-assembly",
      "title": "S. aureus hybrid assembly",
      "planId": "def67890",
      "updated": "2026-04-09T20:01:00Z",
      "status": "draft"
    }
  ]
}
```

**When it's written/updated:**
1. **On any cwd change** (Open Analysis Directory, Open Recent, session picker click, default-cwd-on-launch): the main process pushes the new cwd to the top of the list (or updates the existing entry). If no `*-notebook.md` exists in the new cwd yet, title is set to the cwd basename.
2. **On `saveNotebook()`** in the extension: the extension emits a `notebook_updated` status message with `{path, title, planId, updated, status}` payload. The renderer forwards it to the main process via a new IPC channel `analyses:update-entry`. Main process updates the matching entry (by path).
3. **On plan approval state transitions**: `status` field is updated (`draft` → `approved` → `executing` → `completed`).

**When it's read:**
- On File menu open → build the Open Recent submenu
- On first window load → to decide whether to show the session picker
- On app startup → sanity-check that listed paths still exist; drop any that don't

**Bootstrap fallback** (first run on an upgrading install, or if the file is missing): walk `~/.gxy3/analyses/*/` for `*-notebook.md` files (the default location where old sessions would be), parse YAML frontmatter for title + updated, populate the file. Skipped on subsequent launches.

**User-specific directories** (like `/scratch/bio/...`) are ONLY discovered via use — gxy3 never scans outside `~/.gxy3/analyses/`. Once the user picks a custom dir via Open Analysis Directory, it's added to the registry and appears in Recent from then on.

**Deduplication:** entries are keyed by absolute path. If the user opens the same cwd twice, the existing entry moves to the top (not duplicated).

#### What happens on cwd change (the unified flow)

Three different actions all end up executing the same sequence in the **current window**:

- **File → Open Analysis Directory…** (existing menu item, ⌘O) — user picks any directory
- **File → Open Recent →** a recent analysis
- **Session picker → Continue** on first launch

The sequence:

1. If the current window's agent is **executing a tool** (plan in `executing` state, or a run_command is live), **refuse** the switch and show a toast:
   *"Analysis is running. Wait for it to finish, abort first, or open in a new window (⇧⌘N)."*
2. `agent.stop()` — kill the current agent subprocess. Clear pending IPC responses.
3. `agent.setCwd(newDir)` — update the cwd variable (already resets `hasStartedBefore`)
4. `agent.start()` — spawn a fresh subprocess with the new cwd
5. Renderer: clear chat panel, clear DAG, clear Results tab, hide parameter form if showing — reset all UI to empty
6. Extension's `session_start` hook fires in the new cwd:
   - Check for any existing `*-notebook.md` in the cwd
   - If found: parse it back into `currentPlan` (title, content, steps, approvalState, parameters). Emit `setWidget("plan", ...)`, `setWidget("steps", ...)`, `setWidget("parameters", ...)` to repopulate the UI. **Do not send the welcome message** — the plan IS the context
   - If not found: fresh session, normal welcome
7. Main process: push the new cwd to the top of `recent-analyses.json`

**Important clarification:** all three entry points (Open Analysis Directory, Open Recent, session picker) operate on the **current window only**. To work on a new analysis without disturbing the current session, the user must first open a **New Session Window** (⇧⌘N), then pick the directory in the fresh window.

**Fixes a pre-existing bug:** today `File → Open Analysis Directory` only updates the cwd variable and sends a text message — the agent subprocess keeps running in the OLD cwd, so subsequent tool calls execute in the wrong directory. The new flow restarts the agent, which is the correct behavior.

#### Concurrent execution safeguards

- **Conda env name collisions**: namespace the env name with `currentPlan.id` (already a uuid slice) → `gxy3-<planId>-variant-calling`. Different sessions → different ids → no collision.
- **Pi.dev session files**: already isolated per-cwd via `--continue` picking the latest in the cwd.
- **Notebook files**: already per-cwd.

#### Files to modify

| Path | Action |
|---|---|
| `app/src/main/main.ts` | Per-window state map; register IPC once; "New Session Window" + "Open Recent" menu items; recent-analyses persistence |
| `app/src/main/ipc-handlers.ts` | Refactor every handler to look up AgentManager by `event.sender`; add `analyses:list-recent`, `analyses:open`, `analyses:clear-recent`, `window:new-session` |
| `app/src/preload/preload.ts` | Expose `listRecentAnalyses()`, `openAnalysisDir(path)`, `newSessionWindow()` |
| `app/src/renderer/index.html` | Session picker modal markup (reuse `.modal-overlay` / `.modal` classes from Preferences) |
| `app/src/renderer/styles.css` | Minor additions for the session picker list items |
| `app/src/renderer/app.ts` | On first window load, check `listRecentAnalyses()`; if non-empty, show picker; wire Cancel / Continue handlers |
| `extensions/gxy3/index.ts` | Namespace conda env with `currentPlan.id`; parse existing notebook in new cwd on `session_start` and re-emit UI widgets; emit `notebook_updated` status after `saveNotebook()` |

#### Test

1. **Clean slate**: remove `~/.gxy3/recent-analyses.json` → launch gxy3 → no picker, default greeting. Ask for a plan → notebook saved → persistence file created
2. **Relaunch**: quit + launch → session picker shows the recent analysis → click Continue → cwd switches, plan re-hydrates, chat stays empty
3. **Recent menu**: File → Open Recent → submenu lists analyses with relative timestamps
4. **New session window** (⇧⌘N): second window opens independently
5. **Parallel execution**: start a long install in window 1, start an analysis in window 2 → both work
6. **Close window**: close window 1 while window 2 is running → window 2 keeps going; close window 2 → app quits

#### What we're NOT doing

- Sidebar chat-list UI in the same window
- Mid-execution switches / pausing processes
- Rename / delete / duplicate actions on recent entries (can add later)
- Cross-window sync

## References

- `/media/anton/data/git/pi-galaxy-analyst/` — patterns for extension architecture, tools, notebook, Electron shell
- `/media/anton/data/git/S_aureus/` — prototype analysis (bash scripts, PLAN.md)
- `/media/anton/data/git/galaxy-mcp/` — MCP server for Galaxy integration
- `/media/anton/data/git/galaxy-skills/` — knowledge base for Galaxy development
- `/media/anton/data/git/galaxy-brain/` — research vault
- `/media/anton/data/git/galaxy/` — Galaxy platform codebase
- React Flow docs: https://reactflow.dev/learn — built-in node types, layout via dagre
- Dagre layout recipe for React Flow: https://reactflow.dev/learn/layouting/layouting