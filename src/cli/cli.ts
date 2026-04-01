#!/usr/bin/env node
/**
 * Cyplex CLI — Interactive multi-agent AI terminal.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
import { isFirstRun, runSetupWizard } from './setup_wizard.js';
import { runUpdate } from './updater.js';
import { runUninstall } from './uninstaller.js';

// ── ANSI Color Palette ──────────────────────────────────────────────────────

const c = {
  reset:     '\x1b[0m',
  bold:      '\x1b[1m',
  dim:       '\x1b[2m',
  italic:    '\x1b[3m',
  underline: '\x1b[4m',

  black:     '\x1b[30m',
  red:       '\x1b[31m',
  green:     '\x1b[32m',
  yellow:    '\x1b[33m',
  blue:      '\x1b[34m',
  magenta:   '\x1b[35m',
  cyan:      '\x1b[36m',
  white:     '\x1b[37m',

  bgBlack:   '\x1b[40m',
  bgRed:     '\x1b[41m',
  bgGreen:   '\x1b[42m',
  bgYellow:  '\x1b[43m',
  bgBlue:    '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan:    '\x1b[46m',
  bgWhite:   '\x1b[47m',

  gray:        '\x1b[90m',
  brightRed:   '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow:'\x1b[93m',
  brightBlue:  '\x1b[94m',
  brightMagenta:'\x1b[95m',
  brightCyan:  '\x1b[96m',
  brightWhite: '\x1b[97m',

  orange:  '\x1b[38;5;208m',
  purple:  '\x1b[38;5;141m',
  teal:    '\x1b[38;5;43m',
  pink:    '\x1b[38;5;205m',
  lime:    '\x1b[38;5;154m',
  slate:   '\x1b[38;5;245m',
  darkGray:'\x1b[38;5;238m',
};

// ── Box Drawing Helpers ─────────────────────────────────────────────────────

function getTermWidth(): number {
  return process.stdout.columns || 80;
}

function box(lines: string[], borderColor: string = c.cyan): string {
  const w = Math.min(getTermWidth() - 2, 72);
  const top    = `${borderColor}╭${'─'.repeat(w - 2)}╮${c.reset}`;
  const bottom = `${borderColor}╰${'─'.repeat(w - 2)}╯${c.reset}`;
  const padded = lines.map(line => {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, w - 4 - visible.length);
    return `${borderColor}│${c.reset} ${line}${' '.repeat(pad)} ${borderColor}│${c.reset}`;
  });
  return [top, ...padded, bottom].join('\n');
}

function divider(char: string = '─', color: string = c.darkGray): string {
  return `${color}${char.repeat(Math.min(getTermWidth() - 2, 72))}${c.reset}`;
}

// ── Fancy Banner ────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log('');
  console.log(`  ${c.brightCyan}${c.bold}  ██████╗██╗   ██╗██████╗ ██╗     ███████╗██╗  ██╗${c.reset}`);
  console.log(`  ${c.brightCyan}${c.bold} ██╔════╝╚██╗ ██╔╝██╔══██╗██║     ██╔════╝╚██╗██╔╝${c.reset}`);
  console.log(`  ${c.cyan}${c.bold} ██║      ╚████╔╝ ██████╔╝██║     █████╗   ╚███╔╝${c.reset}`);
  console.log(`  ${c.blue}${c.bold} ██║       ╚██╔╝  ██╔═══╝ ██║     ██╔══╝   ██╔██╗${c.reset}`);
  console.log(`  ${c.blue}${c.bold} ╚██████╗   ██║   ██║     ███████╗███████╗██╔╝ ██╗${c.reset}`);
  console.log(`  ${c.brightBlue}${c.bold}  ╚═════╝   ╚═╝   ╚═╝     ╚══════╝╚══════╝╚═╝  ╚═╝${c.reset}`);
  console.log('');
  console.log(`  ${c.bold}${c.white}  Agent Cyplex${c.reset}  ${c.dim}v0.2.0${c.reset}`);
  console.log(`  ${c.dim}  Multi-Agent AI Orchestration Terminal${c.reset}`);
  console.log(`  ${c.dim}  Security Research Edition${c.reset}`);
  console.log('');
}

// ── System Info Bar ─────────────────────────────────────────────────────────

function printSystemInfo(): void {
  const user = os.userInfo().username;
  const hostname = os.hostname();
  const platform = `${os.type()} ${os.arch()}`;
  const mem = `${Math.round(os.freemem() / 1024 / 1024)}MB free`;

  const providers: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push('Anthropic');
  if (process.env.OPENAI_API_KEY) providers.push('OpenAI');
  if (process.env.GOOGLE_AI_API_KEY) providers.push('Gemini');

  const aiStatus = providers.length > 0
    ? `${c.green}●${c.reset} ${c.white}${providers.join(', ')}${c.reset}`
    : `${c.red}●${c.reset} ${c.dim}no providers configured${c.reset}`;

  console.log(box([
    `${c.teal}${c.bold}System${c.reset}      ${c.white}${user}@${hostname}${c.reset}  ${c.dim}│${c.reset}  ${c.slate}${platform}${c.reset}  ${c.dim}│${c.reset}  ${c.slate}${mem}${c.reset}`,
    `${c.teal}${c.bold}Providers${c.reset}   ${aiStatus}`,
    `${c.teal}${c.bold}Session${c.reset}     ${c.dim}${new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${c.reset}`,
  ], c.darkGray));
  console.log('');
}

// ── Help Screen ─────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log('');
  console.log(`  ${c.bold}${c.brightCyan}COMMANDS${c.reset}`);
  console.log(divider());
  console.log('');

  const cmds: [string, string][] = [
    ['/help',      'Show this help screen'],
    ['/setup',     'Re-run the setup wizard'],
    ['/update',    'Fetch latest from GitHub & rebuild'],
    ['/uninstall', 'Remove Agent Cyplex completely'],
    ['/status',    'Query daemon health & status'],
    ['/clear',     'Clear session context'],
    ['exit',       'Quit the terminal'],
  ];

  for (const [cmd, desc] of cmds) {
    console.log(`    ${c.cyan}${cmd.padEnd(14)}${c.reset}${c.white}${desc}${c.reset}`);
  }

  console.log('');
  console.log(`  ${c.bold}${c.brightCyan}AGENTS${c.reset}`);
  console.log(divider());
  console.log('');

  const agents: [string, string, string][] = [
    ['recon',      '  Reconnaissance & OSINT gathering', c.green],
    ['code',       '  Code analysis, generation & review', c.blue],
    ['exploit',    '  Vulnerability research & PoC dev', c.red],
    ['forensics',  '  Digital forensics & incident response', c.magenta],
    ['report',     '  Report generation & documentation', c.yellow],
    ['monitor',    '  Continuous monitoring & alerting', c.cyan],
    ['threat',     '  Threat intelligence analysis', c.orange],
    ['osint',      '  Open-source intelligence analyst', c.teal],
    ['scribe',     '  Session logging & transcription', c.purple],
  ];

  for (const [name, desc, color] of agents) {
    console.log(`    ${color}●${c.reset} ${c.white}${name.padEnd(12)}${c.reset}${c.dim}${desc}${c.reset}`);
  }

  console.log('');
  console.log(`  ${c.bold}${c.brightCyan}CLI MODULES${c.reset}`);
  console.log(divider());
  console.log('');

  const mods: [string, string][] = [
    ['daemon',  'Background process management'],
    ['agent',   'Agent listing & control'],
    ['task',    'Task submission & tracking'],
    ['session', 'Session management'],
    ['skill',   'Skill registry & execution'],
    ['config',  'Configuration management'],
    ['audit',   'Security audit logs'],
    ['bot',     'Chat bot integrations'],
    ['keys',    'Encrypted keystore management'],
  ];

  for (const [mod, desc] of mods) {
    console.log(`    ${c.slate}${mod.padEnd(12)}${c.reset}${c.dim}${desc}${c.reset}`);
  }

  console.log('');
  console.log(`  ${c.dim}Use commands above for specific tasks. Submit tasks via the daemon.${c.reset}`);
  console.log('');
}

// ── Env Loader ──────────────────────────────────────────────────────────────

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

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile();

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
    .version('0.2.0');

  program.command('setup')
    .description('Run the setup wizard to configure API keys, providers, and integrations')
    .action(async () => { await runSetupWizard(); });

  program.command('update')
    .description('Fetch latest updates from GitHub, rebuild, and restart')
    .action(async () => { await runUpdate(); });

  program.command('uninstall')
    .description('Remove Agent Cyplex, all config, data, and system links')
    .action(async () => { await runUninstall(); });

  registerDaemonCommands(program);
  registerAgentCommands(program);
  registerTaskCommands(program);
  registerSessionCommands(program);
  registerSkillCommands(program);
  registerConfigCommands(program);
  registerAuditCommands(program);
  registerBotCommands(program);
  registerKeysCommands(program);

  program.action(() => { launchRepl(); });

  program.parse();
}

main();

// ── Interactive REPL ────────────────────────────────────────────────────────

async function launchRepl(): Promise<void> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // ── Welcome Screen
  console.clear();
  printBanner();
  printSystemInfo();

  console.log(`  ${c.dim}Type ${c.white}/help${c.dim} for commands.${c.reset}`);
  console.log('');
  console.log(divider('─', c.darkGray));
  console.log('');

  // ── Prompt Loop
  const promptStr = `  ${c.brightCyan}${c.bold}cyplex${c.reset}${c.darkGray} ❯${c.reset} `;

  const showPrompt = () => {
    rl.question(promptStr, async (input: string) => {
      const trimmed = input.trim();

      if (!trimmed) {
        showPrompt();
        return;
      }

      // Exit
      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('');
        console.log(`  ${c.dim}Session ended. Goodbye.${c.reset}`);
        console.log('');
        rl.close();
        return;
      }

      // Commands
      if (trimmed === 'help' || trimmed === '/help') {
        printHelp();
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
        console.clear();
        printBanner();
        printSystemInfo();
        console.log(`  ${c.green}✓${c.reset} ${c.dim}Session cleared.${c.reset}`);
        console.log('');
        console.log(divider('─', c.darkGray));
        console.log('');
      } else if (trimmed === '/status') {
        const providers: string[] = [];
        if (process.env.ANTHROPIC_API_KEY) providers.push('Anthropic');
        if (process.env.OPENAI_API_KEY) providers.push('OpenAI');
        if (process.env.GOOGLE_AI_API_KEY) providers.push('Gemini');

        console.log('');
        console.log(box([
          `${c.bold}Daemon${c.reset}      ${c.yellow}●${c.reset} ${c.dim}checking...${c.reset}`,
          `${c.bold}Providers${c.reset}   ${providers.length > 0 ? `${c.green}●${c.reset} ${providers.join(', ')}` : `${c.red}●${c.reset} none configured`}`,
        ], c.darkGray));
        console.log('');
      } else {
        console.log(`\n  ${c.dim}Submit tasks via the daemon or use ${c.white}/help${c.dim} for available commands.${c.reset}\n`);
      }

      showPrompt();
    });
  };

  showPrompt();
}
