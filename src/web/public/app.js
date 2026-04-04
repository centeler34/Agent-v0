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

// ── Command History ────────────────────────────────────────────────────────

const cmdHistory = [];
let historyIndex = -1;
const MAX_HISTORY = 100;

function pushHistory(cmd) {
    if (!cmd || (cmdHistory.length > 0 && cmdHistory[cmdHistory.length - 1] === cmd)) return;
    cmdHistory.push(cmd);
    if (cmdHistory.length > MAX_HISTORY) cmdHistory.shift();
    historyIndex = cmdHistory.length;
}

function historyUp() {
    if (cmdHistory.length === 0) return;
    if (historyIndex > 0) historyIndex--;
    cmdInput.value = cmdHistory[historyIndex] || '';
}

function historyDown() {
    if (historyIndex < cmdHistory.length - 1) {
        historyIndex++;
        cmdInput.value = cmdHistory[historyIndex];
    } else {
        historyIndex = cmdHistory.length;
        cmdInput.value = '';
    }
}

// ── Toast Notifications ────────────────────────────────────────────────────

const TOAST_ICONS = {
    success: '\u2713',
    error: '\u2717',
    info: '\u2139',
    warning: '\u26A0',
};

function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || ''}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(el);

    setTimeout(() => {
        el.classList.add('removing');
        setTimeout(() => el.remove(), 250);
    }, duration);
}

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
    termLog('Press Ctrl+K for keyboard shortcuts.', 'sys');
    toast('Authentication successful', 'success');
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
    toast(data.message, 'error');
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
    if (authenticated) {
        termLog('Reconnected to daemon.', 'success');
        toast('Daemon reconnected', 'success');
    }
});

socket.on('disconnect', () => {
    connStatus.className = 'conn-badge disconnected';
    connText.textContent = 'Disconnected';
    if (authenticated) {
        termLog('Connection lost. Attempting reconnect...', 'err');
        toast('Connection lost', 'error');
    }
});

// ── Tab Navigation ─────────────────────────────────────────────────────────

const TAB_IDS = ['terminal-tab', 'tasks-tab', 'memory-tab', 'audit-tab'];

function showTab(tabId, btn) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    if (btn) {
        btn.classList.add('active');
    } else {
        const tabs = document.querySelectorAll('.tab');
        const idx = TAB_IDS.indexOf(tabId);
        if (idx >= 0 && tabs[idx]) tabs[idx].classList.add('active');
    }

    if (tabId === 'terminal-tab') cmdInput.focus();
    if (tabId === 'memory-tab') socket.emit('get_memories');
    if (tabId === 'audit-tab') socket.emit('get_audit_logs');
}

// ── Keyboard Shortcuts ─────────────────────────────────────────────────────

function toggleShortcutHelp() {
    const overlay = document.getElementById('shortcut-help');
    overlay.classList.toggle('visible');
}

document.addEventListener('keydown', (e) => {
    const inputFocused = document.activeElement === cmdInput ||
                         document.activeElement?.tagName === 'INPUT' ||
                         document.activeElement?.tagName === 'TEXTAREA';

    // Ctrl+K — shortcut help
    if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        toggleShortcutHelp();
        return;
    }

    // Ctrl+L — clear terminal
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        output.innerHTML = '';
        terminalLines = 0;
        termLog('Terminal cleared.', 'sys');
        return;
    }

    // Escape — close modals / blur input
    if (e.key === 'Escape') {
        const shortcutOverlay = document.getElementById('shortcut-help');
        const memoryModal = document.getElementById('memory-modal');
        if (shortcutOverlay.classList.contains('visible')) {
            shortcutOverlay.classList.remove('visible');
        } else if (memoryModal.style.display === 'flex') {
            closeMemoryModal();
        } else if (inputFocused) {
            document.activeElement.blur();
        }
        return;
    }

    // / — focus command input (when not already in an input)
    if (e.key === '/' && !inputFocused && authenticated) {
        e.preventDefault();
        cmdInput.focus();
        return;
    }

    // Number keys 1-4 — switch tabs (when not in input)
    if (!inputFocused && authenticated && e.key >= '1' && e.key <= '4') {
        const idx = parseInt(e.key) - 1;
        if (TAB_IDS[idx]) showTab(TAB_IDS[idx]);
        return;
    }

    // Arrow Up/Down in command input — history
    if (inputFocused && document.activeElement === cmdInput) {
        if (e.key === 'ArrowUp') { e.preventDefault(); historyUp(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); historyDown(); }
    }
});

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

    pushHistory(val);
    termLog(val, 'cmd');
    socket.emit('submit_task', { task_type: 'intent', raw_input: val });
    cmdInput.value = '';
}

