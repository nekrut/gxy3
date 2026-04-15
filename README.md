# orbit

AI-driven bioinformatics analysis desktop app in the Galaxy Project ecosystem. Replaces Galaxy's web UI with a chat-based interface where biologists describe analyses in natural language and an AI agent handles execution — locally for small/medium tasks, on Galaxy for large-scale compute.

> Internal / repo name: `gxy3`. The user-facing name is **orbit**.

## How it works

1. User describes an analysis in the chat pane (e.g., "assemble these MRSA genomes with autocycler")
2. Agent creates a plan and displays it in the artifact pane for review
3. User reviews parameters (`/review`), approves, and runs the plan (`/test` on sample data, `/execute` on real data)
4. Progress shown as a visual DAG; results rendered in the Notebook tab

## Architecture

```
Electron App
├── Main Process (Node.js)
│   ├── Pi.dev Agent Runtime (LLM interaction, tool-use loop)
│   ├── galaxy-analyst extension (plan management, 5-phase lifecycle, Galaxy API)
│   ├── Process monitor (ps tree polling for live subprocess stats)
│   └── IPC Layer (typed channels to renderer)
├── Preload (contextBridge)
└── Renderer
    ├── Chat pane (streaming messages, thinking indicator, tool cards, queue-while-streaming)
    └── Artifact pane (collapsible; Plan / Steps / Notebook tabs)
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
| DAG | React Flow + dagre |
| Fonts | Inter (body), JetBrains Mono (code) |
| Theme | Galaxy brand dark (`#2c3143` + gold accent `#ffd700`) |

## Current state

### Implemented
- **Electron shell** with streaming chat, thinking indicator, tool cards, queue-while-streaming
- **Single-pane chat by default**; artifact pane auto-reveals when the agent creates a plan, collapsible via button or `Cmd/Ctrl+\`
- **React Flow DAG** in the Steps tab (dagre layout, clickable nodes with details panel)
- **Plan tab** with rendered markdown + raw edit modes
- **Notebook tab** with typed result blocks (markdown, tables, images, file links)
- **Process monitor** — live stats (CPU, memory, runtime) for every subprocess spawned by the agent
- **Cost/token header** with pricing for Claude 4.5/4.6, GPT-4o, Gemini 2.5
- **Preferences dialog** (⌘,): LLM provider/model/key, Galaxy credentials, default directory
- **First-run welcome screen** — single-page form for LLM key + optional Galaxy + working directory
- **Local/Remote execution mode toggle** in the masthead (Local skips Galaxy MCP entirely; Remote exposes Galaxy tools and the agent chooses per-job)
- **Galaxy brand theme** (dark palette, gold accents, Galaxy logo in masthead and dock icon)
- **galaxy-analyst extension** (merged from pi-galaxy-analyst): 5-phase lifecycle, Galaxy API client, notebook persistence with YAML frontmatter + git auto-commit, BRC catalog context, 35+ tools
- **Session management**: `/new` for a clean slate, `--continue` restart for preference changes, fresh-session detection that skips notebook auto-load
- **Slash commands**: `/review`, `/test`, `/execute`, `/plan`, `/status`, `/notebook`, `/decisions`, `/connect`, `/model`, `/new`, `/help`

### Future improvements
See the **"Out of scope (future improvements)"** section in [PLAN.md](PLAN.md) for the current backlog: plan switcher dropdown, two-model planner/executor split, step kill button, ask-while-running pattern, process monitor full command line, and more.

## Installation

### Linux (Ubuntu/Debian)

Open a terminal and run the following commands one by one:

**Step 1 — Install system dependencies:**
```bash
sudo apt update
sudo apt install -y git curl build-essential
```

**Step 2 — Install Node.js** (if you don't already have it):
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install --lts
```

**Step 3 — Install Miniforge** (provides conda and mamba for bioinformatics tools):
```bash
curl -fsSL https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh -o ~/miniforge.sh
bash ~/miniforge.sh -b
~/miniforge3/bin/conda init bash
source ~/.bashrc
rm ~/miniforge.sh
```

**Step 4 — Clone and start gxy3:**
```bash
git clone https://github.com/nekrut/gxy3.git
cd gxy3 && npm install
cd app && npm install
npm start
```

### macOS

**Step 1 — Install Homebrew** (if you don't already have it). Open **Terminal** (search for "Terminal" in Spotlight) and paste:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Follow the prompts. This will also install Xcode Command Line Tools automatically if needed.

**Step 2 — Install Node.js and Git:**
```bash
brew install node git
```

**Step 3 — Install Miniforge** (provides conda and mamba for bioinformatics tools):
```bash
brew install miniforge
conda init "$(basename "$SHELL")"
source ~/.zshrc
```

**Step 4 — Clone and start gxy3:**
```bash
git clone https://github.com/nekrut/gxy3.git
cd gxy3 && npm install
cd app && npm install
npm start
```

### Windows

gxy3 runs on Windows inside WSL2 (Windows Subsystem for Linux). This gives you a full Linux environment with graphical display support — no dual-booting needed.

**Step 1 — Install WSL2.** Right-click the Start button, select **Terminal (Admin)** or **PowerShell (Admin)**, and run:
```powershell
wsl --install --web-download -d Ubuntu
```
Restart your computer when prompted. After reboot, **Ubuntu** will open automatically — create a username and password when asked.

**Step 2 — Run the setup script.** Inside the Ubuntu window, paste this line and press Enter:
```bash
curl -fsSL https://raw.githubusercontent.com/nekrut/gxy3/master/scripts/setup-wsl.sh | bash
source ~/.bashrc
```
This installs Node.js, Miniforge (conda + mamba), and clones gxy3. It takes a few minutes.

**Step 3 — Launch gxy3:**
```bash
cd ~/gxy3/app && npm start
```
The gxy3 window will appear on your Windows desktop (WSLg handles the display automatically).

> **Tips for Windows/WSL2:**
> - Keep your analysis data inside `~/` (the Linux filesystem) for best performance
> - Avoid working on `/mnt/c/` paths — cross-filesystem access is significantly slower
> - Windows 11 has WSLg built in; on Windows 10 run `wsl --update` first
> - To open Ubuntu again later, search for "Ubuntu" in the Start menu

### After installation

On first launch, open **Preferences** (gear icon or `Ctrl+,` / `Cmd+,` on Mac) to set:
- **LLM provider** and API key — you need at least one of: [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or [Google AI](https://aistudio.google.com/) API key. Alternatively, use [Ollama](https://ollama.com/) for free local models.
- **Working directory** — where analysis output will be saved
- **Package manager** — leave as "auto" (prefers mamba, falls back to conda)

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
