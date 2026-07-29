"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function waitForRequest(directory, timeoutMs = 5000)
{
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const check = () => {
            const files = fs.existsSync(directory)
                ? fs.readdirSync(directory).filter((name) => name.endsWith(".request.json"))
                : [];
            if (files.length)
            {
                resolve(JSON.parse(fs.readFileSync(path.join(directory, files[0]), "utf8")));
                return;
            }
            if (Date.now() >= deadline)
            {
                reject(new Error("approval request was not created"));
                return;
            }
            setTimeout(check, 50);
        };
        check();
    });
}

async function runDecision(provider, decision)
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pet-bridge-"));
    const stateDirectory = path.join(root, "states");
    const approvalDirectory = path.join(root, "approvals");
    const bridge = path.resolve(__dirname, "..", "bridge", "agent-pet-bridge.js");
    const child = childProcess.spawn(process.execPath, [bridge, provider, "PermissionRequest"], {
        env: {
            ...process.env,
            AGENT_PET_APPROVAL_TIMEOUT_MS: "5000",
            AGENT_PET_STATE_DIR: stateDirectory
        },
        stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(JSON.stringify({
        session_id: `session-${provider}`,
        cwd: root,
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "npm test", description: "Run tests" }
    }));

    try
    {
        const request = await waitForRequest(approvalDirectory);
        assert.equal(request.provider, "claude" === provider ? "Claude Code" : "Codex");
        assert.match(request.summary, /Run tests/);
        fs.writeFileSync(
            path.join(approvalDirectory, `${request.id}.decision.json`),
            JSON.stringify({ decision })
        );
        const exitCode = await new Promise((resolve) => child.once("exit", resolve));
        assert.equal(exitCode, 0, stderr);
        const output = JSON.parse(stdout);
        assert.equal(output.hookSpecificOutput.decision.behavior, decision);
        const stateFile = fs.readdirSync(stateDirectory).find((name) => name.endsWith(".json"));
        assert.equal(JSON.parse(fs.readFileSync(path.join(stateDirectory, stateFile), "utf8")).state, "running");
    }
    finally
    {
        if (!child.killed)
        {
            child.kill();
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test("Codex permission hook returns allow selected by Agent Pet", async () => {
    await runDecision("codex", "allow");
});

test("Claude permission hook returns deny selected by Agent Pet", async () => {
    await runDecision("claude", "deny");
});