/**
 * Agent v0 — Platform Abstraction Layer
 *
 * Centralizes all OS-specific paths, binaries, and behaviour so the rest
 * of the codebase can call `platform.*` instead of hard-coding Linux assumptions.
 *
 * Supported platforms: Linux (all distros), macOS (Intel + Apple Silicon).
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// ── Platform Detection ────────────────────────────────────────────────────

export type Platform = 'linux' | 'darwin';
export type Arch = 'x64' | 'arm64';

/** The current operating system. Throws on unsupported platforms. */
export function getPlatform(): Platform {
  const p = process.platform;
  if (p === 'linux' || p === 'darwin') {
    // macOS is only supported on Apple Silicon (arm64)
    if (p === 'darwin' && process.arch !== 'arm64') {
      throw new Error('Agent v0 only supports Apple Silicon (M1/M2/M3/M4/M5) Macs. Intel Macs are not supported.');
    }
    return p;
  }
  throw new Error(`Unsupported platform: ${p}. Agent v0 supports Linux and macOS (Apple Silicon).`);
}

export function getArch(): Arch {
  const a = process.arch;
  if (a === 'x64' || a === 'arm64') return a;
  throw new Error(`Unsupported architecture: ${a}. Agent v0 supports x64 (Linux) and arm64.`);
}

export const PLATFORM = getPlatform();
export const ARCH = getArch();
export const IS_MACOS = PLATFORM === 'darwin';
export const IS_LINUX = PLATFORM === 'linux';

// ── Directories ───────────────────────────────────────────────────────────

const HOME = os.homedir();

/** The Agent v0 data/config directory (~/.agent-v0). */
export const DATA_DIR = path.join(HOME, '.agent-v0');

/** Platform-appropriate temporary directory. */
export const TEMP_DIR = os.tmpdir();

/** Default daemon Unix socket path. */
export function socketPath(): string {
  // macOS has a 104-char limit on Unix socket paths, and /tmp is volatile.
  // Use the data dir on macOS for reliability.
  if (IS_MACOS) {
    return path.join(DATA_DIR, 'agent-v0.sock');
  }
  return path.join(TEMP_DIR, 'agent-v0.sock');
}

/** Default daemon PID file path. */
export function pidFilePath(): string {
  if (IS_MACOS) {
    return path.join(DATA_DIR, 'agent-v0.pid');
  }
  return path.join(TEMP_DIR, 'agent-v0.pid');
}

/** Log directory. */
export const LOG_DIR = path.join(DATA_DIR, 'logs');

/** Audit log directory. */
export const AUDIT_DIR = path.join(DATA_DIR, 'audit');

/** Certificate directory. */
export const CERT_DIR = path.join(DATA_DIR, 'certs');

// ── Shell Detection ───────────────────────────────────────────────────────

/**
 * Returns the path to a POSIX-compatible shell.
 *
 * macOS moved to zsh as the default shell and `/bin/sh` is still present
 * but this function future-proofs against environments where it may differ.
 * We prefer /bin/sh (POSIX) on both platforms.
 */
export function shellPath(): string {
  // /bin/sh exists on both Linux and macOS
  if (fs.existsSync('/bin/sh')) return '/bin/sh';
  // Fallback: check SHELL env
  const envShell = process.env.SHELL;
  if (envShell && fs.existsSync(envShell)) return envShell;
  // Last resort
  if (IS_MACOS && fs.existsSync('/bin/zsh')) return '/bin/zsh';
  return '/bin/sh';
}

/** Cached shell path for the current process. */
export const SHELL = shellPath();

// ── Binary Detection ──────────────────────────────────────────────────────

/** Homebrew prefix — /opt/homebrew on Apple Silicon. */
export function homebrewPrefix(): string | null {
  if (!IS_MACOS) return null;
  if (fs.existsSync('/opt/homebrew')) return '/opt/homebrew';
  return null;
}

