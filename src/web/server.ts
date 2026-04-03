/**
 * Agent v0 — Web Dashboard Server
 *
 * Serves the web dashboard and proxies Socket.IO events to the daemon.
 * Launched by `agent-v0 web start`. Hardened for v1.2.2.
 */

import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createHttpsServer } from 'node:https';
import { Server } from 'socket.io';
import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { TaskRegistry } from '../orchestrator/task_registry.js';
import { MemoryManager } from '../orchestrator/memory_manager.js';
import { KeystoreBridge } from '../security/keystore_bridge.js';

const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', false);
app.use(express.json({ limit: '10kb' })); // Mitigate DOS via large payloads

// ── TLS Setup ─────────────────────────────────────────────────────────────

const certDir = path.join(os.homedir(), '.agent-v0', 'certs');
const keyPath = path.join(certDir, 'server.key');
const certPath = path.join(certDir, 'server.crt');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log('  TLS certificates not found. Generating self-signed cert...');
  fs.mkdirSync(certDir, { recursive: true });
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-out', certPath,
    '-keyout', keyPath,
    '-days', '365',
    '-subj', '/CN=localhost'
  ], { stdio: 'pipe' });
  console.log('  Self-signed certificate generated.');
}

const tlsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

const httpsServer = createHttpsServer(tlsOptions, app);

// ── Server Configuration ──────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
const SOCKET_PATH = '/tmp/agent-v0.sock';
const ALLOWED_ORIGINS = [`https://localhost:${PORT}`, `https://127.0.0.1:${PORT}`];

const io = new Server(httpsServer as any, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
});

// Serve static files from web/public
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.resolve(scriptDir, 'public');
app.use(express.static(publicDir));

let registry: TaskRegistry | null = null;
let memoryManager: MemoryManager | null = null;

// ── Rate Limiter ──────────────────────────────────────────────────────────

const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_LIMIT = 5;
const AUTH_RATE_WINDOW_MS = 60_000;

