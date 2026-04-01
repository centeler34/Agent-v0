/**
 * agent-v0 web commands.
 */

import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export function registerWebCommands(program: Command): void {
  const web = program.command('web').description('Web interface management');

  web.command('start')
    .description('Start the local web dashboard')
    .option('-p, --port <port>', 'Port to run the UI on', '3000')
    .action(async (opts) => {
      const scriptDir = path.dirname(new URL(import.meta.url).pathname);
      const serverPath = path.resolve(scriptDir, '..', '..', 'web', 'server.js');

      console.log(`\n  \x1b[36m[*]\x1b[0m Starting Agent v0 Web UI...`);
      
      const child = spawn('node', [serverPath, '--port', opts.port], {
        stdio: 'inherit',
        env: { ...process.env, PORT: opts.port }
      });

      child.on('error', (err) => {
        console.error(`\n  \x1b[31m[x]\x1b[0m Failed to start web server: ${err.message}`);
      });

      console.log(`  \x1b[32m[+]\x1b[0m Dashboard available at: \x1b[1mhttp://localhost:${opts.port}\x1b[0m`);
      console.log(`  \x1b[2m      Press Ctrl+C to stop the web server\x1b[0m\n`);
    });
}
