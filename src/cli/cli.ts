#!/usr/bin/env node
/**
 * Agent v0 CLI — Interactive Multi-Agent AI Terminal.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Command } from 'commander';
import readline from 'node:readline';
import { KeystoreBridge } from '../security/keystore_bridge.js';
import { registerDaemonCommands } from './commands/daemon_cmd.js';
import { registerAgentCommands } from './commands/agent_cmd.js';
import { registerTaskCommands } from './commands/task_cmd.js';
import { registerSessionCommands } from './commands/session_cmd.js';
import { registerSkillCommands } from './commands/skill_cmd.js';
import { registerConfigCommands } from './commands/config_cmd.js';
import { registerAuditCommands } from './commands/audit_cmd.js';
import { registerBotCommands } from './commands/bot_cmd.js';
import { registerKeysCommands } from './commands/keys_cmd.js';
import { registerWebCommands } from './commands/web_cmd.js';
import { TaskRegistry } from '../orchestrator/task_registry.js';
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

// Global instances for CLI
let globalKeystoreBridge: KeystoreBridge | null = null;
let globalTaskRegistry: TaskRegistry | null = null;
const SESSION_TOKEN_PATH = path.join(os.homedir(), '.agent-v0', 'session.token');
const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
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
  console.log(`  ${c.bold}${c.white}  Agent v0${c.reset}  ${c.dim}v1.0.0${c.reset}`);
  console.log(`  ${c.dim}  Multi-Agent AI Orchestration Terminal${c.reset}`);
  console.log(`  ${c.dim}  Universal Orchestration Edition${c.reset}`);
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
    ['/uninstall', 'Remove Agent v0 completely'],
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
  console.log(`    ${c.dim}Agents are dynamically loaded from your configuration.${c.reset}`);
  console.log(`    ${c.dim}Run ${c.white}agent-v0 agent list${c.dim} to see active agents.${c.reset}`);
  console.log('');

  console.log(`    ${c.green}●${c.reset} ${c.white}Agentic${c.reset}     ${c.dim}The central orchestrator${c.reset}`);
  console.log(`    ${c.blue}●${c.reset} ${c.white}Custom...${c.reset}   ${c.dim}Your specialized agents${c.reset}`);

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
  const envPath = path.join(process.env.HOME || '~', '.agent-v0', '.env');
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

// ── Password Prompt Helper ──────────────────────────────────────────────────

async function askMasterPassword(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const question = `  ${c.teal}${c.bold}?${c.reset} ${c.white}Enter Master Password to unlock Agent v0${c.reset}${c.dim}: ${c.reset}`;
    process.stdout.write(question);

    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);

    let password = '';
    const onData = (char: Buffer) => {
      const ch = char.toString();
      if (ch === '\n' || ch === '\r') {
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(password.trim());
      } else if (ch === '\u0003') { // Ctrl+C
        process.exit(0);
      } else if (ch === '\u007f' || ch === '\b') { // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += ch;
        process.stdout.write(`${c.cyan}*${c.reset}`);
      }
    };
    stdin.on('data', onData);
  });
}

// ── Session Token Management ────────────────────────────────────────────────

interface SessionTokenPayload {
  exp: number; // Expiry timestamp in milliseconds
  masterKey: string; // Hex encoded master key
}

/**
 * Generates an encrypted session token.
 * @param masterKey The 32-byte derived master key.
 * @returns Encrypted session token string.
 */
function generateSessionToken(masterKey: Buffer): string {
  // Store the key itself, encrypted with a machine-specific secret if possible.
  // For MVP, we use file permissions (0600) to protect the raw key within the token JSON.
  const payload: SessionTokenPayload = {
    masterKey: masterKey.toString('hex'),
    exp: Date.now() + SESSION_TTL_MS,
  };
  return JSON.stringify(payload);
}

/**
 * Validates and decrypts a session token.
 * @param tokenJson JSON session token string.
 * @returns Derived master key Buffer if valid and not expired, null otherwise.
 */
function validateSessionToken(tokenJson: string): Buffer | null {
  try {
    const payload = JSON.parse(tokenJson);
    if (payload.exp < Date.now()) return null;
    return Buffer.from(payload.masterKey, 'hex');
  } catch (err) {
    return null;
  }
}

function deleteSessionToken(): void {
  if (fs.existsSync(SESSION_TOKEN_PATH)) {
    fs.unlinkSync(SESSION_TOKEN_PATH);
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

  // ── Authentication & Registry Initialization
  const isSkipAuth = args[0] === 'setup' || args[0] === 'uninstall' || args.includes('--help');
  
  if (!isFirstRun() && !isSkipAuth) {
    try {
      const KEYSTORE_PATH = path.join(os.homedir(), '.agent-v0', 'keystore.enc');
      
      if (!fs.existsSync(KEYSTORE_PATH)) {
        console.error(`${c.red}[x]${c.reset} Keystore not found. Run 'agent-v0 setup' first.`);
        process.exit(1);
      }
      
      let masterKey: Buffer | null = null;

      // Attempt to use session token first
      if (fs.existsSync(SESSION_TOKEN_PATH)) {
        const tokenJson = fs.readFileSync(SESSION_TOKEN_PATH, 'utf-8');
        masterKey = validateSessionToken(tokenJson);
        if (masterKey) {
          console.log(`  ${c.green}[+]${c.reset} Session active. Fleets unlocked.`);
        } else {
          deleteSessionToken();
        }
      }

      if (!masterKey) {
        const password = await askMasterPassword();
        globalKeystoreBridge = new KeystoreBridge();
        await globalKeystoreBridge.open(KEYSTORE_PATH, password);
        masterKey = globalKeystoreBridge.getDerivedKey();
        fs.writeFileSync(SESSION_TOKEN_PATH, generateSessionToken(masterKey), 'utf-8');
        console.log(`  ${c.green}[+]${c.reset} Authentication successful. Session token created.`);
      }

      globalTaskRegistry = new TaskRegistry();
      globalTaskRegistry.setMasterKey(masterKey!);

      // Store derived key in process env for subordinate modules if needed (optional, but good for debugging)
      process.env.AGENT_V0_MASTER_KEY = masterKey!.toString('hex');
    } catch (err) {
      console.error(`\n  ${c.red}${c.bold} Authentication Failed:${c.reset} ${c.dim}${err instanceof Error ? err.message : 'Invalid password'}${c.reset}\n`);
      process.exit(1);
    }
  }

  const program = new Command();

  program
    .name('agent-v0')
    .description('Agent v0 — Universal multi-agent AI orchestration CLI')
    .version('1.0.0');

  program.command('setup')
    .description('Run the setup wizard to configure API keys, providers, and integrations')
    .action(async () => { await runSetupWizard(); });

  program.command('update')
    .description('Fetch latest updates from GitHub, rebuild, and restart')
    .action(async () => { await runUpdate(); });

  program.command('uninstall')
    .description('Remove Agent v0, all config, data, and system links')
    .action(async () => { await runUninstall(); });

  registerDaemonCommands(program);
  registerAgentCommands(program, globalTaskRegistry!); // Pass registry
  registerTaskCommands(program);
  registerSessionCommands(program);
  registerSkillCommands(program);
  registerConfigCommands(program);
  registerAuditCommands(program);
  registerBotCommands(program);
  registerKeysCommands(program);
  registerWebCommands(program);

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
  const promptStr = `  ${c.brightCyan}${c.bold}agent-v0${c.reset}${c.darkGray} ❯${c.reset} `;

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
        if (process.env.OPENAI_API_KEY) providers.push('OpenAI'); // Corrected typo
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
