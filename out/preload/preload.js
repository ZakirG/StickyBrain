"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  refreshRequest: () => electron.ipcRenderer.invoke("refresh-request"),
  setInactive: () => electron.ipcRenderer.send("set-inactive"),
  onUpdate: (callback) => {
    electron.ipcRenderer.on("update-ui", (_event, data) => callback(data));
  }
});
