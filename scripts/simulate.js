#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");

const requestedState = String(process.argv[2] || "running").toLowerCase();
const provider = String(process.argv[3] || "codex").toLowerCase();
const eventByState = {
    idle: "SessionEnd",
    running: "UserPromptSubmit",
    completed: "Stop",
    needs_input: "PermissionRequest",
    error: "StopFailure"
};
const eventName = eventByState[requestedState];

if (!eventName)
{
    process.stderr.write("Usage: npm run simulate -- idle|running|completed|needs_input|error [codex|claude]\n");
    process.exit(2);
}

const bridgePath = path.resolve(__dirname, "..", "bridge", "agent-pet-bridge.js");
const payload = JSON.stringify({
    session_id: `demo-${provider}`,
    cwd: process.cwd(),
    message: `模拟状态：${requestedState}`,
    error: "模拟错误"
});

const result = childProcess.spawnSync(
    process.execPath,
    [bridgePath, provider, eventName],
    { input: payload, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
);

process.exitCode = null === result.status ? 1 : result.status;
