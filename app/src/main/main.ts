import { app, BrowserWindow, Menu, dialog } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerIpcHandlers } from "./ipc-handlers.js";

// Workaround for systems where chrome-sandbox isn't suid root
app.commandLine.appendSwitch("no-sandbox");
import { AgentManager } from "./agent.js";

const GXY3_DIR = path.join(os.homedir(), ".gxy3");
const WINDOW_STATE_FILE = path.join(GXY3_DIR, "window-state.json");
const DEFAULT_CWD = path.join(GXY3_DIR, "analyses");

// In forge, these are injected by the Vite plugin. For dev.mjs, use env vars.
const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined =
  (globalThis as Record<string, unknown>).MAIN_WINDOW_VITE_DEV_SERVER_URL as string | undefined
  ?? process.env.VITE_DEV_SERVER_URL;
const MAIN_WINDOW_VITE_NAME: string =
  ((globalThis as Record<string, unknown>).MAIN_WINDOW_VITE_NAME as string | undefined)
  ?? process.env.VITE_NAME
  ?? "main_window";

function log(...args: unknown[]): void {
  console.log("[main]", ...args);
}

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

function loadWindowState(): WindowState {
  try {
    const data = readFileSync(WINDOW_STATE_FILE, "utf-8");
    const state = JSON.parse(data) as WindowState;
    if (state.width > 0 && state.height > 0) return state;
  } catch {}
  return { width: 1400, height: 900 };
}

function saveWindowState(win: BrowserWindow): void {
  try {
    mkdirSync(GXY3_DIR, { recursive: true });
    const bounds = win.getBounds();
    writeFileSync(WINDOW_STATE_FILE, JSON.stringify(bounds));
  } catch {}
}

let mainWindow: BrowserWindow | null = null;
let agentManager: AgentManager | null = null;

function getDefaultCwd(): string {
  const cwd = process.env.GXY3_CWD || DEFAULT_CWD;
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

function createWindow(cwd: string): void {
  log("creating window, cwd:", cwd);
  const saved = loadWindowState();

  mainWindow = new BrowserWindow({
    ...saved,
    minWidth: 800,
    minHeight: 600,
    title: "gxy3",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  agentManager = new AgentManager(mainWindow, cwd);
  registerIpcHandlers(agentManager);

  mainWindow.webContents.once("did-finish-load", () => {
    log("renderer loaded, starting agent");
    agentManager!.start();
  });

  mainWindow.on("close", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });

  mainWindow.on("closed", () => {
    log("window closed");
    mainWindow = null;
  });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "gxy3",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "Open Analysis Directory...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            if (!agentManager) return;
            const result = await dialog.showOpenDialog({
              title: "Choose analysis directory",
              defaultPath: agentManager.getCwd(),
              properties: ["openDirectory", "createDirectory"],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            log("switching cwd to:", result.filePaths[0]);
            agentManager.setCwd(result.filePaths[0]);
            agentManager.stop();
            agentManager.start();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  log("app ready");
  buildMenu();
  const cwd = getDefaultCwd();
  log("cwd:", cwd);
  createWindow(cwd);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(cwd);
    }
  });
});

app.on("window-all-closed", () => {
  log("all windows closed");
  agentManager?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  log("before-quit");
  agentManager?.stop();
});
