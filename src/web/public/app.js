const socket = io();
const output = document.getElementById('output');
const cmdInput = document.getElementById('cmdInput');
const authOverlay = document.getElementById('auth');
const authError = document.getElementById('auth-error');
const connStatus = document.getElementById('connection-status');
const connText = document.getElementById('conn-text');

let heartbeatTimer = null;

// ── Auth Handling ───────────────────────────────────────────────────────────

function login() {
    const password = document.getElementById('passInput').value;
    if (!password) return;
    socket.emit('auth', { password });
}

socket.on('auth_success', (data) => {
    authOverlay.style.display = 'none';
    cmdInput.disabled = false;
    cmdInput.focus();
    log('Fleet unlocked. System ready.', '#10b981');
    updateStats(data.stats);
    updateAgentList(data.agents);
    startHeartbeat();
});

socket.on('auth_error', (data) => {
    authError.textContent = data.message;
    authError.style.display = 'block';
});

function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        if (socket.connected) socket.emit('get_status');
    }, 5000);
}

socket.on('status_update', (data) => {
    updateStats(data.stats);
    updateAgentList(data.agents);
});

// ── Task Orchestration ──────────────────────────────────────────────────────

function sendCmd() {
    const val = cmdInput.value.trim();
    if (!val) return;
    
    log(`> ${val}`, '#00f2ff');
    socket.emit('submit_task', { task_type: 'intent', raw_input: val });
    cmdInput.value = '';
}

function sendQuick(cmd) {
    cmdInput.value = cmd;
    sendCmd();
}

socket.on('task_update', (data) => {
    if (data.type === 'task_accepted') {
        log(`Task ${data.payload.task_id} accepted.`, '#71717a');
    } else if (data.type === 'task_output') {
        log(`[${data.payload.agent_id}] ${data.payload.text}`);
    } else if (data.type === 'task_complete') {
        log(`Task complete.`, '#10b981');
    } else if (data.type === 'task_error') {
        log(`Error: ${data.payload.error}`, '#ef4444');
    }
});

socket.on('task_error', (data) => {
    log(`IPC Error: ${data.message}`, '#ef4444');
});

// ── UI Helpers ──────────────────────────────────────────────────────────────

function updateStats(stats) {
    const statsEl = document.getElementById('stats');
    if (!stats) return;
    statsEl.style.display = 'flex';
    document.getElementById('stat-tasks').textContent = `${stats.total} total tasks`;
    // Agent count is updated via updateAgentList
}

function updateAgentList(agents) {
    const list = document.getElementById('agent-list');
    const countEl = document.getElementById('stat-agents');
    list.innerHTML = '';
    
    if (!agents || agents.length === 0) {
        list.innerHTML = '<p class="muted small">No agents registered</p>';
        countEl.textContent = '0 agents';
        return;
    }

    countEl.textContent = `${agents.length} agents`;
    agents.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent-item';
        div.style.marginBottom = '8px';
        
        const statusClass = agent.state === 'idle' ? 'online' : agent.state === 'busy' ? 'busy' : 'offline';
        
        const dot = `<span class="status-dot ${statusClass}"></span> `;
        div.innerHTML = dot; // The dot is safe
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${agent.id} (${agent.state})`;
        div.appendChild(nameSpan);

        list.appendChild(div);
    });
}

function log(msg, color = '#e1e1e6') {
    const div = document.createElement('div');
    div.style.color = color;
    div.style.marginBottom = '4px';
    
    const time = document.createElement('span');
    time.className = 'muted small';
    time.style.marginRight = '8px';
    time.textContent = new Date().toLocaleTimeString();
    
    const content = document.createElement('span');
    content.textContent = msg;
    
    div.appendChild(time);
    div.appendChild(content);
    output.appendChild(div);
    output.scrollTo({ top: output.scrollHeight, behavior: 'smooth' });
}

socket.on('connect', () => {
    connStatus.className = 'status-connected';
    connText.textContent = 'DAEMON CONNECTED';
});

socket.on('disconnect', () => {
    connStatus.className = 'status-disconnected';
    connText.textContent = 'DISCONNECTED';
});