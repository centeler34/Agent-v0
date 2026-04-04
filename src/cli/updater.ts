/**
 * Agent v0 — Self-Updater
 *
 * Downloads the latest release from GitHub, extracts it over the install
 * directory, rebuilds all components, and restarts the CLI.
 *
 * Strategy:
 *   1. Query GitHub API for the latest release tag + tarball URL.
 *   2. Compare with the local version (from package.json).
 *   3. Download the release tarball to a temp directory.
 *   4. Back up the current install, extract the new code in-place.
 *   5. Install deps, rebuild, restart.
 *
 * Falls back to `git pull` if the install directory is a git repo and
 * the GitHub API request fails (e.g. no network, rate-limited, etc.).
 */

import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'centeler34';
const GITHUB_REPO = 'Agent-v0';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const TARBALL_API = (tag: string) =>
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tarball/${tag}`;

// ── ANSI helpers ─────────────────────────────────────────────────────────────

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

// ── Shell helpers ────────────────────────────────────────────────────────────

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function hasCommand(cmd: string): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) return false;
  try {
    execSync(`command -v -- ${cmd}`, { stdio: 'pipe', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

// ── Install directory resolution ─────────────────────────────────────────────

function getInstallDir(): string {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.resolve(scriptDir, '..', '..');
  const homeInstall = path.join(os.homedir(), '.agent-v0');
  if (fs.existsSync(path.join(repoRoot, 'package.json'))) return repoRoot;
  if (fs.existsSync(path.join(homeInstall, 'package.json'))) return homeInstall;
  return repoRoot;
}

function getLocalVersion(installDir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Write the installed version into package.json so future update checks
 * compare against the actual installed release, not a stale value.
 */
function stampVersion(installDir: string, version: string): void {
  const pkgPath = path.join(installDir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.version === version) return; // already correct
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    info(`Version stamped: ${BOLD}v${version}${NC}`);
  } catch {
    warn('Could not stamp version into package.json');
  }
}

// ── GitHub API helpers ───────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  tarball_url: string;
  published_at: string;
}

function httpsGet(url: string): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'agent-v0-updater', Accept: 'application/vnd.github+json' } }, (res) => {
      // Follow redirects (GitHub sends 302 for tarball downloads)
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function httpsDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'agent-v0-updater', Accept: 'application/octet-stream' } }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return httpsDownload(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => { req.destroy(); reject(new Error('Download timed out')); });
  });
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const res = await httpsGet(GITHUB_API);
    if (res.statusCode !== 200) return null;
    return JSON.parse(res.body) as GitHubRelease;
  } catch {
    return null;
  }
}

// ── Cleanup helper ───────────────────────────────────────────────────────────

function preUpdateCleanup(installDir: string): void {
  const artifactPaths = [
    path.join(installDir, 'dist'),
    path.join(installDir, 'go/net-probe/net-probe'),
  ];
  for (const target of artifactPaths) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    const items = stat.isDirectory() ? fs.readdirSync(target) : [target];
    for (const item of items) {
      const fpath = stat.isDirectory() ? path.join(target, item) : item;
      if (fs.existsSync(fpath) && fs.statSync(fpath).isFile() && fs.statSync(fpath).size === 0) {
        fs.unlinkSync(fpath);
      }
    }
  }
}

// ── Version comparison ───────────────────────────────────────────────────────

function stripV(tag: string): string {
  return tag.replace(/^v/i, '');
}

function isNewer(remoteTag: string, localVersion: string): boolean {
  const r = stripV(remoteTag).split('.').map(Number);
  const l = localVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

// ── Rebuild pipeline ─────────────────────────────────────────────────────────

function rebuildComponents(installDir: string): void {
  info('Rebuilding components...');
  console.log('');

  // ── Node.js / TypeScript ──
  info('  Installing npm dependencies...');
  try {
    run('npm install', installDir);
    success('  npm dependencies installed');
  } catch {
    error('  npm install failed');
  }

  try {
    run('npm audit fix', installDir);
    success('  npm audit vulnerabilities patched');
  } catch {
    // non-critical
  }

  info('  Compiling TypeScript...');
  try {
    run('npx tsc', installDir);
    success('  TypeScript compiled');
  } catch {
    error('  TypeScript build failed');
  }

  // ── Rust ──
  if (hasCommand('cargo')) {
    info('  Updating & building Rust crates...');
    try {
      run('cargo update', installDir);
      run('cargo build --release', installDir);
      success('  Rust crates built');
    } catch {
      warn('  Rust build skipped');
    }
  }

  // ── Go ──
  if (hasCommand('go')) {
    info('  Updating & building Go utilities...');
    try {
      const goDir = path.join(installDir, 'go', 'net-probe');
      if (fs.existsSync(goDir)) {
        run('go get -u ./...', goDir);
        run('go mod tidy', goDir);
        const goDistDir = path.join(installDir, 'dist', 'go');
        if (!fs.existsSync(goDistDir)) fs.mkdirSync(goDistDir, { recursive: true });
        run('go build -o ../../dist/go/net-probe .', goDir);
        success('  Go utilities built');
      }
    } catch {
      warn('  Go build skipped');
    }
  }

  // ── Python ──
  if (hasCommand('pip')) {
    info('  Updating Python dependencies...');
    try {
      const forensicsReq = path.join(installDir, 'python/forensics-service/requirements.txt');
      const osintReq = path.join(installDir, 'python/osint-utils/requirements.txt');
      if (fs.existsSync(forensicsReq)) run(`pip install --upgrade -r ${forensicsReq} -q`, installDir);
      if (fs.existsSync(osintReq)) run(`pip install --upgrade -r ${osintReq} -q`, installDir);
      success('  Python dependencies updated');
    } catch {
      warn('  Python deps update skipped');
    }
  }
}

// ── Restart ──────────────────────────────────────────────────────────────────

function restartCli(installDir: string): void {
  info('Restarting Agent v0...');
  console.log('');

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

// ── GitHub release download strategy ─────────────────────────────────────────

async function updateViaGitHubRelease(installDir: string, release: GitHubRelease): Promise<boolean> {
  const tag = release.tag_name;
  const tmpDir = path.join(os.tmpdir(), `agent-v0-update-${Date.now()}`);
  const tarballPath = path.join(tmpDir, 'release.tar.gz');
  const extractDir = path.join(tmpDir, 'extracted');

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    // Download tarball
    info(`Downloading ${BOLD}${tag}${NC} from GitHub...`);
    const tarballUrl = TARBALL_API(tag);
    await httpsDownload(tarballUrl, tarballPath);

    const sizeKB = Math.round(fs.statSync(tarballPath).size / 1024);
    success(`Downloaded ${sizeKB} KB`);

    // Extract tarball
    info('Extracting release...');
    run(`tar xzf "${tarballPath}" -C "${extractDir}" --strip-components=1`, tmpDir);
    success('Release extracted');

    // Back up current install (keep .git, node_modules, .env, keystore, session)
    info('Backing up current installation...');
    const backupDir = path.join(tmpDir, 'backup');
    fs.mkdirSync(backupDir, { recursive: true });

    // Save items we want to preserve
    const preserve = ['.git', 'node_modules', '.env', 'dist'];
    for (const item of preserve) {
      const src = path.join(installDir, item);
      if (fs.existsSync(src)) {
        const dest = path.join(backupDir, item);
        // Use cp -a for symlinks & permissions
        try { run(`cp -a "${src}" "${dest}"`, installDir); } catch { /* best effort */ }
      }
    }

    // Copy new release files over the install directory
    info('Installing new version...');

    // Get list of files/dirs from the extracted release
    const releaseItems = fs.readdirSync(extractDir);
    for (const item of releaseItems) {
      // Don't overwrite preserved directories with release versions
      if (preserve.includes(item) && item !== '.env') continue;

      const src = path.join(extractDir, item);
      const dest = path.join(installDir, item);

      // Remove old version of the item
      if (fs.existsSync(dest)) {
        const stat = fs.statSync(dest);
        if (stat.isDirectory()) {
          run(`rm -rf "${dest}"`, installDir);
        } else {
          fs.unlinkSync(dest);
        }
      }

      // Copy new version in
      run(`cp -a "${src}" "${dest}"`, installDir);
    }

    // Restore preserved items that might have been removed
    for (const item of preserve) {
      const backed = path.join(backupDir, item);
      const dest = path.join(installDir, item);
      if (fs.existsSync(backed) && !fs.existsSync(dest)) {
        run(`cp -a "${backed}" "${dest}"`, installDir);
      }
    }

    success(`Installed ${BOLD}${tag}${NC}`);

    // Stamp the installed version into package.json so future update
    // checks know exactly which release is installed locally.
    stampVersion(installDir, stripV(tag));

    // Update the local git reference if this is a git repo
    if (fs.existsSync(path.join(installDir, '.git'))) {
      try {
        run('git fetch origin --tags', installDir);
        run(`git reset --hard ${tag}`, installDir);
      } catch {
        // Non-critical — the files are already updated
      }
    }

    // Cleanup temp directory
    try { run(`rm -rf "${tmpDir}"`, os.tmpdir()); } catch { /* best effort */ }

    return true;
  } catch (err) {
    error(`GitHub release download failed: ${err instanceof Error ? err.message : String(err)}`);
    // Cleanup on failure
    try { run(`rm -rf "${tmpDir}"`, os.tmpdir()); } catch { /* best effort */ }
    return false;
  }
}

// ── Git pull fallback strategy ───────────────────────────────────────────────

function updateViaGitPull(installDir: string): boolean {
  warn('Falling back to git pull...');

  if (!fs.existsSync(path.join(installDir, '.git'))) {
    error('No git repository found. Cannot update.');
    return false;
  }

  try {
    run('git fetch origin', installDir);
  } catch {
    error('Failed to fetch from remote. Check your network connection.');
    return false;
  }

  const localHash = run('git rev-parse HEAD', installDir);
  let remoteHash: string;
  try {
    remoteHash = run('git rev-parse origin/main', installDir);
  } catch {
    try {
      remoteHash = run('git rev-parse origin/master', installDir);
    } catch {
      error('Cannot determine remote branch.');
      return false;
    }
  }

  if (localHash === remoteHash) {
    success('Already up to date!');
    return false; // nothing to rebuild
  }

  try {
    // Stash local changes
    try {
      const status = run('git status --porcelain', installDir);
      if (status) {
        warn('Stashing local changes...');
        run('git stash', installDir);
      }
    } catch { /* no changes */ }

    run('git pull origin main --ff-only', installDir);
    const pulledVersion = getLocalVersion(installDir);
    success(`Code updated via git → v${pulledVersion}`);
    return true;
  } catch {
    error('Git pull failed. Resolve conflicts manually.');
    return false;
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runUpdate(): Promise<void> {
  const installDir = getInstallDir();
  preUpdateCleanup(installDir);

  console.log('');
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log(`${BOLD}  Agent v0 — Update${NC}`);
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log('');

  const localVersion = getLocalVersion(installDir);
  info(`Install directory: ${DIM}${installDir}${NC}`);
  info(`Current version:   ${BOLD}v${localVersion}${NC}`);
  console.log('');

  // ── Step 1: Check for updates via GitHub API ──────────────────────────────

  info('Checking GitHub for latest release...');

  const release = await fetchLatestRelease();
  let updated = false;

  if (release) {
    const remoteVersion = stripV(release.tag_name);
    info(`Latest release:    ${BOLD}${release.tag_name}${NC}  ${DIM}(${release.published_at.split('T')[0]})${NC}`);

    if (release.name) {
      info(`Release name:      ${DIM}${release.name}${NC}`);
    }

    console.log('');

    if (!isNewer(release.tag_name, localVersion)) {
      success('Already on the latest version!');
      console.log('');
      return;
    }

    // Show release notes (first 10 lines)
    if (release.body) {
      info('What\'s new:');
      const lines = release.body.split('\n').filter(l => l.trim()).slice(0, 12);
      for (const line of lines) {
        console.log(`    ${DIM}${line}${NC}`);
      }
      if (release.body.split('\n').filter(l => l.trim()).length > 12) {
        console.log(`    ${DIM}...${NC}`);
      }
      console.log('');
    }

    // ── Step 2: Download & install from GitHub release ──────────────────────

    info(`Updating ${BOLD}v${localVersion}${NC} → ${BOLD}${release.tag_name}${NC}`);
    console.log('');

    updated = await updateViaGitHubRelease(installDir, release);

    if (!updated) {
      // Fall back to git pull
      console.log('');
      updated = updateViaGitPull(installDir);
    }
  } else {
    // No release info available — use git pull
    warn('Could not reach GitHub API (rate-limited or offline).');
    console.log('');
    updated = updateViaGitPull(installDir);
  }

  if (!updated) {
    console.log('');
    error('Update was not applied.');
    return;
  }

  console.log('');

  // ── Step 3: Rebuild everything ────────────────────────────────────────────

  rebuildComponents(installDir);

  console.log('');
  const newVersion = getLocalVersion(installDir);
  success(`${BOLD}Update complete! Agent v0 v${newVersion} is ready.${NC}`);
  console.log('');

  // ── Step 4: Restart ───────────────────────────────────────────────────────

  restartCli(installDir);
}
