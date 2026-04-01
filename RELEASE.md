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
