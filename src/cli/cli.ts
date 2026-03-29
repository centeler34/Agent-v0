#!/usr/bin/env node
/**
 * Cyplex CLI — Thin client that connects to the daemon Unix socket.
 */

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

async function main(): Promise<void> {
  // Check for first-run setup before anything else
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
      if (trimmed === 'help') {
        console.log('Commands: daemon, agent, task, session, skill, config, audit, bot, keys, model');
        console.log('Type "exit" to quit');
      } else if (trimmed.startsWith('\\status')) {
        console.log('Querying daemon status...');
      } else if (trimmed.length > 0) {
        console.log(`Submitting to Agentic: "${trimmed}"`);
      }
      prompt();
    });
  };
  prompt();
}
