"use strict";

const path = require("node:path");
const fs = require("node:fs");
const {
    app,
    BrowserWindow,
    ipcMain,
    Menu,
    nativeImage,
    shell,
    Tray,
    screen
} = require("electron");
const { StateStore } = require("./state-store");

let mainWindow = null;
let tray = null;
let stateStore = null;
let latestSnapshot = { state: "idle", sessions: [], counts: {} };
let displayMode = "pet";
let isQuitting = false;

const STATUS_COLORS = Object.freeze({
    idle: "#758195",
    running: "#2bc4e8",
    completed: "#50d890",
    needs_input: "#ffc857",
    error: "#ff5d73"
});

function stateDirectory()
{
    const localAppData = process.env.LOCALAPPDATA
        || path.join(path.dirname(app.getPath("appData")), "Local");

    return path.join(localAppData, "AgentPet", "states");
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

function placeWindow()
{
    if (!mainWindow)
    {
        return;
    }

    const bounds = screen.getPrimaryDisplay().workArea;
    const [width, height] = mainWindow.getSize();
    mainWindow.setPosition(
        bounds.x + bounds.width - width - 24,
        bounds.y + bounds.height - height - 18,
        false
    );
}

function applyDisplayMode(mode)
{
    displayMode = "traffic" === mode ? "traffic" : "pet";
    if (mainWindow)
    {
        mainWindow.setSize(
            "traffic" === displayMode ? 104 : 300,
            "traffic" === displayMode ? 236 : 350,
            true
        );
        mainWindow.webContents.send("display-mode", displayMode);
        placeWindow();
    }
    rebuildTrayMenu();
}

function rebuildTrayMenu()
{
    if (!tray)
    {
        return;
    }

    const autoStart = app.getLoginItemSettings({ path: loginExecutable() }).openAtLogin;
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
            checked: "pet" === displayMode,
            click: () => applyDisplayMode("pet")
        },
        {
            label: "红绿灯模式",
            type: "radio",
            checked: "traffic" === displayMode,
            click: () => applyDisplayMode("traffic")
        },
        { type: "separator" },
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
        width: 300,
        height: 350,
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
        placeWindow();
        mainWindow.showInactive();
        mainWindow.webContents.send("agent-state", latestSnapshot);
        mainWindow.webContents.send("display-mode", displayMode);
    });
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
        createWindow();
        createTray();

        stateStore = new StateStore(stateDirectory());
        stateStore.on("change", publishSnapshot);
        stateStore.start();

        ipcMain.on("set-display-mode", (_event, mode) => applyDisplayMode(mode));
        ipcMain.on("hide-window", () => {
            mainWindow.hide();
            rebuildTrayMenu();
        });
    });
}

app.on("before-quit", () => {
    isQuitting = true;
    if (stateStore)
    {
        stateStore.stop();
    }
});

app.on("window-all-closed", (event) => event.preventDefault());
