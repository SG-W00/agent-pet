"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
    app,
    BrowserWindow,
    dialog,
    globalShortcut,
    ipcMain,
    Menu,
    nativeImage,
    shell,
    Tray,
    screen
} = require("electron");
const { installLocalAi } = require("./ai-setup");
const { ApprovalStore } = require("./approval-store");
const { KeyboardActivityMonitor } = require("./keyboard-activity");
const { importImageFiles } = require("./custom-assets");
const { ResourceMonitor } = require("./resource-monitor");
const { SettingsStore } = require("./settings-store");
const { StateStore } = require("./state-store");

let mainWindow = null;
let tray = null;
let stateStore = null;
let approvalStore = null;
let keyboardMonitor = null;
let resourceMonitor = null;
let settingsStore = null;
let settings = null;
let latestApproval = null;
let latestSnapshot = { state: "idle", sessions: [], counts: {} };
let typingActive = false;
let latestResources = null;
let sessionDetailsOpen = false;
let isQuitting = false;
let setupRunning = false;
let positionAdjusting = false;
let positionAdjustTimer = null;
let moveSaveTimer = null;
let suppressMoveSaveUntil = 0;

const BASE_SIZES = Object.freeze({
    pet: { width: 300, height: 350 },
    traffic: { width: 104, height: 236 }
});

const STATUS_COLORS = Object.freeze({
    idle: "#758195",
    running: "#2bc4e8",
    completed: "#50d890",
    needs_input: "#ffc857",
    error: "#ff5d73"
});

function localAppDataDirectory()
{
    return process.env.LOCALAPPDATA
        || path.join(path.dirname(app.getPath("appData")), "Local");
}

function stateDirectory()
{
    return path.join(localAppDataDirectory(), "AgentPet", "states");
}

function approvalDirectory()
{
    return path.join(localAppDataDirectory(), "AgentPet", "approvals");
}

function customAssetDirectory()
{
    return path.join(app.getPath("userData"), "custom-assets");
}

function imageFileUrl(filePath)
{
    return filePath && fs.existsSync(filePath) ? pathToFileURL(filePath).href : null;
}

