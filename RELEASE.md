# Agent v0 — Release v1.3.1

**Release Date:** 2026-04-04

---

## What's New

### Deep Tool Integration
Agents can now execute real tools during task processing. Instead of relying solely on AI model responses, every agent has access to a curated set of tools (Bash, Grep, Glob, FileRead, FileWrite, FileEdit, WebFetch) via the `AgentToolkit` system. Tool calls are sandboxed, audited, and iteratively fed back to the model.

- **Tool Execution Runtime** (`src/tools/tool_runtime.ts`) — 7 tool implementations with path traversal protection, per-agent allowlists, and audit logging
- **Agent Toolkit** (`src/tools/agent_toolkit.ts`) — Permission-enforcing wrapper that bundles all tools for each agent
- **BaseAgent** upgraded with `queryModelWithTools()` — iterative tool-use loop that parses model tool calls, executes them, and feeds results back (up to 10 rounds)
- All 9 agent subclasses updated to use tool-augmented execution

### Web UI Polish
- Keyboard shortcuts (`/` focus, `Ctrl+L` clear, `Ctrl+K` help, `1-4` tab switch)
- Toast notification system (success/error/info/warning with auto-dismiss)
- Command history (100 entries, Up/Down arrow navigation)
- Terminal line fade-in animations and card hover effects
- Graceful fallback when daemon socket is not running

### Full Rebranding
- Replaced all ~400 "Claude Code" display strings across 196 files in the tools/ framework
- Updated internal identifiers (MCP client name, analytics service, temp directories)
- External URLs, API wire protocol values, and package references left intact

---

## Full Changelog (v1.3.1)

- Added `src/tools/tool_runtime.ts` with Bash, Grep, Glob, FileRead, FileWrite, FileEdit, WebFetch implementations
- Added `src/tools/agent_toolkit.ts` with per-agent permission enforcement
- Updated `BaseAgent` with toolkit integration and `queryModelWithTools()` loop
- Updated all 9 agents (recon, code, forensics, exploit_research, monitor, threat_intel, osint_analyst, report, scribe) to use tools during execution
- Replaced ~400 "Claude Code" references with "Agent v0" across tools/ framework
- Updated internal identifiers (MCP client, analytics, temp dirs)
- Added tool-use documentation to README.md with security model explanation
- Web UI: keyboard shortcuts, toast notifications, command history, animations
- Fixed daemon socket connection graceful fallback in web server
- Removed unused `globSync` import from tool_runtime.ts

---

## Upgrade Notes (v1.3.1)

- Agents now attempt real tool execution during tasks — ensure tools like `rg` (ripgrep), `find`, and `nmap` are installed for full capability
- The tool audit log is in-memory (capped at 10,000 entries) — not persisted to disk
- Tool execution is workspace-sandboxed: agents cannot access files outside their assigned directory

---

---

# Agent v0 — Release v1.3.0

**Release Date:** 2026-04-03

---

## What's New

### Security Audit Trail (Web Dashboard)
A new Security Audit tab in the Web Dashboard provides a real-time, tamper-evident view of all agent actions. Each entry in the audit trail is cryptographically linked via SHA-256 hashing, ensuring the integrity of the logs. Monitor every decision, action, and outcome of your AI agents — complete with timestamps, agent IDs, and action details.

### Web Dashboard Integration
The Web Dashboard has been fully rewritten and properly integrated:
- Dedicated HTTPS server (`src/web/server.ts`) with all security hardening
- Dark terminal-themed UI with 3-column layout (sidebar, terminal, tasks panel)
- Real-time Socket.IO connection with auth overlay
- Agent list rendering for all 10 default agents
- Task submission and active/completed task tracking
- Terminal log with 500-line buffer limit
- XSS-safe output via `escapeHtml` utility

### Advanced Memory System
- Persistent memory system for agent state and context
- Shell command validation layer
- Code syntax bridging between agent components

### Security Hardening
- Secure task cleanup with safe disposal of completed task data
- Real-time web heartbeat monitoring for connection health
- Rate limiting, CORS whitelisting, and Socket.IO auth middleware on all servers
- Payload validation on all Socket.IO events

### Remote Installation
New curl one-liner installer for quick setup:
```bash
curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/remote-install.sh | bash
```

---

## Full Changelog (v1.3.0)

- Added Security Audit tab with SHA-256 cryptographic audit trail
- Rewrote Web Dashboard with proper static file serving (HTML/CSS/JS)
- Created dedicated HTTPS dashboard server with TLS
- Implemented advanced memory system for agent persistence
- Added shell command validation layer
- Added code syntax bridging between components
- Implemented secure task cleanup
- Added real-time web heartbeat monitoring
- Added remote install script (`scripts/remote-install.sh`)
- Fixed Web Dashboard server paths and static file references
- Removed duplicate `index.html` files from orchestrator and CLI commands

---

## Upgrade Notes (v1.3.0)

