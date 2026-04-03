const socket = io();
const output = document.getElementById('output');
const cmdInput = document.getElementById('cmdInput');
const authOverlay = document.getElementById('auth');
const authError = document.getElementById('auth-error');
const connStatus = document.getElementById('connection-status');
const connText = document.getElementById('conn-text');
const cmdInputTerminal = document.getElementById('terminal-tab').querySelector('#cmdInput');

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
    showTab('terminal-tab'); // Show terminal by default after auth
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

socket.on('memories_list', (memories) => {
    renderMemories(memories);
});

// ── Tab Navigation ──────────────────────────────────────────────────────────

function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.getElementById(tabId).style.display = 'block';

    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-button[onclick="showTab('${tabId}')"]`).classList.add('active');

    // Focus command input based on tab
    if (tabId === 'terminal-tab') {
        cmdInputTerminal.disabled = false;
        cmdInputTerminal.focus();
    } else {
        cmdInputTerminal.disabled = true;
    }

    if (tabId === 'memory-tab') {
        socket.emit('get_memories'); // Refresh memories when tab is opened
    }
}

function searchMemories() {
    const query = document.getElementById('memorySearchInput').value.trim();
    socket.emit('search_memories', { query });
}

socket.on('memories_search_results', (memories) => {
    renderMemories(memories);
});

function openMemoryCreator() {
    document.getElementById('memory-modal').style.display = 'flex';
}

function closeMemoryModal() {
    document.getElementById('memory-modal').style.display = 'none';
    document.getElementById('memory-form').reset();
}

function submitMemory() {
    const fact = document.getElementById('memFact').value.trim();
    const type = document.getElementById('memType').value;
    const why = document.getElementById('memWhy').value.trim();
    const howToApply = document.getElementById('memHow').value.trim();

    if (!fact || !why || !howToApply) {
        alert('Please fill in all required fields.');
        return;
    }

    socket.emit('save_memory', { type, fact, why, howToApply });
}

socket.on('memory_saved', () => {
    closeMemoryModal();
    log('System memory updated.', '#10b981');
});

function clearAllMemories() {
    if (confirm('Are you sure you want to clear ALL memories? This action cannot be undone.')) {
        socket.emit('clear_all_memories');
    }
}

socket.on('memories_cleared', () => {
    log('All system memories cleared.', '#ef4444');
    socket.emit('get_memories'); // Refresh the list to show it's empty
});

// ── Task Orchestration ──────────────────────────────────────────────────────

function sendCmd() {
    const val = cmdInput.value.trim();
    if (!val) return;
    
    log(`> ${val}`, '#00f2ff');
    socket.emit('submit_task', { task_type: 'intent', raw_input: val });
    cmdInputTerminal.value = '';
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
        
        const statusClass = agent.state === 'idle' ? 'online' : agent.state === 'busy' ? 'busy' : 'offline'; // Assuming 'online' for idle, 'busy' for busy, 'offline' for others
        
        const dot = `<span class="status-dot ${statusClass}"></span> `;
        div.innerHTML = dot; // The dot is safe
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${agent.id} (${agent.state})`;
        div.appendChild(nameSpan);

        list.appendChild(div);
    });
}

function renderMemories(memories) {
    const list = document.getElementById('memory-list');
    list.innerHTML = '';
    if (memories.length === 0) {
        list.innerHTML = '<p class="muted small">No memories found matching your search.</p>';
        return;
    }
    memories.forEach(m => {
        const div = document.createElement('div');
        div.className = 'memory-item card';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                    <span class="badge badge-${m.type}">${m.type.toUpperCase()}</span>
                    <p style="margin: 8px 0; font-size: 13px; white-space: pre-wrap;">${m.content}</p>
                    <small class="muted">${new Date(m.created_at).toLocaleString()}</small>
                </div>
                <button onclick="deleteMemory('${m.memory_id}')" class="btn-icon">×</button>
            </div>
        `;
        list.appendChild(div);
    });
}

// ── UI Helpers ──────────────────────────────────────────────────────────────


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

function updateStats(stats) {
    const statsEl = document.getElementById('stats');
    if (!stats) return;
    statsEl.style.display = 'flex';
    document.getElementById('stat-tasks').textContent = `${stats.total} total tasks`;
}

socket.on('connect', () => {
    connStatus.className = 'status-connected';
    connText.textContent = 'DAEMON CONNECTED';
});

socket.on('disconnect', () => {
    connStatus.className = 'status-disconnected';
    connText.textContent = 'DISCONNECTED';
});