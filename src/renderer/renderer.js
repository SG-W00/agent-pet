"use strict";

const STATE_PRESENTATION = Object.freeze({
    idle: { title: "空闲中", fallback: "等你派任务给我", badge: "Z", traffic: "空闲" },
    running: { title: "努力工作中", fallback: "正在处理任务…", badge: "⚙", traffic: "执行中" },
    completed: { title: "任务完成啦", fallback: "快来看看成果吧！", badge: "✓", traffic: "已完成" },
    needs_input: { title: "需要你的决定", fallback: "有一个问题等你处理", badge: "?", traffic: "待输入" },
    error: { title: "遇到问题了", fallback: "请回到终端查看错误", badge: "!", traffic: "异常" }
});

const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");
const stateBadge = document.getElementById("state-badge");
const providerLabel = document.getElementById("provider-label");
const sessionCount = document.getElementById("session-count");
const trafficLabel = document.getElementById("traffic-label");
const approvalPanel = document.getElementById("approval-panel");
const approvalProvider = document.getElementById("approval-provider");
const approvalTool = document.getElementById("approval-tool");
const approvalSummary = document.getElementById("approval-summary");
const resourcePanel = document.getElementById("resource-panel");
const resourceCpu = document.getElementById("resource-cpu");
const resourceGpu = document.getElementById("resource-gpu");
const resourceMemory = document.getElementById("resource-memory");
const resourceNetwork = document.getElementById("resource-network");
const mascot = document.getElementById("mascot");
const sessionDetailsPanel = document.getElementById("session-details-panel");
const sessionDetailsList = document.getElementById("session-details-list");
const sessionDetailsSubtitle = document.getElementById("session-details-subtitle");
const sessionSummary = document.getElementById("session-summary");
const clearFinishedButton = document.getElementById("clear-finished-sessions");

let latestSnapshot = { state: "idle", active: null, sessions: [] };
let typingActive = false;
let approvalRequest = null;
let approvalRequests = [];
let latestResources = null;
let windowSettings = { resources: { enabled: true, cpu: true, gpu: true, memory: true, network: true } };
let positionAdjusting = false;
let sessionDetailsOpen = false;
let animationSettings = { style: "classic", hoverEnabled: true, mascotUrl: null, hoverFrameUrls: [], hoverFrameMs: 110 };
let hoverTimer = null;
const defaultMascotUrl = mascot.src;
const HOVER_ACTIONS = ["hop", "wave", "spin", "squash"];

function applyState(snapshot)
{
    latestSnapshot = snapshot || latestSnapshot;
    const state = Object.hasOwn(STATE_PRESENTATION, latestSnapshot.state) ? latestSnapshot.state : "idle";
    const presentation = STATE_PRESENTATION[state];
    const active = latestSnapshot.active;
    const canAnimateTyping = typingActive && ("idle" === state || "running" === state);

    for (const stateName of Object.keys(STATE_PRESENTATION))
    {
        document.body.classList.remove(`state-${stateName}`);
    }
    document.body.classList.add(`state-${state}`);
    document.body.classList.toggle("is-typing", canAnimateTyping);

    statusTitle.textContent = positionAdjusting
        ? "拖动到想要的位置"
        : (canAnimateTyping ? "一起敲代码" : presentation.title);
    statusMessage.textContent = positionAdjusting
        ? "20 秒后自动恢复鼠标穿透"
        : (active && active.message ? active.message : presentation.fallback);
    stateBadge.textContent = canAnimateTyping ? "⌨" : presentation.badge;
    trafficLabel.textContent = presentation.traffic;
    providerLabel.textContent = active
        ? `${active.provider || "Agent"} · ${active.source || "local"}`
        : "Agent Pet";
    sessionCount.textContent = `${Array.isArray(latestSnapshot.sessions) ? latestSnapshot.sessions.length : 0} 个会话 ›`;
    if (sessionDetailsOpen)
    {
        renderSessionDetails();
    }
}