/** Check whether a command exists on PATH. */
export function hasCommand(name: string): boolean {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return false;
  try {
    execFileSync(SHELL, ['-c', `command -v -- ${name}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Resolve the full path to a command, searching Homebrew paths on macOS. */
export function whichCommand(name: string): string | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  try {
    return execFileSync(SHELL, ['-c', `command -v -- ${name}`], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Returns the default list of allowed binary paths for sandboxed execution.
 * On macOS these include Homebrew paths; on Linux the standard FHS paths.
 */
export function defaultAllowedBinaries(): string[] {
  const bins: string[] = [];
  const candidates = IS_MACOS
    ? [
        '/opt/homebrew/bin/python3',
        '/usr/bin/python3',
        '/opt/homebrew/bin/node',
      ]
    : [
        '/usr/bin/python3',
        '/usr/local/bin/python3',
        '/usr/local/bin/node',
        '/usr/bin/node',
      ];

  for (const c of candidates) {
    if (fs.existsSync(c)) bins.push(c);
  }
  return bins;
}

// ── Sandbox Strategy ──────────────────────────────────────────────────────

export type SandboxBackend = 'bubblewrap' | 'sandbox-exec' | 'path-guard-only';

/**
 * Determine the best available sandbox backend for this platform.
 *
 * - Linux: bubblewrap (bwrap) if installed, else path-guard-only
 * - macOS: sandbox-exec (Apple Sandbox.framework) if available, else path-guard-only
 */
export function detectSandboxBackend(): SandboxBackend {
  if (IS_LINUX) {
    return hasCommand('bwrap') ? 'bubblewrap' : 'path-guard-only';
  }
  if (IS_MACOS) {
    // sandbox-exec is built into macOS (part of Sandbox.framework)
    return hasCommand('sandbox-exec') ? 'sandbox-exec' : 'path-guard-only';
  }
  return 'path-guard-only';
}

// ── Read-Only System Paths (for sandbox bind-mounts) ──────────────────────

/**
 * System directories that should be bind-mounted read-only inside a sandbox.
 * These differ between Linux and macOS.
 */
export function readonlySystemPaths(): string[] {
  if (IS_MACOS) {
    return [
      '/usr/lib',
      '/usr/bin',
      '/usr/sbin',
      '/usr/share',
      '/bin',
      '/sbin',
      '/Library/Frameworks',
      '/System/Library/Frameworks',
      // Homebrew
      ...(homebrewPrefix() ? [path.join(homebrewPrefix()!, 'bin'), path.join(homebrewPrefix()!, 'lib')] : []),
    ].filter(p => fs.existsSync(p));
  }
  // Linux
  return [
    '/usr',
    '/lib',
    '/lib64',
    '/bin',
    '/sbin',
  ].filter(p => fs.existsSync(p));
}

// ── Package Manager Detection ─────────────────────────────────────────────

export type PackageManager =
  | 'brew'     // macOS
  | 'apt'      // Debian/Ubuntu
  | 'dnf'      // Fedora/RHEL
  | 'pacman'   // Arch
  | 'zypper'   // openSUSE
  | 'apk'      // Alpine
  | 'unknown';

export function detectPackageManager(): PackageManager {
  if (IS_MACOS) return hasCommand('brew') ? 'brew' : 'unknown';
  const managers: [string, PackageManager][] = [
    ['apt-get', 'apt'],
    ['dnf', 'dnf'],
    ['pacman', 'pacman'],
    ['zypper', 'zypper'],
    ['apk', 'apk'],
  ];
  for (const [cmd, pm] of managers) {
    if (hasCommand(cmd)) return pm;
  }
  return 'unknown';
}

// ── LaunchAgent / systemd ─────────────────────────────────────────────────

/** Path to the LaunchAgent plist for macOS daemon management. */
export function launchAgentPath(): string {
  return path.join(HOME, 'Library', 'LaunchAgents', 'io.agent-v0.daemon.plist');
}

/** Path to the systemd user service for Linux daemon management. */
export function systemdServicePath(): string {
  return path.join(HOME, '.config', 'systemd', 'user', 'agent-v0.service');
}

// ── Go Download URL ───────────────────────────────────────────────────────

/** Construct the Go tarball URL for the current platform. */
export function goDownloadUrl(version: string): string {
  const goOs = IS_MACOS ? 'darwin' : 'linux';
  const goArch = ARCH === 'arm64' ? 'arm64' : 'amd64';
  return `https://go.dev/dl/go${version}.${goOs}-${goArch}.tar.gz`;
}

// ── File Picker (for skill intake) ────────────────────────────────────────

/** Returns the platform-specific command for opening a file picker dialog. */
export function filePickerCommand(): { cmd: string; args: string[] } | null {
  if (IS_MACOS) {
    return {
      cmd: 'osascript',
      args: [
        '-e',
        'set f to POSIX path of (choose file of type {"yaml","yml"} with prompt "Select skill files" with multiple selections allowed)',
      ],
    };
  }
  if (IS_LINUX && hasCommand('zenity')) {
    return {
      cmd: 'zenity',
      args: [
        '--file-selection',
        '--multiple',
        '--separator=\\n',
        '--file-filter=YAML files | *.yaml *.yml',
        '--title=Select skill files',
      ],
    };
  }
  return null;
}

// ── OpenSSL Availability ──────────────────────────────────────────────────

/**
 * Check that OpenSSL is available for TLS cert generation.
 * On macOS, the system openssl may be LibreSSL — that's fine for self-signed certs.
 */
export function hasOpenssl(): boolean {
  return hasCommand('openssl');
}

// ── Summary ───────────────────────────────────────────────────────────────

export function platformSummary(): string {
  const lines = [
    `Platform:    ${PLATFORM} (${ARCH})`,
    `Shell:       ${SHELL}`,
    `Data dir:    ${DATA_DIR}`,
    `Socket:      ${socketPath()}`,
    `PID file:    ${pidFilePath()}`,
    `Sandbox:     ${detectSandboxBackend()}`,
    `Pkg manager: ${detectPackageManager()}`,
  ];
  const brew = homebrewPrefix();
  if (brew) lines.push(`Homebrew:    ${brew}`);
  return lines.join('\n');
}
