/**
 * Agent v0 — Command Center Client
 */

const socket = io();
const output = document.getElementById('output');
const cmdInput = document.getElementById('cmdInput');
const sendBtn = document.getElementById('sendBtn');
const authOverlay = document.getElementById('auth');
const authError = document.getElementById('auth-error');
const connStatus = document.getElementById('connection-status');
const connText = document.getElementById('conn-text');

let authenticated = false;
let heartbeatTimer = null;
let startTime = Date.now();
let terminalLines = 0;
const MAX_TERMINAL_LINES = 500;

// ── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', { hour12: false });
}

function formatUptime() {
    const ms = Date.now() - startTime;
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000) % 60;
    const h = Math.floor(ms / 3600000);
    return `${h}h ${m}m ${s}s`;
}

// ── Auth ───────────────────────────────────────────────────────────────────

function login() {
    const password = document.getElementById('passInput').value;
    if (!password) return;
    socket.emit('auth', { password });
}

socket.on('auth_success', (data) => {
    authenticated = true;
    authOverlay.style.display = 'none';
    cmdInput.disabled = false;
    sendBtn.disabled = false;
    cmdInput.focus();
    termLog('Fleet unlocked. Command center ready.', 'success');
    updateStats(data.stats);
    updateAgentList(data.agents);
    startHeartbeat();
    startUptimeCounter();
});

socket.on('auth_error', (data) => {
    authError.textContent = data.message;
    authError.style.display = 'block';
    document.getElementById('passInput').value = '';
    document.getElementById('passInput').focus();
});

// ── Heartbeat ──────────────────────────────────────────────────────────────

function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        if (socket.connected) socket.emit('get_status');
    }, 5000);
}

function startUptimeCounter() {
    startTime = Date.now();
    setInterval(() => {
        const el = document.getElementById('sys-uptime');
        if (el) el.textContent = formatUptime();
    }, 1000);
}

socket.on('status_update', (data) => {
    updateStats(data.stats);
    updateAgentList(data.agents);
});

// ── Connection ─────────────────────────────────────────────────────────────

socket.on('connect', () => {
    connStatus.className = 'conn-badge connected';
    connText.textContent = 'Connected';
    if (authenticated) termLog('Reconnected to daemon.', 'success');
});

socket.on('disconnect', () => {
    connStatus.className = 'conn-badge disconnected';
    connText.textContent = 'Disconnected';
    if (authenticated) termLog('Connection lost. Attempting reconnect...', 'err');
});

// ── Tab Navigation ─────────────────────────────────────────────────────────

function showTab(tabId, btn) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    if (btn) btn.classList.add('active');

    if (tabId === 'terminal-tab') cmdInput.focus();
    if (tabId === 'memory-tab') socket.emit('get_memories');
    if (tabId === 'audit-tab') socket.emit('get_audit_logs');
}

// ── Terminal ───────────────────────────────────────────────────────────────

function termLog(msg, cls = 'out') {
    const div = document.createElement('div');
    div.className = `term-line ${cls}`;

    const time = document.createElement('span');
    time.style.cssText = 'color: var(--text-3); margin-right: 10px; font-size: 0.7rem;';
    time.textContent = formatTime(new Date());

    const content = document.createElement('span');
    content.textContent = msg;

    div.appendChild(time);
    div.appendChild(content);
    output.appendChild(div);

    terminalLines++;
    if (terminalLines > MAX_TERMINAL_LINES) {
        output.removeChild(output.firstChild);
        terminalLines--;
    }

    output.scrollTo({ top: output.scrollHeight, behavior: 'smooth' });
}

// ── Commands ───────────────────────────────────────────────────────────────

function sendCmd() {
    const val = cmdInput.value.trim();
    if (!val) return;

    termLog(val, 'cmd');
    socket.emit('submit_task', { task_type: 'intent', raw_input: val });
    cmdInput.value = '';
}

function sendQuick(cmd) {
    if (!authenticated) return;
    cmdInput.value = cmd;
    sendCmd();
}

// ── Task Updates ───────────────────────────────────────────────────────────