function publicWindowSettings()
{
    return {
        ...settings,
        animation: {
            ...settings.animation,
            mascotUrl: imageFileUrl(settings.animation.mascotPath),
            hoverFrameUrls: settings.animation.hoverFrames.map(imageFileUrl).filter(Boolean)
        }
    };
}
function loginExecutable()
{
    return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function createTrayImage(state)
{
    const color = STATUS_COLORS[state] || STATUS_COLORS.idle;
    const svg = [
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\">",
        "<circle cx=\"16\" cy=\"16\" r=\"13\" fill=\"#172033\" stroke=\"#ffffff\" stroke-width=\"2\"/>",
        `<circle cx="16" cy="16" r="8" fill="${color}"/>`,
        "</svg>"
    ].join("");
    return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function currentBaseSize()
{
    return BASE_SIZES[settings.displayMode] || BASE_SIZES.pet;
}

function placeWindow(forceDefault = false)
{
    if (!mainWindow)
    {
        return;
    }

    const defaultBounds = screen.getPrimaryDisplay().workArea;
    const bounds = !forceDefault && settings.position
        ? screen.getDisplayNearestPoint(settings.position).workArea
        : defaultBounds;
    const [width, height] = mainWindow.getSize();
    const preferred = !forceDefault && settings.position
        ? settings.position
        : { x: bounds.x + bounds.width - width - 24, y: bounds.y + bounds.height - height - 18 };
    const x = Math.max(bounds.x, Math.min(preferred.x, bounds.x + bounds.width - width));
    const y = Math.max(bounds.y, Math.min(preferred.y, bounds.y + bounds.height - height));
    suppressMoveSaveUntil = Date.now() + 500;
    mainWindow.setPosition(x, y, false);
}

function saveWindowPosition()
{
    if (!mainWindow || Date.now() < suppressMoveSaveUntil)
    {
        return;
    }

    if (moveSaveTimer)
    {
        clearTimeout(moveSaveTimer);
    }
    moveSaveTimer = setTimeout(() => {
        moveSaveTimer = null;
        const [x, y] = mainWindow.getPosition();
        settings = settingsStore.update({ position: { x, y } });
    }, 250);
}

function setPositionAdjusting(active)
{
    if (positionAdjustTimer)
    {
        clearTimeout(positionAdjustTimer);
        positionAdjustTimer = null;
    }
    positionAdjusting = true === active && true === settings.clickThrough;
    applyInteractionMode();
    if (mainWindow && !mainWindow.isDestroyed())
    {
        mainWindow.webContents.send("position-adjust-mode", positionAdjusting);
        if (positionAdjusting)
        {
            mainWindow.show();
            positionAdjustTimer = setTimeout(() => setPositionAdjusting(false), 20000);
        }
    }
    rebuildTrayMenu();
}

function applyInteractionMode()
{
    if (!mainWindow)
    {
        return;
    }

    const shouldIgnoreMouse = settings.clickThrough && !latestApproval && !positionAdjusting && !sessionDetailsOpen;
    mainWindow.setIgnoreMouseEvents(shouldIgnoreMouse, { forward: true });
}

function applyWindowSettings()
{
    if (!mainWindow)
    {
        return;
    }

    const base = currentBaseSize();
    mainWindow.webContents.setZoomFactor(settings.scale);
    mainWindow.setSize(
        Math.round(base.width * settings.scale),
        Math.round(base.height * settings.scale),
        true
    );
    mainWindow.setOpacity(settings.opacity);
    applyInteractionMode();
    mainWindow.webContents.send("display-mode", settings.displayMode);
    mainWindow.webContents.send("window-settings", publicWindowSettings());
    placeWindow();
}

function updateSettings(changes)
{
    settings = settingsStore.update(changes);
    if (false === settings.clickThrough && positionAdjusting)
    {
        setPositionAdjusting(false);
    }
    applyWindowSettings();
    syncKeyboardMonitor();
    syncResourceMonitor();
    rebuildTrayMenu();
}

function applyDisplayMode(mode)
{
    updateSettings({ displayMode: "traffic" === mode ? "traffic" : "pet" });
}

function syncKeyboardMonitor()
{
    if (!keyboardMonitor)
    {
        return;
    }

    if (settings.keyboardAnimation)
    {
        keyboardMonitor.start();
    }
    else
    {
        keyboardMonitor.stop();
    }
}

function syncResourceMonitor()
{
    if (!resourceMonitor)
    {
        return;
    }

    if (settings.resources.enabled)
    {
        resourceMonitor.start();
    }
    else
    {
        resourceMonitor.stop();
        latestResources = null;
        if (mainWindow && !mainWindow.isDestroyed())
        {
            mainWindow.webContents.send("resource-usage", null);
        }
    }
}

function publishResources(snapshot)
{
    latestResources = snapshot;
    if (mainWindow && !mainWindow.isDestroyed())
    {
        mainWindow.webContents.send("resource-usage", snapshot);
    }
}

function publishTypingActivity(active)
{
    typingActive = active;
    if (mainWindow && !mainWindow.isDestroyed())
    {
        mainWindow.webContents.send("typing-activity", active);
    }
}

function setSessionDetailsOpen(open)
{
    sessionDetailsOpen = true === open;
    applyInteractionMode();
    if (mainWindow && !mainWindow.isDestroyed())
    {
        if (sessionDetailsOpen)
        {
            mainWindow.show();
        }
        mainWindow.webContents.send("show-session-details", sessionDetailsOpen);
    }
    rebuildTrayMenu();
}
function decideApproval(decision)
{
    if (!latestApproval || !approvalStore)
    {
        return false;
    }

    const accepted = approvalStore.decide(latestApproval.id, decision);
    if (accepted)
    {
        latestApproval = null;
        mainWindow.webContents.send("approval-request", null);
        applyInteractionMode();
        rebuildTrayMenu();
    }
    return accepted;
}

function publishApprovals(requests)
{
    latestApproval = requests[0] || null;
    if (mainWindow && !mainWindow.isDestroyed())
    {
        if (latestApproval)
        {
            mainWindow.show();
        }
        mainWindow.webContents.send("approval-request", latestApproval);
        mainWindow.webContents.send("resource-usage", latestResources);
        mainWindow.webContents.send("position-adjust-mode", positionAdjusting);
        applyInteractionMode();
    }
    rebuildTrayMenu();
}

function formatSetupResult(result)
{
    const windows = result.windows.ok ? "✓ Windows 已配置" : `✗ Windows：${result.windows.message}`;
    const wsl = result.wsl.ok ? "✓ 默认 WSL 已配置" : `△ 默认 WSL：${result.wsl.message}`;
    return `${windows}\n${wsl}\n\n请重启 Codex 和 Claude Code。Codex 中输入 /hooks，并重新信任 Agent Pet hooks。`;
}

function runOneClickSetup()
{
    if (setupRunning)
    {
        return;
    }

    setupRunning = true;
    rebuildTrayMenu();
    setImmediate(() => {
        const result = installLocalAi(localAppDataDirectory());
        setupRunning = false;
        rebuildTrayMenu();
        dialog.showMessageBox(mainWindow, {
            type: result.windows.ok ? "info" : "error",
            title: "Agent Pet 一键配置",
            message: "本机 AI 配置完成",
            detail: formatSetupResult(result),
            buttons: ["知道了"]
        });
    });
}

async function chooseMascotImage()
{
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择桌宠主图",
        properties: ["openFile"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
    });
    if (result.canceled)
    {
        return;
    }
    try
    {
        const [mascotPath] = importImageFiles(result.filePaths, customAssetDirectory(), "mascot");
        updateSettings({ animation: { mascotPath } });
    }
    catch (error)
    {
        dialog.showErrorBox("无法导入桌宠图片", error.message);
    }
}

async function chooseHoverFrames()
{
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择悬停动画帧（按文件名排序）",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]
    });
    if (result.canceled)
    {
        return;
    }
    try
    {
        const hoverFrames = importImageFiles(result.filePaths, customAssetDirectory(), "hover");
        updateSettings({ animation: { hoverFrames, hoverEnabled: true } });
    }
    catch (error)
    {
        dialog.showErrorBox("无法导入悬停动画帧", error.message);
    }
}
function rebuildTrayMenu()
{
    if (!tray || !settings)
    {
        return;
    }

    const autoStart = app.getLoginItemSettings({ path: loginExecutable() }).openAtLogin;
    const scaleItems = [[0.75, "75%"], [1, "100%"], [1.25, "125%"], [1.5, "150%"]];
    const opacityItems = [[0.5, "50%"], [0.75, "75%"], [0.9, "90%"], [1, "100%"]];

    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: mainWindow && mainWindow.isVisible() ? "隐藏桌宠" : "显示桌宠",
            click: () => {
                if (mainWindow.isVisible())
                {
                    mainWindow.hide();
                }
                else
                {
                    mainWindow.showInactive();
                }
                rebuildTrayMenu();
            }
        },
        { type: "separator" },
        {
            label: "桌宠模式",
            type: "radio",
            checked: "pet" === settings.displayMode,
            click: () => applyDisplayMode("pet")
        },
        {
            label: "红绿灯模式",
            type: "radio",
            checked: "traffic" === settings.displayMode,
            click: () => applyDisplayMode("traffic")
        },
        {
            label: "大小",
            submenu: scaleItems.map(([value, label]) => ({
                label,
                type: "radio",
                checked: value === settings.scale,
                click: () => updateSettings({ scale: value })
            }))
        },
        {
            label: "透明度",
            submenu: opacityItems.map(([value, label]) => ({
                label,
                type: "radio",
                checked: value === settings.opacity,
                click: () => updateSettings({ opacity: value })
            }))
        },
        {
            label: "鼠标穿透模式  Ctrl+Shift+Alt+P",
            type: "checkbox",
            checked: settings.clickThrough,
            click: (item) => updateSettings({ clickThrough: item.checked })
        },
        {
            label: positionAdjusting ? "完成位置调整" : "调整位置（20 秒）  Ctrl+Shift+Alt+M",
            enabled: settings.clickThrough,
            click: () => setPositionAdjusting(!positionAdjusting)
        },
        {
            label: "恢复到右下角",
            click: () => {
                settings = settingsStore.update({ position: null });
                placeWindow(true);
                rebuildTrayMenu();
            }
        },
        {
            label: "外观与动画",
            submenu: [
                {
                    label: "动画风格",
                    submenu: [
                        ["classic", "经典"],
                        ["playful", "活泼"],
                        ["gentle", "轻柔"],
                        ["still", "静止"]
                    ].map(([value, label]) => ({
                        label,
                        type: "radio",
                        checked: value === settings.animation.style,
                        click: () => updateSettings({ animation: { style: value } })
                    }))
                },
                {
                    label: "鼠标悬停随机动画",
                    type: "checkbox",
                    checked: settings.animation.hoverEnabled,
                    click: (item) => updateSettings({ animation: { hoverEnabled: item.checked } })
                },
                {
                    label: "悬停帧速度",
                    submenu: [[70, "快速"], [110, "标准"], [180, "慢速"]].map(([value, label]) => ({
                        label,
                        type: "radio",
                        checked: value === settings.animation.hoverFrameMs,
                        click: () => updateSettings({ animation: { hoverFrameMs: value } })
                    }))
                },
                { type: "separator" },
                { label: "更换桌宠主图…", click: chooseMascotImage },
                { label: "导入悬停动画帧…", click: chooseHoverFrames },
                {
                    label: "恢复默认主图",
                    enabled: Boolean(settings.animation.mascotPath),
                    click: () => updateSettings({ animation: { mascotPath: null } })
                },
                {
                    label: "清除悬停动画帧",
                    enabled: 0 < settings.animation.hoverFrames.length,
                    click: () => updateSettings({ animation: { hoverFrames: [] } })
                }
            ]
        },
        {
            label: "电脑资源显示",
            submenu: [
                {
                    label: "启用资源监控（数据仅保留在本机）",
                    type: "checkbox",
                    checked: settings.resources.enabled,
                    click: (item) => updateSettings({ resources: { enabled: item.checked } })
                },
                { type: "separator" },
                {
                    label: "CPU",
                    type: "checkbox",
                    checked: settings.resources.cpu,
                    click: (item) => updateSettings({ resources: { cpu: item.checked } })
                },
                {
                    label: "GPU",
                    type: "checkbox",
                    checked: settings.resources.gpu,
                    click: (item) => updateSettings({ resources: { gpu: item.checked } })
                },
                {
                    label: "内存",
                    type: "checkbox",
                    checked: settings.resources.memory,
                    click: (item) => updateSettings({ resources: { memory: item.checked } })
                },
                {
                    label: "网速（下行 / 上行）",
                    type: "checkbox",
                    checked: settings.resources.network,
                    click: (item) => updateSettings({ resources: { network: item.checked } })
                }
            ]
        },
        {
            label: "键盘打字动画（不记录按键）",
            type: "checkbox",
            checked: settings.keyboardAnimation,
            click: (item) => updateSettings({ keyboardAnimation: item.checked })
        },
        { type: "separator" },
        {
            label: sessionDetailsOpen ? "关闭会话详情" : `查看 ${latestSnapshot.sessions.length} 个会话详情  Ctrl+Shift+Alt+S`,
            enabled: 0 < latestSnapshot.sessions.length,
            click: () => setSessionDetailsOpen(!sessionDetailsOpen)
        },
        {
            label: latestApproval ? "允许当前授权  Ctrl+Shift+Enter" : "当前没有待授权操作",
            enabled: Boolean(latestApproval),
            click: () => decideApproval("allow")
        },
        {
            label: "拒绝当前授权  Ctrl+Shift+Backspace",
            enabled: Boolean(latestApproval),
            click: () => decideApproval("deny")
        },
        { type: "separator" },
        {
            label: setupRunning ? "正在配置本机 AI…" : "一键配置本机 AI（Windows + 默认 WSL）",
            enabled: !setupRunning,
            click: runOneClickSetup
        },
        {
            label: "打开状态目录",
            click: () => shell.openPath(stateDirectory())
        },
        {
            label: "清除会话状态",
            click: () => stateStore.clear()
        },
        {
            label: "开机启动",
            type: "checkbox",
            checked: autoStart,
            click: (item) => app.setLoginItemSettings({
                openAtLogin: item.checked,
                path: loginExecutable()
            })
        },
        { type: "separator" },
        {
            label: "退出 Agent Pet",
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]));
}

