/**
 * LSP Bridge — Multi-language syntax validation.
 * Hardened wrapper for language-specific syntax checks.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class LSPBridge {
  /**
   * Performs a syntax check using local binaries.
   * Prevents agents from suggesting broken code.
   */
  checkSyntax(language: string, code: string): { valid: boolean; errors: string[] } {
    const tempDir = path.join(os.tmpdir(), 'agent-v0-lsp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const ext = language === 'python' ? '.py' : language === 'javascript' ? '.js' : '.txt';
    const tempFile = path.join(tempDir, `check_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    
    try {
      fs.writeFileSync(tempFile, code);

      if (language === 'python') {
        execFileSync('python3', ['-m', 'py_compile', tempFile], { stdio: 'pipe' });
        return { valid: true, errors: [] };
      }
      
      if (language === 'javascript' || language === 'typescript') {
        execFileSync('node', ['--check', tempFile], { stdio: 'pipe' });
        return { valid: true, errors: [] };
      }

      return { valid: true, errors: [] };
    } catch (err: any) {
      const errorMsg = err.stderr?.toString() || err.message;
      return { valid: false, errors: [errorMsg.split('\n')[0]] };
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  }
}
