# Agent v0 — Security Architecture & Hardening

This document outlines the full security architecture of Agent v0, covering all encryption implementations, vulnerability remediations, and defense-in-depth measures across the Rust, TypeScript, and Python layers.

**Current version: v1.4.4** | 43 vulnerabilities patched across 4 security releases.

---

## 1. Security Release History

### v1.4.4 — TypeScript & Python Hardening (21 fixes)

| Severity | Count | Summary |
|----------|-------|---------|
| Critical | 3 | Command injection in OpenSSL cert generation and agent Bash tool |
| High | 6 | Secret leakage, SSRF, prototype pollution, missing security headers |
| Medium | 12 | DoS payload limits, file permissions, path traversal in Python |

**Key fixes:**
- All `execSync()` calls replaced with `execFileSync()` using argument arrays — eliminates shell injection across the entire TypeScript codebase
- Agent Bash tool now blocks dangerous patterns: backtick substitution, `$()`, pipe-to-bash, reverse shells
- All 3 web servers (web dashboard, orchestrator, CLI server) now set CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Secret redactor hardened against prototype pollution (`__proto__`, `constructor`, `prototype` keys skipped)
- API keys removed from `.env` template — stored only in the encrypted keystore
- All 5 Python forensics modules validate file paths and block `..` traversal
- OSINT tools validate domain/email format before external API requests

### v1.3.2 — Rust Crypto Hardening (22 fixes)

| Severity | Count | Summary |
|----------|-------|---------|
| Critical | 3 | Timing attacks, weak RNG, DoS via oversized IPC messages |
| High | 3 | Panic-prone HMAC, hard-coded test keys, unsafe JSON serialization |
| Medium | 3 | Domain matching, file permissions, error handling |

**Key fixes:**
- Session token validation and audit hash chain verification now use `subtle::ConstantTimeEq` — prevents timing side-channel attacks
- All cryptographic random generation uses `OsRng` instead of `thread_rng()`
- IPC protocol capped at 16 MiB max message size (was uncapped at 4 GB)
- HMAC operations return `Result<T, HmacError>` instead of panicking with `.expect()`
- Hard-coded test keys (`[0xAB; 32]`, `"sk-secret-12345"`, `"hunter2"`) replaced with `OsRng`-generated random values
- Wildcard domain matching normalized to case-insensitive per RFC 4343

### v1.0.0 — SSH Tunnel Removal (9 fixes)

The `go/ssh-tunnel` module was removed entirely after a security audit identified 9 vulnerabilities:
- **Critical:** SSH host key verification disabled (`InsecureIgnoreHostKey`), enabling MITM attacks
- **High:** Race conditions in reconnection logic, missing SSH key file permission checks, double-close on connection forwarding
- **Medium:** No input validation on host/port, hardcoded SSH port, config permissions not checked
- **Low:** Information disclosure in error logging

Rather than patching 9 issues, the entire module was deleted as it no longer served a purpose.

---

## 2. Encryption Architecture

### 2.1 AES-256-GCM Secret Storage

All secrets (AI provider keys, bot tokens) are stored using Authenticated Encryption with Associated Data (AEAD) via AES-256-GCM.

- **Nonce:** A fresh 12-byte random nonce generated via `OsRng` for every encryption operation
- **Integrity:** The GCM authentication tag ensures encrypted data has not been tampered with at rest
- **Key validation:** Encryption functions validate key length (must be exactly 32 bytes) before proceeding

### 2.2 Column-Level SQLite Encryption

The `tasks.db` SQLite database uses column-level encryption for `task_data`, `result_data`, and `secrets` tables.

- **Encryption key:** All data bound to the 32-byte master key derived from the user's master password
- **Persistence:** Sensitive task context and results survive daemon restarts but remain encrypted on disk

### 2.3 Key Derivation (Argon2id)

The master key is derived from the user's master password using Argon2id:

- **Parameters:** 64 MB memory, 3 iterations, parallelism 4
- **Salt:** 16-byte random salt generated via `OsRng`, stored alongside the encrypted keystore
- **Zeroization:** In-memory key material is securely wiped using the `zeroize` crate immediately after use
- **File permissions:** Keystore written with mode `0o600` (owner read/write only)

---

## 3. Authentication & Session Management

### 3.1 Session Tokens

- **Generation:** Cryptographically random tokens generated via `OsRng` (32 bytes, hex-encoded = 64 chars)
- **Validation:** Tokens compared using `subtle::ConstantTimeEq` to prevent timing attacks
- **Lifespan:** Valid for 3 days
- **Re-authentication:** Upon expiration or logout, the token is deleted and the user must re-enter the master password

### 3.2 Web Dashboard Authentication

- **HTTPS only:** Self-signed TLS certificates generated on first launch
- **CORS restriction:** Only `localhost:3000` and `127.0.0.1:3000` are allowed origins
- **Rate limiting:** Authentication attempts are rate-limited per socket
- **Session binding:** Dashboard sessions are bound to the CLI's master key

