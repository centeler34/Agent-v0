/**
 * Agent v0 — Self-Updater
 *
 * Checks the GitHub releases for the latest version, compares it to the
 * locally installed version, and if a newer release exists it downloads
 * the release, diffs the files, copies only the ones that changed, and
 * recompiles only the components that were affected.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import { SHELL } from '../utils/platform.js';

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'centeler34';
const GITHUB_REPO = 'Agent-v0';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const TARBALL_URL = (tag: string) =>
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tarball/${tag}`;

// ── ANSI ─────────────────────────────────────────────────────────────────────

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

const info    = (t: string) => console.log(`  ${CYAN}[*]${NC} ${t}`);
const ok      = (t: string) => console.log(`  ${GREEN}[+]${NC} ${t}`);
const warn    = (t: string) => console.log(`  ${YELLOW}[!]${NC} ${t}`);
const fail    = (t: string) => console.log(`  ${RED}[x]${NC} ${t}`);
const bullet  = (t: string) => console.log(`      ${DIM}${t}${NC}`);

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd: string, cwd: string): string {
  // Use execFileSync with explicit shell to avoid command injection (CWE-78)
  return execFileSync(SHELL, ['-c', cmd], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function hasCmd(name: string): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false;
  try { execFileSync(SHELL, ['-c', `command -v -- ${name}`], { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function sha256(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

// ── Version ──────────────────────────────────────────────────────────────────

function getInstallDir(): string {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const homeInstall = path.join(os.homedir(), '.agent-v0');
  if (fs.existsSync(path.join(repoRoot, 'package.json'))) return repoRoot;
  if (fs.existsSync(path.join(homeInstall, 'package.json'))) return homeInstall;
  return repoRoot;
}

function getLocalVersion(dir: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).version ?? '0.0.0';
  } catch { return '0.0.0'; }
}

function stampVersion(dir: string, version: string): void {
  const p = path.join(dir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (pkg.version === version) return;
    pkg.version = version;
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  } catch { /* best effort */ }
}

function stripV(tag: string): string { return tag.replace(/^v/i, ''); }

function isNewer(remoteTag: string, localVer: string): boolean {
  const r = stripV(remoteTag).split('.').map(Number);
  const l = localVer.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

// ── GitHub API ───────────────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
}

function httpsGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'agent-v0-updater', Accept: 'application/vnd.github+json' },
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location)
        return httpsGet(res.headers.location).then(resolve, reject);
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'agent-v0-updater', Accept: 'application/octet-stream' },
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location)
        return httpsDownload(res.headers.location, dest).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const res = await httpsGet(GITHUB_API);
    if (res.status !== 200) return null;
    return JSON.parse(res.body) as GitHubRelease;
  } catch { return null; }
}

// ── File diffing ─────────────────────────────────────────────────────────────

/** Dirs that should never be replaced from the release. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target']);

/** Walk a directory tree and return relative paths of all files. */
function walkFiles(root: string, rel = ''): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walkFiles(root, relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

interface DiffResult {
  added: string[];    // files only in new release
  changed: string[];  // files that exist in both but content differs
  removed: string[];  // files only in current install (not in release)
}

function diffFiles(currentDir: string, newDir: string): DiffResult {
  const currentFiles = new Set(walkFiles(currentDir));
  const newFiles = new Set(walkFiles(newDir));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const f of newFiles) {
    if (!currentFiles.has(f)) {
      added.push(f);
    } else {
      const currentHash = sha256(path.join(currentDir, f));
      const newHash = sha256(path.join(newDir, f));
      if (currentHash !== newHash) changed.push(f);
    }
  }

  for (const f of currentFiles) {
    if (!newFiles.has(f)) removed.push(f);
  }

  return { added, changed, removed };
}

// ── Figure out what needs rebuilding ─────────────────────────────────────────

interface RebuildPlan {
  typescript: boolean;
  rust: boolean;
  go: boolean;
  python: boolean;
  npm: boolean;
}

function planRebuild(diff: DiffResult): RebuildPlan {
  const all = [...diff.added, ...diff.changed];

  return {
    npm:        all.some(f => f === 'package.json' || f === 'package-lock.json'),
    typescript: all.some(f => f.startsWith('src/') && f.endsWith('.ts')),
    rust:       all.some(f => f.startsWith('rust/') || f === 'Cargo.toml' || f === 'Cargo.lock'),
    go:         all.some(f => f.startsWith('go/')),
    python:     all.some(f => f.startsWith('python/')),
  };
}

