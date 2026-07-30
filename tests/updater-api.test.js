"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Updater } = require("../src/updater");

describe("Updater GitHub API response handling", () =>
{
    let server;
    let port;
    let updater;
    const stateChanges = [];

    before(() =>
    {
        // 创建本地 mock HTTP 服务器模拟 GitHub API
        server = http.createServer((req, res) =>
        {
            if (req.url.includes("/releases/latest"))
            {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    tag_name: "v0.6.0",
                    name: "Agent Pet v0.6.0",
                    body: "新版本更新内容",
                    assets: [
                        {
                            name: "AgentPet-0.6.0-portable.exe",
                            browser_download_url: `http://localhost:${port}/downloads/AgentPet-0.6.0-portable.exe`,
                            size: 1048576
                        }
                    ]
                }));
            }
            else if (req.url.includes("/downloads/"))
            {
                // 模拟下载（返回 1MB 的虚拟数据）
                const data = Buffer.alloc(1048576, 0xAB);
                res.writeHead(200, {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": "1048576"
                });
                res.end(data);
            }
            else
            {
                res.writeHead(404);
                res.end("Not found");
            }
        });

        return new Promise((resolve) =>
        {
            server.listen(0, () =>
            {
                port = server.address().port;
                resolve();
            });
        });
    });

    after(() =>
    {
        if (updater) updater.removeAllListeners();
        server.close();
    });

    it("detects new version from mock GitHub API", async () =>
    {
        updater = new Updater("0.5.0");
        const results = [];
        updater.on("state-change", (data) => results.push(data));

        // 拦截 _jsonGet 指向本地服务器
        updater._jsonGet = function(url, callback)
        {
            const localUrl = `http://localhost:${port}/repos/fcb1379/agent-pet/releases/latest`;
            const req = http.get(localUrl, (res) =>
            {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () =>
                {
                    callback(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
                });
            });
            req.on("error", callback);
        };

        await new Promise((resolve) =>
        {
            updater.on("state-change", (data) =>
            {
                if ("available" === data.state)
                {
                    resolve();
                }
                if ("error" === data.state)
                {
                    resolve(data.error);
                }
            });
            updater.check();
        });

        assert.equal(updater.state, "available");
        assert.equal(updater.latestVersion, "0.6.0");
        assert.ok(updater.downloadUrl.includes("AgentPet-0.6.0-portable.exe"));
        assert.equal(updater.downloadSize, 1048576);
    });

    it("reports up-to-date when version matches", async () =>
    {
        const currentUpdater = new Updater("0.6.0");
        const results = [];
        currentUpdater.on("state-change", (data) => results.push(data));

        currentUpdater._jsonGet = function(url, callback)
        {
            const localUrl = `http://localhost:${port}/repos/fcb1379/agent-pet/releases/latest`;
            http.get(localUrl, (res) =>
            {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () =>
                {
                    callback(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
                });
            }).on("error", callback);
        };

        await new Promise((resolve) =>
        {
            currentUpdater.on("state-change", (data) =>
            {
                if ("up-to-date" === data.state || "error" === data.state)
                {
                    resolve();
                }
            });
            currentUpdater.check();
        });

        assert.equal(currentUpdater.state, "up-to-date");
        currentUpdater.removeAllListeners();
    });

    it("handles GitHub API 403 rate limit", async () =>
    {
        const rateUpdater = new Updater("0.5.0");
        const results = [];
        rateUpdater.on("state-change", (data) => results.push(data));

        rateUpdater._jsonGet = function(url, callback)
        {
            callback(new Error("GitHub API 速率限制，请稍后再试"));
        };

        await new Promise((resolve) =>
        {
            rateUpdater.on("state-change", (data) =>
            {
                if ("error" === data.state)
                {
                    resolve();
                }
            });
            rateUpdater.check();
        });

        assert.equal(rateUpdater.state, "error");
        assert.ok(rateUpdater.error || results.some(r => r.error && r.error.includes("速率限制")));
        rateUpdater.removeAllListeners();
    });
});
