"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentPet", {
    onState: (callback) => ipcRenderer.on("agent-state", (_event, snapshot) => callback(snapshot)),
    onDisplayMode: (callback) => ipcRenderer.on("display-mode", (_event, mode) => callback(mode)),
    onTypingActivity: (callback) => ipcRenderer.on("typing-activity", (_event, active) => callback(active)),
    onApprovalRequest: (callback) => ipcRenderer.on("approval-request", (_event, request) => callback(request)),
    onWindowSettings: (callback) => ipcRenderer.on("window-settings", (_event, settings) => callback(settings)),
    onResourceUsage: (callback) => ipcRenderer.on("resource-usage", (_event, snapshot) => callback(snapshot)),
    onPositionAdjustMode: (callback) => ipcRenderer.on("position-adjust-mode", (_event, active) => callback(active)),
    onShowSessionDetails: (callback) => ipcRenderer.on("show-session-details", (_event, open) => callback(open)),
    setDisplayMode: (mode) => ipcRenderer.send("set-display-mode", mode),
    decideApproval: (decision) => ipcRenderer.send("approval-decision", decision),
    setSessionDetailsOpen: (open) => ipcRenderer.send("session-details-state", open),
    dragWindow: (dx, dy) => ipcRenderer.send("window-drag", dx, dy),
    hide: () => ipcRenderer.send("hide-window")
});