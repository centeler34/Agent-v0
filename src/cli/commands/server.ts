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
import { TaskRegistry } from '../../orchestrator/task_registry.js';
import { KeystoreBridge } from '../../security/keystore_bridge.js';
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
const io = new Server(httpsServer, {
  cors: { origin: false },
});
const PORT = process.env.PORT || 3000;
const SOCKET_PATH = '/tmp/agent-v0.sock';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
app.use(express.static(path.resolve(scriptDir, '..', '..', 'web', 'public')));
app.use(express.json());

let registry: TaskRegistry | null = null;

io.on('connection', (socket: import("socket.io").Socket) => {
  console.log('Client connected to dashboard');

  // Handle Authentication (Unlocking the Registry)
  socket.on('auth', async (data: { password?: string }) => {
    if (!data.password) {
      socket.emit('auth_error', { message: 'Password is required' });
      return;
    }
    try {
      const KEYSTORE_PATH = path.join(os.homedir(), '.agent-v0', 'keystore.enc');
      const bridge = new KeystoreBridge();
      await bridge.open(KEYSTORE_PATH, data.password);
      
      const masterKey = bridge.getDerivedKey();
      
      if (!registry) {
        registry = new TaskRegistry();
      }
      registry.setMasterKey(masterKey);
      
      socket.emit('auth_success', { 
        stats: registry.stats(),
        agents: [] // In a real impl, query daemon for live agents
      });
    } catch (err) {
      socket.emit('auth_error', { message: 'Invalid Master Password' });
    }
  });

  // Proxy messages to the Daemon
  socket.on('submit_task', (taskData: Record<string, any>) => {
    // Ensure the fleet is unlocked before proxying tasks
    if (!registry) {
      socket.emit('auth_error', { message: 'Keystore must be unlocked before submitting tasks.' });
      return;
    }

    const client = net.createConnection(SOCKET_PATH);
    
    client.on('connect', () => {
      const msg = JSON.stringify({
        id: randomUUID(),
        type: 'task_submit',
        payload: taskData
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
        if (buffer.length < 4 + msgLen) break;

        const jsonBuf = buffer.subarray(4, 4 + msgLen);
        buffer = buffer.subarray(4 + msgLen);

        try {
          const response = JSON.parse(jsonBuf.toString('utf-8'));
          // Stream data chunks or final response back to Web UI
          socket.emit('task_update', response);
          
          // Close connection only if task is final
          if (response.type === 'task_complete' || response.type === 'task_error') {
            client.end();
          }
        } catch (err) {
          console.error('Failed to parse daemon response:', err);
        }
      }
    });

    client.on('error', (err) => {
      socket.emit('task_error', { message: 'Failed to communicate with daemon' });
    });
  });
});

httpsServer.listen(PORT, () => {
  console.log(`Agent v0 Web Bridge running on https://localhost:${PORT}`);
});
