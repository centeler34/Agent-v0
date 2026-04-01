# Agent v0 Security Architecture & Hardening

This document outlines the security measures, encryption implementations, and the resolution of legacy security concerns within the Agent v0 ecosystem.

---

## 1. The SSH Tunnel Nightmare (Resolved in v1.0.0)

Prior to the v1.0.0 hardening release, the project included a Go-based SSH tunnel module (`go/ssh-tunnel`) intended for local LLM connectivity. A comprehensive security audit identified **9 critical-to-medium vulnerabilities** that posed a significant risk to user infrastructure:

- **Man-in-the-Middle (MITM) Risk:** SSH host key verification was completely disabled (`InsecureIgnoreHostKey`), allowing silent interception.
- **Credential Exposure:** Private keys were loaded without permission checks (non-0600), and configuration details were leaked in plaintext logs.
- **Stability & Concurrency:** Race conditions in reconnection logic and double-close bugs created potential for denial-of-service and memory corruption.

**Resolution:** The entire module has been purged. Agent v0 now exclusively uses cloud-based providers over TLS-secured HTTPS, removing this attack surface entirely.

---

## 2. Encryption Implementations

Agent v0 employs defense-in-depth encryption to protect sensitive research data and API credentials.

### 2.1 AES-256-GCM Secret Storage
All secrets (AI provider keys, bot tokens) are stored using **Authenticated Encryption with Associated Data (AEAD)** via AES-256-GCM.
- **Initial Vector (IV):** A fresh 12-byte random IV is generated for every encryption operation to prevent pattern analysis.
- **Integrity:** The GCM authentication tag ensures that encrypted data has not been tampered with while at rest.

### 2.2 Column-Level SQLite Encryption
The `tasks.db` SQLite database utilizes column-level encryption for the `task_data`, `result_data`, and `secrets` tables.
- **Encryption Key:** All data is bound to the 32-byte master key derived from the user's master password.
- **Persistence:** Sensitive task context and results survive daemon restarts but remain encrypted on disk.

### 2.3 Key Derivation (Argon2id / Scrypt)
The master key used for database and keystore encryption is derived from the user's master password.
- **Mechanism:** Uses memory-hard KDF functions (Argon2id in the Rust layer, Scrypt in the TypeScript layer) to mitigate brute-force and GPU-accelerated attacks.
- **Zeroization:** In-memory key material is securely wiped using the `zeroize` crate immediately after use.

---

## 3. Authentication & Session Management

### 3.1 "Auth Once" Session Tokens
To balance security and usability, Agent v0 implements an encrypted session token system.
- **Lifespan:** Tokens are valid for **3 days**.
- **Security:** The token itself is an encrypted payload containing an expiration timestamp, bound to the derived master key.
- **Re-authentication:** Upon expiration or logout, the token is deleted, and the user must provide the master password again to unlock the fleet.

---

## 4. Operational Security

### 4.1 Sandboxing (Bubblewrap)
Agents are confined using Linux namespaces and `bwrap`.
- **Filesystem Isolation:** Agents can only access their designated `workspaces/<agent_name>` directory.
- **Syscall Filtering:** Seccomp profiles restrict the agent's ability to interact with the kernel.

### 4.2 Hash-Chained Audit Logs
Every action taken by an agent is recorded in a structured JSONL log.
- **Tamper Evidence:** Each entry contains a SHA-256 hash of the previous entry, making the log append-only and cryptographically verifiable.
- **Redaction:** The `secret_redactor` automatically masks API keys and sensitive payloads before they are written to the audit trail.

---

*For more information on the technical specifications, see Description.md.*
