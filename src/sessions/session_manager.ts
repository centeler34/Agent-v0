/**
 * Session CRUD, workspace initialization, and scope file loading.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { ScopeEnforcer, type EngagementScope } from './scope_enforcer.js';

export interface Session {
  id: string;
  name: string;
  created_at: string;
  workspace_root: string;
  scope?: EngagementScope;
  status: 'active' | 'detached' | 'archived';
  attached_at?: string;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private workspaceBase: string;
  private activeSessionId: string | null = null;

  constructor(workspaceBase: string) {
    this.workspaceBase = workspaceBase;
  }

  create(name: string, scopeFile?: string): Session {
    // Validate session name to prevent path traversal (CWE-23)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      throw new Error(`Invalid session name: "${name}". Use only alphanumeric, hyphens, underscores, and dots.`);
    }

    const id = `session-${crypto.randomUUID()}`;
    const workspaceRoot = path.join(this.workspaceBase, name);

    // Verify resolved path stays within workspace base
    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedBase = path.resolve(this.workspaceBase);
    if (!resolvedRoot.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Path traversal blocked: session name "${name}" resolves outside workspace`);
    }

    // Create workspace directories
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const agentDirs = ['agentic', 'recon', 'code', 'exploit_research', 'reports', 'monitor', 'osint', 'threat_intel', 'forensics', 'scribe'];
    for (const dir of agentDirs) {
      fs.mkdirSync(path.join(workspaceRoot, dir), { recursive: true });
    }

    let scope: EngagementScope | undefined;
    if (scopeFile) {
      const resolvedScope = path.resolve(scopeFile);
      const cwd = path.resolve(process.cwd());
      if (!resolvedScope.startsWith(cwd + path.sep) && resolvedScope !== cwd) {
        throw new Error(`Scope file must be within the current directory: ${scopeFile}`);
      }
      if (fs.existsSync(resolvedScope)) {
        const scopeYaml = fs.readFileSync(resolvedScope, 'utf-8');
        scope = parseYaml(scopeYaml) as EngagementScope;
      }
    }

    const session: Session = {
      id,
      name,
      created_at: new Date().toISOString(),
      workspace_root: workspaceRoot,
      scope,
      status: 'active',
      attached_at: new Date().toISOString(),
    };

    this.sessions.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  attach(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = 'active';
    session.attached_at = new Date().toISOString();
    this.activeSessionId = sessionId;
    return session;
  }

  detach(): void {
    if (this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId);
      if (session) session.status = 'detached';
      this.activeSessionId = null;
    }
  }

  archive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = 'archived';
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    return true;
  }

  getActive(): Session | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) || null;
  }

  getScopeEnforcer(): ScopeEnforcer | null {
    const session = this.getActive();
    if (!session?.scope) return null;
    return new ScopeEnforcer(session.scope);
  }
}
