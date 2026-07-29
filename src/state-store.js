"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const STATE_PRIORITY = Object.freeze({
    needs_input: 5,
    error: 4,
    completed: 3,
    running: 2,
    idle: 1
});

const COMPLETED_LIFETIME_MS = 15000;
const ERROR_LIFETIME_MS = 60000;
const RUNNING_STALE_MS = 6 * 60 * 60 * 1000;

function effectiveState(session, now = Date.now())
{
    const updatedAt = Date.parse(session.updatedAt || "");
    const age = Number.isFinite(updatedAt) ? now - updatedAt : Number.POSITIVE_INFINITY;

    if ("completed" === session.state && age > COMPLETED_LIFETIME_MS)
    {
        return "idle";
    }

    if ("error" === session.state && age > ERROR_LIFETIME_MS)
    {
        return "idle";
    }

    if ("running" === session.state && age > RUNNING_STALE_MS)
    {
        return "idle";
    }

    return Object.hasOwn(STATE_PRIORITY, session.state) ? session.state : "idle";
}

function selectAggregate(sessions, now = Date.now())
{
    const normalized = sessions.map((session) => ({
        ...session,
        state: effectiveState(session, now)
    }));

    normalized.sort((left, right) => {
        const priorityDelta = STATE_PRIORITY[right.state] - STATE_PRIORITY[left.state];
        if (0 !== priorityDelta)
        {
            return priorityDelta;
        }

        return Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0);
    });

    const active = normalized.find((session) => "idle" !== session.state);
    const state = active ? active.state : "idle";

    return {
        state,
        active: active || null,
        sessions: normalized,
        counts: normalized.reduce((counts, session) => {
            counts[session.state] = (counts[session.state] || 0) + 1;
            return counts;
        }, {})
    };
}

class StateStore extends EventEmitter
{
    constructor(stateDirectory)
    {
        super();
        this.stateDirectory = stateDirectory;
        this.fileWatcher = null;
        this.refreshTimer = null;
        this.lastSnapshot = "";
    }

    start()
    {
        fs.mkdirSync(this.stateDirectory, { recursive: true });
        this.refresh();
        this.fileWatcher = fs.watch(this.stateDirectory, () => this.refresh());
        this.refreshTimer = setInterval(() => this.refresh(), 1000);
    }

    refresh()
    {
        let sessions = [];

        try
        {
            sessions = fs.readdirSync(this.stateDirectory)
                .filter((fileName) => fileName.endsWith(".json"))
                .map((fileName) => {
                    const filePath = path.join(this.stateDirectory, fileName);
                    return JSON.parse(fs.readFileSync(filePath, "utf8"));
                })
                .filter((session) => session && "object" === typeof session);
        }
        catch (error)
        {
            sessions = [{
                id: "state-store",
                provider: "Agent Pet",
                source: "windows",
                state: "error",
                message: error.message,
                updatedAt: new Date().toISOString()
            }];
        }

        const snapshot = selectAggregate(sessions);
        const serialized = JSON.stringify(snapshot);

        if (serialized !== this.lastSnapshot)
        {
            this.lastSnapshot = serialized;
            this.emit("change", snapshot);
        }
    }

    clear()
    {
        fs.mkdirSync(this.stateDirectory, { recursive: true });
        for (const fileName of fs.readdirSync(this.stateDirectory))
        {
            if (fileName.endsWith(".json"))
            {
                fs.rmSync(path.join(this.stateDirectory, fileName), { force: true });
            }
        }
        this.refresh();
    }

    stop()
    {
        if (this.fileWatcher)
        {
            this.fileWatcher.close();
        }
        if (this.refreshTimer)
        {
            clearInterval(this.refreshTimer);
        }
    }
}

module.exports = {
    StateStore,
    effectiveState,
    selectAggregate
};
