# [Security Architecture & Updates](./Security.md)

# Agent v0

**The universal multi-agent AI orchestration terminal. Coordinated intelligence for any desire.**

Agent v0 is a powerful framework for deploying fleets of specialized AI agents. While optimized for security researchers and developers, its modular architecture allows anyone to orchestrate complex, parallel workflows—from creative content creation and data analysis to automated research and technical troubleshooting—all from a single, secure terminal interface.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Security Implementation](#security-implementation)
- [Supported AI Providers](#supported-ai-providers)
- [Installation](#installation)
  - [Quick Install (Linux)](#quick-install-linux)
  - [Manual Install](#manual-install)
- [Configuration](#configuration)
- [Usage](#usage)
- [Agent Roles](#agent-roles)
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
- **Permission enforcement** — Fine-grained per-agent policies for filesystem, network, API access (including encrypted API keys from the database), and inter-agent messaging
- **YAML-based skills** — Modular, extensible skill definitions for recon, code analysis, forensics, threat intel, and reporting
- **Persistent daemon** — Background daemon with Unix socket IPC; tasks survive CLI disconnection
- **Bot integrations** — Telegram, Discord, and WhatsApp adapters for remote task submission
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
         |  Recon  | | Code  | |Forensic| |OSINT | |Report |
         |  Agent  | | Agent | | Agent | |Agent | |Agent  |
         +---------+ +-------+ +-------+ +------+ +-------+
              |          |         |         |          |
              +----------+---------+---------+----------+
                                   |
                          +--------+---------+
                          |  Gateway Router  |
                          | rate limiting    |
                          | cost tracking    |
                          | fallback routing |
                          +--------+---------+
                                   |
              +--------------------+--------------------+
              |          |         |         |          |
         Anthropic   OpenAI    Gemini
```

### How It Works

1. **User submits a task** via CLI, REPL, or bot message
2. **Agentic** (the orchestrator) parses intent from natural language
3. Tasks are **decomposed** into discrete subtasks with dependency ordering
4. Subtasks are **delegated** to specialized agents running concurrently
5. Each agent executes within its **sandbox** using assigned **skills**
6. The **Gateway Router** handles all model API calls with rate limiting and fallback
7. Results are **aggregated and synthesized** back to the user
8. Every action is recorded in the **hash-chained audit log**

---

## Security Implementation (v1.0.0 Hardened)

Agent v0 implements defense-in-depth security across multiple layers, all built in Rust for memory safety and performance:

### Sandbox Isolation (`rust/cyplex-sandbox`)

- **Linux Namespaces** — Each agent process runs in isolated PID, mount, network, and user namespaces
- **Bubblewrap Integration** — Leverages `bwrap` for lightweight containerization without requiring root
- **Seccomp Filtering** — Restricts available syscalls to a minimal allowlist per agent role
- **Path Guards** — Filesystem access is confined to the agent's assigned workspace directory; all path traversal attempts are blocked

### Audit Trail (`rust/cyplex-audit`)

- **SHA-256 Hash Chain** — Each log entry includes the hash of the previous entry, creating a tamper-evident chain
- **Append-Only Writer** — Log files are opened in append mode; entries cannot be modified or deleted
- **Sensitive Data Redaction** — API keys, tokens, passwords, and other secrets are automatically masked before logging
- **Structured Entries** — Every entry records: timestamp, agent ID, action type, target, payload hash, and chain hash

### Encrypted Keystore (`rust/cyplex-keystore`)

- **Argon2id Key Derivation** — Master key derived from user passphrase using Argon2id (memory-hard KDF resistant to GPU/ASIC attacks)
- **Authenticated Encryption** — Keys encrypted at rest using modern AEAD ciphers
- **Memory Zeroization** — Sensitive key material is zeroed from memory immediately after use via the `zeroize` crate

### Permission System (`rust/cyplex-permissions`)

- **Policy-Based Access Control** — YAML-defined permission policies per agent specifying allowed filesystem paths, network hosts/ports, API keys, and inter-agent communication channels
- **Runtime Evaluation** — Every agent action is checked against its policy before execution
- **Network Guards** — Outbound network access is restricted to explicitly allowed hosts and ports

### Cryptographic Utilities (`rust/cyplex-crypto`)

- **Ed25519 Signatures** — EdDSA digital signatures for skill verification and inter-agent message authentication
- **HMAC Authentication** — Message authentication codes for IPC protocol integrity
- **Secure RNG** — Cryptographically secure random number generation for tokens and nonces
- **Zeroize** — All cryptographic material is securely wiped from memory after use

### IPC Security (`rust/cyplex-ipc`)

- **Unix Domain Sockets** — Communication restricted to local machine; no network exposure
- **Length-Prefixed JSON Protocol** — Structured message framing prevents injection attacks
- **Session Tokens** — Cryptographically generated session tokens for client authentication
- **Prompt Injection Detection** — Skill inputs are scanned for prompt injection patterns before execution

### Skill Security

- **Signature Verification** — Skills can be cryptographically signed and verified before loading
- **YARA Scanning** — Skill definitions are scanned against YARA rules to detect malicious patterns
- **Quarantine System** — Suspicious skills are isolated in a quarantine directory for manual review before approval

---

### Security Fixes — SSH Tunnel Removal

The `go/ssh-tunnel` module was removed entirely after a security review identified **9 vulnerabilities**, including:

- **Critical:** SSH host key verification disabled (`ssh.InsecureIgnoreHostKey()`), enabling Man-in-the-Middle attacks
- **High:** Race conditions in tunnel reconnection logic (no mutex protection on shared state)
- **High:** Missing SSH private key file permission checks (keys could be world-readable)
- **High:** Double-close race on bidirectional connection forwarding
- **Medium:** No input validation on host/port configuration fields
- **Medium:** Hardcoded SSH port 22 with no configurability
- **Medium:** Config file permissions not verified before loading
- **Low:** Information disclosure in error logging, insufficient keepalive validation

The SSH tunnel was originally used for proxying to local LLM backends (Ollama, LM Studio), which have also been removed. The `golang.org/x/crypto` dependency was eliminated along with it. Rather than patching 9 separate issues, the entire module was deleted as it no longer served a purpose.

---

## Supported AI Providers

| Provider | Type | Models | Cost |
|----------|------|--------|------|
| **Anthropic** | Cloud | Claude 4 Opus, Sonnet, Haiku | Pay-per-token |
| **OpenAI** | Cloud | GPT-4o, GPT-4, GPT-3.5 | Pay-per-token |
| **Google Gemini** | Cloud | Gemini Pro, Ultra | Pay-per-token |

---

## Installation

### Quick Install (Linux)

Paste this single command into your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/install-agent-v0.sh | bash
```

This will:
1. Install all required system dependencies (Node.js, Rust, Go, Python)
2. Clone the repository
3. Build all components (TypeScript, Rust, Go, Python)
4. Install `agent-v0` as a system-wide command
5. Create the configuration directory at `~/.agent-v0/`

After installation, just type:

```bash
agent-v0
```

### Manual Install

#### Prerequisites

- **Node.js** >= 20.0.0 (`https://nodejs.org/`)
- **Rust** (latest stable via `https://rustup.rs/`)
- **Go** >= 1.22 (`https://go.dev/dl/`)
- **Python** >= 3.11 (`https://www.python.org/`)
- **Linux** with kernel >= 5.10 (for namespace/seccomp support)

#### Steps

```bash
# Clone the repository
git clone https://github.com/centeler34/Agent-v0.git
cd Agent-v0

# Install Node.js dependencies
npm install --legacy-peer-deps

# Build Rust security crates
cargo build --release

# Build Go utilities
mkdir -p dist/go
cd go/net-probe && go build -o ../../dist/go/net-probe . && cd ../..

# Install Python dependencies
pip install -r python/forensics-service/requirements.txt
pip install -r python/osint-utils/requirements.txt

# Build TypeScript
npx tsc

# Create config directories
mkdir -p ~/.agent-v0/{logs,audit,workspaces,quarantine/{pending,approved,rejected}}

# Link the command globally
npm link
```

---

## Configuration

On first launch, Agent v0 runs an **interactive setup wizard** that guides you through:

1. **Master password** — Encrypts all API keys in the keystore
2. **Cloud AI providers** — Anthropic, OpenAI, Gemini API keys
3. **Bot integrations** — Telegram, Discord, WhatsApp tokens
4. **Daemon settings** — Log level, socket path

The wizard generates the following files under `~/.agent-v0/`:

| File | Purpose |
|------|---------|
| `~/.agent-v0/.env` | Daemon settings (log level, socket path) — loaded into `process.env` on every launch |
| `~/.agent-v0/config.yaml` | Full daemon, gateway, agent, bot, and security configuration |
| `~/.agent-v0/keystore.enc` | AES-256-GCM encrypted master key derived from your password, used to unlock `tasks.db` |
| `~/.agent-v0/tasks.db` | Encrypted SQLite database storing tasks, secrets (API keys), and session data |
| `~/.agent-v0/session.token` | Encrypted session token, valid for 3 days, allowing "auth once" CLI access |

To re-run the wizard at any time:

```bash
agent-v0 setup
```

You can also edit files directly:

```bash
agent-v0 config edit          # Open config.yaml in $EDITOR
nano ~/.agent-v0/.env               # Edit daemon settings manually (API keys are in encrypted tasks.db)
```

See [config/config.example.yaml](config/config.example.yaml) for full configuration reference.

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

Inside the REPL, slash commands are available:

| Command | Action |
|---------|--------|
| `/update` | Fetch latest updates from GitHub, rebuild all components, and restart |
| `/setup` | Re-run the setup wizard to reconfigure API keys and settings |
| `/uninstall` | Remove Agent v0 completely (config, data, binaries) |
| `/status` | Query daemon status |
| `/help` | Show available commands |
| `exit` | Quit the REPL |

### Updating

Pull the latest patches, rebuild, and restart in one command:

```bash
agent-v0 update             # From the command line
```

Or type `/update` inside the interactive REPL. The updater will:
1. Fetch the latest commits from GitHub
2. Show a changelog of what's new
3. Rebuild TypeScript, Rust, Go, and Python components
4. Restart the CLI automatically

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

### Skill Management

```bash
agent-v0 skill list         # List available skills
agent-v0 skill load ./custom-skill.yaml
agent-v0 skill verify ./skill.yaml
```

### Model Management

```bash
### Audit Logs

```bash
agent-v0 audit query --agent recon --last 1h
```

### Key Management

```bash
agent-v0 keys set ANTHROPIC_API_KEY
agent-v0 keys list
```

### Bot Management

```bash
agent-v0 bot enable telegram
agent-v0 bot disable discord
```

### Session Management

```bash
agent-v0 session list
agent-v0 session archive <session-id>
```

---

## Agent Roles

| Agent | Role | Capabilities |
|-------|------|-------------|
| **Agentic** | Orchestrator | Task decomposition, delegation, result synthesis |
| **Recon** | Reconnaissance | Subdomain enumeration, DNS sweeps, port scanning, fingerprinting |
| **Code** | Code Analysis | Vulnerability review, dependency audit, decompilation analysis |
| **Exploit Research** | CVE Research | CVE chain building, ATT&CK mapping, patch diff analysis |
| **Forensics** | Digital Forensics | PCAP analysis, malware static analysis, memory forensics, log timelines |
| **OSINT Analyst** | Intelligence | Breach lookups, certificate transparency, entity graph building |
| **Threat Intel** | Threat Intelligence | Actor profiling, IoC ingestion, STIX export |
| **Report** | Documentation | Pentest reports, executive summaries, finding writeups |
| **Monitor** | Monitoring | Continuous asset monitoring and alerting |
| **Scribe** | Documentation | Session documentation and note-taking |

---

## Skill System

Skills are modular YAML definitions that give agents specific capabilities. Located in the `skills/` directory:

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

## Limitless Extensibility

Agent v0 is not just a tool; it is a platform. You can define your own agent roles in `config.yaml`, assigning them specific models, workspace sandboxes, and permission sets. 

Whether you want a **Creative Writer Agent**, a **Financial Analyst Agent**, or a **Personal Assistant Agent**, simply define the role and load the corresponding skills. The orchestrator handles the delegation.


## Bot Integrations

Agent v0 supports receiving tasks from chat platforms:

- **Telegram** — via grammy SDK
- **Discord** — via discord.js
- **WhatsApp** — via @whiskeysockets/baileys

All incoming messages are normalized to a unified format, routed through the Agentic orchestrator, and responses are sent back to the originating channel. Bot access is controlled via allowlists and rate limiting.


## Project Structure

```
Agent-v0/
+-- src/                    TypeScript core
|   +-- orchestrator/       Task decomposition & orchestration
|   +-- gateway/            Multi-provider AI routing
|   +-- cli/                CLI entry point & commands
|   +-- daemon/             Background daemon & IPC
|   +-- agents/             Specialized agent implementations
|   +-- bots/               Chat platform adapters
|   +-- security/           TypeScript bridges to Rust security layer
|   +-- sessions/           Session & workspace management
|   +-- skills/             Skill loading, execution & verification
|   +-- types/              Shared type definitions
+-- rust/                   Rust security infrastructure
|   +-- cyplex-sandbox/     OS-level process sandboxing
|   +-- cyplex-audit/       Hash-chained audit logging
|   +-- cyplex-keystore/    Encrypted key storage
|   +-- cyplex-ipc/         Unix socket IPC
|   +-- cyplex-permissions/ Policy-based access control
|   +-- cyplex-crypto/      Cryptographic utilities
+-- go/                     Go utilities
|   +-- net-probe/          Network reconnaissance tools
+-- python/                 Python microservices
|   +-- forensics-service/  Digital forensics analysis
|   +-- osint-utils/        OSINT data gathering
+-- skills/                 YAML skill definitions
+-- config/                 Configuration templates
+-- scripts/                Build & install scripts
```

---

## License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.