function isAuthRateLimited(socketId: string): boolean {
  const now = Date.now();
  const entry = authAttempts.get(socketId);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(socketId, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > AUTH_RATE_LIMIT;
}

const authenticatedSockets = new Set<string>();

// ── Socket.IO Handlers ────────────────────────────────────────────────────

io.on('connection', (socket: import('socket.io').Socket) => {
  console.log(`  Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    authenticatedSockets.delete(socket.id);
    authAttempts.delete(socket.id);
    console.log(`  Client disconnected: ${socket.id}`);
  });

  // Authentication
  socket.on('auth', async (data: any) => {
    if (isAuthRateLimited(socket.id)) {
      socket.emit('auth_error', { message: 'Too many auth attempts. Try again later.' });
      return;
    }

    if (!data || typeof data !== 'object' || !('password' in data)) {
      socket.emit('auth_error', { message: 'Invalid auth payload' });
      return;
    }
    const { password } = data as { password: unknown };
    if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
      socket.emit('auth_error', { message: 'Password must be a non-empty string (max 256 chars)' });
      return;
    }

    try {
      const KEYSTORE_PATH = path.join(os.homedir(), '.agent-v0', 'keystore.enc');
      const bridge = new KeystoreBridge();
      await bridge.open(KEYSTORE_PATH, password);

      const masterKey = bridge.getDerivedKey();
      if (!registry) {
        registry = new TaskRegistry();
      }
      registry.setMasterKey(masterKey);
      memoryManager = new MemoryManager(registry);
      authenticatedSockets.add(socket.id);

      // Fetch live agent status from daemon to populate UI
      const client = net.createConnection(SOCKET_PATH);
      const statusMsg = JSON.stringify({
        id: randomUUID(),
        type: 'daemon_status',
        payload: {},
      });

      client.on('connect', () => {
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(statusMsg.length, 0);
        client.write(Buffer.concat([lenBuf, Buffer.from(statusMsg)]));
      });

      client.on('data', (data) => {
        try {
          const response = JSON.parse(data.subarray(4).toString());
          socket.emit('auth_success', {
            stats: registry!.stats(),
            agents: response.payload.agents || [],
          });
        } catch {
          socket.emit('auth_success', { stats: registry!.stats(), agents: [] });
        } finally {
          client.end();
        }
      });
      
    } catch {
      socket.emit('auth_error', { message: 'Invalid Master Password' });
    }
  });

  // Heartbeat — Fetch live status for authenticated clients
  socket.on('get_status', () => {
    if (!authenticatedSockets.has(socket.id) || !registry) return;

    const client = net.createConnection(SOCKET_PATH);
    const statusMsg = JSON.stringify({
      id: randomUUID(),
      type: 'daemon_status',
      payload: {},
    });

    client.on('connect', () => {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(statusMsg.length, 0);
      client.write(Buffer.concat([lenBuf, Buffer.from(statusMsg)]));
    });

    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.subarray(4).toString());
        socket.emit('status_update', {
          stats: registry!.stats(),
          agents: response.payload.agents || [],
        });
      } catch {
        // Silent fail on malformed daemon response during heartbeat
      } finally {
        client.end();
      }
    });

    client.on('error', () => {
      client.destroy();
    });
  });

  // Memory Management
  socket.on('get_memories', () => {
    if (!authenticatedSockets.has(socket.id) || !registry) return;
    socket.emit('memories_list', registry.getMemories());
  });

  socket.on('save_memory', (data: any) => {
    if (!authenticatedSockets.has(socket.id) || !memoryManager || !registry) return;
    try {
      const { type, fact, why, howToApply } = data;
      memoryManager.saveMemory(type, fact, why, howToApply);
      socket.emit('memory_saved', { success: true });
      socket.emit('memories_list', registry.getMemories());
    } catch (err) {
      socket.emit('memory_error', { message: 'Failed to save memory' });
    }
  });

  socket.on('delete_memory', (data: { id: string }) => {
    if (!authenticatedSockets.has(socket.id) || !registry) return;
    try {
      registry.deleteMemory(data.id);
      socket.emit('memories_list', registry.getMemories());
    } catch (err) {
      socket.emit('memory_error', { message: 'Failed to delete memory' });
    }
  });

  // Clear All Memories
  socket.on('clear_all_memories', () => {
    if (!authenticatedSockets.has(socket.id) || !registry) return;
    try {
      registry.clearAllMemories();
      socket.emit('memories_cleared', { success: true });
    } catch (err) {
      socket.emit('memory_error', { message: 'Failed to clear all memories' });
    }
  });

  // Search Memories
  socket.on('search_memories', (data: { query: string }) => {
    if (!authenticatedSockets.has(socket.id) || !memoryManager) return;
    try {
      const filteredMemories = memoryManager.searchMemories(data.query);
      socket.emit('memories_search_results', filteredMemories);
    } catch (err) {
      socket.emit('memory_error', { message: 'Failed to search memories' });
    }
  });

  // Security Audit Logs
  socket.on('get_audit_logs', async () => {
    if (!authenticatedSockets.has(socket.id)) return;
    try {
      const auditPath = path.join(os.homedir(), '.agent-v0', 'audit', 'audit.jsonl');
      if (fs.existsSync(auditPath)) {
        const content = fs.readFileSync(auditPath, 'utf8');
        const logs = content.trim().split('\n').map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean).reverse().slice(0, 50); // Get latest 50
        
        socket.emit('audit_logs', logs);
      } else {
        socket.emit('audit_logs', []);
      }
    } catch (err) {
      console.error('Failed to read audit logs:', err);
    }
  });

  // Task Submission — proxy to daemon via Unix socket
  socket.on('submit_task', (taskData: any) => {
    if (!authenticatedSockets.has(socket.id) || !registry) {
      socket.emit('auth_error', { message: 'Authentication required before submitting tasks.' });
      return;
    }

    if (!taskData || typeof taskData !== 'object' || Array.isArray(taskData)) {
      socket.emit('task_error', { message: 'Invalid task payload: must be a JSON object' });
      return;
    }
    const safeTaskData = taskData as Record<string, unknown>;

    const client = net.createConnection(SOCKET_PATH);

    client.on('connect', () => {
      const msg = JSON.stringify({
        id: randomUUID(),
        type: 'task_submit',
        payload: safeTaskData,
      });
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(msg.length, 0);
      client.write(Buffer.concat([lenBuf, Buffer.from(msg)]));
    });

    let buffer = Buffer.alloc(0);
    client.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        if (msgLen > 10 * 1024 * 1024) {
          client.destroy();
          socket.emit('task_error', { message: 'Daemon response too large' });
          return;
        }
        if (buffer.length < 4 + msgLen) break;

        const jsonBuf = buffer.subarray(4, 4 + msgLen);
        buffer = buffer.subarray(4 + msgLen);

        try {
          const response = JSON.parse(jsonBuf.toString('utf-8'));
          socket.emit('task_update', response);
          
          // Automatically trigger an audit refresh on the client if the task completes
          if (response.type === 'task_complete') {
             // In a full implementation, the daemon would write to audit.jsonl 
             // and we would emit an 'audit_update' event here.
          }

          if (response.type === 'task_complete' || response.type === 'task_error') {
            client.end();
          }
        } catch {
          console.error('  Failed to parse daemon response');
        }
      }
    });

    client.on('error', () => {
      socket.emit('task_error', { message: 'Failed to communicate with daemon. Is it running?' });
    });
  });
});

// ── Start Server ──────────────────────────────────────────────────────────

httpsServer.listen(PORT, () => {
  console.log(`  Agent v0 Web Dashboard running on https://localhost:${PORT}`);
});
