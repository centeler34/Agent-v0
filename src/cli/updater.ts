/**
 * Agent v0 — Self-Updater
 * Fetches latest code from GitHub, rebuilds all components, and restarts the CLI.
 */

import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import crypto from 'node:crypto'; // Added for crypto.randomUUID()
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

function info(text: string): void {
  console.log(`  ${CYAN}[*]${NC} ${text}`);
}

function success(text: string): void {
  console.log(`  ${GREEN}[+]${NC} ${text}`);
}

function warn(text: string): void {
  console.log(`  ${YELLOW}[!]${NC} ${text}`);
}

function error(text: string): void {
  console.log(`  ${RED}[x]${NC} ${text}`);
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runVisible(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function getInstallDir(): string {
  // Resolve from the running script's location back to repo root
  // dist/cli/updater.js -> ../../ = repo root
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.resolve(scriptDir, '..', '..');
  // Also check the standard install location
  const homeInstall = path.join(process.env.HOME || '~', '.agent-v0');
  if (fs.existsSync(path.join(repoRoot, 'package.json'))) return repoRoot;
  if (fs.existsSync(path.join(homeInstall, 'package.json'))) return homeInstall;
  return repoRoot;
}

/**
 * Cleans up empty or outdated artifact files to prevent deployment issues.
 */
function preUpdateCleanup(installDir: string): void {
  const artifactPaths = [
    path.join(installDir, 'dist'),
    path.join(installDir, 'go/net-probe/net-probe'),
  ];

  for (const target of artifactPaths) {
    if (!fs.existsSync(target)) continue;
    const items = fs.statSync(target).isDirectory() ? fs.readdirSync(target) : [target];
    
    for (const item of items) {
      const fpath = fs.statSync(target).isDirectory() ? path.join(target, item) : item;
      if (fs.existsSync(fpath) && fs.statSync(fpath).isFile() && fs.statSync(fpath).size === 0) {
        fs.unlinkSync(fpath);
      }
    }
  }
}

export async function runUpdate(): Promise<void> {
  const installDir = getInstallDir();

  // Run cleanup before starting update process
  preUpdateCleanup(installDir);

  console.log('');
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log(`${BOLD}  Agent v0 — Update${NC}`);
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log('');

  // Check if it's a git repo
  if (!fs.existsSync(path.join(installDir, '.git'))) {
    error(`No git repository found at ${installDir}`);
    error('Cannot update — was Agent v0 installed from source?');
    return;
  }

  info(`Install directory: ${DIM}${installDir}${NC}`);
  console.log('');

  // ── Step 1: Check for updates ──────────────────────────────────────────

  info('Checking for updates...');
  try {
    run('git fetch origin', installDir);
  } catch {
    error('Failed to fetch from remote. Check your network connection.');
    return;
  }

  const localHash = run('git rev-parse HEAD', installDir);
  let remoteHash: string;
  try {
    remoteHash = run('git rev-parse origin/main', installDir);
  } catch {
    remoteHash = run('git rev-parse origin/master', installDir);
  }

  if (localHash === remoteHash) {
    success('Already up to date!');
    console.log(`  ${DIM}Current version: ${localHash.slice(0, 8)}${NC}`);
    console.log('');
    return;
  }

  // Show what's new
  info('New updates available:');
  console.log('');
  try {
    const log = run(`git log --oneline ${localHash}..${remoteHash}`, installDir);
    for (const line of log.split('\n')) {
      console.log(`    ${GREEN}+${NC} ${line}`);
    }
  } catch {
    info('(could not read changelog)');
  }
  console.log('');

  // ── Step 2: Pull latest code ───────────────────────────────────────────

  info('Pulling latest changes...');
  try {
    // Stash any local changes (like config edits to tracked files)
    try {
      const status = run('git status --porcelain', installDir);
      if (status) {
        warn('Stashing local changes...');
        run('git stash', installDir);
      }
    } catch { /* no changes to stash */ }

    run('git pull origin main --ff-only', installDir);
    success('Code updated');
  } catch {
    // If fast-forward fails, try a reset
    warn('Fast-forward merge failed, resetting to remote...');
    try {
      run('git reset --hard origin/main', installDir);
      success('Code updated (reset to remote)');
    } catch (e) {
      error(`Failed to update code: ${e}`);
      return;
    }
  }

  const newHash = run('git rev-parse --short HEAD', installDir);
  info(`Updated to: ${BOLD}${newHash}${NC}`);
  console.log('');

  // ── Step 3: Rebuild components ─────────────────────────────────────────

  info('Rebuilding components...');
  console.log('');

  // TypeScript
  info('  Installing dependencies...');
  try {
    run('npm install', installDir);
    success('  Dependencies installed');
  } catch (e) {
    error(`  npm install failed: ${e}`);
  }

  info('  Compiling TypeScript...');
  try {
    run('npx tsc', installDir);
    success('  TypeScript compiled');
  } catch (e) {
    error(`  TypeScript build failed: ${e}`);
  }

  // Rust (if cargo is available)
  if (hasCommand('cargo')) {
    info('  Building Rust crates...');
    try {
      run('cargo build --release', installDir);
      success('  Rust crates built');
    } catch (e) {
      warn(`  Rust build skipped: ${e}`);
    }
  }

  // Go (if go is available)
  if (hasCommand('go')) {
    info('  Building Go utilities...');
    try {
      const goDistDir = path.join(installDir, 'dist', 'go');
      if (!fs.existsSync(goDistDir)) fs.mkdirSync(goDistDir, { recursive: true });
      run('go build -o ../../dist/go/net-probe .', path.join(installDir, 'go', 'net-probe'));
      success('  Go utilities built');
    } catch (e) {
      warn(`  Go build skipped: ${e}`);
    }
  }

  // Python deps
  if (hasCommand('pip')) {
    info('  Updating Python dependencies...');
    try {
      run('pip install -r python/forensics-service/requirements.txt -q', installDir);
      run('pip install -r python/osint-utils/requirements.txt -q', installDir);
      success('  Python dependencies updated');
    } catch {
      warn('  Python deps update skipped');
    }
  }

  console.log('');
  success(`${BOLD}Update complete! Agent v0 is ready.${NC}`);
  console.log('');
  
  // ── Step 4: Restart ────────────────────────────────────────────────────

  info('Restarting Agent v0...');
  console.log('');

  // Spawn a new process and exit the current one
  const entryPoint = path.join(installDir, 'dist', 'cli', 'cli.js');
  const child = spawn('node', [entryPoint, ...process.argv.slice(2).filter(a => a !== 'update' && a !== '/update')], {
    cwd: installDir,
    stdio: 'inherit',
    detached: false,
    env: process.env,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

function hasCommand(cmd: string): boolean {
  // Validate command name to prevent command injection (CWE-78)
  if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) {
    return false;
  }
  try {
    execSync(`command -v -- ${cmd}`, { stdio: 'pipe', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}
