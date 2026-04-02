/**
 * Agent v0 — Web Dashboard Client
 */

const socket = io({ transports: ['websocket', 'polling'] });
const output = document.getElementById('output');
const cmdInput = document.getElementById('cmdInput');
const connStatus = document.getElementById('connection-status');
const connText = document.getElementById('conn-text');
const authOverlay = document.getElementById('auth');
const authError = document.getElementById('auth-error');
const statsEl = document.getElementById('stats');

let authenticated = false;
const activeTasks = new Map();
const completedTasks = [];

// ── Connection State ──────────────────────────────────────────────────────

socket.on('connect', () => {
  connStatus.className = 'status-connected';
  connText.textContent = 'CONNECTED';
  log('Connected to Agent v0 daemon.', 'system');
});

socket.on('disconnect', () => {
  connStatus.className = 'status-disconnected';
  connText.textContent = 'DISCONNECTED';
  log('Connection lost. Reconnecting...', 'error');
});

socket.on('connect_error', () => {
  connStatus.className = 'status-disconnected';
  connText.textContent = 'CONNECTION ERROR';
});

// ── Authentication ────────────────────────────────────────────────────────

function login() {
  const password = document.getElementById('passInput').value;
  if (!password) return;

  authError.style.display = 'none';
  socket.emit('auth', { password });
}

socket.on('auth_success', (data) => {
  authenticated = true;
  authOverlay.style.display = 'none';
  cmdInput.disabled = false;
  cmdInput.focus();

  log('System unlocked. Task Registry decrypted.', 'success');
  log('Fleet is ready for orchestration.', 'success');

  if (data && data.stats) {
    document.getElementById('stat-tasks').textContent = (data.stats.totalTasks || 0) + ' tasks';
    document.getElementById('stat-agents').textContent = (data.agents ? data.agents.length : 0) + ' agents';
    statsEl.style.display = 'flex';
  }

  if (data && data.agents && data.agents.length > 0) {
    renderAgents(data.agents);
  } else {
    renderDefaultAgents();
  }
});

socket.on('auth_error', (data) => {
  if (!authenticated) {
    authError.textContent = data.message;
    authError.style.display = 'block';
    document.getElementById('passInput').value = '';
    document.getElementById('passInput').focus();
  } else {
    log('Auth error: ' + data.message, 'error');
  }
});

// ── Agent List ────────────────────────────────────────────────────────────

function renderAgents(agents) {
  const list = document.getElementById('agent-list');
  list.innerHTML = '';

  agents.forEach((agent) => {
    const state = agent.state || 'offline';
    const div = document.createElement('div');
    div.className = 'agent-item agent-' + state;
    div.innerHTML =
      '<span class="status-dot"></span>' +
      '<span>' + escapeHtml(agent.id || agent.name || 'unknown') + '</span>' +
      '<span class="agent-role">' + escapeHtml(state) + '</span>';
    list.appendChild(div);
  });
}

function renderDefaultAgents() {
  const defaultAgents = [
    { id: 'Agentic', state: 'idle' },
    { id: 'Recon', state: 'idle' },
    { id: 'Code', state: 'offline' },
    { id: 'Forensics', state: 'offline' },
    { id: 'OSINT', state: 'offline' },
    { id: 'Exploit Research', state: 'offline' },
    { id: 'Threat Intel', state: 'offline' },
    { id: 'Report', state: 'offline' },
    { id: 'Monitor', state: 'offline' },
    { id: 'Scribe', state: 'offline' },
  ];
  renderAgents(defaultAgents);
}

// ── Task Submission ───────────────────────────────────────────────────────

function sendCmd() {
  const val = cmdInput.value.trim();
  if (!val) return;

  log('> ' + val, 'cmd');
  socket.emit('submit_task', { task_type: 'intent', raw_input: val });
  cmdInput.value = '';
}

