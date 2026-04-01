#!/usr/bin/env bash
set -euo pipefail
echo "=== Agent v0 Development Environment Setup ==="
npm install
mkdir -p ~/.agent-v0/{logs,audit,workspaces,quarantine/{pending,approved,rejected}}
echo "Dev environment ready. Run 'make dev' to start."
