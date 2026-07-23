const { app, BrowserWindow, ipcMain, Tray, Menu, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// Phase 7b/7c/7d/7e: the chat window talks to the SAME engine the terminal
// app uses (src/agent/session.js, src/safety/runOrganize.js,
// src/safety/undo.js) over IPC. The engine is pure ES modules, and this
// file is deliberately plain CommonJS (see electron/package.json), so
// every engine import here uses dynamic import() rather than require().

// Only one instance of the tray app may ever run at a time. Without this,
// every extra double-click of the exe (e.g. while wondering why the tray
// icon isn't responding) spawns a fully separate competing process, and
// they all fight over the same userData/cache folder — which is exactly
// what "Access is denied" / "Unable to create cache" errors mean. If this
// process loses the lock race, it quits immediately instead of creating
// its own window/tray at all.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// If a second launch is attempted while we're already running, bring the
// existing window forward instead of silently doing nothing.
app.on("second-instance", () => {
  if (mainWindow) showWindow();
});

// A packaged, installed app must never write its journal/preferences
// inside its own install folder (often read-only, and wiped on update or
// uninstall) — redirect the engine's data dir to the proper per-user
// AppData location. In dev mode (`npm run dev`), leave it alone so the
// Electron app shares the same data/ folder as the terminal app, which is
// convenient while developing both faces side by side.
if (app.isPackaged) {
  process.env.DESKMATE_DATA_DIR = app.getPath("userData");
}

// Never bundle a real API key into a distributable installer. Prefer a
// .env dropped next to the user's own data (writable, per-user) and only
// fall back to the project-root .env for dev mode.
const userDataEnvPath = path.join(app.getPath("userData"), ".env");
const devEnvPath = path.join(__dirname, "..", ".env");
require("dotenv").config({ path: fs.existsSync(userDataEnvPath) ? userDataEnvPath : devEnvPath });

let mainWindow = null;
let tray = null;
let sessionPromise = null;
let windowShownAt = 0;
let lastToggleAt = 0;

// Set true only by the tray menu's "Quit" — otherwise the window's own
// close (the X button) just hides it, since the app really lives in the
// tray and the window is a popup on top of it.
let isQuitting = false;

// Resolves the Promise returned to runOrganize's `confirm` callback, once
// the renderer's Yes/Cancel button click comes back over IPC. There is only
// ever one organize confirmation in flight at a time (the renderer's input
// is disabled while one is pending).
let pendingConfirmResolve = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = import("../src/agent/session.js").then(({ createSession }) => createSession());
  }
  return sessionPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 560,
    resizable: true,
    show: false, // starts hidden — a tray-only app, no window on launch
    skipTaskbar: true, // lives in the tray, not as a separate taskbar entry
    title: "DeskMate",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // The X button hides the window instead of closing it — same idea as
  // minimizing to tray. Only the tray menu's "Quit" actually exits.
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Clicking away from the window hides it, like a dropdown popover. Guard
  // against a well-known Windows/Electron race: showing + focusing a
  // window can trigger a spurious blur almost immediately afterward (the
  // click that revealed it briefly steals focus back), which would hide
  // the window before you ever see it. Ignore blur in that first instant.
  mainWindow.on("blur", () => {
    if (Date.now() - windowShownAt < 250) return;
    mainWindow.hide();
  });
}

// Anchors the popup near the tray icon — bottom-right on Windows, just
// above the taskbar, clamped so it never renders off-screen.
function positionWindowNearTray() {
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(trayBounds);
  const workArea = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y = Math.round(workArea.y + workArea.height - windowBounds.height - 8);

  x = Math.min(Math.max(x, workArea.x + 8), workArea.x + workArea.width - windowBounds.width - 8);

  mainWindow.setPosition(x, y, false);
}

function showWindow() {
  positionWindowNearTray();
  mainWindow.show();
  mainWindow.focus();
  windowShownAt = Date.now();
}

function toggleWindow() {
  // Some Windows configurations fire the tray's 'click' event more than
  // once for a single physical click, which would show then immediately
  // hide the window again (looking like nothing happened at all). Ignore
  // a second toggle that arrives right on the heels of the first.
  const now = Date.now();
  if (now - lastToggleAt < 300) return;
  lastToggleAt = now;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, "assets", "tray-icon.png"));
  tray.setToolTip("DeskMate");
  tray.on("click", toggleWindow);

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show DeskMate", click: showWindow },
    {
      label: "Undo last organize",
      click: async () => {
        const { undoLastRun } = await import("../src/safety/undo.js");
        const result = await undoLastRun();
        showWindow();
        mainWindow.webContents.send("undo:result", result);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// Passed as runOrganize's `confirm`. Sends a lightweight, display-only view
// of the plan (just filename + category — file-path logic stays here, not
// in the renderer) and waits for the button-click response.
function waitForUserConfirm(moves) {
  const displayMoves = moves.map((m) => ({
    name: path.basename(m.from),
    category: m.category,
  }));
  mainWindow.webContents.send("organize:preview", displayMoves);
  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}

ipcMain.on("organize:confirm-response", (_event, approved) => {
  if (pendingConfirmResolve) {
    pendingConfirmResolve(approved);
    pendingConfirmResolve = null;
  }
});

// One channel for everything typed in the chat box. "organize"/"undo" are
// handled specially (same as the terminal's normalized prefix check) —
// everything else goes through the general agent loop.
ipcMain.handle("chat:send", async (_event, userText) => {
  const normalized = userText.trim().toLowerCase();

  try {
    if (normalized.startsWith("organize")) {
      const { runOrganize } = await import("../src/safety/runOrganize.js");
      const { buildDeskReport } = await import("../src/agent/deskReport.js");
      const session = await getSession();

      try {
        const result = await runOrganize(session.model, { confirm: waitForUserConfirm });
        if (result.status === "done") {
          result.deskReport = buildDeskReport(result.run);
        }
        return { ok: true, kind: "organize", result };
      } catch (err) {
        // Mirrors the terminal's handling: executePlan already rolled back
        // and cleaned up on failure — this is just reporting it, not a
        // second chance to skip validation.
        return { ok: true, kind: "organize", result: { status: "error", error: err.message } };
      }
    }

    if (normalized === "undo") {
      const { undoLastRun } = await import("../src/safety/undo.js");
      const result = await undoLastRun();
      return { ok: true, kind: "undo", result };
    }

    const { sendChatMessage } = await import("../src/agent/session.js");
    const session = await getSession();
    const reply = await sendChatMessage(session, userText);
    return { ok: true, kind: "chat", reply };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// The standalone "Undo last organize" button calls this directly — it
// doesn't need to go through chat history at all.
ipcMain.handle("organize:undo", async () => {
  try {
    const { undoLastRun } = await import("../src/safety/undo.js");
    const result = await undoLastRun();
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on("before-quit", () => {
  isQuitting = true;
});
