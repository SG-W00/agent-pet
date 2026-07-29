"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const state = process.argv[2] || "running";
const mode = process.argv[3] || "pet";
const scenario = process.argv[4] || "state";

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
    window.webContents.send("window-settings", {
        clickThrough: false,
        resources: { enabled: true, cpu: true, gpu: true, memory: true, network: true }
    });
    window.webContents.send("resource-usage", {
        cpu: 28,
        gpu: 16,
        memoryPercent: 63,
        download: 1240000,
        upload: 86000
    });
    if ("typing" === scenario)
    {
        window.webContents.send("typing-activity", true);
    }
    else if ("sessions" === scenario)
    {
        const now = new Date().toISOString();
        const sessions = [
            { id: "codex-1", provider: "Codex", source: "Windows", state: "running", event: "UserPromptSubmit", message: "任务：为桌宠增加会话详情列表", cwd: "C:\\Users\\tester\\AgentPet", updatedAt: now },
            { id: "claude-1", provider: "Claude Code", source: "WSL · Ubuntu", state: "completed", event: "Stop", message: "已完成固件日志分析并整理出三条修复建议。", cwd: "/home/tester/firmware", updatedAt: now },
            { id: "codex-2", provider: "Codex", source: "WSL · Ubuntu", state: "needs_input", event: "PermissionRequest", message: "等待授权：shell_command", cwd: "/home/tester/web", updatedAt: now }
        ];
        window.webContents.send("agent-state", { state: "needs_input", active: sessions[2], sessions, counts: { running: 1, completed: 1, needs_input: 1 } });
        window.webContents.send("show-session-details", true);
    }    else if ("approval" === scenario)
    {
        window.webContents.send("approval-request", {
            id: "visual-smoke-test",
            provider: "codex",
            toolName: "shell_command",
            summary: "npm run build -- --safe-mode"
        });
    }

    await new Promise((resolve) => setTimeout(resolve, 900));
    const image = await window.webContents.capturePage();
    const outputDirectory = path.join(__dirname, "..", "artifacts");
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `ui-${mode}-${state}-${scenario}.png`);
    fs.writeFileSync(outputPath, image.toPNG());
    process.stdout.write(`Captured ${outputPath}\n`);
    app.quit();
});
