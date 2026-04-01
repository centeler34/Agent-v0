/**
 * TypeScript FFI bridge to cyplex-keystore Rust crate.
 * In MVP, provides a pure-TS implementation. In v1.0, calls into Rust via napi-rs.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

interface KeyEntry {
  name: string;
  value: string; // base64-encoded encrypted value
  created_at: string;
  rotated_at?: string;
}

interface KeystoreData {
  version: number;
  salt: string;
  entries: Record<string, KeyEntry>;
}

export class KeystoreBridge {
  private data: KeystoreData | null = null;
  private derivedKey: Buffer | null = null;

  async open(path: string, masterPassword: string): Promise<void> {
    if (!fs.existsSync(path)) {
      // Create new keystore
      const salt = crypto.randomBytes(16).toString('hex');
      this.derivedKey = this.deriveKey(masterPassword, salt);
      this.data = { version: 1, salt, entries: {} };
      this.save(path);
      return;
    }

    const raw = fs.readFileSync(path, 'utf-8');
    const stored = JSON.parse(raw);
    this.derivedKey = this.deriveKey(masterPassword, stored.salt);

    // Decrypt entries
    this.data = {
      version: stored.version,
      salt: stored.salt,
      entries: stored.entries,
    };
  }

  /**
   * Returns the derived 32-byte master key for SQLite column encryption.
   */
  getDerivedKey(): Buffer {
    if (!this.derivedKey) {
      throw new Error('Keystore must be opened before accessing the master key');
    }
    return this.derivedKey;
  }

  get(name: string): string | null {
    if (!this.data || !this.derivedKey) return null;
    const entry = this.data.entries[name];
    if (!entry) return null;

    return this.decrypt(entry.value, this.derivedKey);
  }

  set(name: string, value: string): void {
    if (!this.data || !this.derivedKey) throw new Error('Keystore not open');

    const encrypted = this.encrypt(value, this.derivedKey);
    this.data.entries[name] = {
      name,
      value: encrypted,
      created_at: this.data.entries[name]?.created_at || new Date().toISOString(),
      rotated_at: this.data.entries[name] ? new Date().toISOString() : undefined,
    };
  }

  delete(name: string): boolean {
    if (!this.data) return false;
    if (!this.data.entries[name]) return false;
    delete this.data.entries[name];
    return true;
  }

  list(): string[] {
    if (!this.data) return [];
    return Object.keys(this.data.entries);
  }

  save(path: string): void {
    if (!this.data) throw new Error('Keystore not open');
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private deriveKey(password: string, salt: string): Buffer {
    return crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  }

  private encrypt(plaintext: string, key: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  private decrypt(ciphertext: string, key: Buffer): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf-8');
  }
}