function sendQuick(cmd) {
    if (!authenticated) {
        toast('Authenticate first', 'warning');
        return;
    }
    cmdInput.value = cmd;
    sendCmd();
}

// ── Task Updates ───────────────────────────────────────────────────────────

socket.on('task_update', (data) => {
    if (data.type === 'task_accepted') {
        termLog(`Task ${data.payload.task_id} accepted`, 'agent');
        addTaskCard(data.payload.task_id, data.payload.description || 'Processing...', 'running');
        toast('Task accepted', 'info');
    } else if (data.type === 'task_output') {
        termLog(`[${data.payload.agent_id}] ${data.payload.text}`, 'out');
        updateRecentOutput(data.payload.agent_id, data.payload.text);
    } else if (data.type === 'task_complete') {
        termLog('Task complete.', 'success');
        updateTaskStatus(data.payload?.task_id, 'done');
        toast('Task completed', 'success');
    } else if (data.type === 'task_error') {
        termLog(`Error: ${data.payload.error}`, 'err');
        updateTaskStatus(data.payload?.task_id, 'failed');
        toast('Task failed', 'error');
    }
});

socket.on('task_error', (data) => {
    termLog(`IPC Error: ${data.message}`, 'err');
    toast(data.message, 'error');
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
    const active = stats.running || stats.active || 0;
    pillTasks.textContent = `${active} active`;
    pillTaskDot.className = `pill-dot ${active > 0 ? 'dot-busy' : 'dot-active'}`;

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

    while (container.children.length > 20) {
        container.removeChild(container.lastChild);
    }
}

// ── Memory ─────────────────────────────────────────────────────────────────

function openMemoryCreator() {
    if (!authenticated) { toast('Authenticate first', 'warning'); return; }
    document.getElementById('memory-modal').style.display = 'flex';
    document.getElementById('memFact').focus();
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
        toast('Fact/rule is required', 'warning');
        return;
    }

    socket.emit('save_memory', { type, fact, why, howToApply });
}

socket.on('memory_saved', () => {
    closeMemoryModal();
    toast('Memory saved', 'success');
    socket.emit('get_memories');
});

socket.on('memories_list', (memories) => renderMemories(memories));
socket.on('memories_search_results', (memories) => renderMemories(memories));

function renderMemories(memories) {
    const list = document.getElementById('memory-list');
    list.innerHTML = '';

    if (!memories || memories.length === 0) {
        list.innerHTML = '<div class="empty-state">No memories stored. Create one to persist agent context.</div>';
        return;
    }

    memories.forEach(m => {
        const card = document.createElement('div');
        card.className = 'memory-card';

        const content = m.content || m.fact || '';
        const why = m.why || '';
        const how = m.howToApply || m.how_to_apply || '';

        card.innerHTML = `
            <span class="memory-type type-${escapeHtml(m.type)}">${escapeHtml(m.type)}</span>
            <div class="memory-fact">${escapeHtml(content)}</div>
            ${why ? `<div class="memory-detail"><strong>Why:</strong> ${escapeHtml(why)}</div>` : ''}
            ${how ? `<div class="memory-detail"><strong>Apply:</strong> ${escapeHtml(how)}</div>` : ''}
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
    toast('All memories cleared', 'warning');
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
        list.innerHTML = '<div class="empty-state">No audit entries yet.</div>';
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
