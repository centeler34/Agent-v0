#!/usr/bin/env node
/**
 * Cyplex CLI — Thin client that connects to the daemon Unix socket.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { registerDaemonCommands } from './commands/daemon_cmd.js';
import { registerAgentCommands } from './commands/agent_cmd.js';
import { registerTaskCommands } from './commands/task_cmd.js';
import { registerSessionCommands } from './commands/session_cmd.js';
import { registerSkillCommands } from './commands/skill_cmd.js';
import { registerConfigCommands } from './commands/config_cmd.js';
import { registerAuditCommands } from './commands/audit_cmd.js';
import { registerBotCommands } from './commands/bot_cmd.js';
import { registerKeysCommands } from './commands/keys_cmd.js';
import { registerModelCommands } from './commands/model_cmd.js';
import { isFirstRun, runSetupWizard } from './setup_wizard.js';
import { runUpdate } from './updater.js';
import { runUninstall } from './uninstaller.js';

function loadEnvFile(): void {
  const envPath = path.join(process.env.HOME || '~', '.cyplex', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  // Load .env before anything else
  loadEnvFile();

  // Check for first-run setup
  const args = process.argv.slice(2);
  const isSetupCommand = args[0] === 'setup';

  if (isFirstRun() || isSetupCommand) {
    await runSetupWizard();
    if (isSetupCommand) return;
  }

  const program = new Command();

  program
    .name('agent-cyplex')
    .description('Agent Cyplex — Multi-agent AI orchestration CLI')
    .version('0.1.0');

  // Setup command (re-run wizard)
  program.command('setup')
    .description('Run the setup wizard to configure API keys, providers, and integrations')
    .action(async () => {
      await runSetupWizard();
    });

  // Update command
  program.command('update')
    .description('Fetch latest updates from GitHub, rebuild, and restart')
    .action(async () => {
      await runUpdate();
    });

  // Uninstall command
  program.command('uninstall')
    .description('Remove Agent Cyplex, all config, data, and system links')
    .action(async () => {
      await runUninstall();
    });

  registerDaemonCommands(program);
  registerAgentCommands(program);
  registerTaskCommands(program);
  registerSessionCommands(program);
  registerSkillCommands(program);
  registerConfigCommands(program);
  registerAuditCommands(program);
  registerBotCommands(program);
  registerKeysCommands(program);
  registerModelCommands(program);

  // Default: launch interactive REPL
  program.action(() => {
    console.log('[cyplex] Interactive REPL — type "help" for commands, Ctrl+C to exit');
    launchRepl();
  });

  program.parse();
}

main();

async function launchRepl(): Promise<void> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('[cyplex]> ', async (input: string) => {
      const trimmed = input.trim();
      if (trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        return;
      }
      if (trimmed === 'help' || trimmed === '/help') {
        console.log('Commands: daemon, agent, task, session, skill, config, audit, bot, keys, model');
        console.log('');
        console.log('  /update      — Fetch latest updates from GitHub, rebuild, and restart');
        console.log('  /setup       — Re-run the setup wizard');
        console.log('  /uninstall   — Remove Agent Cyplex completely');
        console.log('  /status      — Query daemon status');
        console.log('  exit         — Quit the REPL');
      } else if (trimmed === '/update') {
        rl.close();
        await runUpdate();
        return;
      } else if (trimmed === '/setup') {
        rl.close();
        await runSetupWizard();
        return;
      } else if (trimmed === '/uninstall') {
        rl.close();
        await runUninstall();
        return;
      } else if (trimmed === '/status' || trimmed.startsWith('\\status')) {
        console.log('Querying daemon status...');
      } else if (trimmed.length > 0) {
        console.log(`Submitting to Agentic: "${trimmed}"`);
      }
      prompt();
    });
  };
  prompt();
}
