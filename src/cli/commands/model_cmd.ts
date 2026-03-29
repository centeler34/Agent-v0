/**
 * `cyplex model` subcommands — local AI backend management.
 */

import type { Command } from 'commander';
import { LocalModelAdapter } from '../../gateway/local_model_adapter.js';
import type { ProviderConfig } from '../../types/provider_config.js';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

function loadEnv(): Record<string, string> {
  const fs = require('node:fs');
  const path = require('node:path');
  const envPath = path.join(process.env.HOME || '~', '.cyplex', '.env');
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

export function registerModelCommands(program: Command): void {
  const model = program.command('model').description('Local AI model management');

  model.command('list').description('List available models')
    .option('--provider <name>', 'Filter by provider')
    .action(async (opts) => {
      const env = loadEnv();
      const providers: { name: string; url: string; type: 'ollama' | 'lmstudio' }[] = [];

      const ollamaUrl = env.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const lmstudioUrl = env.LMSTUDIO_BASE_URL || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';

      if (!opts.provider || opts.provider === 'ollama') {
        providers.push({ name: 'Ollama', url: ollamaUrl, type: 'ollama' });
      }
      if (!opts.provider || opts.provider === 'lmstudio') {
        providers.push({ name: 'LM Studio', url: lmstudioUrl, type: 'lmstudio' });
      }

      for (const p of providers) {
        console.log(`\n${BOLD}${p.name}${NC} (${DIM}${p.url}${NC})`);

        const adapter = new LocalModelAdapter({
          name: p.type,
          type: p.type,
          model: 'default',
          base_url: p.url,
          timeout_ms: 10000,
          max_retries: 1,
        });

        const result = await adapter.testConnection();
        if (result.ok && result.models && result.models.length > 0) {
          for (const m of result.models) {
            console.log(`  ${GREEN}*${NC} ${m}`);
          }
        } else if (result.ok) {
          console.log(`  ${GREEN}[+]${NC} Connected (no models listed)`);
        } else {
          console.log(`  ${RED}[x]${NC} ${result.message}`);
        }
      }
      console.log('');
    });

  model.command('test').description('Test model connectivity')
    .option('--provider <name>', 'Provider to test (ollama or lmstudio)')
    .action(async (opts) => {
      const env = loadEnv();
      const providers: { name: string; url: string; type: 'ollama' | 'lmstudio'; model: string }[] = [];

      if (!opts.provider || opts.provider === 'ollama') {
        providers.push({
          name: 'Ollama',
          url: env.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
          type: 'ollama',
          model: 'llama3.3',
        });
      }
      if (!opts.provider || opts.provider === 'lmstudio') {
        providers.push({
          name: 'LM Studio',
          url: env.LMSTUDIO_BASE_URL || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
          type: 'lmstudio',
          model: 'default',
        });
      }

      for (const p of providers) {
        console.log(`\n${BOLD}Testing ${p.name}${NC} at ${CYAN}${p.url}${NC}`);

        const adapter = new LocalModelAdapter({
          name: p.type,
          type: p.type,
          model: p.model,
          base_url: p.url,
          timeout_ms: 10000,
          max_retries: 1,
        });

        // Step 1: Connection test
        process.stdout.write(`  Connectivity...  `);
        const connResult = await adapter.testConnection();
        if (connResult.ok) {
          console.log(`${GREEN}OK${NC}`);
          if (connResult.models && connResult.models.length > 0) {
            console.log(`  Models available: ${connResult.models.slice(0, 5).join(', ')}${connResult.models.length > 5 ? ` (+${connResult.models.length - 5} more)` : ''}`);
          }
        } else {
          console.log(`${RED}FAILED${NC}`);
          console.log(`  ${RED}${connResult.message}${NC}`);
          continue;
        }

        // Step 2: Inference test
        process.stdout.write(`  Inference test... `);
        try {
          const start = Date.now();
          const response = await adapter.complete({
            model: p.model,
            messages: [{ role: 'user', content: 'Say "hello" in one word.' }],
            max_tokens: 10,
            temperature: 0,
            stream: false,
          });
          const elapsed = Date.now() - start;
          console.log(`${GREEN}OK${NC} (${elapsed}ms)`);
          console.log(`  Response: "${response.content.trim().slice(0, 80)}"`);
          console.log(`  Tokens: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion`);
        } catch (err: any) {
          console.log(`${RED}FAILED${NC}`);
          console.log(`  ${RED}${err.message}${NC}`);
        }
      }
      console.log('');
    });

  model.command('pull <model>').description('Pull a model (Ollama only)').action(async (modelName) => {
    const env = loadEnv();
    const url = (env.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');

    console.log(`${BOLD}Pulling ${modelName}${NC} via Ollama...`);

    try {
      const res = await fetch(`${url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
      });

      if (!res.ok || !res.body) {
        console.log(`${RED}[x]${NC} Failed: HTTP ${res.status}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lastStatus = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.status && data.status !== lastStatus) {
              console.log(`  ${CYAN}[*]${NC} ${data.status}`);
              lastStatus = data.status;
            }
          } catch { /* skip */ }
        }
      }
      console.log(`${GREEN}[+]${NC} Done.`);
    } catch (err: any) {
      console.log(`${RED}[x]${NC} ${err.message}`);
    }
  });

  // Tunnel management
  const tunnels = model.command('tunnels').description('SSH tunnel management');

  tunnels.command('list').description('Show all SSH tunnels').action(async () => {
    console.log('Configured SSH tunnels:');
  });

  tunnels.command('test <name>').description('Test tunnel connectivity').action(async (name) => {
    console.log(`Testing tunnel: ${name}`);
  });

  tunnels.command('reconnect').description('Force reconnect all tunnels').action(async () => {
    console.log('Reconnecting all SSH tunnels...');
  });
}
