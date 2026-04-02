/**
 * agent-v0 web commands — start/stop the web dashboard.
 */

import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';

export function registerWebCommands(program: Command): void {
  const web = program.command('web').description('Web dashboard management');

  web.command('start')
    .description('Start the local web dashboard (HTTPS)')
    .option('-p, --port <port>', 'Port to run the dashboard on', '3000')
    .action(async (opts) => {
      const scriptDir = path.dirname(new URL(import.meta.url).pathname);
      // dist/cli/commands/ -> dist/web/server.js
      const serverPath = path.resolve(scriptDir, '..', '..', 'web', 'server.js');

      console.log(`\n  \x1b[36m[*]\x1b[0m Starting Agent v0 Web Dashboard...`);

      const child = spawn('node', [serverPath], {
        stdio: 'inherit',
        env: { ...process.env, PORT: opts.port },
      });

      child.on('error', (err) => {
        console.error(`\n  \x1b[31m[x]\x1b[0m Failed to start web server: ${err.message}`);
      });

      child.on('spawn', () => {
        console.log(`  \x1b[32m[+]\x1b[0m Dashboard available at: \x1b[1mhttps://localhost:${opts.port}\x1b[0m`);
        console.log(`  \x1b[2m      Press Ctrl+C to stop the web server\x1b[0m\n`);
      });

      // Forward Ctrl+C to child
      process.on('SIGINT', () => {
        child.kill('SIGTERM');
        process.exit(0);
      });

      // Keep parent alive while child runs
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
      });
    });
}