socket.on('task_update', (data) => {
    if (data.type === 'task_accepted') {
        termLog(`Task ${data.payload.task_id} accepted`, 'agent');
        addTaskCard(data.payload.task_id, data.payload.description || 'Processing...', 'running');
    } else if (data.type === 'task_output') {
        termLog(`[${data.payload.agent_id}] ${data.payload.text}`, 'out');
        updateRecentOutput(data.payload.agent_id, data.payload.text);
    } else if (data.type === 'task_complete') {
        termLog('Task complete.', 'success');
        updateTaskStatus(data.payload?.task_id, 'done');
    } else if (data.type === 'task_error') {
        termLog(`Error: ${data.payload.error}`, 'err');
        updateTaskStatus(data.payload?.task_id, 'failed');
    }
});

socket.on('task_error', (data) => {
    termLog(`IPC Error: ${data.message}`, 'err');
});

// ── Agent List ─────────────────────────────────────────────────────────────

const DEFAULT_AGENTS = [
    { id: 'agentic', role: 'Orchestrator', state: 'idle' },
    { id: 'recon', role: 'Reconnaissance', state: 'idle' },
    { id: 'code', role: 'Code Analysis', state: 'idle' },
    { id: 'exploit-research', role: 'CVE Research', state: 'idle' },
    { id: 'forensics', role: 'Forensics', state: 'idle' },
    { id: 'osint', role: 'Intelligence', state: 'idle' },
    { id: 'threat-intel', role: 'Threat Intel', state: 'idle' },
    { id: 'report', role: 'Reports', state: 'idle' },
    { id: 'monitor', role: 'Monitoring', state: 'idle' },
    { id: 'scribe', role: 'Documentation', state: 'idle' },
];

function updateAgentList(agents) {
    const list = document.getElementById('agent-list');
    const pillText = document.getElementById('pill-agents-text');
    const pillDot = document.querySelector('#pill-agents .pill-dot');

    const agentData = agents && agents.length > 0 ? agents : DEFAULT_AGENTS;
    list.innerHTML = '';
    pillText.textContent = `${agentData.length} agents`;

    const anyBusy = agentData.some(a => a.state === 'busy');
    pillDot.className = `pill-dot ${anyBusy ? 'dot-busy' : 'dot-active'}`;

    agentData.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent-item';

        const dotClass = agent.state === 'busy' ? 'busy' : agent.state === 'idle' ? 'idle' : 'active';

        div.innerHTML = `
            <span class="agent-dot ${dotClass}"></span>
            <span class="agent-name">${escapeHtml(agent.id)}</span>
            <span class="agent-role">${escapeHtml(agent.role || agent.state)}</span>
        `;
        list.appendChild(div);
    });
}

// ── Stats ──────────────────────────────────────────────────────────────────

function updateStats(stats) {
    if (!stats) return;
    const pillTasks = document.getElementById('pill-tasks-text');
    const pillTaskDot = document.querySelector('#pill-tasks .pill-dot');
    pillTasks.textContent = `${stats.active || 0} active`;
    pillTaskDot.className = `pill-dot ${(stats.active || 0) > 0 ? 'dot-busy' : 'dot-active'}`;

    if (stats.cost !== undefined) {
        document.getElementById('pill-cost-text').textContent = `$${stats.cost.toFixed(4)}`;
    }
}

// ── Task Cards (Right Panel) ───────────────────────────────────────────────

function addTaskCard(taskId, description, status) {
    const queue = document.getElementById('task-queue');
    const placeholder = queue.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    const card = document.createElement('div');
    card.className = 'task-card';
    card.id = `task-${taskId}`;
    card.innerHTML = `
        <div class="task-card-header">
            <span class="task-card-id">${escapeHtml(taskId.substring(0, 8))}</span>
            <span class="task-card-status ${status}">${status}</span>
        </div>
        <div class="task-card-body">${escapeHtml(description)}</div>
    `;
    queue.prepend(card);
}

function updateTaskStatus(taskId, status) {
    if (!taskId) return;
    const card = document.getElementById(`task-${taskId}`);
    if (card) {
        const statusEl = card.querySelector('.task-card-status');
        statusEl.className = `task-card-status ${status}`;
        statusEl.textContent = status;
    }
}

