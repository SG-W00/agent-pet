"use strict";

const STATE_PRESENTATION = Object.freeze({
    idle: {
        title: "空闲中",
        fallback: "等你派任务给我",
        badge: "Z",
        traffic: "空闲"
    },
    running: {
        title: "努力工作中",
        fallback: "正在处理任务…",
        badge: "⚙",
        traffic: "执行中"
    },
    completed: {
        title: "任务完成啦",
        fallback: "快来看看成果吧！",
        badge: "✓",
        traffic: "已完成"
    },
    needs_input: {
        title: "需要你的决定",
        fallback: "有一个问题等你处理",
        badge: "?",
        traffic: "待输入"
    },
    error: {
        title: "遇到问题了",
        fallback: "请回到终端查看错误",
        badge: "!",
        traffic: "异常"
    }
});

const statusTitle = document.getElementById("status-title");
const statusMessage = document.getElementById("status-message");
const stateBadge = document.getElementById("state-badge");
const providerLabel = document.getElementById("provider-label");
const sessionCount = document.getElementById("session-count");
const trafficLabel = document.getElementById("traffic-label");

function applyState(snapshot)
{
    const state = Object.hasOwn(STATE_PRESENTATION, snapshot.state) ? snapshot.state : "idle";
    const presentation = STATE_PRESENTATION[state];
    const active = snapshot.active;

    for (const stateName of Object.keys(STATE_PRESENTATION))
    {
        document.body.classList.remove(`state-${stateName}`);
    }
    document.body.classList.add(`state-${state}`);

    statusTitle.textContent = presentation.title;
    statusMessage.textContent = active && active.message ? active.message : presentation.fallback;
    stateBadge.textContent = presentation.badge;
    trafficLabel.textContent = presentation.traffic;
    providerLabel.textContent = active
        ? `${active.provider || "Agent"} · ${active.source || "local"}`
        : "Agent Pet";
    sessionCount.textContent = `${snapshot.sessions.length} 个会话`;
}

window.agentPet.onState(applyState);
window.agentPet.onDisplayMode((mode) => {
    document.body.classList.toggle("mode-pet", "pet" === mode);
    document.body.classList.toggle("mode-traffic", "traffic" === mode);
});

document.getElementById("hide-button").addEventListener("click", () => window.agentPet.hide());
