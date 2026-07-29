# Agent Pet

Agent Pet 是一个 Windows 桌面宠物，用动画和托盘状态显示以下 Agent 的活动：

- Windows Codex CLI
- WSL Codex CLI
- Windows Claude Code
- WSL Claude Code

支持状态：空闲、执行中、等待输入、完成、错误。完成动画显示 15 秒后自动回到空闲；错误状态显示 60 秒。

## 开发运行

需要 Node.js 20 或更新版本：

```powershell
npm install
npm start
```

右键托盘图标可以切换“桌宠模式”和“红绿灯模式”、清除状态或设置开机启动。

## 安装 Agent hooks

hooks 安装器会合并已有配置并创建 `.agent-pet.bak` 备份，不会替换无关 hooks。

### Windows

在 Windows PowerShell 中：

```powershell
git clone https://github.com/fcb1379/agent-pet.git
cd agent-pet
npm install
npm run install-hooks
```

### WSL

在每一个需要接入的 WSL 发行版内分别执行：

```bash
cd /mnt/c/path/to/agent-pet
npm run install-hooks
```

安装后重启 Codex 和 Claude Code。Codex 首次加载新 hooks 时，输入 `/hooks` 并信任 Agent Pet hooks。

## 验证动画

程序运行时执行：

```powershell
npm run simulate -- running codex
npm run simulate -- needs_input claude
npm run simulate -- completed codex
npm run simulate -- error claude
npm run simulate -- idle codex
```

## 卸载 hooks

在 Windows 和对应 WSL 中分别执行：

```bash
npm run uninstall-hooks
```

## 状态协议

每个会话在 Windows 下写入：

```text
%LOCALAPPDATA%\AgentPet\states\<session-id>.json
```

WSL bridge 通过 `cmd.exe` 查询 Windows 的 `%LOCALAPPDATA%`，因此与 Windows Agent 共用同一状态目录，不需要监听网络端口。

状态优先级为：

```text
等待输入 > 错误 > 完成（15 秒）> 执行中 > 空闲
```

## 发布

```powershell
npm run test
npm run dist
```

发布产物位于 `dist\AgentPet-0.1.0-portable.exe`。

## 素材说明

`assets/mascot.png` 是为本项目生成的原创机器人水獭，不包含 QQ 宠物或其他品牌的原始角色素材。
