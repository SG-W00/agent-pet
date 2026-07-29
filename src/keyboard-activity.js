"use strict";

const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const DEFAULT_IDLE_MS = 900;

const POWERSHELL_PROBE = String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class AgentPetKeyboardActivity
{
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    public static bool IsAnyKeyboardKeyDown()
    {
        for (int virtualKey = 8; virtualKey <= 254; virtualKey++)
        {
            if (0 != (GetAsyncKeyState(virtualKey) & 0x8000))
            {
                return true;
            }
        }

        return false;
    }
}
"@

while ($true)
{
    if ([AgentPetKeyboardActivity]::IsAnyKeyboardKeyDown())
    {
        [Console]::Out.WriteLine("1")
        [Console]::Out.Flush()
        Start-Sleep -Milliseconds 80
    }
    else
    {
        Start-Sleep -Milliseconds 35
    }
}
`;

class ActivityPulse extends EventEmitter
{
    constructor(idleMs = DEFAULT_IDLE_MS, timers = {})
    {
        super();
        this.idleMs = idleMs;
        this.setTimeout = timers.setTimeout || setTimeout;
        this.clearTimeout = timers.clearTimeout || clearTimeout;
        this.timer = null;
        this.active = false;
    }

    pulse()
    {
        if (!this.active)
        {
            this.active = true;
            this.emit("change", true);
        }

        if (this.timer)
        {
            this.clearTimeout(this.timer);
        }

        this.timer = this.setTimeout(() => {
            this.timer = null;
            this.active = false;
            this.emit("change", false);
        }, this.idleMs);

        if (this.timer && "function" === typeof this.timer.unref)
        {
            this.timer.unref();
        }
    }

    stop()
    {
        if (this.timer)
        {
            this.clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.active)
        {
            this.active = false;
            this.emit("change", false);
        }
    }
}

class KeyboardActivityMonitor extends EventEmitter
{
    constructor(options = {})
    {
        super();
        this.platform = options.platform || process.platform;
        this.spawn = options.spawn || childProcess.spawn;
        this.child = null;
        this.pulse = new ActivityPulse(options.idleMs || DEFAULT_IDLE_MS, options.timers);
        this.pulse.on("change", (active) => this.emit("change", active));
    }

    start()
    {
        if (this.child || "win32" !== this.platform)
        {
            return false;
        }

        const encoded = Buffer.from(POWERSHELL_PROBE, "utf16le").toString("base64");
        this.child = this.spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
            { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
        );
        this.child.stdout.on("data", () => this.pulse.pulse());
        this.child.once("exit", () => {
            this.child = null;
            this.pulse.stop();
        });
        this.child.once("error", () => {
            this.child = null;
            this.pulse.stop();
        });

        return true;
    }

    stop()
    {
        if (this.child)
        {
            this.child.kill();
            this.child = null;
        }
        this.pulse.stop();
    }
}

module.exports = {
    ActivityPulse,
    KeyboardActivityMonitor,
    POWERSHELL_PROBE
};