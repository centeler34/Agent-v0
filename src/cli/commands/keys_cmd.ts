/**
 * `agent-v0 keys` subcommands.
 */

import type { Command } from 'commander';
import path from 'node:path';
import { TaskRegistry } from '../../orchestrator/task_registry.js';
import { KeystoreBridge } from '../../security/keystore_bridge.js'; // Still needed to open keystore.enc for master key
import os from 'node:os';
import fs from 'node:fs';

const KEYSTORE_PATH = path.join(os.homedir(), '.agent-v0', 'keystore.enc');

// Global registry instance (initialized in cli.ts)
declare const globalTaskRegistry: TaskRegistry;
declare const globalKeystoreBridge: KeystoreBridge;

export function registerKeysCommands(program: Command): void {
  const keys = program.command('keys').description('API key management');

  keys.command('set')
    .description('Set an API key in the encrypted database')
    .requiredOption('--name <name>', 'Key name')
    .option('--value <value>', 'Key value (will prompt if omitted)')
    .option('--file <path>', 'Read key from file')
    .action(async (opts) => {
      let value = opts.value;
      if (opts.file) {
        value = fs.readFileSync(opts.file, 'utf-8').trim();
      } else if (!value) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        value = await new Promise<string>((resolve) => {
          rl.question(`Enter value for "${opts.name}": `, (answer) => { rl.close(); resolve(answer); });
        });
      }

      if (!globalTaskRegistry) {
        console.error('Task registry not initialized. Please start Agent v0 normally.');
        process.exit(1);
      }

      if (!value) {
        console.error('Key value cannot be empty.');
        process.exit(1);
      }

      globalTaskRegistry.setSecret(opts.name, value);
      console.log(`API key "${opts.name}" saved to encrypted database.`);
    });

  keys.command('list').description('List stored API key names').action(async () => {
    if (!globalTaskRegistry) {
      console.error('Task registry not initialized. Please start Agent v0 normally.');
      process.exit(1);
    }
    const names = globalTaskRegistry.listSecrets();
    if (names.length > 0) {
      console.log('Stored API keys:');
      names.forEach(name => console.log(`- ${name}`));
    } else {
      console.log('No API keys stored.');
    }
  });

  keys.command('rotate')
    .description('Rotate a key')
    .requiredOption('--provider <name>', 'Key name to rotate')
    .action(async (opts) => {
      // This command would typically involve prompting for a new value and then calling setSecret
      console.log(`Rotating key: ${opts.provider} (Not yet implemented: please use 'set' to update)`);
    });

  keys.command('delete <name>').description('Delete a key').action(async (name) => {
    if (!globalTaskRegistry) {
      console.error('Task registry not initialized. Please start Agent v0 normally.');
      process.exit(1);
    }
    if (globalTaskRegistry.deleteSecret(name)) {
      console.log(`API key "${name}" deleted.`);
    } else {
      console.log(`API key "${name}" not found.`);
    }
  });
}
