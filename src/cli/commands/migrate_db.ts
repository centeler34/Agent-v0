import { TaskRegistry } from '../../orchestrator/task_registry.js';
import { KeystoreBridge } from '../../security/keystore_bridge.js';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * Migration tool to encrypt plaintext data in tasks.db and move API keys to SQLite.
 */
async function runMigration() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const password = await new Promise<string>((resolve) => {
    rl.question('Enter Master Password to perform database migration: ', (answer) => {
      resolve(answer);
    });
  });
  rl.close();

  try {
    const installDir = path.join(os.homedir(), '.agent-v0');
    const keystorePath = path.join(installDir, 'keystore.enc');

    if (!fs.existsSync(keystorePath)) {
      throw new Error('Keystore file not found. Ensure setup has been completed.');
    }

    const bridge = new KeystoreBridge();
    await bridge.open(keystorePath, password);
    
    // Acquire the derived 32-byte key from the bridge for SQLite column encryption
    const masterKey = bridge.getDerivedKey(); 
    const registry = new TaskRegistry();
    registry.setMasterKey(masterKey);

    console.log('[*] Encrypting plaintext task data...');
    const tasksEncrypted = registry.migrateToEncryption();
    console.log(`[+] Task migration complete. ${tasksEncrypted} entries secured.`);

    console.log('[*] Migrating agent API keys to database...');
    const keys = bridge.list();
    for (const keyName of keys) {
      const keyValue = bridge.get(keyName);
      if (keyValue) registry.setSecret(keyName, keyValue.toString());
    }
    console.log(`[+] Secrets migration complete. ${keys.length} API keys moved to database.`);
    
  } catch (err) {
    console.error('[x] Migration failed:', err instanceof Error ? err.message : String(err));
  }
}

runMigration();
