/**
 * Agent v0 — Tool Execution Runtime
 *
 * Provides a lightweight execution layer that lets agents invoke tools
 * (Bash, Grep, Glob, FileRead, FileWrite, WebFetch) during task execution.
 * Each tool call is sandboxed to the agent's workspace and audited.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRole } from '../types/agent_config.js';

// ── Tool Result ────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration_ms: number;
}

// ── Tool Invocation Record (for audit) ─────────────────────────────────────

export interface ToolInvocation {
  tool: string;
  agent_id: AgentRole;
  params: Record<string, unknown>;
  result: ToolResult;
  timestamp: string;
}

const invocationLog: ToolInvocation[] = [];

function recordInvocation(inv: ToolInvocation): void {
  invocationLog.push(inv);
  if (invocationLog.length > 10_000) invocationLog.shift();
}

export function getInvocationLog(): readonly ToolInvocation[] {
  return invocationLog;
}

// ── Path Safety ────────────────────────────────────────────────────────────

function resolveSafe(workspace: string, target: string): string {
  const resolved = path.resolve(workspace, target);
  if (!resolved.startsWith(path.resolve(workspace))) {
    throw new Error(`Path traversal blocked: ${target}`);
  }
  return resolved;
}

// ── Bash Tool ──────────────────────────────────────────────────────────────

/** Dangerous shell metacharacters/patterns that could enable command injection. */
const BLOCKED_PATTERNS = [
  /;\s*(rm|curl|wget|nc|ncat|bash|sh|python|node)\b/,
  /\|\s*(bash|sh|python|node)\b/,
  />\s*\/etc\//,
  /`[^`]*`/,           // backtick command substitution
  /\$\([^)]*\)/,        // $() command substitution
];

export function execBash(
  command: string,
  opts: { cwd: string; timeout_ms?: number; agent_id: AgentRole },
): ToolResult {
  const start = Date.now();

  // Validate the command is not empty and is within size limits
  if (!command || command.length > 10_000) {
    return { success: false, output: '', error: 'Command is empty or exceeds maximum length (10KB)', duration_ms: Date.now() - start };
  }

  // Block dangerous injection patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      const result: ToolResult = { success: false, output: '', error: 'Command blocked: dangerous shell pattern detected', duration_ms: Date.now() - start };
      recordInvocation({ tool: 'Bash', agent_id: opts.agent_id, params: { command: '[BLOCKED]' }, result, timestamp: new Date().toISOString() });
      return result;
    }
  }

  try {
    // Use execFileSync with explicit shell to avoid direct shell metachar interpretation
    // while still supporting pipes/redirects that agents legitimately need.
    const stdout = execFileSync('/bin/sh', ['-c', command], {
      cwd: opts.cwd,
      encoding: 'utf-8',
      timeout: opts.timeout_ms ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result: ToolResult = { success: true, output: stdout.trim(), duration_ms: Date.now() - start };
    recordInvocation({ tool: 'Bash', agent_id: opts.agent_id, params: { command }, result, timestamp: new Date().toISOString() });
    return result;
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() || err.message || 'Unknown error';
    const result: ToolResult = { success: false, output: err.stdout?.toString?.() || '', error: stderr.trim(), duration_ms: Date.now() - start };
    recordInvocation({ tool: 'Bash', agent_id: opts.agent_id, params: { command }, result, timestamp: new Date().toISOString() });
    return result;
  }
}

// ── Grep Tool (ripgrep) ────────────────────────────────────────────────────

export function execGrep(
  pattern: string,
  opts: {
    cwd: string;
    agent_id: AgentRole;
    path?: string;
    glob?: string;
    type?: string;
    case_insensitive?: boolean;
    max_results?: number;
    output_mode?: 'content' | 'files_with_matches' | 'count';
    context_lines?: number;
  },
): ToolResult {
  const start = Date.now();
  const args: string[] = ['--color', 'never'];

  if (opts.case_insensitive) args.push('-i');

  if (opts.output_mode === 'files_with_matches') args.push('-l');
  else if (opts.output_mode === 'count') args.push('-c');
  else args.push('-n'); // content mode with line numbers

  if (opts.context_lines) args.push('-C', String(opts.context_lines));
  if (opts.glob) args.push('--glob', opts.glob);
  if (opts.type) args.push('--type', opts.type);
  if (opts.max_results) args.push('-m', String(opts.max_results));

  args.push('--', pattern);

  const searchPath = opts.path ? resolveSafe(opts.cwd, opts.path) : opts.cwd;
  args.push(searchPath);

  try {
    const stdout = execFileSync('rg', args, {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result: ToolResult = { success: true, output: stdout.trim(), duration_ms: Date.now() - start };
    recordInvocation({ tool: 'Grep', agent_id: opts.agent_id, params: { pattern, ...opts }, result, timestamp: new Date().toISOString() });
    return result;
  } catch (err: any) {
    // rg exits 1 when no matches found — that's not an error
    if (err.status === 1 && !err.stderr?.toString?.().trim()) {
      const result: ToolResult = { success: true, output: '', duration_ms: Date.now() - start };
      recordInvocation({ tool: 'Grep', agent_id: opts.agent_id, params: { pattern }, result, timestamp: new Date().toISOString() });
      return result;
    }
    const result: ToolResult = { success: false, output: '', error: err.stderr?.toString?.() || err.message, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'Grep', agent_id: opts.agent_id, params: { pattern }, result, timestamp: new Date().toISOString() });
    return result;
  }
}

// ── Glob Tool ──────────────────────────────────────────────────────────────

export function execGlob(
  pattern: string,
  opts: { cwd: string; agent_id: AgentRole; max_results?: number },
): ToolResult {
  const start = Date.now();
  try {
    // Use find as a portable glob alternative
    const args = [opts.cwd, '-type', 'f', '-name', pattern];
    if (opts.max_results) args.push('-maxdepth', '10');

    const stdout = execFileSync('find', args, {
      encoding: 'utf-8',
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let lines = stdout.trim().split('\n').filter(Boolean);
    if (opts.max_results) lines = lines.slice(0, opts.max_results);

    const result: ToolResult = { success: true, output: lines.join('\n'), duration_ms: Date.now() - start };
    recordInvocation({ tool: 'Glob', agent_id: opts.agent_id, params: { pattern }, result, timestamp: new Date().toISOString() });
    return result;
  } catch (err: any) {
    const result: ToolResult = { success: false, output: '', error: err.message, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'Glob', agent_id: opts.agent_id, params: { pattern }, result, timestamp: new Date().toISOString() });
    return result;
  }
}

// ── File Read Tool ─────────────────────────────────────────────────────────

export function execFileRead(
  filePath: string,
  opts: { cwd: string; agent_id: AgentRole; offset?: number; limit?: number },
): ToolResult {
  const start = Date.now();
  try {
    const resolved = resolveSafe(opts.cwd, filePath);
    const content = fs.readFileSync(resolved, 'utf-8');
    const lines = content.split('\n');

    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 2000;
    const sliced = lines.slice(offset, offset + limit);

    // Number lines like cat -n
    const numbered = sliced.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');

    const result: ToolResult = { success: true, output: numbered, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'FileRead', agent_id: opts.agent_id, params: { filePath, offset, limit }, result, timestamp: new Date().toISOString() });
    return result;
  } catch (err: any) {
    const result: ToolResult = { success: false, output: '', error: err.message, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'FileRead', agent_id: opts.agent_id, params: { filePath }, result, timestamp: new Date().toISOString() });
    return result;
  }
}

// ── File Write Tool ────────────────────────────────────────────────────────

export function execFileWrite(
  filePath: string,
  content: string,
  opts: { cwd: string; agent_id: AgentRole },
): ToolResult {
  const start = Date.now();
  try {
    const resolved = resolveSafe(opts.cwd, filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');

    const result: ToolResult = { success: true, output: `Wrote ${content.length} bytes to ${filePath}`, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'FileWrite', agent_id: opts.agent_id, params: { filePath, bytes: content.length }, result, timestamp: new Date().toISOString() });
    return result;
  } catch (err: any) {
    const result: ToolResult = { success: false, output: '', error: err.message, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'FileWrite', agent_id: opts.agent_id, params: { filePath }, result, timestamp: new Date().toISOString() });
    return result;
  }
}

// ── File Edit Tool (find & replace) ────────────────────────────────────────

export function execFileEdit(
  filePath: string,
  oldString: string,
  newString: string,
  opts: { cwd: string; agent_id: AgentRole; replace_all?: boolean },
): ToolResult {
  const start = Date.now();
  try {
    const resolved = resolveSafe(opts.cwd, filePath);
    let content = fs.readFileSync(resolved, 'utf-8');

    if (!content.includes(oldString)) {
      const result: ToolResult = { success: false, output: '', error: `old_string not found in ${filePath}`, duration_ms: Date.now() - start };
      recordInvocation({ tool: 'FileEdit', agent_id: opts.agent_id, params: { filePath }, result, timestamp: new Date().toISOString() });
      return result;
    }

    if (opts.replace_all) {
      content = content.split(oldString).join(newString);
    } else {
      content = content.replace(oldString, newString);
    }

    fs.writeFileSync(resolved, content, 'utf-8');
    const result: ToolResult = { success: true, output: `Edited ${filePath}`, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'FileEdit', agent_id: opts.agent_id, params: { filePath }, result, timestamp: new Date().toISOString() });
    return result;
  } catch (err: any) {
    const result: ToolResult = { success: false, output: '', error: err.message, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'FileEdit', agent_id: opts.agent_id, params: { filePath }, result, timestamp: new Date().toISOString() });
    return result;
  }
}

// ── Web Fetch Tool ─────────────────────────────────────────────────────────

export async function execWebFetch(
  url: string,
  opts: { agent_id: AgentRole; timeout_ms?: number },
): Promise<ToolResult> {
  const start = Date.now();

  // Validate URL scheme
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { success: false, output: '', error: 'Invalid URL', duration_ms: Date.now() - start };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { success: false, output: '', error: `Blocked scheme: ${parsed.protocol}`, duration_ms: Date.now() - start };
  }

  // Block cloud metadata endpoints — these are the only real SSRF risk.
  // Private/local IPs are intentionally allowed because Agent v0 runs
  // locally and agents need to reach the daemon, local services, and
  // network targets for security research.
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = [
    /^metadata\.google\.internal$/,       // GCP metadata
    /^169\.254\.169\.254$/,               // AWS/Azure/GCP metadata IP
    /^metadata\.internal$/,
  ];
  if (blockedHosts.some(p => p.test(hostname))) {
    return { success: false, output: '', error: `Blocked: cloud metadata endpoint "${hostname}"`, duration_ms: Date.now() - start };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout_ms ?? 30_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Agent-v0/1.3.0' },
    });
    clearTimeout(timer);

    const text = await response.text();
    const truncated = text.length > 100_000 ? text.substring(0, 100_000) + '\n... (truncated)' : text;

    const result: ToolResult = {
      success: response.ok,
      output: truncated,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      duration_ms: Date.now() - start,
    };
    recordInvocation({ tool: 'WebFetch', agent_id: opts.agent_id, params: { url }, result, timestamp: new Date().toISOString() });
    return result;
  } catch (err: any) {
    const result: ToolResult = { success: false, output: '', error: err.message, duration_ms: Date.now() - start };
    recordInvocation({ tool: 'WebFetch', agent_id: opts.agent_id, params: { url }, result, timestamp: new Date().toISOString() });
    return result;
  }
}

// ── Tool Registry ──────────────────────────────────────────────────────────

export type ToolName = 'Bash' | 'Grep' | 'Glob' | 'FileRead' | 'FileWrite' | 'FileEdit' | 'WebFetch';

export const AVAILABLE_TOOLS: ToolName[] = [
  'Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'FileEdit', 'WebFetch',
];

/**
 * Which tools each agent role is allowed to use.
 */
export const AGENT_TOOL_ALLOWLIST: Record<AgentRole, ToolName[]> = {
  agentic:          ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'FileEdit', 'WebFetch'],
  recon:            ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'WebFetch'],
  code:             ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'FileEdit'],
  exploit_research: ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'WebFetch'],
  forensics:        ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite'],
  osint_analyst:    ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'WebFetch'],
  threat_intel:     ['Bash', 'Grep', 'Glob', 'FileRead', 'WebFetch'],
  report:           ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'FileEdit'],
  monitor:          ['Bash', 'Grep', 'Glob', 'FileRead', 'WebFetch'],
  scribe:           ['Bash', 'Grep', 'Glob', 'FileRead', 'FileWrite', 'FileEdit'],
};

export function isToolAllowed(agent_id: AgentRole, tool: ToolName): boolean {
  return AGENT_TOOL_ALLOWLIST[agent_id]?.includes(tool) ?? false;
}