function updateRecentOutput(agentId, text) {
    const container = document.getElementById('recent-output');
    const placeholder = container.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.style.cssText = 'font-size: 0.75rem; padding: 6px 0; border-bottom: 1px solid var(--border);';
    entry.innerHTML = `
        <span style="color: var(--accent); font-weight: 500;">${escapeHtml(agentId)}</span>
        <span style="color: var(--text-3); margin: 0 4px;">|</span>
        <span style="color: var(--text-2);">${escapeHtml(text.substring(0, 100))}</span>
    `;
    container.prepend(entry);

    // Keep max 20 entries
    while (container.children.length > 20) {
        container.removeChild(container.lastChild);
    }
}

// ── Memory ─────────────────────────────────────────────────────────────────

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

    if (!fact) {
        termLog('Memory fact/rule is required.', 'err');
        return;
    }

    socket.emit('save_memory', { type, fact, why, howToApply });
}

socket.on('memory_saved', () => {
    closeMemoryModal();
    termLog('Memory saved.', 'success');
    socket.emit('get_memories');
});

socket.on('memories_list', (memories) => renderMemories(memories));
socket.on('memories_search_results', (memories) => renderMemories(memories));

function renderMemories(memories) {
    const list = document.getElementById('memory-list');
    list.innerHTML = '';

    if (!memories || memories.length === 0) {
        list.innerHTML = '<div class="empty-state">No memories stored.</div>';
        return;
    }

    memories.forEach(m => {
        const card = document.createElement('div');
        card.className = 'memory-card';
        card.innerHTML = `
            <span class="memory-type type-${escapeHtml(m.type)}">${escapeHtml(m.type)}</span>
            <div class="memory-fact">${escapeHtml(m.content || m.fact || '')}</div>
            <div class="memory-detail">${escapeHtml(m.why || '')}</div>
        `;
        list.appendChild(card);
    });
}

function searchMemories() {
    const query = document.getElementById('memorySearchInput').value.trim();
    socket.emit('search_memories', { query });
}

function clearAllMemories() {
    if (confirm('Clear ALL memories? This cannot be undone.')) {
        socket.emit('clear_all_memories');
    }
}

socket.on('memories_cleared', () => {
    termLog('All memories cleared.', 'err');
    socket.emit('get_memories');
});

// ── Audit Trail ────────────────────────────────────────────────────────────

socket.on('audit_logs', (logs) => renderAuditLogs(logs));
socket.on('audit_update', (entry) => prependAuditEntry(entry));

function renderAuditLogs(logs) {
    const list = document.getElementById('audit-list');
    const countEl = document.getElementById('audit-count');
    list.innerHTML = '';

    if (!logs || logs.length === 0) {
        list.innerHTML = '<div class="empty-state">No audit entries.</div>';
        countEl.textContent = '0 entries';
        return;
    }

    countEl.textContent = `${logs.length} entries`;
    logs.forEach(log => list.appendChild(createAuditEntry(log)));
}

function prependAuditEntry(entry) {
    const list = document.getElementById('audit-list');
    const empty = list.querySelector('.empty-state');
    if (empty) empty.remove();
    list.prepend(createAuditEntry(entry));

    const countEl = document.getElementById('audit-count');
    const current = parseInt(countEl.textContent) || 0;
    countEl.textContent = `${current + 1} entries`;
}

function createAuditEntry(log) {
    const div = document.createElement('div');
    div.className = 'audit-entry';

    const outcomeColor = log.outcome === 'success' ? 'var(--success)' : 'var(--error)';

    div.innerHTML = `
        <div class="audit-time">${formatTime(log.timestamp)}</div>
        <div class="audit-content">
            <div class="audit-action" style="color: ${outcomeColor}">
                ${escapeHtml(log.action_type || 'unknown')} &mdash; ${escapeHtml(log.outcome || 'unknown')}
            </div>
            <div class="audit-agent">${escapeHtml(log.agent_id || 'system')}</div>
            <div class="audit-hash">${escapeHtml((log.entry_hash || '').substring(0, 48))}...</div>
        </div>
    `;
    return div;
}

function filterAudit() {
    const query = document.getElementById('auditSearchInput').value.trim().toLowerCase();
    document.querySelectorAll('.audit-entry').forEach(entry => {
        const text = entry.textContent.toLowerCase();
        entry.style.display = text.includes(query) ? 'flex' : 'none';
    });
}
