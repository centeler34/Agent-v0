/**
 * Agent Cyplex — First-Run Setup Wizard
 * Interactive terminal setup that runs on first launch.
 * Configures API keys, local AI backends, bot tokens, and daemon settings.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { KeystoreBridge } from '../security/keystore_bridge.js';

const HOME = process.env.HOME || process.env.USERPROFILE || '~';
const CYPLEX_DIR = path.join(HOME, '.cyplex');
const CONFIG_PATH = path.join(CYPLEX_DIR, 'config.yaml');
const KEYSTORE_PATH = path.join(CYPLEX_DIR, 'keystore.enc');
const SETUP_MARKER = path.join(CYPLEX_DIR, '.setup-complete');
const ENV_PATH = path.join(CYPLEX_DIR, '.env');

// ── Terminal helpers ──────────────────────────────────────────────────────

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

function banner(): void {
  console.log(`${CYAN}`);
  console.log(`  ___                    _      ____            _           `);
  console.log(` / _ \\  __ _  ___ _ __ | |_   / ___|_   _ _ __| | _____  __`);
  console.log(`| |_| |/ _\` |/ _ \\ '_ \\| __| | |   | | | | '_ \\ |/ _ \\ \\/ /`);
  console.log(`| | | | (_| |  __/ | | | |_  | |___| |_| | |_) | |  __/>  < `);
  console.log(`|_| |_|\\__, |\\___|_| |_|\\__|  \\____|\\__, | .__/|_|\\___/_/\\_\\`);
  console.log(`       |___/                         |___/|_|               `);
  console.log(`${NC}`);
  console.log(`${BOLD}  Multi-Agent AI Orchestration Terminal${NC}`);
  console.log(`${DIM}  v0.1.0 — Security Research Edition${NC}`);
  console.log('');
}

function header(text: string): void {
  console.log('');
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log(`${BOLD}  ${text}${NC}`);
  console.log(`${CYAN}${'─'.repeat(60)}${NC}`);
  console.log('');
}

function info(text: string): void {
  console.log(`  ${CYAN}[*]${NC} ${text}`);
}

function success(text: string): void {
  console.log(`  ${GREEN}[+]${NC} ${text}`);
}

function warn(text: string): void {
  console.log(`  ${YELLOW}[!]${NC} ${text}`);
}

function error(text: string): void {
  console.log(`  ${RED}[x]${NC} ${text}`);
}

// ── Input helpers ─────────────────────────────────────────────────────────

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function ask(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` ${DIM}[${defaultVal}]${NC}` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function askSecret(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`  ${question}: `);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let input = '';
    const onData = (char: Buffer) => {
      const c = char.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (c === '\u007f' || c === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(0);
      } else {
        input += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

async function askYesNo(rl: readline.Interface, question: string, defaultVal: boolean = false): Promise<boolean> {
  const hint = defaultVal ? 'Y/n' : 'y/N';
  const answer = await ask(rl, `${question} (${hint})`);
  if (answer === '') return defaultVal;
  return answer.toLowerCase().startsWith('y');
}

async function askChoice(rl: readline.Interface, question: string, options: string[], defaultIdx: number = 0): Promise<number> {
  console.log(`  ${question}`);
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? `${GREEN}>${NC}` : ' ';
    console.log(`    ${marker} ${i + 1}) ${options[i]}`);
  }
  const answer = await ask(rl, `  Choice`, String(defaultIdx + 1));
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) return idx;
  return defaultIdx;
}

// ── Setup Steps ───────────────────────────────────────────────────────────

interface SetupConfig {
  masterPassword: string;
  defaultProvider: string;
  fallbackProvider: string;
  keys: Record<string, string>;
  ollamaUrl: string;
  ollamaModel: string;
  lmstudioUrl: string;
  lmstudioModel: string;
  useLocalAi: boolean;
  enableTelegram: boolean;
  telegramToken: string;
  enableDiscord: boolean;
  discordToken: string;
  enableWhatsapp: boolean;
  daemonLogLevel: string;
  socketPath: string;
}

async function stepWelcome(rl: readline.Interface): Promise<void> {
  console.log(`  Welcome to ${BOLD}Agent Cyplex${NC} — your multi-agent AI orchestration terminal.`);
  console.log('');
  console.log('  This wizard will help you configure:');
  console.log('');
  console.log(`    ${CYAN}1.${NC} Master password for encrypted keystore`);
  console.log(`    ${CYAN}2.${NC} AI provider API keys (Anthropic, OpenAI, Gemini)`);
  console.log(`    ${CYAN}3.${NC} Local AI backends (Ollama, LM Studio)`);
  console.log(`    ${CYAN}4.${NC} Bot integrations (Telegram, Discord, WhatsApp)`);
  console.log(`    ${CYAN}5.${NC} Daemon & security settings`);
  console.log('');
  console.log(`  ${DIM}You can re-run this wizard anytime with: agent-cyplex setup${NC}`);
  console.log('');
  await ask(rl, `Press ${BOLD}Enter${NC} to continue`);
}

async function stepMasterPassword(rl: readline.Interface): Promise<string> {
  header('Step 1: Master Password');
  console.log(`  Your master password encrypts all API keys and secrets.`);
  console.log(`  ${YELLOW}Choose a strong password — it cannot be recovered if lost.${NC}`);
  console.log('');

  let password = '';
  while (true) {
    password = await askSecret(rl, 'Enter master password');
    if (password.length < 8) {
      error('Password must be at least 8 characters');
      continue;
    }
    const confirm = await askSecret(rl, 'Confirm master password');
    if (password !== confirm) {
      error('Passwords do not match');
      continue;
    }
    break;
  }
  success('Master password set');
  return password;
}

async function stepCloudProviders(rl: readline.Interface): Promise<{ keys: Record<string, string>; defaultProvider: string; fallbackProvider: string }> {
  header('Step 2: Cloud AI Providers');
  console.log('  Configure API keys for cloud AI providers.');
  console.log(`  ${DIM}Press Enter to skip any provider you don't want to use.${NC}`);
  console.log('');

  const keys: Record<string, string> = {};

  // Anthropic
  console.log(`  ${BOLD}Anthropic (Claude)${NC}`);
  const anthropicKey = await askSecret(rl, 'API key (sk-ant-...)');
  if (anthropicKey) {
    keys['anthropic_api_key'] = anthropicKey;
    success('Anthropic API key saved');
  } else {
    warn('Anthropic skipped');
  }
  console.log('');

  // OpenAI
  console.log(`  ${BOLD}OpenAI (GPT)${NC}`);
  const openaiKey = await askSecret(rl, 'API key (sk-...)');
  if (openaiKey) {
    keys['openai_api_key'] = openaiKey;
    success('OpenAI API key saved');
  } else {
    warn('OpenAI skipped');
  }
  console.log('');

  // Gemini
  console.log(`  ${BOLD}Google Gemini${NC}`);
  const geminiKey = await askSecret(rl, 'API key (AI...)');
  if (geminiKey) {
    keys['google_ai_api_key'] = geminiKey;
    success('Gemini API key saved');
  } else {
    warn('Gemini skipped');
  }
  console.log('');

  // Default provider selection
  const configured = [];
  if (keys['anthropic_api_key']) configured.push('anthropic');
  if (keys['openai_api_key']) configured.push('openai');
  if (keys['google_ai_api_key']) configured.push('gemini');

  let defaultProvider = 'anthropic';
  let fallbackProvider = 'openai';

  if (configured.length > 0) {
    const defaultIdx = await askChoice(rl, 'Select default AI provider:', configured, 0);
    defaultProvider = configured[defaultIdx];

    const remaining = configured.filter((_, i) => i !== defaultIdx);
    if (remaining.length > 0) {
      const fbIdx = await askChoice(rl, 'Select fallback provider:', remaining, 0);
      fallbackProvider = remaining[fbIdx];
    }
  } else {
    warn('No cloud providers configured — you can use local AI or add keys later');
  }

  return { keys, defaultProvider, fallbackProvider };
}

async function fetchModels(baseUrl: string, provider: 'ollama' | 'lmstudio'): Promise<string[]> {
  try {
    const base = baseUrl.replace(/\/+$/, '');
    // Ollama: GET /api/tags → { models: [{ name }] }
    // LM Studio: GET /v1/models → { data: [{ id }] }
    const url = provider === 'ollama'
      ? `${base}/api/tags`
      : `${base}/v1/models`;

    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];

    const data: any = await res.json();
    const models: string[] = [];

    if (provider === 'ollama' && data.models) {
      for (const m of data.models) models.push(m.name || m.model);
    } else if (data.data) {
      for (const m of data.data) models.push(m.id || m.model);
    }

    return models;
  } catch {
    return [];
  }
}

async function stepLocalAi(rl: readline.Interface): Promise<{ useLocalAi: boolean; ollamaUrl: string; ollamaModel: string; lmstudioUrl: string; lmstudioModel: string }> {
  header('Step 3: Local AI Backends');
  console.log('  Run AI models locally with Ollama or LM Studio.');
  console.log(`  ${DIM}No API keys needed — completely offline.${NC}`);
  console.log('');

  const useLocalAi = await askYesNo(rl, 'Configure local AI backends?', true);
  if (!useLocalAi) {
    return { useLocalAi: false, ollamaUrl: '', ollamaModel: '', lmstudioUrl: '', lmstudioModel: '' };
  }

  // ── Ollama ──
  console.log('');
  console.log(`  ${BOLD}Ollama${NC}`);
  const ollamaUrl = await ask(rl, 'Ollama endpoint URL', 'http://localhost:11434');
  let ollamaModel = '';

  if (ollamaUrl) {
    info('Connecting to Ollama...');
    const ollamaModels = await fetchModels(ollamaUrl, 'ollama');
    if (ollamaModels.length > 0) {
      success(`Found ${ollamaModels.length} model(s):`);
      const idx = await askChoice(rl, 'Select default model:', ollamaModels, 0);
      ollamaModel = ollamaModels[idx];
      success(`Ollama: ${ollamaUrl} → ${BOLD}${ollamaModel}${NC}`);
    } else {
      warn('Could not connect or no models loaded. You can type a model name manually.');
      ollamaModel = await ask(rl, 'Ollama model name', 'llama3.3');
    }
  }

  // ── LM Studio ──
  console.log('');
  console.log(`  ${BOLD}LM Studio${NC}`);
  const lmstudioUrl = await ask(rl, 'LM Studio endpoint URL', 'http://127.0.0.1:1234');
  let lmstudioModel = '';

  if (lmstudioUrl) {
    info('Connecting to LM Studio...');
    const lmModels = await fetchModels(lmstudioUrl, 'lmstudio');
    if (lmModels.length > 0) {
      success(`Found ${lmModels.length} model(s):`);
      const idx = await askChoice(rl, 'Select default model:', lmModels, 0);
      lmstudioModel = lmModels[idx];
      success(`LM Studio: ${lmstudioUrl} → ${BOLD}${lmstudioModel}${NC}`);
    } else {
      warn('Could not connect or no models loaded. Make sure LM Studio server is running.');
      warn('You can type a model name manually or re-run setup later.');
      lmstudioModel = await ask(rl, 'LM Studio model name (or press Enter to skip)', '');
    }
  }

  return { useLocalAi, ollamaUrl, ollamaModel, lmstudioUrl, lmstudioModel };
}

async function stepBots(rl: readline.Interface): Promise<{ enableTelegram: boolean; telegramToken: string; enableDiscord: boolean; discordToken: string; enableWhatsapp: boolean; botKeys: Record<string, string> }> {
  header('Step 4: Bot Integrations');
  console.log('  Receive tasks from chat platforms.');
  console.log(`  ${DIM}Press Enter to skip any integration.${NC}`);
  console.log('');

  const botKeys: Record<string, string> = {};

  // Telegram
  const enableTelegram = await askYesNo(rl, 'Enable Telegram bot?', false);
  let telegramToken = '';
  if (enableTelegram) {
    telegramToken = await askSecret(rl, 'Telegram bot token');
    if (telegramToken) {
      botKeys['telegram_bot_token'] = telegramToken;
      success('Telegram configured');
    }
  }
  console.log('');

  // Discord
  const enableDiscord = await askYesNo(rl, 'Enable Discord bot?', false);
  let discordToken = '';
  if (enableDiscord) {
    discordToken = await askSecret(rl, 'Discord bot token');
    if (discordToken) {
      botKeys['discord_bot_token'] = discordToken;
      success('Discord configured');
    }
  }
  console.log('');

  // WhatsApp
  const enableWhatsapp = await askYesNo(rl, 'Enable WhatsApp bot?', false);
  if (enableWhatsapp) {
    info('WhatsApp uses QR-code pairing — will be configured on first bot start');
  }

  return { enableTelegram, telegramToken, enableDiscord, discordToken, enableWhatsapp, botKeys };
}

async function stepDaemon(rl: readline.Interface): Promise<{ logLevel: string; socketPath: string }> {
  header('Step 5: Daemon & Security Settings');
  console.log('  Configure the background daemon.');
  console.log('');

  const logIdx = await askChoice(rl, 'Log level:', ['debug', 'info', 'warn', 'error'], 1);
  const logLevel = ['debug', 'info', 'warn', 'error'][logIdx];
  console.log('');

  const socketPath = await ask(rl, 'Daemon socket path', '/tmp/cyplex.sock');
  console.log('');

  return { logLevel, socketPath };
}

// ── Config Generation ─────────────────────────────────────────────────────

function generateConfig(cfg: SetupConfig): string {
  return `cyplex:
  version: "1.0"

  daemon:
    socket_path: "${cfg.socketPath}"
    pid_file: "/tmp/cyplex.pid"
    heartbeat_interval_ms: 5000
    log_level: "${cfg.daemonLogLevel}"
    log_path: "~/.cyplex/logs/"

  sessions:
    default_workspace_root: "~/.cyplex/workspaces/"
    auto_archive_after_days: 90

  gateway:
    default_provider: "${cfg.defaultProvider}"
    fallback_provider: "${cfg.fallbackProvider}"
    timeout_ms: 30000
    max_retries: 3
    providers:
${cfg.keys['anthropic_api_key'] ? `      anthropic:
        model: "claude-sonnet-4-6"
        key_ref: "anthropic_api_key"` : `      # anthropic:
      #   model: "claude-sonnet-4-6"
      #   key_ref: "anthropic_api_key"`}
${cfg.keys['openai_api_key'] ? `      openai:
        model: "gpt-4o"
        key_ref: "openai_api_key"` : `      # openai:
      #   model: "gpt-4o"
      #   key_ref: "openai_api_key"`}
${cfg.keys['google_ai_api_key'] ? `      gemini:
        model: "gemini-pro"
        key_ref: "google_ai_api_key"` : `      # gemini:
      #   model: "gemini-pro"
      #   key_ref: "google_ai_api_key"`}
${cfg.useLocalAi ? `      ollama_local:
        type: ollama
        base_url: "${cfg.ollamaUrl}"
        model: "${cfg.ollamaModel}"
      lmstudio_local:
        type: lmstudio
        base_url: "${cfg.lmstudioUrl}"
        model: "${cfg.lmstudioModel}"` : `      # ollama_local:
      #   type: ollama
      #   base_url: "http://localhost:11434"
      #   model: "llama3.3"
      # lmstudio_local:
      #   type: lmstudio
      #   base_url: "http://127.0.0.1:1234"
      #   model: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF"`}

  agents:
    agentic:
      enabled: true
      model_override: "${cfg.defaultProvider === 'anthropic' ? 'anthropic/claude-opus-4-6' : cfg.defaultProvider === 'openai' ? 'openai/gpt-4o' : cfg.defaultProvider + '/default'}"
      max_concurrent_delegations: 10
    recon:
      enabled: true
      workspace: "workspaces/recon/"
      skills: [recon.subdomain_enum, recon.dns_sweep, recon.tech_fingerprint]
      permissions:
        network.allow: ["*.shodan.io", "crt.sh", "*.censys.io", "dns.google", "web.archive.org"]
        fs.write: ["workspaces/recon/"]
        fs.execute: false
    code:
      enabled: true
      workspace: "workspaces/code/"
      permissions:
        fs.execute: true
        execute.allowed_binaries: ["/usr/bin/python3", "/usr/local/bin/node"]
        network.allow: []
    exploit_research:
      enabled: true
      workspace: "workspaces/exploit_research/"
      permissions:
        network.allow: ["nvd.nist.gov", "cve.mitre.org"]
        fs.execute: false
    report:
      enabled: true
      workspace: "workspaces/reports/"
      permissions:
        fs.write: ["workspaces/reports/"]
        network.allow: []
        fs.execute: false
    monitor:
      enabled: true
      workspace: "workspaces/monitor/"
    osint_analyst:
      enabled: true
      workspace: "workspaces/osint/"
    threat_intel:
      enabled: true
      workspace: "workspaces/threat_intel/"
    forensics:
      enabled: true
      workspace: "workspaces/forensics/"
    scribe:
      enabled: true
      workspace: "workspaces/scribe/"

  bots:
    telegram:
      enabled: ${cfg.enableTelegram}
      token_key_ref: "telegram_bot_token"
      allowlist: []
    discord:
      enabled: ${cfg.enableDiscord}
      token_key_ref: "discord_bot_token"
    whatsapp:
      enabled: ${cfg.enableWhatsapp}

  security:
    audit_log_path: "~/.cyplex/audit/audit.jsonl"
    keystore_path: "~/.cyplex/keystore.enc"
    kdf: "argon2id"
    session_token_ttl_hours: 24
    skill_signature_verification: true

  rate_limits:
    global_tokens_per_minute: 500000
    per_agent_tokens_per_minute: 100000
    bot_messages_per_user_per_minute: 20
`;
}

function generateEnvFile(cfg: SetupConfig): string {
  return `# ============================================================================
# Agent Cyplex — Environment Configuration
# Auto-generated by setup wizard. Do not commit to version control.
# ============================================================================

# ── Cloud AI Provider API Keys ─────────────────────────────────────────────
ANTHROPIC_API_KEY=${cfg.keys['anthropic_api_key'] || ''}
OPENAI_API_KEY=${cfg.keys['openai_api_key'] || ''}
GOOGLE_AI_API_KEY=${cfg.keys['google_ai_api_key'] || ''}

# ── Local AI Backend ───────────────────────────────────────────────────────
LOCAL_AI_PROVIDER=${cfg.useLocalAi ? (cfg.lmstudioModel ? 'lmstudio' : 'ollama') : ''}
OLLAMA_BASE_URL=${cfg.ollamaUrl || 'http://localhost:11434'}
OLLAMA_MODEL=${cfg.ollamaModel || ''}
LMSTUDIO_BASE_URL=${cfg.lmstudioUrl || 'http://127.0.0.1:1234'}
LMSTUDIO_MODEL=${cfg.lmstudioModel || ''}

# ── Bot Tokens ─────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=${cfg.keys['telegram_bot_token'] || ''}
DISCORD_BOT_TOKEN=${cfg.keys['discord_bot_token'] || ''}

# ── Daemon Settings ────────────────────────────────────────────────────────
CYPLEX_SOCKET_PATH=${cfg.socketPath}
CYPLEX_LOG_LEVEL=${cfg.daemonLogLevel}
`;
}

// ── Main Setup Flow ───────────────────────────────────────────────────────

export function isFirstRun(): boolean {
  return !fs.existsSync(SETUP_MARKER);
}

export async function runSetupWizard(): Promise<void> {
  const rl = createRl();

  try {
    banner();
    await stepWelcome(rl);

    // Step 1: Master password
    const masterPassword = await stepMasterPassword(rl);

    // Step 2: Cloud providers
    const { keys: cloudKeys, defaultProvider, fallbackProvider } = await stepCloudProviders(rl);

    // Step 3: Local AI
    const localAi = await stepLocalAi(rl);

    // Step 4: Bots
    const bots = await stepBots(rl);

    // Step 5: Daemon settings
    const daemon = await stepDaemon(rl);

    // ── Write everything ─────────────────────────────────────────────────

    header('Finalizing Setup');

    // Create directories
    const dirs = [
      CYPLEX_DIR,
      path.join(CYPLEX_DIR, 'logs'),
      path.join(CYPLEX_DIR, 'audit'),
      path.join(CYPLEX_DIR, 'workspaces'),
      path.join(CYPLEX_DIR, 'sessions'),
      path.join(CYPLEX_DIR, 'quarantine', 'pending'),
      path.join(CYPLEX_DIR, 'quarantine', 'approved'),
      path.join(CYPLEX_DIR, 'quarantine', 'rejected'),
    ];
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
    success('Created ~/.cyplex/ directory structure');

    // Save keys to encrypted keystore
    const allKeys = { ...cloudKeys, ...bots.botKeys };
    if (Object.keys(allKeys).length > 0) {
      const keystore = new KeystoreBridge();
      await keystore.open(KEYSTORE_PATH, masterPassword);
      for (const [name, value] of Object.entries(allKeys)) {
        if (value) keystore.set(name, value);
      }
      keystore.save(KEYSTORE_PATH);
      success(`Saved ${Object.keys(allKeys).length} key(s) to encrypted keystore`);
    }

    // Generate and write config
    const cfg: SetupConfig = {
      masterPassword,
      defaultProvider,
      fallbackProvider,
      keys: allKeys,
      ollamaUrl: localAi.ollamaUrl,
      ollamaModel: localAi.ollamaModel,
      lmstudioUrl: localAi.lmstudioUrl,
      lmstudioModel: localAi.lmstudioModel,
      useLocalAi: localAi.useLocalAi,
      enableTelegram: bots.enableTelegram,
      telegramToken: bots.telegramToken,
      enableDiscord: bots.enableDiscord,
      discordToken: bots.discordToken,
      enableWhatsapp: bots.enableWhatsapp,
      daemonLogLevel: daemon.logLevel,
      socketPath: daemon.socketPath,
    };

    const configYaml = generateConfig(cfg);
    fs.writeFileSync(CONFIG_PATH, configYaml, 'utf-8');
    success('Generated ~/.cyplex/config.yaml');

    // Write .env file with API keys
    const envContent = generateEnvFile(cfg);
    fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
    success('Generated ~/.cyplex/.env');

    // Mark setup as complete
    fs.writeFileSync(SETUP_MARKER, new Date().toISOString(), 'utf-8');

    // ── Summary ──────────────────────────────────────────────────────────

    header('Setup Complete');
    console.log(`  ${GREEN}Agent Cyplex is ready.${NC}`);
    console.log('');
    console.log(`  ${BOLD}Configuration:${NC}  ~/.cyplex/config.yaml`);
    console.log(`  ${BOLD}Environment:${NC}    ~/.cyplex/.env`);
    console.log(`  ${BOLD}Keystore:${NC}       ~/.cyplex/keystore.enc`);
    console.log(`  ${BOLD}Audit logs:${NC}     ~/.cyplex/audit/`);
    console.log(`  ${BOLD}Workspaces:${NC}     ~/.cyplex/workspaces/`);
    console.log('');

    const providerCount = Object.keys(cloudKeys).length + (localAi.useLocalAi ? 2 : 0);
    const botCount = [bots.enableTelegram, bots.enableDiscord, bots.enableWhatsapp].filter(Boolean).length;

    console.log(`  ${CYAN}Providers:${NC}  ${providerCount} configured`);
    console.log(`  ${CYAN}Bots:${NC}       ${botCount} enabled`);
    console.log(`  ${CYAN}Log level:${NC}  ${daemon.logLevel}`);
    console.log('');
    console.log(`  ${BOLD}Quick start:${NC}`);
    console.log(`    ${DIM}$${NC} agent-cyplex daemon start   ${DIM}# Start background daemon${NC}`);
    console.log(`    ${DIM}$${NC} agent-cyplex                 ${DIM}# Launch interactive REPL${NC}`);
    console.log('');
    console.log(`  ${DIM}Re-run setup anytime: agent-cyplex setup${NC}`);
    console.log(`  ${DIM}Edit config manually: agent-cyplex config edit${NC}`);
    console.log('');

  } finally {
    rl.close();
  }
}
