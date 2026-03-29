/**
 * `cyplex model` subcommands — local AI backend management.
 */

import type { Command } from 'commander';
import { LocalModelAdapter } from '../../gateway/local_model_adapter.js';
import fs from 'node:fs';
import path from 'node:path';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

function getProviderConfig(provider: 'ollama' | 'lmstudio') {
  const envPath = path.join(process.env.HOME || '~', '.cyplex', '.env');
  let ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  let lmstudioUrl = process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234';

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('OLLAMA_BASE_URL=')) ollamaUrl = trimmed.split('=').slice(1).join('=');
      if (trimmed.startsWith('LMSTUDIO_BASE_URL=')) lmstudioUrl = trimmed.split('=').slice(1).join('=');
    }
  }

  return {
    name: provider,
    type: provider,
    model: provider === 'ollama' ? 'llama3.3' : 'default',
    base_url: provider === 'ollama' ? ollamaUrl : lmstudioUrl,
    timeout_ms: 30000,
    max_retries: 1,
  } as const;
}

export function registerModelCommands(program: Command): void {
  const model = program.command('model').description('Local AI model management');

  model.command('list').description('List available models')
    .option('--provider <name>', 'Filter by provider (ollama or lmstudio)')
    .action(async (opts) => {
      const providers: ('ollama' | 'lmstudio')[] = opts.provider
        ? [opts.provider]
        : ['ollama', 'lmstudio'];

      for (const p of providers) {
        const config = getProviderConfig(p);
        const adapter = new LocalModelAdapter(config);
        const label = p === 'ollama' ? 'Ollama' : 'LM Studio';

        console.log(`\n${BOLD}${label}${NC} (${DIM}${config.base_url}${NC})`);

        try {
          const models = await adapter.listModels();
          if (models.length > 0) {
            for (const m of models) console.log(`  ${GREEN}*${NC} ${m}`);
          } else {
            console.log(`  ${DIM}No models loaded${NC}`);
          }
        } catch (err: any) {
          console.log(`  ${RED}[x]${NC} ${err.message}`);
        }
      }
      console.log('');
    });

  model.command('test').description('Test model connectivity')
    .option('--provider <name>', 'Provider to test (ollama or lmstudio)')
    .action(async (opts) => {
      const providers: ('ollama' | 'lmstudio')[] = opts.provider
        ? [opts.provider]
        : ['ollama', 'lmstudio'];

      for (const p of providers) {
        const config = getProviderConfig(p);
        const adapter = new LocalModelAdapter(config);
        const label = p === 'ollama' ? 'Ollama' : 'LM Studio';

        console.log(`\n${BOLD}Testing ${label}${NC} at ${CYAN}${config.base_url}${NC}`);

        // Connection test
        process.stdout.write(`  Connectivity...  `);
        const conn = await adapter.testConnection();
        if (conn.ok) {
          console.log(`${GREEN}OK${NC}`);
          if (conn.models && conn.models.length > 0) {
            console.log(`  Models: ${conn.models.slice(0, 5).join(', ')}${conn.models.length > 5 ? ` (+${conn.models.length - 5} more)` : ''}`);
          }
        } else {
          console.log(`${RED}FAILED${NC}`);
          console.log(`  ${RED}${conn.message}${NC}`);
          continue;
        }

        // Inference test
        process.stdout.write(`  Inference test... `);
        try {
          const start = Date.now();
          const response = await adapter.complete({
            model: config.model,
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

  model.command('load <model>').description('Load a model into memory')
    .option('--provider <name>', 'Provider (ollama or lmstudio)', 'lmstudio')
    .action(async (modelName, opts) => {
      const config = getProviderConfig(opts.provider);
      const adapter = new LocalModelAdapter(config);
      const label = opts.provider === 'ollama' ? 'Ollama' : 'LM Studio';

      console.log(`${CYAN}[*]${NC} Loading "${modelName}" on ${label}...`);
      const result = await adapter.loadModel(modelName);
      if (result.ok) {
        console.log(`${GREEN}[+]${NC} ${result.message}`);
      } else {
        console.log(`${RED}[x]${NC} ${result.message}`);
      }
    });

  model.command('download <model>').description('Download a model')
    .option('--provider <name>', 'Provider (ollama or lmstudio)', 'lmstudio')
    .action(async (modelName, opts) => {
      const config = getProviderConfig(opts.provider);
      const adapter = new LocalModelAdapter(config);
      const label = opts.provider === 'ollama' ? 'Ollama' : 'LM Studio';

      if (opts.provider === 'ollama') {
        // Ollama streaming pull
        console.log(`${CYAN}[*]${NC} Pulling "${modelName}" via Ollama...`);
        const url = (config.base_url as string).replace(/\/+$/, '');
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
            for (const line of decoder.decode(value, { stream: true }).split('\n')) {
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
        return;
      }

      // LM Studio download
      console.log(`${CYAN}[*]${NC} Downloading "${modelName}" via ${label}...`);
      try {
        const result = await adapter.downloadModel(modelName);
        console.log(`${GREEN}[+]${NC} ${result.message}`);
        if (result.jobId) {
          console.log(`  Job ID: ${result.jobId}`);
          console.log(`  Check status: agent-cyplex model download-status ${result.jobId}`);
        }
      } catch (err: any) {
        console.log(`${RED}[x]${NC} ${err.message}`);
      }
    });

  model.command('download-status <job-id>').description('Check download progress (LM Studio)')
    .action(async (jobId) => {
      const config = getProviderConfig('lmstudio');
      const adapter = new LocalModelAdapter(config);

      try {
        const status = await adapter.downloadStatus(jobId);
        console.log(`  Status:   ${status.status}`);
        if (status.progress !== undefined) {
          const pct = Math.round(status.progress * 100);
          const bar = '█'.repeat(Math.floor(pct / 2)) + '░'.repeat(50 - Math.floor(pct / 2));
          console.log(`  Progress: [${bar}] ${pct}%`);
        }
        console.log(`  Message:  ${status.message}`);
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
