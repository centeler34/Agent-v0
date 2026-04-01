/**
 * `cyplex audit` subcommands.
 */

import type { Command } from 'commander';
import path from 'node:path';
import { AuditBridge } from '../../security/audit_bridge.js';

const AUDIT_PATH = path.join(process.env.HOME || '~', '.agent-v0', 'audit', 'audit.jsonl');

export function registerAuditCommands(program: Command): void {
  const audit = program.command('audit').description('Audit log management');

  audit.command('logs').description('View recent audit entries')
    .option('-n <count>', 'Number of entries', '20')
    .action(async (opts) => {
      const bridge = new AuditBridge(AUDIT_PATH);
      const entries = bridge.export();
      const recent = entries.slice(-parseInt(opts.n, 10));
      for (const entry of recent) {
        console.log(`[${entry.timestamp}] ${entry.agent_id} ${entry.action_type} → ${entry.outcome}`);
      }
    });

  audit.command('export').description('Export audit log')
    .option('--since <date>', 'Export entries since date (ISO8601)')
    .option('--format <fmt>', 'Export format (jsonl/json)', 'jsonl')
    .action(async (opts) => {
      const bridge = new AuditBridge(AUDIT_PATH);
      const entries = bridge.export(opts.since);
      if (opts.format === 'json') {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        for (const entry of entries) {
          console.log(JSON.stringify(entry));
        }
      }
    });

  audit.command('search').description('Search audit entries')
    .option('--agent <id>', 'Filter by agent')
    .option('--action <type>', 'Filter by action type')
    .action(async (opts) => {
      const bridge = new AuditBridge(AUDIT_PATH);
      let entries = bridge.export();
      if (opts.agent) entries = entries.filter((e) => e.agent_id === opts.agent);
      if (opts.action) entries = entries.filter((e) => e.action_type === opts.action);
      for (const entry of entries) {
        console.log(`[${entry.timestamp}] ${entry.agent_id} ${entry.action_type} → ${entry.outcome}`);
      }
    });

  audit.command('verify').description('Verify audit log integrity').action(async () => {
    const bridge = new AuditBridge(AUDIT_PATH);
    const result = bridge.verifyChain();
    if (result.valid) {
      console.log(`Audit log integrity: VERIFIED (${result.entries} entries)`);
    } else {
      console.error(`Audit log integrity: FAILED — ${result.error}`);
    }
  });
}
