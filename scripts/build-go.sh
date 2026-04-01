#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist
echo "Building Go binaries..."
cd go/net-probe && go build -o ../../dist/net-probe . && cd ../..
echo "Done. Binaries in dist/"
