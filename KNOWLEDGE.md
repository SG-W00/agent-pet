# Agent Pet 工程知识文档

> 项目版本：v0.3.0 | 最后更新：2026-07-30
>
> **注意：本文档为工程知识文档，供开发者理解项目架构和模块设计使用。不是替换 README，README 面向用户。**
>
> 本文档由 [wushangu] 在项目初期形成，后续开发者应随版本更新同步维护此文档。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [项目结构](#3-项目结构)
4. [架构总览](#4-架构总览)
5. [核心模块详解](#5-核心模块详解)
   - 5.1 Electron 主进程 (`src/main.js`)
   - 5.2 渲染进程 (`src/renderer/`)
   - 5.3 状态管理 (`src/state-store.js`)
   - 5.4 设置管理 (`src/settings-store.js`)
   - 5.5 授权系统 (`src/approval-store.js` + `bridge/agent-pet-bridge.js`)
   - 5.6 键盘活动监控 (`src/keyboard-activity.js`)
   - 5.7 资源监控 (`src/resource-monitor.js`)
   - 5.8 自定义素材管理 (`src/custom-assets.js`)
   - 5.9 一键配置 (`src/ai-setup.js`)
   - 5.10 Hook 配置 (`scripts/hook-config.js`)
   - 5.11 Hook 安装 (`scripts/install-hooks.js`)
6. [数据流与通信架构](#6-数据流与通信架构)
7. [状态优先级与生命周期](#7-状态优先级与生命周期)
8. [动画系统](#8-动画系统)
9. [快捷键系统](#9-快捷键系统)
10. [安全模型](#10-安全模型)
11. [测试](#11-测试)
12. [构建与发布](#12-构建与发布)
13. [开发指南](#13-开发指南)
14. [相关项目](#14-相关项目)

---

## 1. 项目概述

Agent Pet 是一个 Windows 桌面宠物应用，通过 Electron 实现，用于实时显示 Codex CLI 和 Claude Code（分别来自 Windows 和 WSL）的活动状态。

**核心功能：**
- 在桌面上以宠物的形态展示 Agent 的工作状态（空闲、执行中、待输入/授权、完成、错误）
- 右键托盘菜单提供丰富的显示模式、大小、透明度、鼠标穿透等配置
- 实时显示 CPU/GPU/内存/网速资源条
- 键盘打字动画
- 授权请求的桌面弹窗处理
- 一键配置本机 Codex/Claude hooks

**设计理念：**
- 纯本地运行，不开放网络端口，不上传数据
- 文件系统作为 IPC 介质（状态文件 + 授权请求文件）
- 兼容 Windows 和 WSL 的 Agent 活动

---

## 2. 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 20 | 运行时 |
| Electron | ^37.2.4 | 桌面框架 |
| electron-builder | ^26.0.12 | 构建打包 |
| 测试 | node:test (内置) | 单元测试 |
| 文件系统 | fs.watch + polling | 状态监控 |
| PowerShell | Windows 内置 | 硬件探针 + 键盘监控 |

**关键依赖分析：** 项目几乎没有第三方 npm 依赖（仅有 Electron 和 electron-builder），全部使用 Node.js 内置模块（`fs`, `path`, `crypto`, `os`, `child_process`, `events`, `readline`）。这是一个有意识的设计选择——减少攻击面，保持轻量。

---

## 3. 项目结构

```
agent-pet/
├── assets/                           # 静态资源
│   ├── icon.ico                      # Windows 托盘图标
│   ├── mascot.png                    # 默认桌宠主图（机器人水獭）
│   └── mascot-chroma.png             # 褪绿版本（去绿幕）
├── bridge/
│   └── agent-pet-bridge.js           # ★ Agent hook 桥接脚本（核心 IPC）
├── scripts/
│   ├── install-hooks.js              # Hook 安装入口
│   ├── uninstall-hooks.js            # Hook 卸载入口
│   ├── hook-config.js                # ★ Hook 配置管理（事件定义、路径、CRUD）
│   ├── simulate.js                   # 模拟 Agent 状态用于测试
│   └── capture-ui.js                 # UI 截图捕获（视觉冒烟测试）
├── src/
│   ├── main.js                       # ★ Electron 主进程（窗口、托盘、IPC）
│   ├── preload.js                    # 上下文桥接（contextBridge）
│   ├── state-store.js                # ★ Agent 会话状态管理
│   ├── settings-store.js             # 用户设置持久化
│   ├── approval-store.js             # ★ 授权请求管理
│   ├── keyboard-activity.js          # 键盘活动监控
│   ├── resource-monitor.js           # CPU/GPU/内存/网速监控
│   ├── custom-assets.js              # 自定义图片导入
│   ├── ai-setup.js                   # 一键配置 AI CLI hooks
│   └── renderer/
│       ├── index.html                # 主窗口 HTML
│       ├── renderer.js               # ★ 渲染进程逻辑
│       └── styles.css                # ★ 完整样式/动画定义
├── tests/
│   ├── state-store.test.js           # 状态管理测试
│   ├── bridge-approval.test.js       # 授权流程集成测试
│   └── desktop-features.test.js      # 桌面功能单元测试
├── package.json
├── KNOWLEDGE.md                      # 本文档
└── README.md                         # 用户文档
```

---

## 4. 架构总览

Agent Pet 采用 **Electron 双进程架构**，通过文件系统作为进程间和跨主机通信的介质。

```
┌─────────────────────────────────────────────────────────────┐
│                   Electron Renderer Process                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  renderer.js                                         │   │
│  │  - 状态渲染（文字、徽章、面板）                        │   │
│  │  - 动画控制（CSS class 切换）                          │   │
│  │  - 悬浮动画（内置动作 / 自定义帧）                      │   │
│  │  - 资源面板更新                                       │   │
│  │  - 授权 UI 交互                                       │   │
│  │  - 会话详情面板                                       │   │
│  └───────────────┬──────────────────────────────────────┘   │
│                  │  IPC (contextBridge)                      │
│  ┌───────────────▼──────────────────────────────────────┐   │
│  │  preload.js                                          │   │
│  │  - agentPet.onState / onTypingActivity / ...          │   │
│  │  - agentPet.setDisplayMode / decideApproval / ...     │   │
│  └───────────────┬──────────────────────────────────────┘   │
└──────────────────┼──────────────────────────────────────────┘
                   │  ipcMain / ipcRenderer
┌──────────────────▼──────────────────────────────────────────┐
│                  Electron Main Process                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  main.js                                             │   │
│  │  - 窗口管理（透明 / 无框 / 置顶）                     │   │
│  │  - 系统托盘菜单                                      │   │
│  │  - 全局快捷键                                        │   │
│  │  - 子系统编排（start/stop 生命周期）                  │   │
│  └───┬───────┬───────┬───────┬───────┬───────┬─────────┘   │
│      │       │       │       │       │       │             │
│  ┌───▼───┐┌──▼───┐┌──▼───┐┌──▼───┐┌──▼───┐┌──▼───┐       │
│  │State  ││Approval││Keyboard││Resrc. ││Sets. ││AI    │       │
│  │Store  ││Store  ││Monitor ││Monitor││Store ││Setup │       │
│  └───────┘└───────┘└───────┘└───────┘└───────┘└───────┘       │
└──────────────────────────────────────────────────────────────┘
                            │ 文件系统
┌───────────────────────────▼──────────────────────────────────┐
│    %LOCALAPPDATA%\AgentPet\                                  │
│    ├── states\              ← Agent 会话状态（JSON）        │
│    │   ├── <session-id>.json                                 │
│    │   └── ...                                               │
│    ├── approvals\           ← 授权请求/响应（JSON）          │
│    │   ├── <id>.request.json                                 │
│    │   └── <id>.decision.json                                │
│    └── setup-package\       ← WSL 安装临时文件               │
└──────────────────────────────────────────────────────────────┘
                            │ stdin/stdout
┌───────────────────────────▼──────────────────────────────────┐
│  Codex CLI / Claude Code (Windows + WSL)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  agent-pet-bridge.js (每个进程独立运行)               │   │
│  │  - 监听 CLI 生命周期事件                              │   │
│  │  - 写入状态文件到 Windows 共享目录                    │   │
│  │  - 处理授权请求流                                    │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. 核心模块详解

### 5.1 Electron 主进程 (`src/main.js`)

**职责：** 窗口生命周期管理、系统托盘、全局快捷键、子系统编排。

**关键数据结构：**
- `BASE_SIZES` — 两种显示模式的基础尺寸（宠物 300×350，红绿灯 104×236）
- `STATUS_COLORS` — 状态到颜色的映射（idle/#758195, running/#2bc4e8, completed/#50d890, needs_input/#ffc857, error/#ff5d73）

**窗口配置：**
```js
transparent: true,      // 透明背景
frame: false,           // 无框窗口
resizable: false,       // 禁止调整大小
alwaysOnTop: true,      // 始终置顶
skipTaskbar: true,      // 不在任务栏显示
hasShadow: false        // 无阴影
contextIsolation: true  // 安全隔离
```

**生命周期：**
- 单实例锁（`app.requestSingleInstanceLock()`）
- 窗口关闭时默认隐藏而非退出（`event.preventDefault()`）
- `before-quit` 统一清理所有子系统

**关键方法：**
- `applyWindowSettings()` — 应用尺寸/透明度/点击穿透/位置
- `applyInteractionMode()` — 根据点击穿透 + 授权状态 + 位置调整 + 会话详情决定鼠标事件处理
- `placeWindow(forceDefault)` — 窗口定位（记住位置或右下角）
- `saveWindowPosition()` — 防抖保存窗口位置（250ms 延迟）
- `setPositionAdjusting()` — 鼠标穿透时临时恢复拖动（20 秒自动恢复）
- `rebuildTrayMenu()` — 重建托盘菜单（反映最新状态）

### 5.2 渲染进程 (`src/renderer/`)

#### `index.html`

**视图结构：**
1. `#pet-view` — 宠物主视图（默认显示）
   - `#speech-bubble` — 状态文字气泡
   - `#pet-stage` — 宠物舞台（mascot + typing scene + effects）
   - `#resource-panel` — 资源监控面板
   - `#session-summary` — 底部会话摘要
2. `#traffic-view` — 红绿灯模式视图
3. `#session-details-panel` — 会话详情抽屉
4. `#approval-panel` — 授权请求浮层

#### `renderer.js`

**状态呈现常量 `STATE_PRESENTATION`：**
| 状态 | 标题 | 提示 | 徽章 | 红绿灯文字 |
|------|------|------|------|-----------|
| idle | 空闲中 | 等你派任务给我 | Z | 空闲 |
| running | 努力工作中 | 正在处理任务… | ⚙ | 执行中 |
| completed | 任务完成啦 | 快来看看成果吧！ | ✓ | 已完成 |
| needs_input | 需要你的决定 | 有一个问题等你处理 | ? | 待输入 |
| error | 遇到问题了 | 请回到终端查看错误 | ! | 异常 |

**IPC 回调注册（通过 `window.agentPet`）：**
- `onState(snapshot)` — 状态更新
- `onTypingActivity(active)` — 键盘活动信号
- `onApprovalRequest(request)` — 授权请求
- `onDisplayMode(mode)` — 显示模式切换
- `onWindowSettings(settings)` — 设置更新
- `onResourceUsage(snapshot)` — 资源数据
- `onShowSessionDetails(open)` — 会话详情开关
- `onPositionAdjustMode(active)` — 位置调整模式

**悬停动画系统：**
- 鼠标移入宠物时随机播放内置动作（hop/wave/spin/squash）或自定义帧动画
- 65% 概率播放自定义帧（有帧时），否则播放内置动作
- 使用 `hoverTimer` 管理动画生命周期，防止冲突

#### `styles.css`

**设计规范：**
- 颜色方案：深蓝底色（`#141c2d`）+ 白色文字 + 状态色点缀
- 字体：Microsoft YaHei UI / Segoe UI
- 圆角风格：统一 12-22px 圆角
- 阴影：`drop-shadow` + `box-shadow` 层次感
- 暗色模式：`color-scheme: dark`

**动画分类：**
| 类型 | 选择器 | 说明 |
|------|--------|------|
| 空闲呼吸 | `.state-idle #mascot` | 3.2s 循环上下浮动 |
| 工作摇摆 | `.state-running #mascot` | 0.58s 交替旋转 |
| 完成跳跃 | `.state-completed #mascot` | 0.75s 跳跃 3 次 |
| 待输入抖动 | `.state-needs_input #mascot` | 0.55s 左右摇头 |
| 错误震动 | `.state-error #mascot` | 0.22s 抖动 |
| 打字前倾 | `.is-typing` | 0.44s 交替倾斜 |
| 悬停动作 | `.hover-action-*` | 跳/挥手/旋转/压缩 |

**动画风格（`animation-style-*`）：**
- `classic`（默认）— 使用内置状态动画
- `playful` — 更活泼的弹跳和摇摆
- `gentle` — 轻柔浮动
- `still` — 静止

### 5.3 状态管理 (`src/state-store.js`)

**核心职责：** 监控 `%LOCALAPPDATA%\AgentPet\states\` 目录，读取所有 JSON 文件，聚合并发布状态变更。

**状态优先级（`STATE_PRIORITY`）：**
```
needs_input (5) > error (4) > completed (3) > running (2) > idle (1)
```

**有效期机制（`effectiveState()`）：**
- `completed` 保持 15 秒后 → idle
- `error` 保持 60 秒后 → idle
- `running` 超过 6 小时无更新 → idle

**聚合算法（`selectAggregate()`）：**
1. 归一化每个 session 的有效状态
2. 按优先级降序 + 更新时间降序排列
3. 取第一个非 idle session 作为 `active`
4. 计算各状态计数

**监控机制：**
- `fs.watch()` — 文件系统事件触发刷新
- `setInterval(1000ms)` — 轮询备份（弥补 fs.watch 不靠谱的场景）
- 变更检测通过 JSON 字符串比较，避免不必要的 emit

### 5.4 设置管理 (`src/settings-store.js`)

**配置文件位置：** `app.getPath("userData")/settings.json`

**默认设置：**
```js
{
  clickThrough: false,        // 鼠标穿透
  displayMode: "pet",         // 显示模式（pet / traffic）
  keyboardAnimation: true,    // 键盘打字动画
  opacity: 1,                 // 透明度（0.5/0.75/0.9/1）
  scale: 1,                   // 缩放（0.75/1/1.25/1.5）
  position: null,             // 窗口位置（null=右下角）
  animation: {
    style: "classic",         // 动画风格
    hoverEnabled: true,       // 悬停动画
    mascotPath: null,         // 自定义主图路径
    hoverFrames: [],          // 自定义悬停帧
    hoverFrameMs: 110         // 帧间隔（60-500ms）
  },
  resources: {
    enabled: true,            // 资源监控总开关
    cpu: true, gpu: true, memory: true, network: true
  }
}
```

**特点：**
- 所有值严格校验和白名单（不合法值静默回退到默认）
- `update()` 方法做浅合并（shallow merge）
- 每次更新立即写入磁盘
- 读取失败时返回默认值

### 5.5 授权系统

授权系统是整个项目中设计最精巧的部分，需要特别关注。

#### `src/approval-store.js`（Electron 端）

- 监控 `approvals/` 目录，250ms 轮询
- 读取 `.request.json` 文件，过滤过期请求
- 提供 `decide(id, decision)` 方法写入 `.decision.json`
- 使用原子写入（`.tmp` 临时文件 + `renameSync`）防止脏读
- `SAFE_ID` 正则校验：`/^[A-Za-z0-9._-]{1,120}$/`

#### `bridge/agent-pet-bridge.js`（Agent 端）

这是一个独立运行的 Node.js CLI 脚本，被 Codex/Claude 的 hook 系统调用。

**事件标准化（`normalizeEvent()`）：**

| 输入事件 | 标准化状态 |
|---------|-----------|
| UserPromptSubmit, sessionstart, running | running |
| PermissionRequest, approvalrequested, needsinput + Notification(idle_prompt/permission_prompt) | needs_input |
| Stop, agentturncomplete, completed | completed |
| StopFailure, error, failed | failed/error |
| SessionEnd, idle | idle |

**授权流程：**
1. Agent hook 触发 PermissionRequest 事件
2. bridge 脚本计算 `sessionIdentifier()`，写入状态文件
3. bridge 创建 `approvals/<id>.request.json`
4. bridge 进入 `waitForApprovalDecision()` 轮询（100ms）
5. Electron `approval-store` 检测到请求文件 → 显示 UI
6. 用户允许/拒绝 → Electron 写入 `decision.json`
7. bridge 检测到 decision 文件 → 清理文件 → stdout 返回结果
8. 超时（默认 150s）→ 清理文件 → 返回 null（回退终端）

**会话 ID 生成（`sessionIdentifier()`）：**
- 优先使用 `session_id` / `thread_id` / `conversation_id`
- 否则组合 `{provider}|{cwd}|{ppid}` 的 SHA-256 摘要

**权限响应格式：**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"  // 或 "deny"
    }
  }
}
```

### 5.6 键盘活动监控 (`src/keyboard-activity.js`)

**平台限制：** 仅 Windows

**技术实现：**
- 通过 PowerShell 内嵌 C# P/Invoke 代码调用 `user32.dll!GetAsyncKeyState`
- 扫描虚拟键码 8-254，检测任意键按下
- 按下时每 80ms 输出 "1"，空闲时每 35ms 空循环
- 所有处理在 PowerShell 进程中完成，主进程只接收行数据

**ActivityPulse 模式：**
- 收到数据 → 触发 `active=true`
- 空闲超时后 → 触发 `active=false`
- 默认空闲超时 900ms

**安全保证：** 不输出、不存储、不传输具体按键信息，仅报告是否有按键活动。

### 5.7 资源监控 (`src/resource-monitor.js`)

**采样间隔：** 2 秒

**数据来源：**
| 指标 | 来源 |
|------|------|
| CPU | `os.cpus()` delta 计算 |
| GPU | PowerShell WMI (`Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine`) |
| 内存 | `os.totalmem()` - `os.freemem()` |
| 网速 | PowerShell WMI (`Win32_PerfFormattedData_Tcpip_NetworkInterface`) |

**GPU/网络探针：** 通过 base64 编码的 PowerShell 脚本作为子进程运行，通过 stdout 行协议传递 JSON：

```json
{"gpu": 23.5, "download": 1048576.0, "upload": 512000.0}
```

### 5.8 自定义素材管理 (`src/custom-assets.js`)

**存储位置：** `app.getPath("userData")/custom-assets/{mascot,hover}/`

**校验规则：**
- 格式：PNG、JPG、WebP、GIF
- 大小：单文件 ≤ 25MB
- 数量：hover 帧 ≤ 48 张

**文件名生成：**
```js
`${group}-${index}-${sha256(sourcePath + mtimeMs).slice(0,12)}.${ext}`
```

**排序：** 按文件名自然顺序（`localeCompare` with `numeric: true`）

### 5.9 一键配置 (`src/ai-setup.js`)

**流程：**
1. Windows 端：调用 `install-hooks.js` 安装 hooks
2. WSL 端：将 hook 脚本复制到 `%LOCALAPPDATA%\AgentPet\setup-package\`
3. 通过 `wsl.exe` 调用 WSL 内的 Node.js 执行安装

**路径映射：** `C:\Users\xxx` → `/mnt/c/Users/xxx`

### 5.10 Hook 配置 (`scripts/hook-config.js`)

**监控事件定义：**
```js
CODEX_EVENTS = ["UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"];
CLAUDE_EVENTS = ["UserPromptSubmit", "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd"];
```

**配置路径：**
- Codex hooks：`~/.codex/hooks.json`
- Claude settings：`~/.claude/settings.json`
- Bridge 安装：`~/.agent-pet/agent-pet-bridge.js`

**配置合并策略：**
1. 先移除所有包含 `agent-pet-bridge.js` 的旧 handler
2. 添加新的 handler
3. 首次创建备份 `.agent-pet.bak`

**Handler 命令格式：**
```
node "<bridge-path>" <provider> <eventName>
```

**超时配置：**
- PermissionRequest：180s
- Codex SessionEnd：3s
- 其他：10s

### 5.11 Hook 安装 (`scripts/install-hooks.js`)

**卸载 (`uninstall-hooks.js`)**：调用 `removeManagedHandlers()` 移除所有 Agent Pet 的 hooks。

---

## 6. 数据流与通信架构

### 6.1 状态数据流

```
Codex/Claude 进程
  │ 生命周期事件（stdin → agent-pet-bridge.js）
  │
  ▼ 写入 JSON 状态文件
%LOCALAPPDATA%\AgentPet\states\<session-id>.json
  │
  ├── fs.watch 事件触发
  │   └── state-store.refresh()
  │
  └── 定时轮询（1s）
      └── state-store.refresh()
          │
          ▼ 聚合所有 session
      selectAggregate(sessions)
          │
          ▼ JSON 字符串比较变化
      emit('change', snapshot)
          │
          ▼ IPC
      mainWindow.webContents.send('agent-state', snapshot)
          │
          ▼ contextBridge
      agentPet.onState(callback)
          │
          ▼ DOM
      applyState(snapshot)
```

### 6.2 授权请求数据流

```
Agent CLI 触发 PermissionRequest
  │
  ▼ stdin
agent-pet-bridge.js
  ├── 写入状态文件
  ├── 创建 <id>.request.json
  └── 进入 waitForApprovalDecision 轮询（100ms）
      │
      ├─── 超时（150s）→ 清理文件 → 返回 null
      │
      └─── 检测到 <id>.decision.json
              → 清理文件 → stdout 返回决策
```

```
Electron approval-store（250ms 轮询）
  ├── 检测到 .request.json → emit → 显示授权 UI
  └── 用户操作 → 写入 .decision.json
```

### 6.3 WSL 兼容

WSL 内的 Agent 通过 `cmd.exe` 查询 Windows 的 `%LOCALAPPDATA%` 路径，然后映射为 WSL 路径（`/mnt/c/Users/...`），实现 Windows 和 WSL 共享同一状态目录。

---

## 7. 状态优先级与生命周期

### 7.1 全局状态聚合

所有 session 的状态通过优先级聚合为单一的"显示状态"：

```
needs_input (5)  ← 最高优先级
error (4)
completed (3)    ← 完成状态保持 15 秒
running (2)
idle (1)         ← 最低优先级
```

### 7.2 Session 状态生命周期

```
                    ┌──────────────┐
       SessionEnd   │              │   UserPromptSubmit
     ┌──────────────┤    idle      ├──────────────┐
     │              │              │              │
     │              └──────┬───────┘              │
     │                     │                      │
     ▼                     ▼                      ▼
┌────────┐         ┌──────────────┐        ┌──────────┐
│ idle   │◄────────│  completed   │◄───────│ running  │
└────────┘ 15 秒   └──────────────┘ Stop   └─────┬────┘
     ▲                                            │
     │                                   ┌────────┴────────┐
     │ 60 秒                              │                 │
     │                            PermissionRequest   StopFailure
     │                                   │                 │
     │                                   ▼                 ▼
     │                            ┌──────────────┐  ┌──────────┐
     └────────────────────────────│ needs_input  │  │  error   │
                                  └──────────────┘  └──────────┘
```

**关键生命周期规则：**
- `completed` 状态保持 15 秒 → idle（用于展示完成动画）
- `error` 状态保持 60 秒 → idle（便于用户看到错误）
- `running` 超过 6 小时无更新 → idle（防僵尸 session）
- `SessionEnd` 事件如果发生在完成/错误的保持期内，保留原状态（`shouldPreserveFinalState`）

---

## 8. 动画系统

### 8.1 状态动画（CSS @keyframes）

| 状态 | 动画名 | 时长 | 说明 |
|------|--------|------|------|
| idle | `idle-breathe` | 3.2s | 上下浮动 + 轻微缩放 |
| running | `working-bob` | 0.58s | 左右摇摆 |
| running | `badge-spin` | 1.7s | 徽章旋转 |
| completed | `happy-jump` | 0.75s×3 | 弹跳 |
| completed | `sparkle` | 0.8s | 星星闪烁 |
| needs_input | `attention-shake` | 0.55s | 左右摇头 |
| needs_input | `badge-pulse` | 0.75s | 徽章脉冲 |
| error | `error-jitter` | 0.22s | 抖动 + 红色发光 |
| typing | `typing-lean` | 0.44s | 身体前倾 |
| typing | `paw-type-*` | 0.24s | 爪子交替敲击 |
| typing | `key-glow` | 0.52s | 按键发光 |
| typing | `typing-particle` | 0.8s | 粒子动画 |

### 8.2 动画风格

| 风格 | idel 动画 | running 动画 |
|------|-----------|-------------|
| classic | `idle-breathe` | `working-bob` |
| playful | `playful-bounce` (1.05s) | `playful-work` (0.36s) |
| gentle | `gentle-float` (3.8s) | `gentle-float` (3.8s) |
| still | 无 | 无 |

### 8.3 悬停动作（鼠标移入触发）

| 动作 | 动画 | 时长 | 效果 |
|------|------|------|------|
| hop | `hover-hop` | 0.82s | 跳跃 |
| wave | `hover-wave` | 0.72s | 左右摇摆 |
| spin | `hover-spin` | 0.78s | 旋转 360° |
| squash | `hover-squash` | 0.75s | 压缩反弹 |

---

## 9. 快捷键系统

| 快捷键 | 功能 | 条件 |
|--------|------|------|
| Ctrl+Shift+Enter | 允许当前 Agent 授权 | 有授权请求时 |
| Ctrl+Shift+Backspace | 拒绝当前 Agent 授权 | 有授权请求时 |
| Ctrl+Shift+Alt+P | 切换鼠标穿透 | 始终可用 |
| Ctrl+Shift+Alt+M | 穿透时临时恢复拖动（20 秒） | 启用鼠标穿透时 |
| Ctrl+Shift+Alt+S | 打开/关闭会话详情 | 有会话时 |

所有快捷键通过 `globalShortcut` 注册，在 `before-quit` 时统一注销。

---

## 10. 安全模型

### 10.1 通信安全
- **不开放网络端口** — 所有通信通过本地文件系统
- **不上传数据** — 状态、资源数据仅保留在本机
- **不依赖云端服务** — 完全离线运行

### 10.2 键盘监控安全
- 仅通过 `GetAsyncKeyState` 检测按键是否按下（布尔信号）
- PowerShell 进程仅输出 `"1"`（有按键）或不输出
- Electron 端只接收 `active` / `inactive` 信号

### 10.3 授权安全
- 授权文件使用 SHA-256 ID（不可猜测）
- `SAFE_ID` 正则校验防止路径穿越
- 原子写入防止脏读
- 150 秒超时自动回退终端流程
- 桌宠不自动批准任何操作

### 10.4 资源文件安全
- 导入图片格式白名单（PNG/JPG/WebP/GIF）
- 大小限制 25MB
- 复制到隔离的 `custom-assets` 目录
- 不依赖原始文件位置

### 10.5 Electron 安全配置
- `contextIsolation: true` — 渲染进程与 Node.js 隔离
- `nodeIntegration: false` — 渲染进程无 Node.js 访问
- `preload.js` 仅暴露有限的 IPC 通道
- `webPreferences` 最小权限原则

---

## 11. 测试

**运行：** `npm test`（使用 Node.js 内置 `node:test`）

### 测试文件覆盖

| 文件 | 覆盖模块 | 测试内容 |
|------|---------|---------|
| `state-store.test.js` | state-store + bridge | 聚合优先级、有效期、事件映射、路径转换、消息格式化 |
| `bridge-approval.test.js` | bridge | Codex/Claude 授权请求 → 决策 → 状态更新的完整集成测试 |
| `desktop-features.test.js` | 多模块 | 键盘脉冲、设置校验、授权决策、路径转换、CPU 计算、动画设置、自定义素材 |

### 测试特点
- 无外部依赖，纯内存/mktemp 测试
- 使用 `node:test` + `node:assert/strict`
- 授权测试涉及完整的子进程生命周期
- 设置测试覆盖边界值和不合法输入

---

## 12. 构建与发布

```powershell
npm run test       # 运行测试
npm run dist       # 构建可移植 exe（electron-builder）
```

**构建产物：** `dist/AgentPet-<version>-portable.exe`

**electron-builder 配置：**
- 输出格式：Windows 可移植（portable）
- Asar 打包
- 图标：`assets/icon.ico`

---

## 13. 开发指南

### 本地开发

```powershell
npm install
npm start          # 正常启动
npm run dev        # 开发模式（带 dev flag）
```

### 模拟测试

在没有 Agent CLI 的情况下，可以使用 simulate 脚本测试不同状态：

```powershell
# 模拟 Codex 各个状态
npm run simulate -- running codex
npm run simulate -- needs_input codex
npm run simulate -- completed codex
npm run simulate -- error codex
npm run simulate -- idle codex

# 模拟 Claude Code 状态
npm run simulate -- running claude
```

### 视觉冒烟测试

```powershell
node scripts/capture-ui.js running pet
node scripts/capture-ui.js error traffic
```

### Hook 开发

添加新 hook 事件时需修改：
1. `scripts/hook-config.js` — 在 `CODEX_EVENTS` 或 `CLAUDE_EVENTS` 添加事件名
2. `bridge/agent-pet-bridge.js` — 在 `normalizeEvent()` 中添加事件映射
3. `tests/bridge-approval.test.js` — 添加对应测试

### 添加新状态

1. `src/main.js` — 添加 `STATUS_COLORS` 颜色
2. `src/state-store.js` — 添加 `STATE_PRIORITY` 优先级
3. `src/renderer/renderer.js` — 添加 `STATE_PRESENTATION` 呈现
4. `src/renderer/styles.css` — 添加对应的 CSS 状态动画
5. `bridge/agent-pet-bridge.js` — 添加事件映射和生命周期规则

### 状态文件格式

每个 session 状态文件（`<session-id>.json`）：
```json
{
  "protocolVersion": 1,
  "id": "claude-xxxxx",
  "provider": "Claude Code",
  "source": "Windows",
  "state": "running",
  "event": "UserPromptSubmit",
  "message": "任务：检查代码错误",
  "cwd": "C:\\project",
  "pid": 12345,
  "updatedAt": "2026-07-30T08:00:00.000Z"
}
```

---

## 14. 相关项目

### D:\Desktop\pet（独立桌宠原型）

一个 Python 桌面宠物原型，使用 `py` 实现，包含：
- 随机语录系统（12 条预设语录）
- 定时提醒（下班、午饭、下午茶）
- 行走动画
- Sprite 帧动画

与 Agent Pet 的关系：早期原型 / 独立项目，Agent Pet 是该项目的 Electron 重构和功能扩展。

### 其他工作目录
- `C:\Users\admin\AppData\Local\AgentPet\states\` — Agent Pet 运行时会话状态目录
- `d:\tmp\agent-pet-build\` — 构建缓存目录

---

## 附录：数据目录参考

| 路径 | 用途 |
|------|------|
| `%LOCALAPPDATA%\AgentPet\states\` | Agent 会话状态文件 |
| `%LOCALAPPDATA%\AgentPet\approvals\` | 授权请求/响应文件 |
| `%LOCALAPPDATA%\AgentPet\setup-package\` | WSL 安装临时文件 |
| `app.getPath("userData")/settings.json` | 用户设置 |
| `app.getPath("userData")/custom-assets/` | 自定义图片资源 |
| `~/.agent-pet/agent-pet-bridge.js` | 安装的 bridge 脚本 |
| `~/.codex/hooks.json` | Codex CLI hooks 配置 |
| `~/.claude/settings.json` | Claude Code hooks 配置 |
