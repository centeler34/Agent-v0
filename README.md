# Agent v0

**The universal multi-agent AI orchestration terminal. Coordinated intelligence for any desire.**

Agent v0 is a powerful framework for deploying fleets of specialized AI agents. While optimized for security researchers and developers, its modular architecture allows anyone to orchestrate complex, parallel workflows — from creative content creation and data analysis to automated research and technical troubleshooting — all from a single, secure terminal interface.

> **Current version: v1.4.4** | [Security Architecture](./Security.md) | [Releases](https://github.com/centeler34/Agent-v0/releases)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Security Implementation](#security-implementation)
- [Supported AI Providers](#supported-ai-providers)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Self-Updater](#self-updater)
- [Agent Roles](#agent-roles)
- [Tool Integration](#tool-integration)
- [Skill System](#skill-system)
- [Bot Integrations](#bot-integrations)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

- **CLI-first** — Full terminal interface with interactive REPL, no GUI required
- **Multi-agent orchestration** — A central "Agentic" orchestrator decomposes tasks, delegates to specialized subordinate agents, and synthesizes results
- **Model-agnostic** — Route tasks to Anthropic Claude, OpenAI GPT, or Google Gemini
- **OS-level sandboxing** — Agents are confined to assigned workspaces using Linux namespaces, seccomp, and Bubblewrap
- **Hash-chained audit logs** — Tamper-evident, append-only SHA-256 chained audit trail for every agent action
- **Encrypted keystore** — API keys and secrets encrypted at rest with Argon2id key derivation
- **Permission enforcement** — Fine-grained per-agent policies for filesystem, network, API access, and inter-agent messaging
- **Real tool execution** — Agents use Bash, Grep, Glob, FileRead/Write/Edit, and WebFetch with iterative tool-call loops
- **YAML-based skills** — Modular, extensible skill definitions for recon, code analysis, forensics, threat intel, and reporting
- **Persistent daemon** — Background daemon with Unix socket IPC; tasks survive CLI disconnection
- **Bot integrations** — Telegram, Discord, and WhatsApp adapters for remote task submission
- **Smart self-updater** — `agent-v0 update` checks GitHub releases, diffs files, and rebuilds only what changed
- **Web dashboard** — HTTPS web UI with Socket.IO for real-time task monitoring
- **Cost tracking** — Per-agent, per-session token usage and cost breakdown

---

## Architecture

```
                          +------------------+
                          |     CLI / REPL   |
                          |   (commander.js) |
                          +--------+---------+
                                   |
                          Unix Domain Socket
                                   |
                          +--------+---------+
                          |      Daemon      |
                          | (process manager |
                          |  heartbeat, IPC) |
                          +--------+---------+
                                   |
                          +--------+---------+
                          |     Agentic      |
                          |  (orchestrator)  |
                          | intent parsing   |
                          | task decompose   |
                          | result synthesis |
                          +--------+---------+
                                   |
              +--------------------+--------------------+
              |          |         |         |          |
         +----+----+ +---+---+ +--+---+ +---+---+ +---+---+
         |  Recon  | | Code  | |Forens| |OSINT | |Report |
         |  Agent  | | Agent | |Agent | |Agent | |Agent  |
         +---------+ +-------+ +------+ +------+ +-------+
              |          |         |         |          |
              +----------+---------+---------+----------+
                                   |
                          +--------+---------+
                          |  AgentToolkit    |
                          | per-agent tools  |
                          | workspace sandbox|
                          | audit logging    |
                          +--------+---------+
                                   |
                          +--------+---------+
                          |  Gateway Router  |
                          | rate limiting    |
                          | cost tracking    |
                          | fallback routing |
                          +--------+---------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
         Anthropic             OpenAI              Gemini
```

### How It Works

1. **User submits a task** via CLI, REPL, web dashboard, or bot message
2. **Agentic** (the orchestrator) parses intent from natural language
3. Tasks are **decomposed** into discrete subtasks with dependency ordering
4. Subtasks are **delegated** to specialized agents running concurrently
5. Each agent executes within its **sandbox** using assigned **tools and skills**
6. Agents make **iterative tool calls** (Bash, Grep, FileRead, WebFetch, etc.) with results fed back to the model
7. The **Gateway Router** handles all model API calls with rate limiting and fallback
8. Results are **aggregated and synthesized** back to the user
9. Every action is recorded in the **hash-chained audit log**

---

## Security Implementation

Agent v0 implements defense-in-depth security across multiple layers. The core security infrastructure is built in Rust for memory safety and performance, with additional hardening in the TypeScript and Python layers.

### Rust Security Layer

#### Sandbox Isolation (`rust/cyplex-sandbox`)
- **Linux Namespaces** — Each agent runs in isolated PID, mount, network, and user namespaces
- **Bubblewrap Integration** — Lightweight containerization without requiring root
- **Seccomp Filtering** — Restricts syscalls to a minimal allowlist per agent role
- **Path Guards** — Filesystem access confined to the agent's workspace; all traversal attempts blocked

#### Audit Trail (`rust/cyplex-audit`)
- **SHA-256 Hash Chain** — Each log entry includes the hash of the previous entry, creating a tamper-evident chain
- **Constant-Time Verification** — Hash comparisons use `subtle::ConstantTimeEq` to prevent timing side-channels
- **Append-Only Writer** — Log files are opened in append mode; entries cannot be modified
- **Sensitive Data Redaction** — Secrets are automatically masked before logging

#### Encrypted Keystore (`rust/cyplex-keystore`)
- **Argon2id Key Derivation** — Master key derived from user passphrase (memory-hard, GPU/ASIC resistant)
- **AES-256-GCM Encryption** — Keys encrypted at rest with authenticated encryption
- **Memory Zeroization** — Key material is zeroed from memory immediately after use via `zeroize`
- **Secure File Permissions** — Keystore written with mode `0o600` (owner read/write only)

#### Permission System (`rust/cyplex-permissions`)
- **Policy-Based Access Control** — YAML-defined policies per agent for filesystem, network, API, and messaging
- **Runtime Evaluation** — Every agent action checked against its policy before execution
- **Network Guards** — Outbound access restricted to allowed hosts with case-insensitive domain matching (RFC 4343)

#### Cryptographic Utilities (`rust/cyplex-crypto`)
- **Ed25519 Signatures** — EdDSA for skill verification and inter-agent authentication
- **HMAC-SHA256** — Message authentication with proper `Result` error handling (no panics)
- **OS-Level CSPRNG** — All random generation uses `OsRng` (not `thread_rng`)
- **Zeroize on Drop** — All cryptographic material securely wiped after use

#### IPC Security (`rust/cyplex-ipc`)
- **Unix Domain Sockets** — Communication restricted to local machine
- **Constant-Time Token Validation** — Session tokens compared with `subtle::ConstantTimeEq`
- **Max Message Size** — IPC protocol capped at 16 MiB to prevent DoS
- **Length-Prefixed Protocol** — Structured framing prevents injection

### TypeScript Security Layer

- **No Shell Injection** — All `exec` calls use `execFileSync` with argument arrays, never string interpolation
- **Command Blocklist** — Agent Bash tool blocks dangerous patterns (backtick substitution, `$()`, pipe-to-bash, reverse shells)
- **Security Headers** — All web servers set CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Payload Limits** — JSON body parsers capped at 10KB
- **Prototype Pollution Protection** — Secret redactor skips `__proto__`/`constructor`/`prototype` keys
- **No Secrets in .env** — API keys stored only in the encrypted keystore, never in plaintext config files

### Python Security Layer

- **Path Traversal Protection** — All forensics tools validate file paths and block `..` traversal
- **Input Validation** — OSINT tools validate domain format (regex) and URL-encode before requests
- **Email Validation** — Breach lookup validates email format before querying external APIs

---

## Supported AI Providers

| Provider | Models | Type |
|----------|--------|------|
| **Anthropic** | Claude 4 Opus, Sonnet, Haiku | Cloud (pay-per-token) |
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5 | Cloud (pay-per-token) |
| **Google Gemini** | Gemini Pro, Ultra | Cloud (pay-per-token) |

---

## Installation

### Quick Install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/install-agent-v0.sh | bash
```

This will install all dependencies (Node.js, Rust, Go, Python), clone the repo, build all components, and install `agent-v0` as a system-wide command.

### Manual Install

#### Prerequisites

- **Node.js** >= 20.0.0
- **Rust** (latest stable via rustup)
- **Go** >= 1.23
- **Python** >= 3.11
- **Linux** with kernel >= 5.10 (for namespace/seccomp support)

#### Steps

```bash
git clone https://github.com/centeler34/Agent-v0.git
cd Agent-v0

npm install
cargo build --release
cd go/net-probe && go build -o ../../dist/go/net-probe . && cd ../..
pip install -r python/forensics-service/requirements.txt
pip install -r python/osint-utils/requirements.txt
npx tsc

mkdir -p ~/.agent-v0/{logs,audit,workspaces,quarantine/{pending,approved,rejected}}
npm link
```

After installation:

```bash
agent-v0
```

---

## Configuration

On first launch, Agent v0 runs an **interactive setup wizard**:

1. **Master password** — Encrypts all API keys in the keystore
2. **Cloud AI providers** — Anthropic, OpenAI, Gemini API keys (stored encrypted, never in plaintext)
3. **Bot integrations** — Telegram, Discord, WhatsApp tokens
4. **Daemon settings** — Log level, socket path

Generated files under `~/.agent-v0/`:

| File | Purpose |
|------|---------|
| `config.yaml` | Full daemon, gateway, agent, bot, and security configuration |
| `keystore.enc` | AES-256-GCM encrypted keystore (Argon2id-derived key) |
| `tasks.db` | Encrypted SQLite database for tasks, secrets, sessions |
| `session.token` | Encrypted session token (3-day TTL) for "auth once" CLI access |
| `.env` | Daemon settings only (log level, socket path) — no secrets |

```bash
agent-v0 setup            # Re-run the wizard
agent-v0 config edit      # Open config.yaml in $EDITOR
```

---

## Usage

### Start the Daemon

```bash
agent-v0 daemon start       # Start background daemon
agent-v0 daemon status      # Check daemon health
agent-v0 daemon stop        # Graceful shutdown
```

### Interactive REPL

```bash
agent-v0                    # Launch interactive mode
```

| Command | Action |
|---------|--------|
| `/update` | Check for updates, download & rebuild only what changed |
| `/setup` | Re-run the setup wizard |
| `/uninstall` | Remove Agent v0 completely |
| `/status` | Query daemon health & providers |
| `/help` | Show available commands |
| `/clear` | Clear session context |
| `exit` | Quit the REPL |

### Task Management

```bash
agent-v0 task submit "Enumerate subdomains for example.com"
agent-v0 task status <task-id>
agent-v0 task cancel <task-id>
```

### Agent Management

```bash
agent-v0 agent list         # List all agents and their status
agent-v0 agent status recon # Check specific agent
```

### Key Management

```bash
agent-v0 keys set ANTHROPIC_API_KEY
agent-v0 keys list
```

### Audit Logs

```bash
agent-v0 audit query --agent recon --last 1h
```

### Web Dashboard

```bash
agent-v0 web start          # Launch HTTPS dashboard on localhost:3000
```

---

## Self-Updater

`agent-v0 update` is a smart differential updater:

```
$ agent-v0 update

  [*] Installed version: v1.4.4
  [*] Checking for updates...

  [*] Latest version:    v1.4.4  (released 2026-04-04)

  [+] You are already running the latest version!

      No download needed. Agent v0 v1.4.4 is up to date.
```

When a new version is available:

1. **Shows your installed version** (read from `package.json`)
2. **Checks GitHub Releases API** for the latest release
3. **If already on latest** — tells you and exits immediately (no download)
4. **If a new version exists:**
   - Downloads the release tarball from GitHub
   - **SHA-256 diffs every file** against your current install
   - Shows exactly which files were added, modified, or removed
   - **Copies only the changed files** — doesn't touch anything else
   - **Rebuilds only affected components** (e.g. TypeScript changes only trigger `tsc`, Rust changes only trigger `cargo build`)
   - Stamps the new version into `package.json`
   - Restarts the CLI

---

## Agent Roles

| Agent | Role | Tools | Capabilities |
|-------|------|-------|-------------|
| **Agentic** | Orchestrator | All | Task decomposition, delegation, result synthesis |
| **Recon** | Reconnaissance | Bash, Grep, Glob, FileRead, FileWrite, WebFetch | Subdomain enum, DNS sweeps, port scanning, fingerprinting |
| **Code** | Code Analysis | Bash, Grep, Glob, FileRead, FileWrite, FileEdit | Vulnerability review, dependency audit, decompilation |
| **Exploit Research** | CVE Research | Bash, Grep, Glob, FileRead, FileWrite, WebFetch | CVE chain building, ATT&CK mapping, patch diff |
| **Forensics** | Digital Forensics | Bash, Grep, Glob, FileRead, FileWrite | PCAP analysis, malware static analysis, memory forensics |
| **OSINT Analyst** | Intelligence | Bash, Grep, Glob, FileRead, FileWrite, WebFetch | Breach lookups, cert transparency, entity graphs |
| **Threat Intel** | Threat Intelligence | Bash, Grep, Glob, FileRead, WebFetch | Actor profiling, IoC ingestion, STIX export |
| **Report** | Documentation | Bash, Grep, Glob, FileRead, FileWrite, FileEdit | Pentest reports, executive summaries, findings |
| **Monitor** | Monitoring | Bash, Grep, Glob, FileRead, WebFetch | Continuous asset monitoring and alerting |
| **Scribe** | Notes | Bash, Grep, Glob, FileRead, FileWrite, FileEdit | Session documentation and note-taking |

---

## Tool Integration

Every agent has access to a curated set of tools via the `AgentToolkit` system. During task execution, agents make tool calls that are executed locally and fed back iteratively.

### Available Tools

| Tool | Description |
|------|-------------|
| **Bash** | Execute shell commands with configurable timeouts and injection protection |
| **Grep** | Search file contents using ripgrep regex patterns with glob/type filtering |
| **Glob** | Find files by name pattern (e.g., `*.py`, `*.yaml`) |
| **FileRead** | Read file contents with line numbers, offset, and limit |
| **FileWrite** | Write or create files in the agent's workspace |
| **FileEdit** | Find-and-replace text within files |
| **WebFetch** | Fetch content from HTTP/HTTPS URLs (APIs, feeds, pages) |

### Security Model

- **Per-agent allowlists** — Each agent only has access to the tools it needs
- **Workspace sandboxing** — All file operations confined to the agent's assigned workspace
- **Path traversal protection** — Resolved paths checked against workspace root
- **Command injection protection** — Bash tool blocks dangerous shell patterns (backtick substitution, `$()`, pipe-to-bash)
- **Cloud metadata blocking** — WebFetch blocks requests to cloud metadata endpoints (169.254.169.254)
- **Audit logging** — Every tool invocation recorded with agent ID, parameters, result, and timestamp

### How It Works

1. Agent receives a task and calls `queryModelWithTools()`
2. The AI model's system prompt includes descriptions of available tools
3. When the model outputs a `<tool_call>` block, the runtime parses and executes it
4. Tool results are fed back to the model for the next reasoning step
5. This loop continues (up to 10 rounds) until the model produces a final answer
6. All tool invocations are tracked in the result (`tools_used`, `tool_calls_count`)

### Tool Introspection

```bash
agent-v0 /tools-inspect           # Summary of all tools
agent-v0 /tools-inspect --json    # Full JSON Schema definitions
agent-v0 /tools-inspect Bash      # Details for a specific tool
agent-v0 /tools-inspect --last-request  # Inspect the last API request sent to Claude
```

---

## Skill System

Skills are modular YAML definitions that give agents specific capabilities:

```
skills/
  recon/          subdomain_enum, dns_sweep, shodan_sweep, tech_fingerprint, wayback_crawl
  code/           vulnerability_review, decompile_analysis, dependency_audit, poc_generator
  exploit_research/ cve_chain_builder, attck_mapper, patch_diff
  forensics/      pcap_analysis, malware_static, log_timeline
  threat_intel/   actor_profile, ioc_ingest, stix_export
  report/         pentest_report, executive_summary, finding_writeup
```

Custom skills can be loaded at runtime and are verified via cryptographic signatures and YARA scanning before execution.

---

## Bot Integrations

Agent v0 supports receiving tasks from chat platforms:

- **Telegram** — via grammy SDK
- **Discord** — via discord.js
- **WhatsApp** — via @whiskeysockets/baileys

All incoming messages are normalized, routed through the Agentic orchestrator, and responses sent back to the originating channel. Bot access is controlled via allowlists and rate limiting.

---

## Project Structure

```
Agent-v0/
+-- src/                    TypeScript core
|   +-- orchestrator/       Task decomposition & orchestration
|   +-- gateway/            Multi-provider AI routing
|   +-- cli/                CLI entry point, commands, updater, setup wizard
|   +-- daemon/             Background daemon & IPC
|   +-- agents/             Specialized agent implementations (9 agents + base)
|   +-- bots/               Chat platform adapters (Telegram, Discord, WhatsApp)
|   +-- security/           Keystore bridge, secret redactor, audit bridge
|   +-- sessions/           Session & workspace management
|   +-- skills/             Skill loading, execution & verification
|   +-- tools/              Tool execution runtime & AgentToolkit
|   +-- web/                Web dashboard (HTTPS + Socket.IO)
|   +-- types/              Shared type definitions
+-- tools/                  Extended tool framework (React/Ink terminal UI)
+-- rust/                   Rust security infrastructure
|   +-- cyplex-sandbox/     OS-level process sandboxing
|   +-- cyplex-audit/       Hash-chained audit logging
|   +-- cyplex-keystore/    Encrypted key storage (AES-256-GCM + Argon2id)
|   +-- cyplex-ipc/         Unix socket IPC with constant-time auth
|   +-- cyplex-permissions/ Policy-based access control & network guards
|   +-- cyplex-crypto/      Ed25519, HMAC-SHA256, OsRng, zeroize
+-- go/                     Go utilities
|   +-- net-probe/          Network reconnaissance tools
+-- python/                 Python microservices
|   +-- forensics-service/  PCAP, YARA, Volatility, PE analysis
|   +-- osint-utils/        Cert transparency, breach lookup
+-- skills/                 YAML skill definitions
+-- config/                 Configuration templates
+-- scripts/                Build & install scripts
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | >= 20.0 |
| **Language** | TypeScript | 6.0 |
| **AI SDKs** | @anthropic-ai/sdk, openai, @google/generative-ai | 0.82, 6.33, 0.24 |
| **CLI** | Commander.js | 14.0 |
| **Web** | Express + Socket.IO | 5.2 + 4.8 |
| **Bots** | grammy, discord.js, baileys | 1.42, 14.26, 7.0 |
| **Security** | Rust (6 crates) | Edition 2021 |
| **Crypto** | aes-gcm, argon2, ed25519-dalek, hmac, sha2, subtle | Latest stable |
| **Sandbox** | nix (Linux namespaces), libc | 0.31, 0.2 |
| **Forensics** | Python (scapy, yara-python, volatility3, pefile) | Latest stable |
| **Network** | Go net-probe | Go 1.23 |
| **Schema** | Zod | 4.3 |

---

## License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.
