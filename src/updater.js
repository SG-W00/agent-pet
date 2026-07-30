"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

function getHttpModule(url)
{
    return url && "http:" === new URL(url).protocol ? http : https;
}

const GITHUB_OWNER = "SG-W00";
const GITHUB_REPO = "agent-pet";
const REQUEST_TIMEOUT = 15000;
const USER_AGENT = `AgentPet/1.0`;

function localAppDataDir()
{
    return process.env.LOCALAPPDATA
        || path.join(path.dirname(require("electron").app.getPath("appData")), "Local");
}

function updateDirectory()
{
    return path.join(localAppDataDir(), "AgentPet", "update");
}

function compareVersions(a, b)
{
    const pa = String(a).replace(/^v/i, "").split(".").map(Number);
    const pb = String(b).replace(/^v/i, "").split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++)
    {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

class Updater extends EventEmitter
{
    constructor(currentVersion)
    {
        super();
        this.currentVersion = currentVersion;
        this.state = "idle";
        this.latestVersion = null;
        this.downloadUrl = null;
        this.downloadSize = 0;
        this.releaseNotes = null;
        this.tempDir = null;
        this.destPath = null;
        this.shaUrl = null;
        this._downloadRequest = null;
    }

    check()
    {
        if ("checking" === this.state) return;
        this._setState("checking");

        this._jsonGet(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, (err, data) =>
        {
            if (err)
            {
                this._setState("error", { error: "无法检查更新：" + err.message });
                return;
            }

            const tag = String(data.tag_name || "").replace(/^v/i, "");
            if (!tag)
            {
                this._setState("error", { error: "GitHub Release 数据格式异常" });
                return;
            }

            if (0 >= compareVersions(tag, this.currentVersion))
            {
                this._setState("up-to-date");
                return;
            }

            const asset = (data.assets || []).find((a) =>
                /AgentPet-.+-portable\.exe/i.test(a.name)
            );
            if (!asset || !asset.browser_download_url)
            {
                this._setState("error", { error: "未找到可下载的便携版更新文件" });
                return;
            }

            const shaAsset = (data.assets || []).find((a) =>
                /SHA256|\.sha256/i.test(a.name) && a.name.includes(asset.name)
            );

            this.latestVersion = tag;
            this.downloadUrl = asset.browser_download_url;
            this.downloadSize = asset.size || 0;
            this.releaseNotes = data.body || "";
            this.shaUrl = shaAsset ? shaAsset.browser_download_url : null;

            this._setState("available", {
                version: tag,
                size: this.downloadSize
            });
        });
    }

    download()
    {
        if ("available" !== this.state) return;

        this._setState("downloading");

        const tempDir = updateDirectory();
        fs.mkdirSync(tempDir, { recursive: true });

        const baseName = `AgentPet-${this.latestVersion}-portable.exe`;
        const tempPath = path.join(tempDir, baseName + ".download");
        const destPath = path.join(tempDir, baseName);

        this.tempDir = tempDir;
        this.destPath = destPath;

        const fileStream = fs.createWriteStream(tempPath);
        let receivedBytes = 0;
        let totalBytes = this.downloadSize;

        const mod = getHttpModule(this.downloadUrl);
        const req = mod.get(this.downloadUrl, {
            timeout: REQUEST_TIMEOUT,
            headers: { "User-Agent": USER_AGENT }
        }, (response) =>
        {
            if (300 <= response.statusCode && 400 > response.statusCode && response.headers.location)
            {
                this.downloadUrl = response.headers.location;
                fileStream.close();
                if (this._downloadRequest)
                {
                    this._downloadRequest.destroy();
                }
                this.download();
                return;
            }

            if (!totalBytes && response.headers["content-length"])
            {
                totalBytes = parseInt(response.headers["content-length"], 10) || 0;
            }

            if (200 !== response.statusCode)
            {
                fileStream.close();
                fs.rmSync(tempPath, { force: true });
                this._setState("available", { version: this.latestVersion, size: this.downloadSize });
                this._setState("error", { error: `下载失败 (HTTP ${response.statusCode})` });
                return;
            }

            response.on("data", (chunk) =>
            {
                receivedBytes += chunk.length;
                fileStream.write(chunk);
                this.emit("progress", {
                    percent: totalBytes ? Math.min(100, Math.round(receivedBytes / totalBytes * 100)) : 0,
                    received: receivedBytes,
                    total: totalBytes
                });
            });

            response.on("end", () =>
            {
                fileStream.end();
            });
        });

        this._downloadRequest = req;

        req.on("error", (err) =>
        {
            fileStream.close();
            fs.rmSync(tempPath, { force: true });
            this._setState("available", { version: this.latestVersion, size: this.downloadSize });
            this._setState("error", { error: "下载出错：" + err.message });
        });

        req.on("timeout", () =>
        {
            req.destroy();
            fileStream.close();
            fs.rmSync(tempPath, { force: true });
            this._setState("error", { error: "下载超时" });
        });

        fileStream.on("finish", () =>
        {
            fs.renameSync(tempPath, destPath);
            this._verifyIntegrity(destPath);
        });
    }

    apply()
    {
        if ("downloaded" !== this.state) return false;

        const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
        if (!portableExe)
        {
            this._setState("error", { error: "开发模式下无法自动更新，请手动下载" });
            return false;
        }

        const workerSrc = path.join(__dirname, "updater-worker.js");
        const workerDest = path.join(this.tempDir, "updater-worker.js");
        try
        {
            // worker 可能被打包在 asar 中，需要复制出来运行
            const workerContent = fs.readFileSync(workerSrc);
            fs.writeFileSync(workerDest, workerContent);
        }
        catch (err)
        {
            this._setState("error", { error: "无法准备更新程序：" + err.message });
            return false;
        }

        const manifest =
        {
            pid: process.pid,
            oldExe: portableExe,
            newExe: this.destPath,
            tempDir: this.tempDir
        };
        const manifestPath = path.join(this.tempDir, "update-manifest.json");
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));

        const child = require("node:child_process").spawn(
            process.execPath,
            [workerDest, manifestPath],
            {
                detached: true,
                stdio: "ignore",
                env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
            }
        );
        child.unref();

        return true;
    }

    cancel()
    {
        if ("downloading" === this.state && this._downloadRequest)
        {
            this._downloadRequest.destroy();
            this._downloadRequest = null;
        }
        this._setState("idle");
    }

    _setState(state, data)
    {
        this.state = state;
        this.emit("state-change", { state, ...data });
    }

    _jsonGet(url, callback)
    {
        const req = https.get(url, {
            timeout: REQUEST_TIMEOUT,
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "application/json"
            }
        }, (res) =>
        {
            if (403 === res.statusCode)
            {
                callback(new Error("GitHub API 速率限制，请稍后再试"));
                return;
            }
            if (404 === res.statusCode)
            {
                callback(new Error("未找到 Release 信息"));
                return;
            }
            if (200 !== res.statusCode)
            {
                callback(new Error(`GitHub API 返回 ${res.statusCode}`));
                return;
            }

            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
            {
                try
                {
                    callback(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
                }
                catch (e)
                {
                    callback(e);
                }
            });
        });
        req.on("error", callback);
        req.on("timeout", () =>
        {
            req.destroy();
            callback(new Error("请求超时"));
        });
    }

    _verifyIntegrity(filePath)
    {
        if (this.shaUrl)
        {
            const shaMod = getHttpModule(this.shaUrl);
            shaMod.get(this.shaUrl, { headers: { "User-Agent": USER_AGENT } }, (res) =>
            {
                if (200 !== res.statusCode)
                {
                    this._finalizeDownload(filePath);
                    return;
                }
                let body = "";
                res.on("data", (c) => body += c.toString("utf8"));
                res.on("end", () =>
                {
                    const match = body.match(/^[0-9a-fA-F]{64}/);
                    if (match)
                    {
                        const expected = match[0].toLowerCase();
                        const actual = crypto.createHash("sha256")
                            .update(fs.readFileSync(filePath))
                            .digest("hex");
                        if (expected !== actual)
                        {
                            fs.rmSync(filePath, { force: true });
                            this._setState("error", { error: "文件校验失败，可能已损坏" });
                            return;
                        }
                    }
                    this._finalizeDownload(filePath);
                });
            }).on("error", () => this._finalizeDownload(filePath));
        }
        else
        {
            this._finalizeDownload(filePath);
        }
    }

    _finalizeDownload(filePath)
    {
        this._setState("downloaded", { version: this.latestVersion });
    }
}

module.exports = { Updater, updateDirectory, compareVersions };