function createWindow()
{
    mainWindow = new BrowserWindow({
        width: BASE_SIZES.pet.width,
        height: BASE_SIZES.pet.height,
        transparent: true,
        frame: false,
        resizable: false,
        show: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.setAlwaysOnTop(true, "floating");
    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    mainWindow.once("ready-to-show", () => {
        applyWindowSettings();
        mainWindow.showInactive();
        mainWindow.webContents.send("agent-state", latestSnapshot);
        mainWindow.webContents.send("typing-activity", typingActive);
        mainWindow.webContents.send("approval-request", latestApproval);
        mainWindow.webContents.send("resource-usage", latestResources);
        mainWindow.webContents.send("position-adjust-mode", positionAdjusting);
    });
    mainWindow.on("move", saveWindowPosition);
    mainWindow.on("close", (event) => {
        if (!isQuitting)
        {
            event.preventDefault();
            mainWindow.hide();
            rebuildTrayMenu();
        }
    });
}

function createTray()
{
    tray = new Tray(createTrayImage("idle"));
    tray.setToolTip("Agent Pet · 空闲");
    tray.on("click", () => {
        if (mainWindow.isVisible())
        {
            mainWindow.hide();
        }
        else
        {
            mainWindow.showInactive();
        }
        rebuildTrayMenu();
    });
    rebuildTrayMenu();
}

function publishSnapshot(snapshot)
{
    latestSnapshot = snapshot;
    if (mainWindow && !mainWindow.isDestroyed())
    {
        mainWindow.webContents.send("agent-state", snapshot);
    }
    if (tray)
    {
        tray.setImage(createTrayImage(snapshot.state));
        const provider = snapshot.active ? snapshot.active.provider : "Agent";
        tray.setToolTip(`Agent Pet · ${provider} · ${snapshot.state}`);
    }
    rebuildTrayMenu();
}

function registerGlobalShortcuts()
{
    globalShortcut.register("CommandOrControl+Shift+Enter", () => decideApproval("allow"));
    globalShortcut.register("CommandOrControl+Shift+Backspace", () => decideApproval("deny"));
    globalShortcut.register("CommandOrControl+Shift+Alt+P", () => {
        updateSettings({ clickThrough: !settings.clickThrough });
    });
    globalShortcut.register("CommandOrControl+Shift+Alt+M", () => {
        setPositionAdjusting(!positionAdjusting);
    });
    globalShortcut.register("CommandOrControl+Shift+Alt+S", () => {
        if (0 < latestSnapshot.sessions.length)
        {
            setSessionDetailsOpen(!sessionDetailsOpen);
        }
    });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock)
{
    app.quit();
}
else
{
    app.on("second-instance", () => {
        if (mainWindow)
        {
            mainWindow.show();
        }
    });

    app.whenReady().then(() => {
        fs.mkdirSync(stateDirectory(), { recursive: true });
        fs.mkdirSync(approvalDirectory(), { recursive: true });
        settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
        settings = settingsStore.load();

        createWindow();
        createTray();

        stateStore = new StateStore(stateDirectory());
        stateStore.on("change", publishSnapshot);
        stateStore.start();

        approvalStore = new ApprovalStore(approvalDirectory());
        approvalStore.on("change", publishApprovals);
        approvalStore.start();

        keyboardMonitor = new KeyboardActivityMonitor();
        keyboardMonitor.on("change", publishTypingActivity);
        syncKeyboardMonitor();

        resourceMonitor = new ResourceMonitor();
        resourceMonitor.on("change", publishResources);
        syncResourceMonitor();
        registerGlobalShortcuts();

        ipcMain.on("set-display-mode", (_event, mode) => applyDisplayMode(mode));
        ipcMain.on("hide-window", () => {
            mainWindow.hide();
            rebuildTrayMenu();
        });
        ipcMain.on("approval-decision", (_event, decision) => decideApproval(decision));
        ipcMain.on("session-details-state", (_event, open) => {
            sessionDetailsOpen = true === open;
            applyInteractionMode();
            rebuildTrayMenu();
        });
    });
}

app.on("before-quit", () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    if (positionAdjustTimer)
    {
        clearTimeout(positionAdjustTimer);
    }
    if (moveSaveTimer)
    {
        clearTimeout(moveSaveTimer);
    }
    if (stateStore)
    {
        stateStore.stop();
    }
    if (approvalStore)
    {
        approvalStore.stop();
    }
    if (keyboardMonitor)
    {
        keyboardMonitor.stop();
    }
    if (resourceMonitor)
    {
        resourceMonitor.stop();
    }
});

app.on("window-all-closed", (event) => event.preventDefault());