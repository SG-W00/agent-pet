#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    CLAUDE_EVENTS,
    CODEX_EVENTS,
    addManagedHandlers,
    configurationPaths,
    readJson,
    writeJsonWithBackup
} = require("./hook-config");

function main()
{
    const paths = configurationPaths();
    const sourceBridge = path.resolve(__dirname, "..", "bridge", "agent-pet-bridge.js");
    const installedBridge = path.join(paths.installDirectory, "agent-pet-bridge.js");

    fs.mkdirSync(paths.installDirectory, { recursive: true });
    fs.copyFileSync(sourceBridge, installedBridge);

    const codexConfig = addManagedHandlers(
        readJson(paths.codexHooks, { hooks: {} }),
        CODEX_EVENTS,
        "codex",
        installedBridge
    );
    const claudeConfig = addManagedHandlers(
        readJson(paths.claudeSettings, {}),
        CLAUDE_EVENTS,
        "claude",
        installedBridge
    );

    writeJsonWithBackup(paths.codexHooks, codexConfig);
    writeJsonWithBackup(paths.claudeSettings, claudeConfig);

    process.stdout.write([
        "Agent Pet hooks installed.",
        `  Codex: ${paths.codexHooks}`,
        `  Claude Code: ${paths.claudeSettings}`,
        `  Bridge: ${installedBridge}`,
        "",
        "Restart both CLIs. In Codex, run /hooks once and trust the Agent Pet hooks.",
        "Run this installer separately in Windows and in each WSL distribution you use.",
        ""
    ].join("\n"));
}

try
{
    main();
}
catch (error)
{
    process.stderr.write(`Install failed: ${error.message}\n`);
    process.exitCode = 1;
}
