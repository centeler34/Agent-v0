/**
 * Agent v0 Web Bridge Server
 */

import express from 'express';
import { createServer } from 'node:https';
import { Server } from 'socket.io';
import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { TaskRegistry } from './task_registry.js';
import { KeystoreBridge } from '../security/keystore_bridge.js';
import os from 'node:os';

const app = express();
app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', false);

const certDir = path.join(os.homedir(), '.agent-v0', 'certs');
const keyPath = path.join(certDir, 'server.key');
const certPath = path.join(certDir, 'server.crt');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log('  TLS certificates not found. Generating self-signed cert...');
  fs.mkdirSync(certDir, { recursive: true });
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -out "${certPath}" -keyout "${keyPath}" -days 365 -subj "/CN=localhost"`,
    { stdio: 'pipe' },
  );
  console.log('  Self-signed certificate generated.');
}

const tlsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

const httpsServer = createServer(tlsOptions, app);

// CORS: only allow connections from localhost (the dashboard)
const ALLOWED_ORIGINS = ['https://localhost:3000', 'https://127.0.0.1:3000'];
const io = new Server(httpsServer, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
});
const PORT = process.env.PORT || 3000;
const SOCKET_PATH = '/tmp/agent-v0.sock';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
app.use(express.static(path.resolve(scriptDir, '..', 'web', 'public')));
app.use(express.json({ limit: '1mb' }));

let registry: TaskRegistry | null = null;

// --- Rate limiter for auth attempts (per-socket) ---
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_LIMIT = 5; // max attempts
const AUTH_RATE_WINDOW_MS = 60_000; // per minute

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

// --- Socket.IO auth middleware: require auth token after initial auth ---
const authenticatedSockets = new Set<string>();

io.on('connection', (socket: import("socket.io").Socket) => {
  console.log('Client connected to dashboard');

  // Clean up on disconnect
  socket.on('disconnect', () => {
    authenticatedSockets.delete(socket.id);
    authAttempts.delete(socket.id);
  });

  // Handle Authentication (Unlocking the Registry)
  socket.on('auth', async (data: unknown) => {
    // Rate limit auth attempts
    if (isAuthRateLimited(socket.id)) {
      socket.emit('auth_error', { message: 'Too many auth attempts. Try again later.' });
      return;
    }

    // Validate payload shape
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
      registry = new TaskRegistry();
      registry.setMasterKey(masterKey);
      authenticatedSockets.add(socket.id);

      socket.emit('auth_success', {
        stats: registry.stats(),
        agents: []
      });
    } catch {
      socket.emit('auth_error', { message: 'Invalid Master Password' });
    }
  });

  // Proxy messages to the Daemon
  socket.on('submit_task', (taskData: unknown) => {
    // Require authentication before task submission
    if (!authenticatedSockets.has(socket.id) || !registry) {
      socket.emit('auth_error', { message: 'Authentication required before submitting tasks.' });
      return;
    }

    // Validate task payload
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
        payload: safeTaskData
      });
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(msg.length, 0);
      client.write(Buffer.concat([lenBuf, Buffer.from(msg)]));
    });

    let buffer = Buffer.alloc(0);
    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        // Reject excessively large messages (10 MB max)
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

          if (response.type === 'task_complete' || response.type === 'task_error') {
            client.end();
          }
        } catch {
          console.error('Failed to parse daemon response');
        }
      }
    });

    client.on('error', () => {
      socket.emit('task_error', { message: 'Failed to communicate with daemon' });
    });
  });
});

httpsServer.listen(PORT, () => {
  console.log(`Agent v0 Web Bridge running on https://localhost:${PORT}`);
});