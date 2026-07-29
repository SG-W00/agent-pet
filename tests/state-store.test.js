"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { effectiveState, selectAggregate } = require("../src/state-store");
const { normalizeEvent, shouldPreserveFinalState, windowsPathToWsl } = require("../bridge/agent-pet-bridge");

test("aggregate chooses the highest-priority active state", () => {
    const now = Date.now();
    const sessions = [
        { state: "running", updatedAt: new Date(now).toISOString() },
        { state: "needs_input", updatedAt: new Date(now).toISOString() },
        { state: "completed", updatedAt: new Date(now).toISOString() }
    ];

    assert.equal(selectAggregate(sessions, now).state, "needs_input");
});

test("a recent completion is visible above another running session", () => {
    const now = Date.now();
    const sessions = [
        { state: "running", updatedAt: new Date(now).toISOString() },
        { state: "completed", updatedAt: new Date(now).toISOString() }
    ];

    assert.equal(selectAggregate(sessions, now).state, "completed");
});

test("completed state returns to idle after its display lifetime", () => {
    const now = Date.now();
    const session = {
        state: "completed",
        updatedAt: new Date(now - 16000).toISOString()
    };

    assert.equal(effectiveState(session, now), "idle");
});

test("maps Codex and Claude lifecycle events", () => {
    assert.equal(normalizeEvent("UserPromptSubmit", {}), "running");
    assert.equal(normalizeEvent("PermissionRequest", {}), "needs_input");
    assert.equal(normalizeEvent("Notification", { notification_type: "idle_prompt" }), "needs_input");
    assert.equal(normalizeEvent("Stop", {}), "completed");
    assert.equal(normalizeEvent("StopFailure", {}), "error");
    assert.equal(normalizeEvent("SessionEnd", {}), "idle");
});

test("session end preserves a recent completion but not an old one", () => {
    const now = Date.now();
    assert.equal(shouldPreserveFinalState({
        state: "completed",
        updatedAt: new Date(now - 1000).toISOString()
    }, "idle", now), true);
    assert.equal(shouldPreserveFinalState({
        state: "completed",
        updatedAt: new Date(now - 16000).toISOString()
    }, "idle", now), false);
});

test("converts a Windows local app data path to WSL", () => {
    assert.equal(
        windowsPathToWsl("C:\\Users\\woan\\AppData\\Local"),
        "/mnt/c/Users/woan/AppData/Local"
    );
});
