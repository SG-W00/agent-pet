"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentPet", {
    onState: (callback) => ipcRenderer.on("agent-state", (_event, snapshot) => callback(snapshot)),
    onDisplayMode: (callback) => ipcRenderer.on("display-mode", (_event, mode) => callback(mode)),
    setDisplayMode: (mode) => ipcRenderer.send("set-display-mode", mode),
    hide: () => ipcRenderer.send("hide-window")
});
