#!/usr/bin/env bash
# ============================================================================
# Agent v0 — Remote Installer (curl one-liner)
# Usage: curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/remote-install.sh | bash
# ============================================================================
set -euo pipefail

REPO_URL="https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/install-agent-v0.sh"

# Download and execute the full installer
curl -fsSL "$REPO_URL" | bash
