/**
 * /skills-download handler — URL fetch + local file picker for skill intake.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

export interface IntakeResult {
  success: boolean;
  quarantinePath?: string;
  hash?: string;
  error?: string;
}

const QUARANTINE_BASE = path.join(process.env.HOME || '~', '.cyplex', 'quarantine');
const QUARANTINE_DIR = path.join(QUARANTINE_BASE, 'pending');

function ensureQuarantineDir(): void {
  fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  fs.mkdirSync(path.join(QUARANTINE_BASE, 'approved'), { recursive: true });
  fs.mkdirSync(path.join(QUARANTINE_BASE, 'rejected'), { recursive: true });
}

/**
 * Validate that a resolved path stays within the expected directory.
 * Prevents path traversal attacks (CWE-23).
 */
function assertWithinDir(filePath: string, allowedDir: string): void {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(allowedDir);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    throw new Error(`Path traversal blocked: ${filePath} escapes ${allowedDir}`);
  }
}

/**
 * Validate that a URL is a safe remote HTTPS/HTTP endpoint.
 * Blocks file://, data://, and other non-HTTP schemes to prevent SSRF.
 */
function validateUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL format';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `Blocked scheme: ${parsed.protocol} — only http(s) allowed`;
  }
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
    return 'Blocked: localhost URLs are not allowed';
  }
  return null;
}

/**
 * Download a skill from a URL and place in quarantine.
 */
export async function intakeFromUrl(url: string, allowHttp = false): Promise<IntakeResult> {
  const urlError = validateUrl(url);
  if (urlError) {
    return { success: false, error: urlError };
  }

  if (!allowHttp && url.startsWith('http://')) {
    return { success: false, error: 'HTTP (non-TLS) downloads are rejected. Use --allow-http to override.' };
  }

  if (!url.endsWith('.yaml') && !url.endsWith('.yml')) {
    return { success: false, error: 'URL must point to a .yaml or .yml file' };
  }

  ensureQuarantineDir();

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `Download failed: HTTP ${response.status}` };
    }

    const content = await response.text();
    return quarantineContent(content, url);
  } catch (err) {
    return { success: false, error: `Download error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Import a skill from a local file path.
 */
export function intakeFromFile(filePath: string): IntakeResult {
  const resolved = path.resolve(filePath);

  if (!resolved.endsWith('.yaml') && !resolved.endsWith('.yml')) {
    return { success: false, error: 'File must be a .yaml or .yml file' };
  }

  if (!fs.existsSync(resolved)) {
    return { success: false, error: `File not found: ${resolved}` };
  }

  ensureQuarantineDir();
  const content = fs.readFileSync(resolved, 'utf-8');
  return quarantineContent(content, `file://${resolved}`);
}

/**
 * Open native file picker and import selected files.
 */
export function intakeFromPicker(): IntakeResult[] {
  const platform = process.platform;
  let files: string[] = [];

  try {
    if (platform === 'linux') {
      const result = execSync('zenity --file-selection --multiple --file-filter="YAML files|*.yaml *.yml" 2>/dev/null', {
        encoding: 'utf-8',
      });
      files = result.trim().split('|');
    } else if (platform === 'darwin') {
      const result = execSync(
        'osascript -e \'choose file of type {"yaml","yml"} with multiple selections allowed\'',
        { encoding: 'utf-8' },
      );
      files = result.trim().split(', ').map((f) => f.replace('alias ', ''));
    }
  } catch {
    return [{ success: false, error: 'File picker cancelled or unavailable' }];
  }

  return files.filter((f) => f.length > 0).map((f) => intakeFromFile(f));
}

function quarantineContent(content: string, source: string): IntakeResult {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const filename = `${hash}.yaml`;

  // Validate filename contains only hex chars to prevent injection
  if (!/^[a-f0-9]{64}\.yaml$/.test(filename)) {
    return { success: false, error: 'Internal error: unexpected hash format' };
  }

  const quarantinePath = path.join(QUARANTINE_DIR, filename);
  const metaPath = path.join(QUARANTINE_DIR, `${hash}.yaml.meta.json`);

  // Enforce path stays within quarantine directory (CWE-23 mitigation)
  assertWithinDir(quarantinePath, QUARANTINE_DIR);
  assertWithinDir(metaPath, QUARANTINE_DIR);

  // Write skill file
  fs.writeFileSync(quarantinePath, content, 'utf-8');

  // Write metadata alongside
  const meta = {
    source,
    hash,
    quarantined_at: new Date().toISOString(),
    status: 'pending_scan',
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  return { success: true, quarantinePath, hash };
}
