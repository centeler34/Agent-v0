#!/usr/bin/env bash
set -euo pipefail

echo "=== Agent Cyplex Installer ==="
echo ""

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"
echo "Detected: $OS $ARCH"

# Check prerequisites
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo "  [MISSING] $1"
        return 1
    else
        echo "  [OK] $1 ($(command -v "$1"))"
        return 0
    fi
}

echo ""
echo "Checking prerequisites..."
MISSING=0
check_cmd node || MISSING=1
check_cmd npm || MISSING=1
check_cmd cargo || MISSING=1
check_cmd go || MISSING=1
check_cmd python3 || MISSING=1

if [ "$MISSING" -eq 1 ]; then
    echo ""
    echo "Some prerequisites are missing. Please install them and re-run."
    echo "  Node.js:  https://nodejs.org/"
    echo "  Rust:     https://rustup.rs/"
    echo "  Go:       https://go.dev/dl/"
    echo "  Python:   https://www.python.org/"
    exit 1
fi

echo ""
echo "Installing Node.js dependencies..."
npm install

echo ""
echo "Building Rust crates..."
cargo build --release

echo ""
echo "Building Go binaries..."
cd go/net-probe && go build -o ../../dist/net-probe . && cd ../..

echo ""
echo "Installing Python dependencies..."
pip install -r python/forensics-service/requirements.txt 2>/dev/null || true
pip install -r python/osint-utils/requirements.txt 2>/dev/null || true

echo ""
echo "Building TypeScript..."
npx tsc

echo ""
echo "Creating config directory..."
mkdir -p ~/.cyplex/{logs,audit,workspaces,quarantine/{pending,approved,rejected}}

echo ""
echo "=== Installation complete ==="
echo "Run 'cyplex daemon start' to begin."
