/**
 * Advanced Command Validator
 * Adapted from high-security flag validation patterns.
 */

type FlagArgType = 'none' | 'string' | 'number';

interface CommandConfig {
  safeFlags: Record<string, FlagArgType>;
  dangerousBinaries?: string[];
}

const COMMAND_REGISTRY: Record<string, CommandConfig> = {
  'find': { safeFlags: { '-name': 'string', '-type': 'string', '-maxdepth': 'number', '-mindepth': 'number', '-path': 'string', '-mtime': 'string', '-size': 'string', '-h': 'none', '-L': 'none' } },
  'grep': { safeFlags: { '-r': 'none', '-i': 'none', '-v': 'none', '-l': 'none', '-n': 'none', '-E': 'none', '-F': 'none', '-A': 'number', '-B': 'number', '-C': 'number', '--exclude-dir': 'string', '--color': 'string', '-q': 'none' } },
  'sed': { safeFlags: { '-n': 'none', '-e': 'string', '-E': 'none', '-r': 'none' } },
  'xargs': { safeFlags: { '-I': 'string', '-n': 'number', '-P': 'number', '-0': 'none', '-t': 'none', '-r': 'none', '-E': 'string' } },
  'ls': { safeFlags: { '-l': 'none', '-a': 'none', '-h': 'none', '-R': 'none', '-t': 'none', '-S': 'none', '-F': 'none', '-1': 'none' } },
  'sort': { safeFlags: { '-n': 'none', '-r': 'none', '-u': 'none', '-k': 'string', '-t': 'string', '-b': 'none', '-f': 'none' } },
  'file': { safeFlags: { '-b': 'none', '--mime': 'none', '-i': 'none', '-L': 'none', '--brief': 'none', '-v': 'none' } },
  'git status': { safeFlags: { '-s': 'none', '--short': 'none', '--branch': 'none' } },
  'git diff': { safeFlags: { '--stat': 'none', '--cached': 'none', '--name-only': 'none', '--unified': 'number', '-U': 'number' } },
  'git log': { safeFlags: { '--oneline': 'none', '-n': 'number', '--graph': 'none', '--stat': 'none', '--decorate': 'none' } },
  'git blame': { safeFlags: { '-L': 'string', '-C': 'none', '-M': 'none', '-e': 'none' } },
  'git ls-files': { safeFlags: { '--modified': 'none', '--others': 'none', '--deleted': 'none', '--cached': 'none' } },
  'tree': { safeFlags: { '-a': 'none', '-d': 'none', '-L': 'number', '-P': 'string', '-I': 'string', '-f': 'none', '-h': 'none' } },
  'date': { safeFlags: { '-d': 'string', '--date': 'string', '-r': 'string', '-u': 'none', '-I': 'string' } },
  'hostname': { safeFlags: { '-f': 'none', '-i': 'none', '-I': 'none', '-s': 'none' } },
  'lsof': { safeFlags: { '-h': 'none', '-i': 'none', '-p': 'string', '-u': 'string', '-t': 'none' } },
  'pgrep': { safeFlags: { '-l': 'none', '-a': 'none', '-f': 'none', '-u': 'string' } },
  'ss': { safeFlags: { '-h': 'none', '-n': 'none', '-a': 'none', '-l': 'none', '-p': 'none', '-t': 'none', '-u': 'none' } },
  'fd': { safeFlags: { '-h': 'none', '-H': 'none', '-I': 'none', '-e': 'string', '-d': 'number' } },
  'fdfind': { safeFlags: { '-h': 'none', '-H': 'none', '-I': 'none', '-e': 'string', '-d': 'number' } },
  'ps': { safeFlags: { '-e': 'none', '-A': 'none', '-f': 'none', '-F': 'none', '-u': 'string' } },
  'sha256sum': { safeFlags: { '-c': 'none', '--check': 'none', '-b': 'none', '--binary': 'none' } },
  'cat': { safeFlags: { '-n': 'none', '-b': 'none', '-s': 'none' } },
  'head': { safeFlags: { '-n': 'number', '-c': 'number' } },
  'tail': { safeFlags: { '-n': 'number', '-c': 'number', '-f': 'none' } },
  'wc': { safeFlags: { '-l': 'none', '-w': 'none', '-c': 'none', '-m': 'none' } },
};

const RESTRICTED_BINARIES = ['bash', 'sh', 'python', 'python3', 'node', 'curl', 'wget', 'sudo'];

export class CommandValidator {
  /**
   * Validates if a command and its flags are within the safe allowlist.
   */
  static isSafe(commandName: string, args: string[]): { safe: boolean; reason?: string } {
    const { baseCmd, effectiveArgs } = this.resolveCommandContext(commandName, args);

    // 1. Detect Shell Injection/Expansion
    if (this.containsShellMetacharacters(effectiveArgs)) {
      return { safe: false, reason: 'Possible shell expansion/injection detected in arguments.' };
    }

    // 2. Block Known Dangerous Binaries
    if (RESTRICTED_BINARIES.includes(commandName) && !COMMAND_REGISTRY[baseCmd]) {
      return { safe: false, reason: `Direct execution of ${commandName} is restricted. Use a skill.` };
    }

    // 3. Flag Validation
    const config = COMMAND_REGISTRY[baseCmd];
    if (config) {
      return this.validateFlags(config.safeFlags, effectiveArgs);
    }

    return { safe: true };
  }

  private static resolveCommandContext(commandName: string, args: string[]) {
    let effectiveArgs = [...args];
    if (commandName === 'git' && args.length > 0) {
      return { baseCmd: `git ${args[0]}`, effectiveArgs: args.slice(1) };
    }
    return { baseCmd: commandName, effectiveArgs };
  }

  private static containsShellMetacharacters(args: string[]): boolean {
    // Matches metacharacter set from tools/utils/bash/commands.ts to prevent shell injection and subshells
    const metachars = ['$','`','>','|','<','&',';','*','?','[','{','}','(',')','\\','!','~'];
    return args.some(arg => metachars.some(char => arg.includes(char)));
  }

  private static validateFlags(safeFlags: Record<string, FlagArgType>, args: string[]): { safe: boolean; reason?: string } {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') break; // Respect POSIX end-of-options separator

      if (arg && arg.startsWith('-')) {
        const flagType = safeFlags[arg];
        if (!flagType) {
          return { safe: false, reason: `Unrecognized or dangerous flag: ${arg}` };
        }
        if (flagType === 'string' || flagType === 'number') {
          i++; // Consume the next argument as the value
        }
      }
    }
    return { safe: true };
  }
}