- The web dashboard now runs on its own HTTPS server — access it at `https://localhost:3000`
- Auth is required to access the dashboard (rate-limited: 5 attempts/min)
- Install via curl: `curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/remote-install.sh | bash`
- All 22 security patches from v1.2.2 remain in place

---

---

# Agent v0 — Release v1.2.2

**Release Date:** 2026-04-02

---

## What's New

Agent v0 v1.2.2 is a security-focused release that resolves all 22 vulnerabilities identified during a comprehensive security review. This completes the full security hardening pass started in v1.0.0.

---

## Security Vulnerabilities Patched (22 total)

### Critical (2)

| # | Vulnerability | File | Fix |
|---|--------------|------|-----|
| 1 | Unencrypted task results stored in SQLite | `task_registry.ts` | Added AES-256-GCM column-level encryption for all task data |
| 2 | encrypt() allowed calls without master key | `task_registry.ts` | Throws if `setMasterKey()` not called before encryption |

### High (7)

| # | Vulnerability | File | Fix |
|---|--------------|------|-----|
| 3 | No validation on encrypted data format before decrypt | `task_registry.ts` | Added regex validation (`isEncrypted()`) before decryption |
| 4 | Error objects leaked internal paths and stack traces | `updater.ts` | Replaced `${e}` with generic error messages in all catch blocks |
| 5 | Path traversal on session scope file loading | `session_manager.ts` | Added `startsWith(cwd)` guard on resolved scope paths |
| 6 | No rate limiting on auth/task submission | `server.ts` (both) | 5 attempts/minute per-socket rate limiter on auth events |
| 7 | Prototype pollution via keystore `get()` | `keystore_bridge.ts` | Added `SAFE_KEY_NAME` regex + `hasOwnProperty` guard |
| 8 | SSRF via unchecked URL schemes in skill download | `skill_intake.ts` | Added `validateUrl()` blocking non-HTTP schemes and localhost |
| 9 | Command injection via `$EDITOR` env var | `config_cmd.ts` | Restricted editor regex to `[a-zA-Z0-9_-]+` (no paths) |
| 10 | Shell injection in native file picker | `skill_intake.ts` | Replaced `execSync` with `execFileSync` (no shell invoked) |

### Medium (8)

| # | Vulnerability | File | Fix |
|---|--------------|------|-----|
| 11 | CORS allowed all origins | `server.ts` (both) | Explicit whitelist: `localhost:3000` and `127.0.0.1:3000` only |
| 12 | No Socket.IO authentication middleware | `server.ts` (both) | `authenticatedSockets` Set tracks auth state per connection |
| 13 | Unvalidated Socket.IO payloads | `server.ts` (both) | Type + shape validation on `auth` and `submit_task` events |
| 14 | `Math.random()` used for session IDs | `session_manager.ts` | Replaced with `crypto.randomUUID()` |
| 15 | Weak scrypt KDF parameters (N=16384) | `keystore_bridge.ts` | Strengthened to N=65536, r=8, p=1 |
| 16 | Unvalidated `HOME` env var used in paths | `daemon_cmd.ts`, `updater.ts`, `skill_intake.ts` | Validate with `os.homedir()` fallback |
| 17 | TOCTOU race in quarantine file writes | `skill_intake.ts` | Atomic file creation with `O_CREAT\|O_EXCL` (`'wx'` flag) |
| 18 | XSS via `innerText` in web dashboards | `index.html` (both) | Changed to `textContent` |

### Low (5)

| # | Vulnerability | File | Fix |
|---|--------------|------|-----|
| 19 | Missing .gitignore entries for secrets | `.gitignore` | Added `*.pem`, `*.key`, `*.crt`, `certs/`, `.env.*`, `config/config.yaml` |
| 20 | Destructive `git reset --hard` in updater | `updater.ts` | Safe abort with user instructions instead of data loss |
| 21 | Express fingerprinting headers exposed | `server.ts` (both) | Disabled `x-powered-by` and `etag` headers |
| 22 | Weak session name regex | `session_manager.ts` | Tightened to alphanumeric + hyphens only |

---

## Additional Fixes

- Fixed `daemon_main.ts` — renamed `CyplexDaemon` to `AgentV0Daemon` and updated stale socket/PID paths
- Fixed import paths in `migrate_db.ts` (was pointing to wrong directory)
- Removed unused `crypto` imports across multiple files
- HTTP servers migrated to HTTPS with auto-generated self-signed TLS certificates
- Added 10 MB message size limit on daemon IPC responses
- Added 1 MB limit on Express JSON body parsing

---

## Upgrade Notes

- TLS certificates are auto-generated on first server start in `~/.agent-v0/certs/`
- The web dashboard now requires HTTPS — update bookmarks to `https://localhost:3000`
- Auth is now rate-limited: 5 failed attempts per minute before lockout
- Session names must match `[a-zA-Z0-9-]` pattern (no special characters)

---

---

# Agent v0 — Release v1.0.0

**Release Date:** 2026-04-01

---

## What's New

Agent v0 v1.0.0 is a security-hardened release that removes deprecated functionality and eliminates critical vulnerabilities discovered during an internal security audit.

