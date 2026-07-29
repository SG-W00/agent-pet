"use strict";

const childProcess = require("node:child_process");
const os = require("node:os");
const readline = require("node:readline");
const { EventEmitter } = require("node:events");

const SAMPLE_INTERVAL_MS = 2000;

const WINDOWS_HARDWARE_PROBE = String.raw`
$ErrorActionPreference = "SilentlyContinue"
while ($true)
{
    $gpuValue = 0.0
    $gpuSamples = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
        Where-Object { $_.Name -match "engtype_3D" }
    if ($null -ne $gpuSamples)
    {
        $gpuValue = ($gpuSamples | Measure-Object -Property UtilizationPercentage -Sum).Sum
    }

    $networkSamples = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface |
        Where-Object { $_.Name -notmatch "Loopback|isatap|Teredo" }
    $received = 0.0
    $sent = 0.0
    if ($null -ne $networkSamples)
    {
        $received = ($networkSamples | Measure-Object -Property BytesReceivedPersec -Sum).Sum
        $sent = ($networkSamples | Measure-Object -Property BytesSentPersec -Sum).Sum
    }

    [Console]::Out.WriteLine((@{
        gpu = [Math]::Min(100.0, [double]$gpuValue)
        download = [double]$received
        upload = [double]$sent
    } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 2000
}
`;

function cpuTimes(cpus)
{
    return cpus.reduce((summary, cpu) => {
        const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
        summary.idle += cpu.times.idle;
        summary.total += total;
        return summary;
    }, { idle: 0, total: 0 });
}

function cpuPercent(previous, current)
{
    const totalDelta = current.total - previous.total;
    const idleDelta = current.idle - previous.idle;
    if (0 >= totalDelta)
    {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round((1 - (idleDelta / totalDelta)) * 100)));
}

class ResourceMonitor extends EventEmitter
{
    constructor(options = {})
    {
        super();
        this.platform = options.platform || process.platform;
        this.spawn = options.spawn || childProcess.spawn;
        this.os = options.os || os;
        this.timer = null;
        this.child = null;
        this.reader = null;
        this.previousCpu = null;
        this.hardware = { gpu: null, download: 0, upload: 0 };
    }

    start()
    {
        if (this.timer)
        {
            return false;
        }
        this.previousCpu = cpuTimes(this.os.cpus());
        if ("win32" === this.platform)
        {
            this.startWindowsProbe();
        }
        this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
        this.sample();
        return true;
    }

    startWindowsProbe()
    {
        const encoded = Buffer.from(WINDOWS_HARDWARE_PROBE, "utf16le").toString("base64");
        this.child = this.spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
            { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
        );
        this.reader = readline.createInterface({ input: this.child.stdout });
        this.reader.on("line", (line) => {
            try
            {
                const value = JSON.parse(line);
                this.hardware = {
                    gpu: Number.isFinite(Number(value.gpu)) ? Math.round(Number(value.gpu)) : null,
                    download: Math.max(0, Number(value.download) || 0),
                    upload: Math.max(0, Number(value.upload) || 0)
                };
            }
            catch (_error)
            {
                // Ignore transient or localized PowerShell output.
            }
        });
        this.child.once("exit", () => {
            this.child = null;
            this.reader = null;
        });
        this.child.once("error", () => {
            this.child = null;
            this.reader = null;
        });
    }

    sample()
    {
        const currentCpu = cpuTimes(this.os.cpus());
        const totalMemory = this.os.totalmem();
        const usedMemory = Math.max(0, totalMemory - this.os.freemem());
        const snapshot = {
            cpu: this.previousCpu ? cpuPercent(this.previousCpu, currentCpu) : 0,
            gpu: this.hardware.gpu,
            memoryPercent: 0 < totalMemory ? Math.round((usedMemory / totalMemory) * 100) : 0,
            memoryUsed: usedMemory,
            memoryTotal: totalMemory,
            download: this.hardware.download,
            upload: this.hardware.upload,
            updatedAt: new Date().toISOString()
        };
        this.previousCpu = currentCpu;
        this.emit("change", snapshot);
        return snapshot;
    }

    stop()
    {
        if (this.timer)
        {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.reader)
        {
            this.reader.close();
            this.reader = null;
        }
        if (this.child)
        {
            this.child.kill();
            this.child = null;
        }
    }
}

module.exports = {
    cpuPercent,
    cpuTimes,
    ResourceMonitor,
    WINDOWS_HARDWARE_PROBE
};