function sendQuick(cmd) {
  if (!authenticated) {
    log('Authenticate first.', 'error');
    return;
  }
  log('> ' + cmd, 'cmd');
  socket.emit('submit_task', { task_type: 'intent', raw_input: cmd });
}

// ── Task Updates ──────────────────────────────────────────────────────────

socket.on('task_update', (data) => {
  if (!data || !data.type) return;

  if (data.type === 'task_accepted') {
    const taskId = data.payload && data.payload.task_id ? data.payload.task_id : 'unknown';
    log('Task ' + taskId + ' accepted by daemon.', 'info');
    addActiveTask(taskId, data.payload);
  } else if (data.type === 'task_output') {
    const agentId = data.payload && data.payload.agent_id ? data.payload.agent_id : '?';
    const text = data.payload && data.payload.text ? data.payload.text : '';
    log('[' + agentId + '] ' + text, 'agent');
  } else if (data.type === 'task_complete') {
    const taskId = data.payload && data.payload.task_id ? data.payload.task_id : 'unknown';
    log('Task ' + taskId + ' completed successfully.', 'success');
    completeTask(taskId, 'complete');
  } else if (data.type === 'task_error') {
    const taskId = data.payload && data.payload.task_id ? data.payload.task_id : 'unknown';
    log('Task ' + taskId + ' failed.', 'error');
    completeTask(taskId, 'error');
  }
});

socket.on('task_error', (data) => {
  log('Error: ' + (data.message || 'Unknown error'), 'error');
});

// ── Task Panel Rendering ──────────────────────────────────────────────────

function addActiveTask(taskId, payload) {
  activeTasks.set(taskId, {
    id: taskId,
    description: payload && payload.raw_input ? payload.raw_input : 'Task ' + taskId,
    status: 'running',
    startedAt: new Date(),
  });
  renderTasks();
}

function completeTask(taskId, status) {
  const task = activeTasks.get(taskId);
  if (task) {
    task.status = status;
    task.completedAt = new Date();
    completedTasks.unshift(task);
    activeTasks.delete(taskId);
    if (completedTasks.length > 20) completedTasks.pop();
  }
  renderTasks();
}

function renderTasks() {
  const activeList = document.getElementById('task-list');
  const historyList = document.getElementById('task-history');

  if (activeTasks.size === 0) {
    activeList.innerHTML = '<p class="muted small">No active tasks</p>';
  } else {
    activeList.innerHTML = '';
    activeTasks.forEach((task) => {
      activeList.appendChild(createTaskCard(task));
    });
  }

  if (completedTasks.length === 0) {
    historyList.innerHTML = '<p class="muted small">No completed tasks</p>';
  } else {
    historyList.innerHTML = '';
    completedTasks.slice(0, 10).forEach((task) => {
      historyList.appendChild(createTaskCard(task));
    });
  }

  // Update stats
  document.getElementById('stat-tasks').textContent = activeTasks.size + ' active';
}

function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card';

  const shortId = task.id.length > 12 ? task.id.slice(0, 8) + '...' : task.id;
  const statusClass = 'task-status-' + task.status;

  card.innerHTML =
    '<div class="task-card-header">' +
      '<span class="task-id">' + escapeHtml(shortId) + '</span>' +
      '<span class="task-status ' + statusClass + '">' + escapeHtml(task.status) + '</span>' +
    '</div>' +
    '<div class="task-description">' + escapeHtml(task.description) + '</div>';

  return card;
}

// ── Terminal Logging ──────────────────────────────────────────────────────

function log(msg, type) {
  const line = document.createElement('div');
  line.className = 'log-line';

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString();

  const text = document.createElement('span');
  text.className = 'log-' + (type || 'system');
  text.textContent = msg;

  line.appendChild(time);
  line.appendChild(text);
  output.appendChild(line);

  // Auto-scroll
  output.scrollTop = output.scrollHeight;

  // Keep max 500 lines
  while (output.children.length > 500) {
    output.removeChild(output.firstChild);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Focus password input on load
document.getElementById('passInput').focus();
