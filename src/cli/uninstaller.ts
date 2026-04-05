/**
 * Agent v0 — Uninstaller
 * Removes all installed files, config, symlinks, and data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline';
import * as platform from '../utils/platform.js';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

const HOME = process.env.HOME || '~';
const INSTALL_DIR = platform.DATA_DIR;
const CONFIG_DIR = platform.DATA_DIR;
const SYSTEM_BIN = '/usr/local/bin/agent-v0';
const LOCAL_BIN = path.join(HOME, '.local', 'bin', 'agent-v0');

function info(text: string): void {
  console.log(`  ${CYAN}[*]${NC} ${text}`);
}

function success(text: string): void {
  console.log(`  ${GREEN}[+]${NC} ${text}`);
}

function warn(text: string): void {
  console.log(`  ${YELLOW}[!]${NC} ${text}`);
}

function removed(text: string): void {
  console.log(`  ${RED}[-]${NC} ${text}`);
}

export async function runUninstall(): Promise<void> {
  console.log('');
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log(`${BOLD}  Agent v0 — Uninstaller${NC}`);
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log('');

  // Show what will be removed
  console.log(`  This will remove the following:`);
  console.log('');

  const toRemove: { path: string; label: string; exists: boolean }[] = [
    { path: INSTALL_DIR, label: 'Installation directory', exists: fs.existsSync(INSTALL_DIR) },
    { path: CONFIG_DIR, label: 'Configuration & data', exists: fs.existsSync(CONFIG_DIR) },
    { path: SYSTEM_BIN, label: 'System binary link', exists: fs.existsSync(SYSTEM_BIN) },
    { path: LOCAL_BIN, label: 'Local binary link', exists: fs.existsSync(LOCAL_BIN) },
  ];

  for (const item of toRemove) {
    const status = item.exists ? `${RED}will be removed${NC}` : `${DIM}not found${NC}`;
    console.log(`    ${item.exists ? RED : DIM}*${NC} ${item.label}: ${DIM}${item.path}${NC} — ${status}`);
  }
  console.log('');

  const hasAnything = toRemove.some(i => i.exists);
  if (!hasAnything) {
    warn('Nothing to uninstall — Agent v0 does not appear to be installed.');
    console.log('');
    return;
  }

  // Confirm
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`  ${YELLOW}${BOLD}Are you sure you want to uninstall? This cannot be undone. (yes/no): ${NC}`, (ans) => {
      resolve(ans.trim().toLowerCase());
      rl.close();
    });
  });

  if (answer !== 'yes' && answer !== 'y') {
    info('Uninstall cancelled.');
    console.log('');
    return;
  }

  console.log('');

  // Stop daemon if running
  try {
    const pidFile = platform.pidFilePath();
    if (fs.existsSync(pidFile)) {
      const pid = fs.readFileSync(pidFile, 'utf-8').trim();
      info(`Stopping daemon (PID ${pid})...`);
      try {
        process.kill(parseInt(pid, 10), 'SIGTERM');
      } catch { /* already dead */ }
      fs.unlinkSync(pidFile);
      success('Daemon stopped');
    }
  } catch { /* no daemon running */ }

  // Remove socket
  try {
    const sockPath = platform.socketPath();
    if (fs.existsSync(sockPath)) {
      fs.unlinkSync(sockPath);
      removed('Removed daemon socket');
    }
  } catch { /* ignore */ }

  // Remove symlinks
  for (const binPath of [SYSTEM_BIN, LOCAL_BIN]) {
    if (fs.existsSync(binPath)) {
      try {
        // Might need sudo for /usr/local/bin
        if (binPath === SYSTEM_BIN) {
          try {
            execFileSync('sudo', ['rm', '-f', binPath], { stdio: 'pipe' });
          } catch {
            fs.unlinkSync(binPath);
          }
        } else {
          fs.unlinkSync(binPath);
        }
        removed(`Removed ${binPath}`);
      } catch (err: any) {
        warn(`Could not remove ${binPath}: ${err.message}. Remove manually with: sudo rm ${binPath}`);
      }
    }
  }

  // Remove config directory
  if (fs.existsSync(CONFIG_DIR)) {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
    removed(`Removed ${CONFIG_DIR}`);
  }

  // Remove installation directory
  if (fs.existsSync(INSTALL_DIR)) {
    fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
    removed(`Removed ${INSTALL_DIR}`);
  }

  // npm unlink if applicable
  try {
    execFileSync('npm', ['unlink', '-g', 'agent-v0'], { stdio: 'pipe' });
    removed('Removed npm global link');
  } catch { /* not linked */ }

  console.log('');
  success(`${BOLD}Agent v0 has been uninstalled.${NC}`);
  console.log('');
  console.log(`  ${DIM}To reinstall:${NC}`);
  console.log(`  ${DIM}curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/install-agent-v0.sh | bash${NC}`); // Already correct from previous change
  console.log('');
}
