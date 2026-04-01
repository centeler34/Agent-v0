/**
 * Agent subprocess lifecycle management.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentConfig, AgentRole, AgentState } from '../types/agent_config.js';

export interface AgentProcess {
  id: string;
  pid: number;
  state: AgentState;
  startedAt: Date;
  config: AgentConfig;
  process: ChildProcess | null;
}

export class ProcessManager {
  private processes: Map<string, AgentProcess> = new Map();

  async spawnAgent(config: AgentConfig): Promise<AgentProcess> {
    const existing = this.processes.get(config.id);
    if (existing && existing.state !== 'stopped' && existing.state !== 'error') {
      throw new Error(`Agent ${config.id} is already running`);
    }

    // Validate agent ID to prevent path traversal (CWE-23) and command injection
    if (!/^[a-z][a-z0-9_]*$/.test(config.id)) {
      throw new Error(`Invalid agent ID: ${config.id}`);
    }

    const child = spawn(process.execPath, ['--experimental-strip-types', `src/agents/${config.id}_agent.ts`], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CYPLEX_AGENT_ID: config.id,
        CYPLEX_WORKSPACE: config.workspace,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    const agentProcess: AgentProcess = {
      id: config.id,
      pid: child.pid ?? 0,
      state: 'idle',
      startedAt: new Date(),
      config,
      process: child,
    };

    child.on('exit', (code) => {
      agentProcess.state = code === 0 ? 'stopped' : 'error';
      agentProcess.process = null;
    });

    child.on('error', () => {
      agentProcess.state = 'error';
    });

    this.processes.set(config.id, agentProcess);
    return agentProcess;
  }

  async killAgent(agentId: string): Promise<void> {
    const agent = this.processes.get(agentId);
    if (!agent || !agent.process) return;

    agent.process.kill('SIGTERM');

    // Wait up to 5s for graceful shutdown, then SIGKILL
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (agent.process) {
          agent.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      if (agent.process) {
        agent.process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    agent.state = 'stopped';
    agent.process = null;
  }

  async restartAgent(agentId: string): Promise<void> {
    const agent = this.processes.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    await this.killAgent(agentId);
    await this.spawnAgent(agent.config);
  }

  listAgents(): AgentProcess[] {
    return Array.from(this.processes.values()).map(({ process: _proc, ...rest }) => ({
      ...rest,
      process: null,
    }));
  }

  getProcessMap(): Map<string, AgentProcess> {
    return this.processes;
  }

  async drainAll(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const busyAgents = Array.from(this.processes.values()).filter((a) => a.state === 'busy');
      if (busyAgents.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
