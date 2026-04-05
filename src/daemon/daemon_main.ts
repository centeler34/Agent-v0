#!/usr/bin/env node
/**
 * Daemon background entry point.
 * This file is spawned as a detached child process by `agent-cyplex daemon start`.
 * It runs silently — all output goes to the log file.
 */

import { AgentV0Daemon } from './daemon.js';
import * as platform from '../utils/platform.js';

const args = process.argv.slice(2);
let sock = platform.socketPath();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--socket' && args[i + 1]) {
    sock = args[i + 1];
  }
}

const daemon = new AgentV0Daemon({
  socketPath: sock,
  pidFile: platform.pidFilePath(),
  heartbeatIntervalMs: 5000,
  logLevel: process.env.AGENT_V0_LOG_LEVEL || 'info',
  agents: {},
});

daemon.start().catch((err: Error) => {
  console.error('Daemon failed to start:', err.message);
  process.exit(1);
});
