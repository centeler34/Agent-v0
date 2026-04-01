/**
 * Agent v0 Daemon — Main entry point.
 * Binds to a Unix socket, manages agent lifecycle, and routes IPC messages.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger, format, transports } from 'winston';
import { HeartbeatMonitor } from './heartbeat.js';
import { ProcessManager, type AgentProcess } from './process_manager.js';
import { acquireLock, releaseLock, isLocked } from './lock.js';
import type { AgentConfig, AgentRole } from '../types/agent_config.js';
import type { TaskEnvelope, ResultEnvelope } from '../types/task_envelope.js';

const logDir = path.join(process.env.HOME || '~', '.agent-v0', 'logs');
const logTransports: any[] = [
  new transports.File({ filename: path.join(logDir, 'daemon.log') }),
];

// Only add console transport if running in foreground (TTY attached)
if (process.stdout.isTTY) {
  logTransports.push(new transports.Console({ format: format.combine(format.colorize(), format.simple()) }));
}

const logger = createLogger({
  level: process.env.AGENT_V0_LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: logTransports,
});

export interface DaemonConfig {
  socketPath: string;
  pidFile: string;
  heartbeatIntervalMs: number;
  logLevel: string;
  agents: Record<string, AgentConfig>;
}

export interface DaemonStatus {
  running: boolean;
  pid: number;
  uptime_ms: number;
  agents: { id: string; state: string }[];
  activeTasks: number;
  socketPath: string;
}

interface IpcMessage {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export class AgentV0Daemon {
  private server: net.Server | null = null;
  private startedAt: Date | null = null;
  private processManager: ProcessManager;
  private heartbeat: HeartbeatMonitor;
  private config: DaemonConfig;
  private connections: Set<net.Socket> = new Set();

  constructor(config: DaemonConfig) {
    this.config = config;
    this.processManager = new ProcessManager();
    this.heartbeat = new HeartbeatMonitor(config.heartbeatIntervalMs);
  }

  async start(): Promise<void> {
    if (isLocked(this.config.pidFile)) {
      throw new Error(`Daemon already running (PID file: ${this.config.pidFile})`);
    }

    acquireLock(this.config.pidFile);
    logger.info('Daemon starting', { pid: process.pid, socket: this.config.socketPath });

    // Remove stale socket file
    if (fs.existsSync(this.config.socketPath)) {
      fs.unlinkSync(this.config.socketPath);
    }

    // Spawn configured agents
    for (const [id, agentConfig] of Object.entries(this.config.agents)) {
      if (agentConfig.enabled) {
        await this.processManager.spawnAgent(agentConfig);
        logger.info(`Agent spawned: ${id}`);
      }
    }

    // Start heartbeat monitoring
    this.heartbeat.start(this.processManager.getProcessMap());

    // Bind Unix socket server
    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.socketPath, () => {
        this.startedAt = new Date();
        logger.info('Daemon listening', { socket: this.config.socketPath });
        resolve();
      });
      this.server!.on('error', reject);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => this.stop(true));
    process.on('SIGINT', () => this.stop(false));
  }

  async stop(drain = false): Promise<void> {
    logger.info('Daemon shutting down', { drain });

    if (drain) {
      logger.info('Draining in-flight tasks...');
      await this.processManager.drainAll(30000);
    }

    this.heartbeat.stop();

    // Kill all agent processes
    for (const agent of this.processManager.listAgents()) {
      await this.processManager.killAgent(agent.id);
    }

    // Close all client connections
    for (const conn of this.connections) {
      conn.destroy();
    }

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }

    // Clean up socket and PID files
    if (fs.existsSync(this.config.socketPath)) {
      fs.unlinkSync(this.config.socketPath);
    }
    releaseLock(this.config.pidFile);

    logger.info('Daemon stopped');
  }

  async restart(): Promise<void> {
    await this.stop(true);
    await this.start();
  }

  status(): DaemonStatus {
    return {
      running: this.server !== null && this.server.listening,
      pid: process.pid,
      uptime_ms: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      agents: this.processManager.listAgents().map((a) => ({ id: a.id, state: a.state })),
      activeTasks: this.processManager.listAgents().reduce((sum, a) => sum + (a.state === 'busy' ? 1 : 0), 0),
      socketPath: this.config.socketPath,
    };
  }

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      // Length-prefixed protocol: 4 bytes (big-endian) + JSON payload
      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32BE(0);
        if (buffer.length < 4 + msgLen) break;

        const jsonBuf = buffer.subarray(4, 4 + msgLen);
        buffer = buffer.subarray(4 + msgLen);

        try {
          const msg: IpcMessage = JSON.parse(jsonBuf.toString('utf-8'));
          const response = this.handleMessage(msg);
          const responseJson = Buffer.from(JSON.stringify(response), 'utf-8');
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32BE(responseJson.length, 0);
          socket.write(Buffer.concat([lenBuf, responseJson]));
        } catch (err) {
          logger.error('Failed to handle message', { error: err });
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', (err) => {
      logger.error('Socket error', { error: err.message });
      this.connections.delete(socket);
    });
  }

  private handleMessage(msg: IpcMessage): IpcMessage {
    switch (msg.type) {
      case 'ping':
        return { id: msg.id, type: 'pong', payload: {} };

      case 'daemon_status':
        return { id: msg.id, type: 'daemon_status', payload: this.status() as unknown as Record<string, unknown> };

      case 'agent_list':
        return {
          id: msg.id,
          type: 'agent_list',
          payload: { agents: this.processManager.listAgents() },
        };

      case 'task_submit':
        logger.info('Task submitted', { task_type: msg.payload.task_type });
        return {
          id: msg.id,
          type: 'task_accepted',
          payload: { task_id: msg.payload.task_id, status: 'accepted' },
        };

      case 'task_status':
        return {
          id: msg.id,
          type: 'task_status',
          payload: { task_id: msg.payload.task_id, status: 'pending' },
        };

      case 'task_cancel':
        return {
          id: msg.id,
          type: 'task_cancelled',
          payload: { task_id: msg.payload.task_id },
        };

      default:
        return { id: msg.id, type: 'error', payload: { error: `Unknown message type: ${msg.type}` } };
    }
  }
}
