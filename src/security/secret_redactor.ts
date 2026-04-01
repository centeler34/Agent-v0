/**
 * Strip secrets from any object before logging.
 */

const SECRET_KEY_PATTERNS = [
  /key/i,
  /token/i,
  /secret/i,
  /password/i,
  /pass(phrase|wd)?/i,
  /credential/i,
  /auth/i,
  /bearer/i,
  /api.?key/i,
];

const REDACTED = '[REDACTED]';

/**
 * Recursively walk an object and replace values for keys that match secret patterns.
 * Mutates the input object in place.
 */
export function redactSecrets(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (isSecretKey(key)) {
      obj[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      redactSecrets(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === 'object' && value[i] !== null) {
          redactSecrets(value[i] as Record<string, unknown>);
        }
      }
    } else if (typeof value === 'string' && looksLikeSecret(value)) {
      obj[key] = REDACTED;
    }
  }
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}

function looksLikeSecret(value: string): boolean {
  // Detect common API key / token patterns
  if (value.startsWith('sk-') && value.length > 20) return true;
  if (value.startsWith('sk-ant-') && value.length > 20) return true;
  if (value.startsWith('AIza') && value.length > 30) return true;
  if (value.startsWith('xoxb-') || value.startsWith('xoxp-')) return true;
  if (/^[A-Za-z0-9]{32,}$/.test(value)) return true;
  return false;
}
