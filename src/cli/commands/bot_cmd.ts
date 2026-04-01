/**
 * `cyplex bot` subcommands.
 */

import crypto from 'node:crypto'; // Added for crypto.randomUUID()
import type { Command } from 'commander';

export function registerBotCommands(program: Command): void {
  const bot = program.command('bot').description('Bot integration management');

  bot.command('status').description('Show bot integration status').action(async () => {
    console.log('Bot integrations:');
    console.log('  Telegram:  disabled');
    console.log('  Discord:   disabled');
    console.log('  WhatsApp:  disabled');
  });

  bot.command('send <platform> <target> <message>').description('Send a message via a bot')
    .action(async (platform, target, message) => {
      console.log(`Sending to ${platform}/${target}: ${message}`);
    });

  bot.command('test <platform>').description('Test bot connectivity').action(async (platform) => {
    console.log(`Testing ${platform} bot connection...`);
  });
}