function displayPath(cwd)
{
    const value = String(cwd || "未知目录");
    const parts = value.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : value;
}

function formatUpdatedAt(value)
{
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function renderSessionDetails()
{
    const sessions = Array.isArray(latestSnapshot.sessions) ? latestSnapshot.sessions : [];
    const dismissibleCount = sessions.filter((session) => ["idle", "completed", "error"].includes(session.state)).length;
    sessionDetailsSubtitle.textContent = `${sessions.length} 个会话 · 按状态优先排列`;
    clearFinishedButton.disabled = 0 === dismissibleCount;
    sessionDetailsList.replaceChildren();

    if (0 === sessions.length)
    {
        const empty = document.createElement("p");
        empty.className = "session-empty";
        empty.textContent = "当前还没有 Agent 会话。";
        sessionDetailsList.appendChild(empty);
        return;
    }

    for (const session of sessions)
    {
        const state = Object.hasOwn(STATE_PRESENTATION, session.state) ? session.state : "idle";
        const card = document.createElement("article");
        card.className = `session-card session-${state}`;

        const header = document.createElement("header");
        const identity = document.createElement("strong");
        identity.textContent = `${session.provider || "Agent"} · ${displayPath(session.cwd)}`;
        const stateLabel = document.createElement("span");
        stateLabel.className = "session-state";
        stateLabel.textContent = STATE_PRESENTATION[state].traffic;
        header.append(identity, stateLabel);

        const source = document.createElement("span");
        source.className = "session-source";
        source.textContent = `${session.source || "local"} · ${session.event || "状态更新"}`;

        const message = document.createElement("p");
        message.textContent = session.message || STATE_PRESENTATION[state].fallback;

        card.append(header, source, message);

        const request = approvalRequests.find((item) => item.sessionId === session.id);
        if (request)
        {
            const approval = document.createElement("section");
            approval.className = "session-inline-approval";
            const operation = document.createElement("code");
            operation.textContent = request.toolName || "待审批操作";
            const summary = document.createElement("p");
            summary.textContent = request.summary || "请核对操作内容后选择。";
            const actions = document.createElement("div");
            actions.className = "session-actions";
            const allow = document.createElement("button");
            allow.type = "button";
            allow.className = "session-allow";
            allow.textContent = "允许";
            allow.addEventListener("click", () => window.agentPet.decideApproval("allow", request.id));
            const deny = document.createElement("button");
            deny.type = "button";
            deny.className = "session-deny";
            deny.textContent = "拒绝";
            deny.addEventListener("click", () => window.agentPet.decideApproval("deny", request.id));
            actions.append(allow, deny);
            approval.append(operation, summary, actions);
            card.appendChild(approval);
        }
        else if ("needs_input" === state)
        {
            const notice = document.createElement("div");
            notice.className = "session-input-notice";
            notice.textContent = "此请求需要文本输入，请回到原 Codex / Claude Code 会话继续。当前 hooks 无法安全代发任意文本。";
            card.appendChild(notice);
        }

        const footer = document.createElement("footer");
        const cwd = document.createElement("code");
        cwd.textContent = session.cwd || "未知目录";
        cwd.title = session.cwd || "";
        const updated = document.createElement("time");
        updated.dateTime = session.updatedAt || "";
        updated.textContent = formatUpdatedAt(session.updatedAt);
        footer.append(cwd, updated);

        if (["idle", "completed", "error"].includes(state))
        {
            const dismiss = document.createElement("button");
            dismiss.type = "button";
            dismiss.className = "session-dismiss";
            dismiss.textContent = "关闭";
            dismiss.title = "只移除桌宠中的会话记录，不会终止 Agent";
            dismiss.addEventListener("click", () => window.agentPet.dismissSession(session.id));
            footer.appendChild(dismiss);
        }

        card.appendChild(footer);
        sessionDetailsList.appendChild(card);
    }
}

function setSessionDetails(open, notify = true)
{
    sessionDetailsOpen = true === open;
    sessionDetailsPanel.hidden = !sessionDetailsOpen;
    document.body.classList.toggle("has-session-details", sessionDetailsOpen);
    if (sessionDetailsOpen)
    {
        renderSessionDetails();
    }
    applyApproval(approvalRequest);
    if (notify)
    {
        window.agentPet.setSessionDetailsOpen(sessionDetailsOpen);
    }
}
function applyApproval(request)
{
    approvalRequest = request || null;
    const showStandalone = null !== approvalRequest && !sessionDetailsOpen;

    document.body.classList.toggle("has-approval", showStandalone);
    approvalPanel.hidden = !showStandalone;
    if (!approvalRequest)
    {
        return;
    }

    approvalProvider.textContent = `${String(approvalRequest.provider || "Agent").toUpperCase()} · 需要授权`;
    approvalTool.textContent = approvalRequest.toolName || "未知操作";
    approvalSummary.textContent = approvalRequest.summary || "请核对操作内容后选择。";
}

function applyApprovalRequests(requests)
{
    approvalRequests = Array.isArray(requests) ? requests : [];
    if (sessionDetailsOpen)
    {
        renderSessionDetails();
    }
}

function cancelHoverAnimation()
{
    if (hoverTimer)
    {
        clearTimeout(hoverTimer);
        clearInterval(hoverTimer);
        hoverTimer = null;
    }
    for (const action of HOVER_ACTIONS)
    {
        document.body.classList.remove(`hover-action-${action}`);
    }
    mascot.src = animationSettings.mascotUrl || defaultMascotUrl;
}

function playBuiltInHoverAnimation()
{
    const action = HOVER_ACTIONS[Math.floor(Math.random() * HOVER_ACTIONS.length)];
    document.body.classList.add(`hover-action-${action}`);
    hoverTimer = setTimeout(() => {
        document.body.classList.remove(`hover-action-${action}`);
        hoverTimer = null;
    }, 900);
}

function playCustomHoverFrames()
{
    const frames = animationSettings.hoverFrameUrls;
    let index = 0;
    mascot.src = frames[index];
    if (1 === frames.length)
    {
        hoverTimer = setTimeout(cancelHoverAnimation, 650);
        return;
    }

    hoverTimer = setInterval(() => {
        index++;
        if (frames.length <= index)
        {
            cancelHoverAnimation();
            return;
        }
        mascot.src = frames[index];
    }, animationSettings.hoverFrameMs);
}

function playRandomHoverAnimation()
{
    if (
        !animationSettings.hoverEnabled ||
        hoverTimer ||
        document.body.classList.contains("has-approval") ||
        document.body.classList.contains("has-session-details")
    )
    {
        return;
    }

    if (0 < animationSettings.hoverFrameUrls.length && 0.65 > Math.random())
    {
        playCustomHoverFrames();
    }
    else
    {
        playBuiltInHoverAnimation();
    }
}

function applyAnimationSettings(settings)
{
    cancelHoverAnimation();
    animationSettings = {
        ...animationSettings,
        ...(settings.animation || {})
    };
    for (const style of ["classic", "playful", "gentle", "still"])
    {
        document.body.classList.toggle(`animation-style-${style}`, style === animationSettings.style);
    }
    mascot.src = animationSettings.mascotUrl || defaultMascotUrl;
}
function formatRate(bytesPerSecond)
{
    const value = Math.max(0, Number(bytesPerSecond) || 0);
    if (1048576 <= value)
    {
        return `${(value / 1048576).toFixed(1)}M`;
    }
    if (1024 <= value)
    {
        return `${Math.round(value / 1024)}K`;
    }
    return `${Math.round(value)}B`;
}

function applyResourceSettings(settings)
{
    windowSettings = settings || windowSettings;
    const resources = windowSettings.resources || {};
    const enabledKeys = ["cpu", "gpu", "memory", "network"].filter((key) => false !== resources[key]);
    resourcePanel.hidden = false === resources.enabled || 0 === enabledKeys.length;
    for (const chip of resourcePanel.querySelectorAll("[data-resource]"))
    {
        chip.hidden = !enabledKeys.includes(chip.dataset.resource);
    }
    document.body.classList.toggle("has-resources", !resourcePanel.hidden);
}

function applyResourceUsage(snapshot)
{
    latestResources = snapshot || null;
    if (!latestResources)
    {
        resourceCpu.textContent = "--%";
        resourceGpu.textContent = "--%";
        resourceMemory.textContent = "--%";
        resourceNetwork.textContent = "↓ -- ↑ --";
        return;
    }

    resourceCpu.textContent = `${latestResources.cpu ?? 0}%`;
    resourceGpu.textContent = null === latestResources.gpu ? "N/A" : `${latestResources.gpu}%`;
    resourceMemory.textContent = `${latestResources.memoryPercent ?? 0}%`;
    resourceNetwork.textContent = `↓ ${formatRate(latestResources.download)} ↑ ${formatRate(latestResources.upload)}`;
}
function submitApproval(decision)
{
    if (approvalRequest)
    {
        window.agentPet.decideApproval(decision, approvalRequest.id);
    }
}

window.agentPet.onState(applyState);
window.agentPet.onTypingActivity((active) => {
    typingActive = true === active;
    applyState(latestSnapshot);
});
window.agentPet.onApprovalRequest(applyApproval);
window.agentPet.onApprovalRequests(applyApprovalRequests);
window.agentPet.onDisplayMode((mode) => {
    document.body.classList.toggle("mode-pet", "pet" === mode);
    document.body.classList.toggle("mode-traffic", "traffic" === mode);
});
window.agentPet.onWindowSettings((settings) => {
    document.body.classList.toggle("is-click-through", true === settings.clickThrough);
    applyResourceSettings(settings);
    applyAnimationSettings(settings);
});
window.agentPet.onResourceUsage(applyResourceUsage);
window.agentPet.onShowSessionDetails((open) => setSessionDetails(open, false));
window.agentPet.onPositionAdjustMode((active) => {
    positionAdjusting = true === active;
    document.body.classList.toggle("is-position-adjusting", positionAdjusting);
    applyState(latestSnapshot);
});

mascot.addEventListener("mouseenter", playRandomHoverAnimation);

// 手动窗口拖动：mascot 因 -webkit-app-region: no-drag 不参与原生拖动，
// 通过 IPC 手动移动窗口，同时保留 mouseenter 悬停动画。
(function initManualDrag()
{
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    mascot.addEventListener("mousedown", (event) =>
    {
        if (0 !== event.button)
        {
            return;
        }
        isDragging = true;
        dragStartX = event.screenX;
        dragStartY = event.screenY;
        event.preventDefault();
    });

    document.addEventListener("mousemove", (event) =>
    {
        if (!isDragging)
        {
            return;
        }
        const dx = event.screenX - dragStartX;
        const dy = event.screenY - dragStartY;
        if (dx || dy)
        {
            window.agentPet.dragWindow(dx, dy);
            dragStartX = event.screenX;
            dragStartY = event.screenY;
        }
    });

    document.addEventListener("mouseup", () =>
    {
        isDragging = false;
    });
})();
sessionSummary.addEventListener("click", () => setSessionDetails(!sessionDetailsOpen));
sessionSummary.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key))
    {
        event.preventDefault();
        setSessionDetails(!sessionDetailsOpen);
    }
});
document.getElementById("session-details-close").addEventListener("click", () => setSessionDetails(false));
clearFinishedButton.addEventListener("click", () => window.agentPet.clearFinishedSessions());
document.getElementById("approval-allow").addEventListener("click", () => submitApproval("allow"));
document.getElementById("approval-deny").addEventListener("click", () => submitApproval("deny"));
document.getElementById("hide-button").addEventListener("click", () => window.agentPet.hide());