---

## 4. Runtime Security

### 4.1 Agent Sandboxing

Agents are confined using Linux namespaces and Bubblewrap (`bwrap`):

- **Filesystem isolation:** Agents can only access their designated `workspaces/<agent_name>` directory
- **Path traversal protection:** All file paths are resolved and validated against the workspace root before any filesystem operation
- **Syscall filtering:** Seccomp profiles restrict the agent's kernel interaction
- **Namespace isolation:** Separate PID, mount, network, and user namespaces per agent

### 4.2 Tool Execution Security

The `AgentToolkit` enforces per-agent tool allowlists at runtime:

| Control | Implementation |
|---------|---------------|
| **Per-agent allowlists** | Each agent role only has access to the tools it needs |
| **Bash injection blocking** | Patterns like `` `cmd` ``, `$(cmd)`, `; rm`, `| bash` are rejected |
| **Command size limit** | Maximum 10KB per command |
| **Workspace confinement** | FileRead/Write/Edit operations cannot escape the workspace |
| **Cloud metadata blocking** | WebFetch blocks `169.254.169.254` and `metadata.google.internal` |
| **Timeout enforcement** | All tool calls have configurable timeouts (default 120s for Bash, 30s for WebFetch) |

### 4.3 Web Server Hardening

All 3 HTTP servers (web dashboard, orchestrator, CLI server) enforce:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://localhost:*; frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Powered-By` | Disabled |
| JSON body limit | 10KB max |

---

## 5. Audit Trail

Every agent action is logged to a structured, append-only, hash-chained audit log.

### 5.1 Hash Chain Integrity

- Each log entry contains the SHA-256 hash of the previous entry
- Chain verification uses `subtle::ConstantTimeEq` to prevent timing attacks
- The first entry links to a genesis sentinel (64 zero characters)
- Verification: entries can be validated individually or as a complete chain

### 5.2 Secret Redaction

Before any data is written to the audit log, the `secret_redactor` module:

- Matches keys against patterns: `key`, `token`, `secret`, `password`, `credential`, `auth`, `bearer`, `api_key`
- Detects API key formats: `sk-*`, `sk-ant-*`, `AIza*`, `xoxb-*`, `xoxp-*`
- Replaces matched values with `[REDACTED]`
- Skips `__proto__`, `constructor`, `prototype` keys (prototype pollution protection)
- Enforces max recursion depth of 20 to prevent stack overflow attacks

### 5.3 Tool Invocation Logging

Every tool call is recorded with:
- Tool name and agent ID
- Input parameters
- Success/failure result
- Execution duration
- ISO 8601 timestamp

Capped at 10,000 entries in the in-memory ring buffer.

---

## 6. Cryptographic Standards

| Primitive | Implementation | Purpose |
|-----------|---------------|---------|
| AES-256-GCM | `aes-gcm` 0.10 | Secret storage encryption |
| Argon2id | `argon2` 0.5 (64MB/3iter/4par) | Master key derivation |
| Ed25519 | `ed25519-dalek` 2.x | Skill signature verification |
| HMAC-SHA256 | `hmac` 0.12 + `sha2` 0.10 | Message authentication |
| SHA-256 | `sha2` 0.10 | Audit log hash chain |
| CSPRNG | `rand::rngs::OsRng` | All random generation |
| Constant-time comparison | `subtle` 2.6 | Token/hash validation |
| Memory zeroization | `zeroize` 1.8 | Key material cleanup |

All cryptographic operations use proper error handling (`Result` types) — no `.expect()` or `.unwrap()` on crypto paths.

---

## 7. Python Security

All Python forensics and OSINT modules enforce input validation:

| Module | Protection |
|--------|-----------|
| `pcap_analyzer.py` | Path traversal check + `realpath` validation |
| `entropy_analyzer.py` | Path traversal check + `realpath` validation |
| `pefile_analyzer.py` | Path traversal check + file existence validation |
| `yara_scanner.py` | Path traversal check on both `file_path` and `rules_path` |
| `volatility_bridge.py` | Path traversal check |
| `cert_transparency.py` | Domain format regex + URL encoding |
| `breach_lookup.py` | Email format regex + length limit |

---

## 8. Recommendations for Operators

1. **Run `npm audit` and `pip audit` regularly** — monitor dependencies for new CVEs
2. **Keep Agent v0 updated** — `agent-v0 update` checks GitHub releases and applies only changed files
3. **Use strong master passwords** — Argon2id protects against brute force, but a weak password is still a weak password
4. **Review audit logs** — `agent-v0 audit query` lets you inspect what agents have been doing
5. **Restrict bot access** — Use allowlists in `config.yaml` to control who can submit tasks via Telegram/Discord/WhatsApp
6. **Run behind a firewall** — The web dashboard binds to localhost by default; keep it that way in production

---

*For the full project description and architecture deep-dive, see [Description.md](./Description.md).*
