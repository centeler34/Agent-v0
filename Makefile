.PHONY: all build build-rust build-ts build-go clean test lint dev install

all: build

# ── Build ──────────────────────────────────────────────────────────

build: build-rust build-ts build-go

build-rust:
	cargo build --release

build-ts:
	npx tsc

build-go:
	cd go/net-probe && go build -o ../../dist/net-probe .

# ── Development ────────────────────────────────────────────────────

dev:
	npx tsx watch src/cli/cli.ts

install:
	npm install
	pip install -r python/forensics-service/requirements.txt
	pip install -r python/osint-utils/requirements.txt

# ── Test ───────────────────────────────────────────────────────────

test: test-rust test-ts test-py

test-rust:
	cargo test

test-ts:
	npx vitest run

test-py:
	python -m pytest tests/python/

# ── Lint ───────────────────────────────────────────────────────────

lint:
	npx eslint src/ --ext .ts,.tsx
	cargo clippy -- -D warnings

# ── Clean ──────────────────────────────────────────────────────────

clean:
	rm -rf dist/ target/ __pycache__/
