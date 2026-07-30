"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ActivityPulse, POWERSHELL_PROBE } = require("../src/keyboard-activity");
const { ApprovalStore } = require("../src/approval-store");
const { normalizeSettings } = require("../src/settings-store");
const { windowsPathToWsl } = require("../src/ai-setup");
const { cpuPercent } = require("../src/resource-monitor");
const { importImageFiles, validateImageFile } = require("../src/custom-assets");
const { createTrayBitmap, STATUS_RGB, TRAY_ICON_SIZE } = require("../src/tray-icon");

test("keyboard activity emits only active and idle transitions", () => {
    const events = [];
    let callback = null;
    const pulse = new ActivityPulse(900, {
        setTimeout: (next) => {
            callback = next;
            return { unref() {} };
        },
        clearTimeout: () => {}
    });

    pulse.on("change", (active) => events.push(active));
    pulse.pulse();
    pulse.pulse();
    assert.deepEqual(events, [true]);
    callback();
    assert.deepEqual(events, [true, false]);
});

test("keyboard probe emits activity only and never prints virtual key values", () => {
    assert.match(POWERSHELL_PROBE, /WriteLine\("1"\)/);
    assert.doesNotMatch(POWERSHELL_PROBE, /WriteLine\([^\n]*virtualKey/);
});

test("settings accept only supported size and opacity presets", () => {
    assert.deepEqual(normalizeSettings({ scale: 1.25, opacity: 0.75, clickThrough: true }), {
        clickThrough: true,
        displayMode: "pet",
        keyboardAnimation: true,
        opacity: 0.75,
        scale: 1.25,
        position: null,
        animation: {
            style: "classic",
            hoverEnabled: true,
            mascotPath: null,
            hoverFrames: [],
            hoverFrameMs: 110
        },
        resources: {
            enabled: true,
            cpu: true,
            gpu: true,
            memory: true,
            network: true
        }
    });
    assert.equal(normalizeSettings({ scale: 9 }).scale, 1);
});

test("approval decisions are written only for existing safe requests", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pet-approval-"));
    try
    {
        const store = new ApprovalStore(directory);
        const request = {
            id: "request-1",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString()
        };
        fs.writeFileSync(path.join(directory, "request-1.request.json"), JSON.stringify(request));
        store.refresh();
        assert.equal(store.active().id, "request-1");
        assert.equal(store.decide("request-1", "allow"), true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "request-1.decision.json"), "utf8")).decision, "allow");
        assert.equal(store.decide("../escape", "allow"), false);
    }
    finally
    {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
test("one-click setup converts its packaged installer path for WSL", () => {
    assert.equal(
        windowsPathToWsl("C:\\Users\\tester\\AppData\\Local\\AgentPet\\setup-package"),
        "/mnt/c/Users/tester/AppData/Local/AgentPet/setup-package"
    );
});
test("resource CPU usage is calculated from bounded time deltas", () => {
    assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 125, total: 300 }), 75);
    assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 }), 0);
});

test("resource visibility settings merge without resetting other metrics", () => {
    const settings = normalizeSettings({ resources: { gpu: false, network: false } });
    assert.equal(settings.resources.enabled, true);
    assert.equal(settings.resources.cpu, true);
    assert.equal(settings.resources.gpu, false);
    assert.equal(settings.resources.network, false);
});
test("desktop position accepts finite coordinates and rejects invalid values", () => {
    assert.deepEqual(normalizeSettings({ position: { x: 120.4, y: -20.6 } }).position, { x: 120, y: -21 });
    assert.equal(normalizeSettings({ position: { x: "left", y: 2 } }).position, null);
});
test("animation settings support styles, custom images and bounded frame speed", () => {
    const settings = normalizeSettings({
        animation: {
            style: "playful",
            hoverEnabled: false,
            mascotPath: "C:\\pet.png",
            hoverFrames: ["C:\\frame-1.png", "C:\\frame-2.png"],
            hoverFrameMs: 70
        }
    });
    assert.equal(settings.animation.style, "playful");
    assert.equal(settings.animation.hoverEnabled, false);
    assert.equal(settings.animation.hoverFrames.length, 2);
    assert.equal(settings.animation.hoverFrameMs, 70);
    assert.equal(normalizeSettings({ animation: { style: "unknown", hoverFrameMs: 1 } }).animation.style, "classic");
});

test("custom animation assets are copied locally in natural filename order", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pet-assets-"));
    try
    {
        const source = path.join(directory, "source");
        const target = path.join(directory, "target");
        fs.mkdirSync(source);
        const frame10 = path.join(source, "frame-10.png");
        const frame2 = path.join(source, "frame-2.png");
        fs.writeFileSync(frame10, "png-10");
        fs.writeFileSync(frame2, "png-2");
        const imported = importImageFiles([frame10, frame2], target, "hover");
        assert.equal(imported.length, 2);
        assert.equal(fs.readFileSync(imported[0], "utf8"), "png-2");
        assert.throws(() => validateImageFile(path.join(source, "frame.svg")));
    }
    finally
    {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
test("tray bitmap has transparent corners and a visible state-colored center", () => {
    const bitmap = createTrayBitmap("running");
    const centerOffset = ((TRAY_ICON_SIZE / 2) * TRAY_ICON_SIZE + (TRAY_ICON_SIZE / 2)) * 4;
    assert.equal(bitmap.length, TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4);
    assert.equal(bitmap[3], 0);
    assert.equal(bitmap[centerOffset + 3], 255);
    assert.deepEqual(
        [bitmap[centerOffset + 2], bitmap[centerOffset + 1], bitmap[centerOffset]],
        STATUS_RGB.running
    );
});
