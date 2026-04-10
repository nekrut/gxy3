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

### Phase 5: Galaxy Bridge
- MCP bridge to galaxy-mcp subprocess
- Galaxy tools (connect, run, upload, get results)
- Mixed execution (some steps local, some on Galaxy)
- State sync to Galaxy server
- **Test**: Connect to usegalaxy.org, run a tool, retrieve results

### Phase 6: End-to-End Prototype
- Full S_aureus scenario: "analyze this paper, assemble with autocycler"
- Agent reads PDF, reads existing S_aureus scripts as examples
- Agent creates plan, user approves, agent executes
- Results displayed in artifact pane
- **Test**: Complete the prototype scenario from the Goal section

### Phase 7: Artifact sharing via GitHub

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

## References

- `/media/anton/data/git/pi-galaxy-analyst/` — patterns for extension architecture, tools, notebook, Electron shell
- `/media/anton/data/git/S_aureus/` — prototype analysis (bash scripts, PLAN.md)
- `/media/anton/data/git/galaxy-mcp/` — MCP server for Galaxy integration
- `/media/anton/data/git/galaxy-skills/` — knowledge base for Galaxy development
- `/media/anton/data/git/galaxy-brain/` — research vault
- `/media/anton/data/git/galaxy/` — Galaxy platform codebase
- React Flow docs: https://reactflow.dev/learn — built-in node types, layout via dagre
- Dagre layout recipe for React Flow: https://reactflow.dev/learn/layouting/layouting