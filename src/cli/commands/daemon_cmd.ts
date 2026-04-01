/**
 * `agent-v0 daemon` subcommands — start, stop, restart, status, logs.
 */

import type { Command } from 'commander';
import { sendIpcMessage } from '../ipc_client.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

const PID_FILE = '/tmp/agent-v0.pid';
const LOG_DIR = path.join(process.env.HOME || '~', '.agent-v0', 'logs');

function isDaemonRunning(): { running: boolean; pid?: number } {
  if (!fs.existsSync(PID_FILE)) return { running: false };
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (isNaN(pid)) return { running: false };
  try {
    process.kill(pid, 0); // signal 0 = check if process exists
    return { running: true, pid };
  } catch {
    // PID file exists but process is dead — stale
    fs.unlinkSync(PID_FILE);
    return { running: false };
  }
}

export function registerDaemonCommands(program: Command): void {
  const daemon = program.command('daemon').description('Manage the Agent v0 background daemon');

  daemon
    .command('start')
    .description('Start the Agent v0 daemon in the background')
    .option('--socket <path>', 'Unix socket path', '/tmp/agent-v0.sock')
    .option('--foreground', 'Run in foreground (don\'t daemonize)')
    .action(async (opts) => {
      // Check if already running
      const check = isDaemonRunning();
      if (check.running) {
        console.log(`${YELLOW}[!]${NC} Daemon is already running (PID ${check.pid})`);
        return;
      }

      if (opts.foreground) {
        // Run directly in this process (blocks)
        const { AgentV0Daemon } = await import('../../daemon/daemon.js');
        const d = new AgentV0Daemon({
          socketPath: opts.socket,
          pidFile: PID_FILE,
          heartbeatIntervalMs: 5000,
          logLevel: process.env.AGENT_V0_LOG_LEVEL || 'info',
          agents: {},
        });
        await d.start();
        return;
      }

      // Fork daemon into background
      const scriptDir = path.dirname(new URL(import.meta.url).pathname);
      const daemonEntry = path.resolve(scriptDir, '..', '..', 'daemon', 'daemon_main.js');

      // Ensure log directory exists
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }

      const logFile = path.join(LOG_DIR, 'daemon.log');
      const out = fs.openSync(logFile, 'a');
      const err = fs.openSync(logFile, 'a');

      const child = spawn('node', [daemonEntry, '--socket', opts.socket], {
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env },
      });

      child.unref();

      // Wait briefly for PID file to appear (confirms daemon started)
      let started = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 300));
        const status = isDaemonRunning();
        if (status.running) {
          console.log(`${GREEN}[+]${NC} Daemon started (PID ${status.pid})`);
          console.log(`${DIM}    Socket: ${opts.socket}${NC}`);
          console.log(`${DIM}    Logs:   ${logFile}${NC}`);
          started = true;
          break;
        }
      }

      if (!started) {
        console.log(`${YELLOW}[!]${NC} Daemon may still be starting — check logs: ${logFile}`);
      }
    });

  daemon
    .command('stop')
    .description('Stop the Agent v0 background daemon')
    .option('--drain', 'Wait for in-flight tasks before stopping')
    .action(async (opts) => {
      const check = isDaemonRunning();
      if (!check.running) {
        console.log(`${YELLOW}[!]${NC} Daemon is not running`);
        return;
      }

      console.log(`${CYAN}[*]${NC} Stopping daemon (PID ${check.pid})...`);

      // Try graceful IPC shutdown first
      try {
        await sendIpcMessage({
          id: crypto.randomUUID(),
          type: 'daemon_stop',
          payload: { drain: opts.drain ?? false },
        });
      } catch {
        // IPC failed — send SIGTERM directly
      }

      // Send SIGTERM
      try {
        process.kill(check.pid!, 'SIGTERM');
      } catch { /* already dead */ }

      // Wait for process to exit
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 250));
        if (!isDaemonRunning().running) {
          console.log(`${GREEN}[+]${NC} Daemon stopped`);
          return;
        }
      }

      // Force kill
      try {
        process.kill(check.pid!, 'SIGKILL');
        if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        console.log(`${YELLOW}[!]${NC} Daemon force killed`);
      } catch {
        console.log(`${RED}[x]${NC} Could not stop daemon`);
      }
    });

  daemon
    .command('restart')
    .description('Restart the Agent v0 background daemon')
    .action(async () => {
      const check = isDaemonRunning();
      if (check.running) {
        console.log(`${CYAN}[*]${NC} Stopping daemon (PID ${check.pid})...`);
        try {
          process.kill(check.pid!, 'SIGTERM');
        } catch { /* ignore */ }

        // Wait for it to die
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 250));
          if (!isDaemonRunning().running) break;
        }
        console.log(`${GREEN}[+]${NC} Daemon stopped`);
      }

      // Trigger start via re-parse
      console.log(`${CYAN}[*]${NC} Starting daemon...`);
      const startCmd = daemon.commands.find(c => c.name() === 'start');
      if (startCmd) {
        await startCmd.parseAsync(['start'], { from: 'user' });
      }
    });

  daemon
    .command('status')
    .description('Show daemon health and status')
    .action(async () => {
      const check = isDaemonRunning();
      if (!check.running) {
        console.log(`${RED}[x]${NC} Daemon is not running`);
        return;
      }

      console.log(`${GREEN}[+]${NC} Daemon is running (PID ${check.pid})`);

      try {
        const response = await sendIpcMessage({
          id: crypto.randomUUID(),
          type: 'daemon_status',
          payload: {},
        });
        if (response) {
          const p = response.payload as Record<string, unknown>;
          const uptimeMs = p.uptime_ms as number;
          const uptimeSec = Math.floor(uptimeMs / 1000);
          const h = Math.floor(uptimeSec / 3600);
          const m = Math.floor((uptimeSec % 3600) / 60);
          const s = uptimeSec % 60;
          console.log(`    Uptime:       ${h}h ${m}m ${s}s`);
          console.log(`    Socket:       ${p.socketPath}`);
          console.log(`    Active tasks: ${p.activeTasks}`);
          const agents = p.agents as { id: string; state: string }[];
          if (agents && agents.length > 0) {
            console.log(`    Agents:`);
            for (const a of agents) {
              const color = a.state === 'idle' ? GREEN : a.state === 'busy' ? YELLOW : RED;
              console.log(`      ${color}*${NC} ${a.id} — ${a.state}`);
            }
          } else {
            console.log(`    Agents:       ${DIM}none${NC}`);
          }
        }
      } catch {
        console.log(`    ${YELLOW}(could not query daemon via IPC)${NC}`);
      }
    });

  daemon
    .command('logs')
    .description('Tail daemon logs')
    .option('-n <lines>', 'Number of lines', '50')
    .option('-f, --follow', 'Follow log output')
    .action(async (opts) => {
      const logFile = path.join(LOG_DIR, 'daemon.log');
      if (!fs.existsSync(logFile)) {
        console.log(`${YELLOW}[!]${NC} No log file found at ${logFile}`);
        return;
      }

      const { execFileSync, spawn: spawnProc } = await import('node:child_process');
      // Validate line count is a positive integer to prevent command injection (CWE-78)
      const lineCount = parseInt(opts.n, 10);
      if (isNaN(lineCount) || lineCount <= 0 || lineCount > 100000) {
        console.log(`${RED}[x]${NC} Invalid line count: ${opts.n}`);
        return;
      }
      const safeN = String(lineCount);
      if (opts.follow) {
        const tail = spawnProc('tail', ['-f', '-n', safeN, logFile], { stdio: 'inherit' });
        tail.on('exit', () => process.exit(0));
      } else {
        try {
          const output = execFileSync('tail', ['-n', safeN, logFile], { encoding: 'utf-8' });
          console.log(output);
        } catch {
          console.log(`${RED}[x]${NC} Could not read log file`);
        }
      }
    });
}
