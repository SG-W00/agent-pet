"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const state = process.argv[2] || "running";
const mode = process.argv[3] || "pet";

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        width: "traffic" === mode ? 104 : 300,
        height: "traffic" === mode ? 236 : 350,
        show: false,
        transparent: true,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, "..", "src", "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    await window.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
    window.webContents.send("display-mode", mode);
    window.webContents.send("agent-state", {
        state,
        active: {
            provider: "Codex",
            source: "WSL ? Ubuntu",
            state,
            message: `Visual smoke test: ${state}`,
            updatedAt: new Date().toISOString()
        },
        sessions: [{ state }],
        counts: { [state]: 1 }
    });

    await new Promise((resolve) => setTimeout(resolve, 900));
    const image = await window.webContents.capturePage();
    const outputDirectory = path.join(__dirname, "..", "artifacts");
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `ui-${mode}-${state}.png`);
    fs.writeFileSync(outputPath, image.toPNG());
    process.stdout.write(`Captured ${outputPath}\n`);
    app.quit();
});