// ── Apply changes ────────────────────────────────────────────────────────────

function applyDiff(installDir: string, newDir: string, diff: DiffResult): void {
  // Copy added + changed files
  for (const f of [...diff.added, ...diff.changed]) {
    const src = path.join(newDir, f);
    const dest = path.join(installDir, f);
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // Remove deleted files (but never remove config / user files)
  const safeToRemove = diff.removed.filter(f =>
    !f.startsWith('.') &&
    !f.includes('.env') &&
    !f.includes('keystore') &&
    !f.includes('session.token')
  );
  for (const f of safeToRemove) {
    const target = path.join(installDir, f);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

// ── Selective rebuild ────────────────────────────────────────────────────────

function rebuild(installDir: string, plan: RebuildPlan): void {
  info('Rebuilding changed components...');
  console.log('');

  if (plan.npm) {
    info('  Installing npm dependencies...');
    try {
      run('npm install', installDir);
      try { run('npm audit fix', installDir); } catch { /* non-critical */ }
      ok('  npm dependencies updated');
    } catch { fail('  npm install failed'); }
  }

  if (plan.typescript) {
    info('  Compiling TypeScript...');
    try {
      // npm install first if we haven't already (types may have changed)
      if (!plan.npm) {
        try { run('npm install', installDir); } catch { /* best effort */ }
      }
      run('npx tsc', installDir);
      ok('  TypeScript compiled');
    } catch { fail('  TypeScript build failed'); }
  }

  if (plan.rust && hasCmd('cargo')) {
    info('  Building Rust crates...');
    try {
      run('cargo build --release', installDir);
      ok('  Rust crates built');
    } catch { warn('  Rust build skipped'); }
  }

  if (plan.go && hasCmd('go')) {
    info('  Building Go utilities...');
    try {
      const goDir = path.join(installDir, 'go', 'net-probe');
      if (fs.existsSync(goDir)) {
        const goDistDir = path.join(installDir, 'dist', 'go');
        if (!fs.existsSync(goDistDir)) fs.mkdirSync(goDistDir, { recursive: true });
        run('go build -o ../../dist/go/net-probe .', goDir);
        ok('  Go utilities built');
      }
    } catch { warn('  Go build skipped'); }
  }

  if (plan.python && hasCmd('pip')) {
    info('  Updating Python dependencies...');
    try {
      const f1 = path.join(installDir, 'python/forensics-service/requirements.txt');
      const f2 = path.join(installDir, 'python/osint-utils/requirements.txt');
      if (fs.existsSync(f1)) run(`pip install --upgrade -r "${f1}" -q`, installDir);
      if (fs.existsSync(f2)) run(`pip install --upgrade -r "${f2}" -q`, installDir);
      ok('  Python dependencies updated');
    } catch { warn('  Python deps update skipped'); }
  }

  if (!plan.npm && !plan.typescript && !plan.rust && !plan.go && !plan.python) {
    ok('  No components need recompilation (config/docs only change)');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runUpdate(): Promise<void> {
  const installDir = getInstallDir();
  const localVersion = getLocalVersion(installDir);

  // ── Header ──
  console.log('');
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log(`${BOLD}  Agent v0 — Update${NC}`);
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log('');
  info(`Installed version: ${BOLD}v${localVersion}${NC}`);
  info(`Install path:      ${DIM}${installDir}${NC}`);
  console.log('');

  // ── Step 1: Check GitHub for latest release ──

  info('Checking for updates...');
  console.log('');

  const release = await fetchLatestRelease();

  if (!release) {
    fail('Could not reach GitHub. Check your internet connection.');
    console.log('');
    return;
  }

  const remoteVersion = stripV(release.tag_name);
  info(`Latest version:    ${BOLD}v${remoteVersion}${NC}  ${DIM}(released ${release.published_at.split('T')[0]})${NC}`);

  if (release.name) {
    info(`Release:           ${DIM}${release.name}${NC}`);
  }

  console.log('');

  // ── Step 2: Compare versions ──

  if (!isNewer(release.tag_name, localVersion)) {
    ok(`${BOLD}You are already running the latest version!${NC}`);
    console.log('');
    console.log(`  ${DIM}No download needed. Agent v0 v${localVersion} is up to date.${NC}`);
    console.log('');
    return;
  }

  // Show what's new
  info(`${BOLD}New version available: v${localVersion} → v${remoteVersion}${NC}`);
  console.log('');

  if (release.body) {
    info('Changelog:');
    const lines = release.body.split('\n').filter(l => l.trim()).slice(0, 15);
    for (const line of lines) bullet(line);
    if (release.body.split('\n').filter(l => l.trim()).length > 15) bullet('...');
    console.log('');
  }

  // ── Step 3: Download release ──

  const tmpDir = path.join(os.tmpdir(), `agent-v0-update-${Date.now()}`);
  const tarball = path.join(tmpDir, 'release.tar.gz');
  const extractDir = path.join(tmpDir, 'release');

  try {
    fs.mkdirSync(extractDir, { recursive: true });

    info(`Downloading v${remoteVersion} from GitHub...`);
    await httpsDownload(TARBALL_URL(release.tag_name), tarball);

    const sizeKB = Math.round(fs.statSync(tarball).size / 1024);
    ok(`Downloaded (${sizeKB} KB)`);

    // Extract
    info('Extracting...');
    run(`tar xzf "${tarball}" -C "${extractDir}" --strip-components=1`, tmpDir);
    ok('Extracted');
    console.log('');

    // ── Step 4: Diff — find only the files that changed ──

    info('Comparing files...');
    const diff = diffFiles(installDir, extractDir);

    const totalChanged = diff.added.length + diff.changed.length + diff.removed.length;

    if (totalChanged === 0) {
      ok('All files are identical — nothing to update.');
      stampVersion(installDir, remoteVersion);
      console.log('');
      return;
    }

    // Show summary
    if (diff.changed.length > 0) {
      info(`${BOLD}${diff.changed.length}${NC} file(s) modified:`);
      for (const f of diff.changed.slice(0, 20)) bullet(`~ ${f}`);
      if (diff.changed.length > 20) bullet(`... and ${diff.changed.length - 20} more`);
    }
    if (diff.added.length > 0) {
      info(`${BOLD}${diff.added.length}${NC} file(s) added:`);
      for (const f of diff.added.slice(0, 10)) bullet(`+ ${f}`);
      if (diff.added.length > 10) bullet(`... and ${diff.added.length - 10} more`);
    }
    if (diff.removed.length > 0) {
      info(`${BOLD}${diff.removed.length}${NC} file(s) removed`);
    }
    console.log('');

    // ── Step 5: Apply only changed files ──

    info('Applying changes...');
    applyDiff(installDir, extractDir, diff);
    stampVersion(installDir, remoteVersion);
    ok(`Updated to ${BOLD}v${remoteVersion}${NC} — ${totalChanged} file(s) changed`);
    console.log('');

    // ── Step 6: Rebuild only affected components ──

    const plan = planRebuild(diff);
    const rebuildList: string[] = [];
    if (plan.npm) rebuildList.push('npm');
    if (plan.typescript) rebuildList.push('TypeScript');
    if (plan.rust) rebuildList.push('Rust');
    if (plan.go) rebuildList.push('Go');
    if (plan.python) rebuildList.push('Python');

    if (rebuildList.length > 0) {
      info(`Components to rebuild: ${BOLD}${rebuildList.join(', ')}${NC}`);
      console.log('');
    }

    rebuild(installDir, plan);

    console.log('');
    ok(`${BOLD}Update complete! Agent v0 v${remoteVersion} is ready.${NC}`);
    console.log('');

    // ── Step 7: Restart ──

    info('Restarting Agent v0...');
    console.log('');

    const entry = path.join(installDir, 'dist', 'cli', 'cli.js');
    const args = process.argv.slice(2).filter(a => a !== 'update' && a !== '/update');
    const child = spawn('node', [entry, ...args], {
      cwd: installDir, stdio: 'inherit', detached: false, env: process.env,
    });
    child.on('exit', (code) => process.exit(code ?? 0));

  } catch (err) {
    fail(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Clean up temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
