/**
 * `cyplex session` subcommands.
 */

import crypto from 'node:crypto'; // Added for crypto.randomUUID()
import type { Command } from 'commander';
import { sendIpcMessage } from '../ipc_client.js';

export function registerSessionCommands(program: Command): void {
  const session = program.command('session').description('Manage sessions');

  session.command('new').description('Create a new session')
    .option('--name <name>', 'Session name')
    .option('--scope <file>', 'Path to scope YAML file')
    .action(async (opts) => {
      const name = opts.name || `session-${Date.now()}`;
      const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'session_new', payload: { name, scope: opts.scope } });
      if (res) console.log('Session created:', JSON.stringify(res.payload, null, 2));
    });

  session.command('list').description('List all sessions').action(async () => {
    const res = await sendIpcMessage({ id: crypto.randomUUID(), type: 'session_list', payload: {} });
    if (res) console.log(JSON.stringify(res.payload, null, 2));
  });

  session.command('attach <session-id>').description('Attach to a session').action(async (sessionId) => {
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'session_attach', payload: { session_id: sessionId } });
    console.log(`Attached to session: ${sessionId}`);
  });

  session.command('detach').description('Detach from current session').action(async () => {
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'session_detach', payload: {} });
    console.log('Detached from session');
  });

  session.command('resume <session-id>').description('Resume a session').action(async (sessionId) => {
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'session_attach', payload: { session_id: sessionId } });
    console.log(`Resumed session: ${sessionId}`);
  });

  session.command('archive <session-id>').description('Archive a session').action(async (sessionId) => {
    await sendIpcMessage({ id: crypto.randomUUID(), type: 'session_archive', payload: { session_id: sessionId } });
    console.log(`Archived session: ${sessionId}`);
  });

  session.command('export <session-id>').description('Export a session')
    .option('--format <fmt>', 'Export format (zip/tar)', 'zip')
    .action(async (sessionId, opts) => {
      console.log(`Exporting session ${sessionId} as ${opts.format}...`);
    });
}
