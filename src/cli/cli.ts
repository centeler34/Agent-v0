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
import { LocalModelAdapter } from '../gateway/local_model_adapter.js';
import type { Message } from '../types/provider_config.js';

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

function resolveModelAdapter(): LocalModelAdapter | null {
  const envPath = path.join(process.env.HOME || '~', '.cyplex', '.env');
  let provider: 'ollama' | 'lmstudio' = 'ollama';
  let baseUrl = '';
  let model = '';

  // Read from .env
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (t.startsWith('OLLAMA_BASE_URL=')) baseUrl = baseUrl || t.split('=').slice(1).join('=');
      if (t.startsWith('LMSTUDIO_BASE_URL=')) { baseUrl = t.split('=').slice(1).join('='); provider = 'lmstudio'; }
      if (t.startsWith('OLLAMA_MODEL=')) model = t.split('=').slice(1).join('=');
      if (t.startsWith('LMSTUDIO_MODEL=')) { model = t.split('=').slice(1).join('='); provider = 'lmstudio'; }
      if (t.startsWith('LOCAL_AI_PROVIDER=')) {
        const v = t.split('=').slice(1).join('=').toLowerCase();
        if (v === 'lmstudio' || v === 'ollama') provider = v;
      }
    }
  }

  // Also check env vars
  if (process.env.LMSTUDIO_BASE_URL) { baseUrl = process.env.LMSTUDIO_BASE_URL; provider = 'lmstudio'; }
  if (process.env.OLLAMA_BASE_URL && !baseUrl) { baseUrl = process.env.OLLAMA_BASE_URL; }
  if (process.env.LMSTUDIO_MODEL) { model = process.env.LMSTUDIO_MODEL; provider = 'lmstudio'; }
  if (process.env.OLLAMA_MODEL && !model) { model = process.env.OLLAMA_MODEL; }

  if (!baseUrl) {
    baseUrl = provider === 'lmstudio' ? 'http://127.0.0.1:1234' : 'http://localhost:11434';
  }
  if (!model) {
    model = provider === 'lmstudio' ? 'default' : 'llama3.3';
  }

  try {
    return new LocalModelAdapter({
      name: provider,
      type: provider,
      model,
      base_url: baseUrl,
      timeout_ms: 120000,
      max_retries: 1,
    });
  } catch {
    return null;
  }
}

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

async function launchRepl(): Promise<void> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const adapter = resolveModelAdapter();
  const chatHistory: Message[] = [];

  if (adapter) {
    console.log(`${DIM}Connected to ${adapter.provider} — model responses are live${NC}`);
  } else {
    console.log(`${RED}[!]${NC} No local AI configured. Run /setup to configure. Chat will not work.`);
  }

  const prompt = () => {
    rl.question(`${GREEN}[cyplex]>${NC} `, async (input: string) => {
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
        console.log('  /clear       — Clear chat history');
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
      } else if (trimmed === '/clear') {
        chatHistory.length = 0;
        console.log(`${DIM}Chat history cleared.${NC}`);
      } else if (trimmed === '/status' || trimmed.startsWith('\\status')) {
        console.log('Querying daemon status...');
      } else if (trimmed.length > 0) {
        if (!adapter) {
          console.log(`${RED}[!]${NC} No AI backend configured. Run /setup first.`);
          prompt();
          return;
        }

        chatHistory.push({ role: 'user', content: trimmed });

        try {
          process.stdout.write(`${CYAN}[ai]${NC} `);
          let fullResponse = '';

          for await (const chunk of adapter.stream({
            messages: chatHistory,
            system: 'You are Agent Cyplex, a multi-agent AI assistant for security researchers. Be concise and helpful.',
            max_tokens: 2048,
            temperature: 0.7,
            stream: true,
          })) {
            process.stdout.write(chunk.delta);
            fullResponse += chunk.delta;
          }

          console.log(''); // newline after streamed response
          chatHistory.push({ role: 'assistant', content: fullResponse });
        } catch (err: any) {
          console.log(`\n${RED}[error]${NC} ${err.message}`);
        }
      }
      prompt();
    });
  };
  prompt();
}
