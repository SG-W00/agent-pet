#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

function readStdin()
{
    return new Promise((resolve) => {
        if (process.stdin.isTTY)
        {
            resolve("");
            return;
        }

        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
            input += chunk;
        });
        process.stdin.on("end", () => resolve(input));
        process.stdin.resume();
    });
}

function windowsPathToWsl(windowsPath)
{
    const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath.trim());
    if (!match)
    {
        return windowsPath.trim();
    }

    return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

function resolveStateDirectory()
{
    if (process.env.AGENT_PET_STATE_DIR)
    {
        return process.env.AGENT_PET_STATE_DIR;
    }

    if ("win32" === process.platform)
    {
        return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AgentPet", "states");
    }

    if (process.env.WSL_DISTRO_NAME || fs.existsSync("/proc/sys/fs/binfmt_misc/WSLInterop"))
    {
        try
        {
            const localAppData = childProcess.execFileSync(
                "cmd.exe",
                ["/d", "/c", "echo", "%LOCALAPPDATA%"],
                { encoding: "utf8", windowsHide: true }
            ).trim();
            return path.join(windowsPathToWsl(localAppData), "AgentPet", "states");
        }
        catch (_error)
        {
            const windowsUser = process.env.WINUSER || process.env.USER || "Public";
            return `/mnt/c/Users/${windowsUser}/AppData/Local/AgentPet/states`;
        }
    }

    return path.join(os.homedir(), ".local", "share", "AgentPet", "states");
}

function normalizeEvent(eventName, payload)
{
    const event = String(eventName || payload.hook_event_name || payload.type || "")
        .toLowerCase()
        .replaceAll(/[^a-z0-9]/g, "");
    const notificationType = String(payload.notification_type || "").toLowerCase();

    if (["userpromptsubmit", "sessionstart", "start", "running"].includes(event))
    {
        return "running";
    }

    if (
        ["permissionrequest", "approvalrequested", "needsinput", "agentneedsinput"].includes(event) ||
        ("notification" === event && ["permission_prompt", "idle_prompt", "agent_needs_input"].includes(notificationType))
    )
    {
        return "needs_input";
    }

    if (["stop", "agentturncomplete", "taskcompleted", "completed", "agentcompleted"].includes(event))
    {
        return "completed";
    }

    if (["stopfailure", "error", "failed", "blocked"].includes(event))
    {
        return "error";
    }

    if (["sessionend", "idle"].includes(event))
    {
        return "idle";
    }

    return "running";
}

function safeIdentifier(value)
{
    return String(value).replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
}

function sessionIdentifier(provider, payload)
{
    const explicit = payload.session_id ||
        payload.thread_id ||
        payload["thread-id"] ||
        payload.conversation_id ||
        ("codex" === provider ? process.env.CODEX_THREAD_ID : undefined);

    if (explicit)
    {
        return safeIdentifier(`${provider}-${explicit}`);
    }

    const identity = `${provider}|${payload.cwd || process.cwd()}|${process.ppid}`;
    const digest = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16);
    return `${safeIdentifier(provider)}-${digest}`;
}

function messageFor(state, payload)
{
    if (payload.message)
    {
        return String(payload.message).slice(0, 180);
    }
    if (payload.last_assistant_message && "completed" === state)
    {
        return String(payload.last_assistant_message).replaceAll(/\s+/g, " ").slice(0, 180);
    }

    return {
        idle: "会话已空闲",
        running: "正在处理任务…",
        completed: "任务已完成",
        needs_input: "需要你的输入或审批",
        error: payload.error ? `任务失败：${payload.error}` : "任务遇到错误"
    }[state];
}

function shouldPreserveFinalState(existingSession, nextState, now = Date.now())
{
    if ("idle" !== nextState || !existingSession)
    {
        return false;
    }

    const updatedAt = Date.parse(existingSession.updatedAt || "");
    const age = Number.isFinite(updatedAt) ? now - updatedAt : Number.POSITIVE_INFINITY;

    return ("completed" === existingSession.state && age < 15000) ||
        ("error" === existingSession.state && age < 60000);
}

async function main()
{
    const provider = String(process.argv[2] || "agent").toLowerCase();
    const eventName = process.argv[3] || "running";
    const input = await readStdin();
    let payload = {};

    if (input.trim())
    {
        try
        {
            payload = JSON.parse(input);
        }
        catch (_error)
        {
            payload = { message: input.trim() };
        }
    }

    const state = normalizeEvent(eventName, payload);
    const id = sessionIdentifier(provider, payload);
    const stateDirectory = resolveStateDirectory();
    const session = {
        protocolVersion: 1,
        id,
        provider: "claude" === provider ? "Claude Code" : "Codex",
        source: "win32" === process.platform ? "Windows" : (process.env.WSL_DISTRO_NAME ? `WSL · ${process.env.WSL_DISTRO_NAME}` : "Linux"),
        state,
        event: eventName,
        message: messageFor(state, payload),
        cwd: payload.cwd || process.cwd(),
        pid: process.ppid,
        updatedAt: new Date().toISOString()
    };

    fs.mkdirSync(stateDirectory, { recursive: true });
    const statePath = path.join(stateDirectory, `${id}.json`);
    let existingSession = null;

    if (fs.existsSync(statePath))
    {
        try
        {
            existingSession = JSON.parse(fs.readFileSync(statePath, "utf8"));
        }
        catch (_error)
        {
            existingSession = null;
        }
    }

    if (!shouldPreserveFinalState(existingSession, state))
    {
        fs.writeFileSync(statePath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    }
}

if (require.main === module)
{
    main().catch((error) => {
        process.stderr.write(`Agent Pet bridge: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    normalizeEvent,
    resolveStateDirectory,
    sessionIdentifier,
    shouldPreserveFinalState,
    windowsPathToWsl
};
