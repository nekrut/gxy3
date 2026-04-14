# gxy3

AI-driven bioinformatics analysis desktop app. Replaces Galaxy's web UI with a chat-based interface where biologists describe analyses in natural language and an AI agent handles execution — locally for small/medium tasks, on Galaxy for large-scale compute.

## How it works

1. User describes an analysis in the chat pane (e.g., "assemble these MRSA genomes with autocycler")
2. Agent creates a plan and displays it in the artifact pane for review
3. User approves (edits optional), agent executes step by step
4. Progress shown as a visual DAG; results rendered in the Results tab

## Architecture

```
Electron App
├── Main Process (Node.js)
│   ├── Pi.dev Agent Runtime (LLM interaction, tool-use loop)
│   ├── gxy3 Extension (plan management, execution, Galaxy bridge)
│   └── IPC Layer (typed channels to renderer)
├── Preload (contextBridge)
└── Renderer (two-pane layout)
    ├── Left:  Chat (streaming messages, thinking indicator, tool cards)
    └── Right: Artifacts (plan editor, visual DAG, typed results)
```

## Tech stack

| Component | Technology |
|---|---|
| Desktop | Electron 35 |
| Build | Vite + electron-forge |
| Language | TypeScript (strict) |
| Agent | Pi.dev (`@mariozechner/pi-coding-agent`) |
| MCP bridge | `pi-mcp-adapter` |
| Markdown | `marked` |
| UI theme | Galaxy-derived (Atkinson Hyperlegible, Galaxy color palette) |

## Current state

### Phase 1: Skeleton ✓
- Electron + Vite + forge setup
- Pi.dev agent running as RPC subprocess
- Two-pane layout with draggable divider
- Chat with streaming markdown and tool cards

### Phase 2: Plan + Artifacts ✓
- `display_plan` / `update_step` / `get_plan` tools
- Plan rendering (markdown + raw edit modes)
- Visual DAG with SVG bezier connectors and branching for parallel steps
- Clickable step nodes showing executed command + explanation
- Galaxy-style history item colors for step status (green=done, orange=running, red=failed)
- Notebook persistence (markdown+YAML) with git auto-commit
- Thinking indicator ("... thinking" bubble + status badge)
- Working directory display in header with change button

### Phase 3: Local Execution ✓
- `install_tools` — conda/mamba env creation with bioconda+conda-forge
- `run_command` — shell execution with auto conda env activation, background mode, timeout
- `check_process` / `cancel_command` — process management
- `report_result` — typed results to Results tab (markdown, tables, images, file links)
- HTML reports open in a new Electron window
- Session token/cost display in header (pricing for Claude 4.5/4.6, GPT-4o, o1, Gemini 2.5)
- Preferences dialog (⌘,): LLM provider/model/key, Galaxy credentials, default directory, package manager

### Phase 4: Galaxy Bridge (planned)
- MCP bridge to galaxy-mcp subprocess
- Galaxy tools (connect, run, upload, get results)
- Mixed local + Galaxy execution

### Phase 5: End-to-End (planned)
- Full prototype scenario: read paper, plan assembly, execute, display results
- Workflow reader (learn from existing Snakemake/Nextflow/CWL pipelines)

### Phase 6: GitHub artifact sharing (planned)
- Agent-driven `git push` via existing `gh` CLI / SSH / PAT
- No new UI — agent detects auth and handles everything through chat

## Installation

### Prerequisites (all platforms)

- [Node.js](https://nodejs.org/) 20+ (LTS recommended)
- [Conda](https://github.com/conda-forge/miniforge) or Mamba (for bioinformatics tool installation)
- An LLM API key (Anthropic, OpenAI, or Google) — configured in Preferences on first launch

### Linux

```bash
git clone https://github.com/nekrut/gxy3.git
cd gxy3 && npm install
cd app && npm install
npm start
```

### macOS

```bash
git clone https://github.com/nekrut/gxy3.git
cd gxy3 && npm install
cd app && npm install
npm start
```

Requires Xcode Command Line Tools (`xcode-select --install`) for native module compilation.

### Windows (via WSL2)

gxy3 runs on Windows inside WSL2 (Windows Subsystem for Linux). WSLg provides the graphical display automatically.

**Step 1 — Install WSL2** (PowerShell as Administrator):
```powershell
wsl --install --web-download -d Ubuntu
```
Reboot, then open **Ubuntu** from the Start menu and create your Linux user.

**Step 2 — Run the setup script** (inside Ubuntu):
```bash
curl -fsSL https://raw.githubusercontent.com/nekrut/gxy3/master/scripts/setup-wsl.sh | bash
source ~/.bashrc
```

This installs Node.js, Miniforge (conda+mamba), and clones gxy3.

**Step 3 — Launch**:
```bash
cd ~/gxy3/app && npm start
```

> **Tips for Windows/WSL2:**
> - Keep analysis data inside `~/` (the WSL2 filesystem) for best performance
> - Avoid working on `/mnt/c/` paths — cross-filesystem access is slow
> - Windows 11 has WSLg built in; Windows 10 needs `wsl --update`

### Configuration

On first launch, open Preferences (gear icon or `Cmd/Ctrl+,`) to set:
- **LLM provider** and API key (Anthropic, OpenAI, Google, or Ollama for local models)
- **Working directory** for analysis output
- **Package manager** preference (auto/mamba/conda)

## Project structure

```
gxy3/
  bin/gxy3.js                     CLI entry point (Pi.dev agent)
  extensions/gxy3/index.ts        Extension: tools, plan state, execution
  app/
    src/main/main.ts              Electron lifecycle, window, menu
    src/main/agent.ts             Agent subprocess manager (RPC)
    src/main/ipc-handlers.ts      IPC channel registration
    src/preload/preload.ts        contextBridge API
    src/renderer/
      app.ts                      Root UI, event wiring, tab switching
      chat/chat-panel.ts          Chat messages, streaming, thinking indicator
      artifacts/
        artifact-panel.ts         Plan editor, result block renderer
        step-graph.ts             Visual DAG with SVG connectors
      styles.css                  Galaxy-derived light theme
```
