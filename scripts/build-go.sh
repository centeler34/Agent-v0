#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist/go
echo "Building Go binaries..."
cd go/net-probe && go build -o ../../dist/go/net-probe . && cd ../..
echo "Done. Binaries in dist/"
