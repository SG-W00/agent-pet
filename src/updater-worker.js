#!/usr/bin/env node
"use strict";

// 独立运行的更新器子进程 — 零外部依赖
// 启动方式：ELECTRON_RUN_AS_NODE=1 electron.exe updater-worker.js <manifest-path>

const fs = require("node:fs");
const path = require("node:path");
const child_process = require("node:child_process");

const manifestPath = process.argv[2];
if (!manifestPath)
{
    process.exit(1);
}

let manifest;
try
{
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}
catch (_)
{
    process.exit(1);
}

const { pid, oldExe, newExe, tempDir } = manifest;

// 删除工单文件（不再需要）
try { fs.rmSync(manifestPath, { force: true }); } catch (_) {}

function waitForExit(retries)
{
    retries = retries || 600;
    if (0 >= retries)
    {
        applyUpdate();
        return;
    }

    try
    {
        process.kill(pid, 0);
        setTimeout(() => waitForExit(retries - 1), 500);
    }
    catch (_)
    {
        applyUpdate();
    }
}

function applyUpdate()
{
    try
    {
        const targetDir = path.dirname(oldExe);
        fs.mkdirSync(targetDir, { recursive: true });

        const backupPath = oldExe + ".bak";
        try
        {
            fs.renameSync(oldExe, backupPath);
        }
        catch (_)
        {
            // 旧文件可能不存在的情况
        }

        fs.copyFileSync(newExe, oldExe);

        try { fs.rmSync(backupPath, { force: true }); } catch (_) {}

        const child = child_process.spawn(oldExe, [], {
            detached: true,
            stdio: "ignore",
            env: { ...process.env }
        });
        child.unref();

        cleanup();

        process.exit(0);
    }
    catch (err)
    {
        try
        {
            const backupPath = oldExe + ".bak";
            if (fs.existsSync(backupPath))
            {
                fs.renameSync(backupPath, oldExe);
            }
        }
        catch (_) {}

        try
        {
            fs.writeFileSync(
                path.join(tempDir, "update-error.log"),
                `[${new Date().toISOString()}] ${err.stack || err.message}\n`
            );
        }
        catch (_) {}

        process.exit(1);
    }
}

function cleanup()
{
    try
    {
        if (newExe && fs.existsSync(newExe))
        {
            fs.rmSync(newExe, { force: true });
        }
        try { fs.rmSync(__filename, { force: true }); } catch (_) {}
        const hasErrorLog = fs.existsSync(path.join(tempDir, "update-error.log"));
        if (!hasErrorLog)
        {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
    catch (_) {}
}

waitForExit();
