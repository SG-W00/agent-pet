"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const SAFE_ID = /^[A-Za-z0-9._-]{1,120}$/;

class ApprovalStore extends EventEmitter
{
    constructor(approvalDirectory)
    {
        super();
        this.approvalDirectory = approvalDirectory;
        this.timer = null;
        this.lastSnapshot = "";
        this.requests = [];
    }

    start()
    {
        fs.mkdirSync(this.approvalDirectory, { recursive: true });
        this.refresh();
        this.timer = setInterval(() => this.refresh(), 250);
    }

    refresh(now = Date.now())
    {
        let requests = [];

        try
        {
            requests = fs.readdirSync(this.approvalDirectory)
                .filter((name) => name.endsWith(".request.json"))
                .map((name) => JSON.parse(fs.readFileSync(path.join(this.approvalDirectory, name), "utf8")))
                .filter((request) => request && SAFE_ID.test(String(request.id || "")))
                .filter((request) => now < Date.parse(request.expiresAt || 0))
                .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
        }
        catch (_error)
        {
            requests = [];
        }

        const serialized = JSON.stringify(requests);
        if (serialized !== this.lastSnapshot)
        {
            this.lastSnapshot = serialized;
            this.requests = requests;
            this.emit("change", requests);
        }
    }

    active()
    {
        return this.requests[0] || null;
    }

    decide(requestId, decision)
    {
        const id = String(requestId || "");
        if (!SAFE_ID.test(id) || !["allow", "deny"].includes(decision))
        {
            return false;
        }

        const requestPath = path.join(this.approvalDirectory, `${id}.request.json`);
        if (!fs.existsSync(requestPath))
        {
            return false;
        }

        const decisionPath = path.join(this.approvalDirectory, `${id}.decision.json`);
        const temporaryPath = `${decisionPath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryPath, `${JSON.stringify({ decision, decidedAt: new Date().toISOString() })}\n`, "utf8");
        fs.renameSync(temporaryPath, decisionPath);
        return true;
    }

    stop()
    {
        if (this.timer)
        {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = {
    ApprovalStore,
    SAFE_ID
};