---

## Removed: Local LLM Support (Ollama, LM Studio)

Local AI backend support has been fully removed. Agent v0 now exclusively uses cloud AI providers:

- **Anthropic** (Claude 4 Opus, Sonnet, Haiku)
- **OpenAI** (GPT-4o, GPT-4, GPT-3.5)
- **Google Gemini** (Gemini Pro, Ultra)

All Ollama and LM Studio adapters, model management commands, and local model configuration have been deleted.

---

## Removed: SSH Tunnel Module

The `go/ssh-tunnel` module has been completely removed. This module was originally used to proxy connections to local LLM backends and is no longer needed after the local AI removal.

### Files Deleted

- `go/ssh-tunnel/main.go`
- `go/ssh-tunnel/tunnel.go`
- `go/ssh-tunnel/key_loader.go`
- `go/ssh-tunnel/config.go`
- `go/ssh-tunnel/health.go`

### Dependency Removed

- `golang.org/x/crypto` — no longer required after SSH tunnel deletion

### TypeScript Cleanup

- Removed `SshTunnelConfig` interface from `src/types/provider_config.ts`
- Removed `ssh_tunnel` field from `ProviderConfig`
- Removed SSH tunnel build steps from `Makefile`, `scripts/build-go.sh`, `scripts/install.sh`, `scripts/install-agent-v0.sh`, and `src/cli/updater.ts`

---

## Security Vulnerabilities Found and Resolved

A security review of the SSH tunnel module identified **9 vulnerabilities** across 4 severity levels. All were resolved by removing the module entirely.

### Critical (1)

| # | Vulnerability | File | Description |
|---|--------------|------|-------------|
| 1 | **Disabled SSH Host Key Verification** | `tunnel.go:83` | Used `ssh.InsecureIgnoreHostKey()` which completely disables host key verification, enabling Man-in-the-Middle (MITM) attacks. Any attacker with network position could intercept SSH connections undetected. |

### High (3)

| # | Vulnerability | File | Description |
|---|--------------|------|-------------|
| 2 | **Race Condition in Reconnection** | `tunnel.go:181-203` | `reconnect()` was called from `keepaliveLoop()` without mutex protection. Concurrent goroutines accessed `t.client` and `t.listener` without synchronization, leading to potential panics or nil pointer dereferences. |
| 3 | **Missing SSH Key Permission Check** | `key_loader.go:21-26` | Private keys were loaded without verifying file permissions. Keys with world-readable permissions (should be 0600) could be read by any local user. |
| 4 | **Double-Close Race on Connections** | `tunnel.go:149-156` | Bidirectional copy goroutines each closed their respective connections independently, creating race conditions when one goroutine closed while the other was still reading/writing. |

### Medium (3)

| # | Vulnerability | File | Description |
|---|--------------|------|-------------|
| 5 | **No Input Validation on Config Fields** | `tunnel.go:87,93,142` | `RemoteHost`, `LocalPort`, and `RemotePort` were used directly without validation. No port range checks (1-65535), no hostname sanitization. |
| 6 | **Hardcoded SSH Port** | `tunnel.go:87` | SSH port was hardcoded to 22 (`fmt.Sprintf("%s:22", t.config.RemoteHost)`) with no configuration option for non-standard ports. |
| 7 | **Config File Permissions Not Verified** | `main.go:26` | Configuration file was read without checking file permissions, potentially exposing sensitive data if the file was world-readable. |

### Low (2)

| # | Vulnerability | File | Description |
|---|--------------|------|-------------|
| 8 | **Information Disclosure in Logs** | `main.go:46-47` | Tunnel configuration including remote host and SSH user was logged in plaintext, potentially leaking infrastructure details. |
| 9 | **No Keepalive Interval Validation** | `config.go:11` | `KeepaliveIntervalS` was not validated. A value of 0 or negative could cause undefined behavior in ticker creation. |

---

## Resolution

Rather than patching 9 separate vulnerabilities in a module that no longer serves a purpose, the entire `go/ssh-tunnel` module was deleted. This eliminates the attack surface completely and removes the `golang.org/x/crypto` dependency from the project.

---

## Upgrade Notes

- If you were using local LLM backends (Ollama or LM Studio), you must switch to a cloud provider (Anthropic, OpenAI, or Gemini). Run `agent-v0 setup` to configure your API keys.
- The `cyplex` CLI command has been renamed to `agent-v0`.
- No configuration migration is needed for users already on cloud providers.

---

## Full Changelog

- Removed local AI functionality (Ollama, LM Studio adapters and model management)
- Removed SSH tunnel module (`go/ssh-tunnel/`) — resolved 9 security vulnerabilities
- Removed `golang.org/x/crypto` dependency
- Removed `SshTunnelConfig` from TypeScript types
- Updated all build scripts and install scripts
- Renamed package from `agent-cyplex` to `agent-v0`
- Updated Go module to 1.23, updated `golang.org/x/sys` to v0.30.0
