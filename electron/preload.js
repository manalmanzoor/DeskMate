const { contextBridge, ipcRenderer } = require("electron");

// The renderer never gets direct Node/filesystem access (contextIsolation
// is on, nodeIntegration is off) — this is the ONLY bridge it has, and it
// only ever exchanges plain chat text and small display-only objects.
contextBridge.exposeInMainWorld("deskmate", {
  sendMessage: (text) => ipcRenderer.invoke("chat:send", text),

  // Fires when an organize plan needs the user's confirmation. `moves` is
  // just [{ name, category }] — display data only, never full paths.
  onOrganizePreview: (callback) => {
    ipcRenderer.on("organize:preview", (_event, moves) => callback(moves));
  },
  confirmOrganize: (approved) => ipcRenderer.send("organize:confirm-response", approved),

  undoLastOrganize: () => ipcRenderer.invoke("organize:undo"),

  // Fires when "Undo last organize" is triggered from the tray's right-click
  // menu, so the chat window can show the same outcome message it would if
  // the in-window Undo button had been clicked instead.
  onUndoResult: (callback) => {
    ipcRenderer.on("undo:result", (_event, result) => callback(result));
  },
});
