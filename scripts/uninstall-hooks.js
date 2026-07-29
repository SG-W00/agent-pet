#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const {
    CLAUDE_EVENTS,
    CODEX_EVENTS,
    configurationPaths,
    readJson,
    removeManagedHandlers,
    writeJsonWithBackup
} = require("./hook-config");

function updateIfPresent(filePath, events)
{
    if (!fs.existsSync(filePath))
    {
        return;
    }

    const config = removeManagedHandlers(readJson(filePath, {}), events);
    writeJsonWithBackup(filePath, config);
}

function main()
{
    const paths = configurationPaths();
    updateIfPresent(paths.codexHooks, CODEX_EVENTS);
    updateIfPresent(paths.claudeSettings, CLAUDE_EVENTS);

    process.stdout.write([
        "Agent Pet hooks removed from Codex and Claude Code configuration.",
        "The ~/.agent-pet bridge directory was kept so the operation remains recoverable.",
        ""
    ].join("\n"));
}

try
{
    main();
}
catch (error)
{
    process.stderr.write(`Uninstall failed: ${error.message}\n`);
    process.exitCode = 1;
}
