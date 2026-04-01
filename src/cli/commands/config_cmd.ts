/**
 * `cyplex config` subcommands.
 */

import crypto from 'node:crypto'; // Added for crypto.randomUUID()
import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.join(process.env.HOME || '~', '.agent-v0', 'config.yaml');

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('Manage configuration');

  config.command('init').description('Initialize default config').action(async () => {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(CONFIG_PATH)) {
      console.log('Config already exists at', CONFIG_PATH);
    } else {
      fs.copyFileSync(path.join(process.cwd(), 'config', 'config.example.yaml'), CONFIG_PATH);
      console.log('Config initialized at', CONFIG_PATH);
    }
  });

  config.command('show').description('Display current config').action(async () => {
    if (fs.existsSync(CONFIG_PATH)) {
      console.log(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } else {
      console.log('No config found. Run `cyplex config init` first.');
    }
  });

  config.command('edit').description('Open config in $EDITOR').action(async () => {
    const editor = process.env.EDITOR || 'vi';
    // Validate editor is a simple command name to prevent command injection (CWE-78)
    if (!/^[a-zA-Z0-9_/.-]+$/.test(editor)) {
      console.error('Invalid $EDITOR value — must be a simple command name');
      return;
    }
    const { execFileSync } = await import('node:child_process');
    execFileSync(editor, [CONFIG_PATH], { stdio: 'inherit' });
  });

  config.command('validate').description('Validate current config').action(async () => {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.log('No config found');
      return;
    }
    try {
      const { parse } = await import('yaml');
      parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      console.log('Config is valid YAML');
    } catch (err) {
      console.error('Config validation failed:', err);
    }
  });

  config.command('export').description('Export config').action(async () => {
    if (fs.existsSync(CONFIG_PATH)) {
      console.log(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  });
}
