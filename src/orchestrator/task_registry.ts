/**
 * In-memory + SQLite task state store.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { TaskEnvelope, ResultEnvelope, TaskStatus, TaskNode } from '../types/task_envelope.js';

export class TaskRegistry {
  private db: Database.Database;
  private masterKey: Buffer | null = null;

  constructor() {
    const dbDir = path.join(os.homedir(), '.agent-v0');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'tasks.db');
    this.db = new Database(dbPath);
    this.initSchema();
  }

  /**
   * Sets the master key used for column-level encryption.
   * This should be called by the daemon once the keystore is unlocked.
   */
  setMasterKey(key: string | Buffer): void {
    this.masterKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
    if (this.masterKey.length !== 32) {
      throw new Error('Master key for TaskRegistry must be 32 bytes (AES-256)');
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        parent_task_id TEXT,
        status TEXT,
        assigned_agent TEXT,
        retry_count INTEGER,
        max_retries INTEGER,
        started_at TEXT,
        completed_at TEXT,
        task_data TEXT,
        result_data TEXT
      );

      CREATE TABLE IF NOT EXISTS secrets (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT,
        depends_on_id TEXT,
        PRIMARY KEY (task_id, depends_on_id),
        FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_id) REFERENCES tasks(task_id) ON DELETE CASCADE
      );
    `);
  }

  /**
   * Migrates any plaintext tasks in the database to encrypted format.
   */
  migrateToEncryption(): number {
    if (!this.masterKey) throw new Error('Master key required for migration');
    
    const rows = this.db.prepare('SELECT task_id, task_data, result_data FROM tasks').all() as any[];
    let migratedCount = 0;

    const updateStmt = this.db.prepare('UPDATE tasks SET task_data = ?, result_data = ? WHERE task_id = ?');

    this.db.transaction(() => {
      for (const row of rows) {
        let needsUpdate = false;
        let encryptedTask = row.task_data;
        let encryptedResult = row.result_data;

        if (row.task_data && !this.isEncrypted(row.task_data)) {
          encryptedTask = this.encrypt(row.task_data);
          needsUpdate = true;
        }

        if (row.result_data && !this.isEncrypted(row.result_data)) {
          encryptedResult = this.encrypt(row.result_data);
          needsUpdate = true;
        }

        if (needsUpdate) {
          updateStmt.run(encryptedTask, encryptedResult, row.task_id);
          migratedCount++;
        }
      }
    })();

    return migratedCount;
  }

  setSecret(name: string, value: string): void {
    const encrypted = this.encrypt(value);
    this.db.prepare('INSERT OR REPLACE INTO secrets (name, value, created_at) VALUES (?, ?, ?)')
      .run(name, encrypted, new Date().toISOString());
  }

  getSecret(name: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM secrets WHERE name = ?').get(name) as any;
    if (!row) return undefined;
    return this.decrypt(row.value);
  }

  listSecrets(): string[] {
    const rows = this.db.prepare('SELECT name FROM secrets').all() as any[];
    return rows.map(row => row.name);
  }
  register(task: TaskEnvelope): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (task_id, parent_task_id, status, assigned_agent, retry_count, max_retries, task_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const dataToStore = this.encrypt(JSON.stringify(task));

    stmt.run(
      task.task_id,
      task.parent_task_id || null,
      'pending',
      task.target_agent,
      0,
      3,
      dataToStore
    );
  }

  get(taskId: string): TaskNode | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as any;
    if (!row) return undefined;

    const dependencies = this.db.prepare('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?')
      .all(taskId)
      .map((r: any) => r.depends_on_id);

    const dependents = this.db.prepare('SELECT task_id FROM task_dependencies WHERE depends_on_id = ?')
      .all(taskId)
      .map((r: any) => r.task_id);

    const taskData = JSON.parse(this.decrypt(row.task_data));
    const resultData = row.result_data ? JSON.parse(this.decrypt(row.result_data)) : undefined;

    return {
      task: taskData,
      status: row.status as TaskStatus,
      assigned_agent: row.assigned_agent,
      retry_count: row.retry_count,
      max_retries: row.max_retries,
      started_at: row.started_at,
      completed_at: row.completed_at,
      result: resultData,
      dependencies,
      dependents,
    };
  }

  updateStatus(taskId: string, status: TaskStatus): void {
    let started_at: string | undefined;
    let completed_at: string | undefined;

    if (status === 'running') {
      started_at = new Date().toISOString();
      this.db.prepare('UPDATE tasks SET status = ?, started_at = ? WHERE task_id = ?').run(status, started_at, taskId);
    } else if (['success', 'failed', 'timeout', 'cancelled'].includes(status)) {
      completed_at = new Date().toISOString();
      this.db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE task_id = ?').run(status, completed_at, taskId);
    } else {
      this.db.prepare('UPDATE tasks SET status = ? WHERE task_id = ?').run(status, taskId);
    }
  }

  setResult(taskId: string, result: ResultEnvelope): void {
    this.db.prepare(`
      UPDATE tasks 
      SET result_data = ?, status = ?, completed_at = ? 
      WHERE task_id = ?
    `).run(
      this.encrypt(JSON.stringify(result)),
      result.status,
      result.completed_at,
      taskId
    );
  }

  addDependency(taskId: string, dependsOnId: string): void {
    try {
      this.db.prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)').run(taskId, dependsOnId);
    } catch (err) {
      // Ignore duplicates
    }
  }

  getByStatus(status: TaskStatus): TaskNode[] {
    const rows = this.db.prepare('SELECT task_id FROM tasks WHERE status = ?').all(status);
    return rows.map((r: any) => this.get(r.task_id)!).filter(Boolean);
  }

  getByAgent(agentId: string): TaskNode[] {
    const rows = this.db.prepare('SELECT task_id FROM tasks WHERE assigned_agent = ?').all(agentId);
    return rows.map((r: any) => this.get(r.task_id)!).filter(Boolean);
  }

  getAll(): TaskNode[] {
    const rows = this.db.prepare('SELECT task_id FROM tasks').all();
    return rows.map((r: any) => this.get(r.task_id)!).filter(Boolean);
  }

  getRunning(): TaskNode[] {
    return this.getByStatus('running');
  }

  getPending(): TaskNode[] {
    return this.getByStatus('pending');
  }

  cancel(taskId: string): boolean {
    const row = this.db.prepare('SELECT status FROM tasks WHERE task_id = ?').get(taskId) as any;
    if (!row || row.status === 'success' || row.status === 'failed') return false;

    this.db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE task_id = ?')
      .run('cancelled', new Date().toISOString(), taskId);
    return true;
  }

  canRetry(taskId: string): boolean {
    const row = this.db.prepare('SELECT retry_count, max_retries, status FROM tasks WHERE task_id = ?').get(taskId) as any;
    if (!row) return false;
    return row.retry_count < row.max_retries && (row.status === 'failed' || row.status === 'timeout');
  }

  incrementRetry(taskId: string): void {
    this.db.prepare('UPDATE tasks SET retry_count = retry_count + 1, status = ? WHERE task_id = ?')
      .run('pending', taskId);
  }

  deleteSecret(name: string): boolean {
    const result = this.db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
    return result.changes > 0;
  }

  /**
   * Securely removes cancelled, failed, or timed-out tasks.
   * Also prunes the task_dependencies table of orphan records.
   */
  cleanup(): number {
    const deleteStmt = this.db.prepare(`
      DELETE FROM tasks 
      WHERE status IN ('cancelled', 'failed', 'timeout')
    `);
    const result = deleteStmt.run();
    
    this.db.exec(`DELETE FROM task_dependencies WHERE task_id NOT IN (SELECT task_id FROM tasks) OR depends_on_id NOT IN (SELECT task_id FROM tasks)`);
    return result.changes;
  }

  stats(): { total: number; pending: number; running: number; completed: number; failed: number } {
    const rows = this.db.prepare('SELECT status, count(*) as count FROM tasks GROUP BY status').all() as any[];
    const counts = { total: 0, pending: 0, running: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      counts.total += row.count;
      if (row.status === 'pending') counts.pending = row.count;
      if (row.status === 'running') counts.running = row.count;
      if (row.status === 'success') counts.completed = row.count;
      if (row.status === 'failed') counts.failed = row.count;
    }
    return counts;
  }

  // ── Encryption Helpers ───────────────────────────────────────────────────

  private encrypt(plaintext: string): string {
    if (!this.masterKey) {
      throw new Error('Master key required for encryption — call setMasterKey() first');
    }

    const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    // Format: iv:tag:encrypted_data
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  }

  private static ENCRYPTED_FORMAT = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/;

  private isEncrypted(value: string): boolean {
    return TaskRegistry.ENCRYPTED_FORMAT.test(value);
  }

  private decrypt(ciphertext: string): string {
    if (!this.masterKey) {
      throw new Error('Master key required for decryption — call setMasterKey() first');
    }

    if (!this.isEncrypted(ciphertext)) {
      throw new Error('Data does not match encrypted format — possible corruption or unencrypted data');
    }

    const [ivHex, tagHex, dataHex] = ciphertext.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(dataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
