/**
 * Quarantine state manager — pending/approved/rejected lifecycle.
 */

import fs from 'node:fs';
import path from 'node:path';

const QUARANTINE_BASE = path.join(process.env.HOME || '~', '.cyplex', 'quarantine');

export interface QuarantineEntry {
  hash: string;
  source: string;
  status: 'pending_scan' | 'scanning' | 'clean' | 'rejected' | 'approved';
  quarantined_at: string;
  scanned_at?: string;
  approved_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  file_path: string;
}

export class SkillQuarantine {
  listPending(): QuarantineEntry[] {
    return this.listDir('pending');
  }

  listRejected(): QuarantineEntry[] {
    return this.listDir('rejected');
  }

  getEntry(hash: string): QuarantineEntry | null {
    // Validate hash format to prevent path traversal (CWE-23)
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;

    for (const dir of ['pending', 'approved', 'rejected']) {
      const metaPath = path.join(QUARANTINE_BASE, dir, `${hash}.yaml.meta.json`);
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        return {
          ...meta,
          file_path: path.join(QUARANTINE_BASE, dir, `${hash}.yaml`),
        };
      }
    }
    return null;
  }

  approve(hash: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(hash)) return false;
    return this.moveEntry(hash, 'pending', 'approved', { approved_at: new Date().toISOString(), status: 'approved' });
  }

  reject(hash: string, reason: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(hash)) return false;
    return this.moveEntry(hash, 'pending', 'rejected', {
      rejected_at: new Date().toISOString(),
      status: 'rejected',
      rejection_reason: reason,
    });
  }

  purgeRejected(): number {
    const dir = path.join(QUARANTINE_BASE, 'rejected');
    if (!fs.existsSync(dir)) return 0;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      fs.unlinkSync(path.join(dir, file));
    }
    return files.length;
  }

  private listDir(subdir: string): QuarantineEntry[] {
    const dir = path.join(QUARANTINE_BASE, subdir);
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.meta.json'))
      .map((f) => {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        const hash = f.replace('.yaml.meta.json', '');
        return {
          ...meta,
          hash,
          file_path: path.join(dir, `${hash}.yaml`),
        };
      });
  }

  private moveEntry(hash: string, fromDir: string, toDir: string, updates: Record<string, unknown>): boolean {
    const srcYaml = path.join(QUARANTINE_BASE, fromDir, `${hash}.yaml`);
    const srcMeta = path.join(QUARANTINE_BASE, fromDir, `${hash}.yaml.meta.json`);
    const destYaml = path.join(QUARANTINE_BASE, toDir, `${hash}.yaml`);
    const destMeta = path.join(QUARANTINE_BASE, toDir, `${hash}.yaml.meta.json`);

    if (!fs.existsSync(srcYaml)) return false;

    fs.mkdirSync(path.join(QUARANTINE_BASE, toDir), { recursive: true });

    // Update metadata
    const meta = fs.existsSync(srcMeta) ? JSON.parse(fs.readFileSync(srcMeta, 'utf-8')) : {};
    Object.assign(meta, updates);
    fs.writeFileSync(destMeta, JSON.stringify(meta, null, 2));

    // Move files
    fs.renameSync(srcYaml, destYaml);
    if (fs.existsSync(srcMeta)) fs.unlinkSync(srcMeta);

    return true;
  }
}
