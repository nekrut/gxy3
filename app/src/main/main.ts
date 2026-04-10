import { app, BrowserWindow, Menu, dialog } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
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
  // Priority: env var > config.json > hardcoded default
  let cwd = process.env.GXY3_CWD;
  if (!cwd) {
    try {
      const configPath = path.join(GXY3_DIR, "config.json");
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (cfg.defaultCwd) cwd = cfg.defaultCwd;
      }
    } catch {}
  }
  cwd = cwd || DEFAULT_CWD;
  // Expand ~
  if (cwd.startsWith("~")) cwd = path.join(os.homedir(), cwd.slice(1));
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

/**
 * Open an external URL in a new BrowserWindow. Used for things like IGV.js
 * viewers served on localhost, HTML reports, external docs — anything that
 * would otherwise navigate the main window away from the gxy3 renderer.
 */
function openExternalUrlWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: url,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Minimal menu for the popup so user can reload / go back / zoom
  win.setMenuBarVisibility(true);
  win.loadURL(url).catch((err) => {
    log("failed to load external url:", url, err);
  });
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

  // Prevent the main window from ever navigating away from the renderer.
  // External URLs (e.g. IGV.js viewers, reports served on localhost) should
  // always open in a new window so the user can click Back to return to gxy3.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // Allow in-app navigation to the Vite dev server or the packaged index.
    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
    log("intercepted external navigation → new window:", url);
    openExternalUrlWindow(url);
  });

  // target="_blank" links / window.open() calls → new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log("window open handler → new window:", url);
    openExternalUrlWindow(url);
    return { action: "deny" };
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

function openPreferences(): void {
  if (mainWindow) mainWindow.webContents.send("menu:open-preferences");
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "gxy3",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Preferences...",
          accelerator: "CmdOrCtrl+,",
          click: openPreferences,
        },
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
            if (!agentManager || !mainWindow) return;
            const result = await dialog.showOpenDialog({
              title: "Choose analysis directory",
              defaultPath: agentManager.getCwd(),
              properties: ["openDirectory", "createDirectory"],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            const dir = result.filePaths[0];
            log("switching cwd to:", dir);
            agentManager.setCwd(dir);
            // Notify renderer to update UI and inform agent — no restart
            mainWindow.webContents.send("agent:cwd-changed", dir);
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
        { type: "separator" },
        {
          label: "Preferences...",
          accelerator: "CmdOrCtrl+,",
          click: openPreferences,
        },
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
