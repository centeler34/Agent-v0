#!/usr/bin/env bash
# ============================================================================
# Agent v0 — Universal Installer (Linux + macOS)
# Usage: curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-v0/main/scripts/install-agent-v0.sh | bash
# ============================================================================
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="$HOME/.agent-v0"
BIN_LINK="/usr/local/bin/agent-v0"
REPO_URL="https://github.com/centeler34/Agent-v0.git"
NODE_MIN="20"
GO_MIN="1.23"
PYTHON_MIN="3.11"

banner() {
    echo -e "${CYAN}"
    echo "  ___                    _            ___  "
    echo " / _ \  __ _  ___ _ __ | |_  __   __ / _ \ "
    echo "| |_| |/ _\` |/ _ \ '_ \| __| \ \ / /| | | |"
    echo "| | | | (_| |  __/ | | | |_   \ V / | |_| |"
    echo "|_| |_|\__, |\___|_| |_|\__|   \_/   \___/ "
    echo "       |___/                               "
    echo -e "${NC}"
    echo -e "${BOLD}Multi-Agent AI Orchestration CLI Terminal${NC}"
    echo ""
}

info()    { echo -e "${CYAN}[*]${NC} $1"; }
success() { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
fail()    { echo -e "${RED}[x]${NC} $1"; exit 1; }

# --------------------------------------------------------------------------
# OS Detection
# --------------------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux)  PLATFORM="linux" ;;
    Darwin)
        PLATFORM="macos"
        if [ "$ARCH" != "arm64" ]; then
            fail "Agent v0 only supports Apple Silicon (M1/M2/M3/M4/M5) Macs. Intel Macs are not supported."
        fi
        ;;
    *)      fail "Unsupported operating system: $OS. Agent v0 supports Linux and macOS (Apple Silicon)." ;;
esac

case "$ARCH" in
    x86_64)  GOARCH="amd64" ;;
    aarch64) GOARCH="arm64" ;;
    arm64)   GOARCH="arm64" ;;
    *)       fail "Unsupported architecture: $ARCH" ;;
esac

# --------------------------------------------------------------------------
# Package Manager Detection
# --------------------------------------------------------------------------
detect_pkg_manager() {
    if [ "$PLATFORM" = "macos" ]; then
        if command -v brew &>/dev/null; then
            echo "brew"
        else
            echo "unknown"
        fi
        return
    fi
    # Linux
    if command -v apt-get &>/dev/null; then echo "apt"
    elif command -v dnf &>/dev/null; then echo "dnf"
    elif command -v pacman &>/dev/null; then echo "pacman"
    elif command -v zypper &>/dev/null; then echo "zypper"
    elif command -v apk &>/dev/null; then echo "apk"
    else echo "unknown"
    fi
}

# --------------------------------------------------------------------------
# Install system packages
# --------------------------------------------------------------------------
install_system_deps() {
    local pm
    pm=$(detect_pkg_manager)
    info "Detected: $OS $ARCH (package manager: $pm)"

    if [ "$PLATFORM" = "macos" ]; then
        if [ "$pm" = "unknown" ]; then
            warn "Homebrew not found. Installing Homebrew first..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            # Source Homebrew for the rest of this script
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
        info "Installing system dependencies via Homebrew..."
        brew install git curl openssl 2>/dev/null || true
        return
    fi

    # Linux
    case "$pm" in
        apt)
            sudo apt-get update -qq
            sudo apt-get install -y -qq git curl build-essential bubblewrap openssl
            ;;
        dnf)
            sudo dnf install -y git curl gcc gcc-c++ make bubblewrap openssl
            ;;
        pacman)
            sudo pacman -Sy --noconfirm git curl base-devel bubblewrap openssl
            ;;
        zypper)
            sudo zypper install -y git curl gcc gcc-c++ make bubblewrap openssl
            ;;
        apk)
            sudo apk add git curl build-base bubblewrap openssl
            ;;
        *)
            warn "Unknown package manager. Please install git, curl, build tools, openssl, and bubblewrap (Linux) manually."
            ;;
    esac
}

# --------------------------------------------------------------------------
# Install Node.js via nvm if missing or outdated
# --------------------------------------------------------------------------
ensure_node() {
    if command -v node &>/dev/null; then
        local ver
        ver=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$ver" -ge "$NODE_MIN" ]; then
            success "Node.js $(node -v) found"
            return
        fi
        warn "Node.js $(node -v) is too old (need >= $NODE_MIN)"
    fi

    if [ "$PLATFORM" = "macos" ] && command -v brew &>/dev/null; then
        info "Installing Node.js via Homebrew..."
        brew install node
        success "Node.js $(node -v) installed"
        return
    fi

    info "Installing Node.js via nvm..."
    export NVM_DIR="$HOME/.nvm"
    if [ ! -d "$NVM_DIR" ]; then
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    fi
    # shellcheck source=/dev/null
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts
    success "Node.js $(node -v) installed"
}

# --------------------------------------------------------------------------
# Install Rust via rustup if missing
# --------------------------------------------------------------------------
ensure_rust() {
    if command -v cargo &>/dev/null; then
        success "Rust $(rustc --version | awk '{print $2}') found"
        return
    fi

    info "Installing Rust via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
    success "Rust $(rustc --version | awk '{print $2}') installed"
}

# --------------------------------------------------------------------------
# Install Go if missing or outdated
# --------------------------------------------------------------------------
ensure_go() {
    if command -v go &>/dev/null; then
        local ver
        ver=$(go version | grep -oE '[0-9]+\.[0-9]+' | head -1)
        success "Go $ver found"
        return
    fi

    if [ "$PLATFORM" = "macos" ] && command -v brew &>/dev/null; then
        info "Installing Go via Homebrew..."
        brew install go
        success "Go $(go version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+') installed"
        return
    fi

    # Linux: download binary
    info "Installing Go ${GO_MIN}..."
    local go_os="linux"
    curl -fsSL "https://go.dev/dl/go${GO_MIN}.${go_os}-${GOARCH}.tar.gz" -o /tmp/go.tar.gz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf /tmp/go.tar.gz
    rm /tmp/go.tar.gz
    export PATH="/usr/local/go/bin:$PATH"

    # Add to shell profile
    local profile="$HOME/.bashrc"
    [ "$PLATFORM" = "macos" ] && profile="$HOME/.zshrc"
    echo 'export PATH="/usr/local/go/bin:$PATH"' >> "$profile"
    success "Go $(go version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+') installed"
}

# --------------------------------------------------------------------------
# Install Python if missing
# --------------------------------------------------------------------------
ensure_python() {
    if command -v python3 &>/dev/null; then
        local ver
        ver=$(python3 --version | awk '{print $2}')
        success "Python $ver found"
        return
    fi

    if [ "$PLATFORM" = "macos" ] && command -v brew &>/dev/null; then
        info "Installing Python via Homebrew..."
        brew install python
        success "Python $(python3 --version | awk '{print $2}') installed"
        return
    fi

    # Linux
    info "Installing Python..."
    local pm
    pm=$(detect_pkg_manager)
    case "$pm" in
        apt)    sudo apt-get install -y -qq python3 python3-pip python3-venv ;;
        dnf)    sudo dnf install -y python3 python3-pip ;;
        pacman) sudo pacman -Sy --noconfirm python python-pip ;;
        zypper) sudo zypper install -y python3 python3-pip ;;
        apk)    sudo apk add python3 py3-pip ;;
        *)      fail "Cannot auto-install Python. Please install Python >= $PYTHON_MIN manually." ;;
    esac
    success "Python $(python3 --version | awk '{print $2}') installed"
}

# --------------------------------------------------------------------------
# Clone & Build
# --------------------------------------------------------------------------
clone_repo() {
    if [ -d "$INSTALL_DIR" ]; then
        info "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull --ff-only || true
    else
        info "Cloning Agent v0..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
}

build_typescript() {
    info "Installing Node.js dependencies..."
    npm install --legacy-peer-deps 2>&1 | tail -1

    info "Compiling TypeScript..."
    npx tsc
    success "TypeScript build complete"
}

build_rust() {
    info "Building Rust security crates (release mode)..."
    cargo build --release 2>&1 | tail -3
    success "Rust build complete"
}

build_go() {
    info "Building Go utilities..."
    mkdir -p dist/go
    (cd go/net-probe && go build -o ../../dist/go/net-probe .)
    success "Go build complete"
}

install_python_deps() {
    info "Installing Python dependencies..."
    python3 -m pip install -r python/forensics-service/requirements.txt --quiet 2>/dev/null || true
    python3 -m pip install -r python/osint-utils/requirements.txt --quiet 2>/dev/null || true
    success "Python dependencies installed"
}

setup_config() {
    info "Setting up configuration directories..."
    mkdir -p "$HOME/.agent-v0"/{logs,audit,workspaces,sessions,certs}
    mkdir -p "$HOME/.agent-v0/quarantine"/{pending,approved,rejected}

    if [ ! -f "$HOME/.agent-v0/config.yaml" ]; then
        cp config/config.example.yaml "$HOME/.agent-v0/config.yaml"
        success "Default config created at ~/.agent-v0/config.yaml"
    else
        warn "Config already exists at ~/.agent-v0/config.yaml -- skipping"
    fi
}

install_command() {
    info "Installing 'agent-v0' command..."

    # Create wrapper script (platform-aware)
    cat > "$INSTALL_DIR/agent-v0" << 'WRAPPER'
#!/usr/bin/env bash
INSTALL_DIR="$HOME/.agent-v0"
export NODE_PATH="$INSTALL_DIR/node_modules"

# Ensure nvm node is available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null

# Ensure cargo/go are in PATH
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env" 2>/dev/null
[ -d "/usr/local/go/bin" ] && export PATH="/usr/local/go/bin:$PATH"

# macOS Apple Silicon Homebrew path
if [ "$(uname -s)" = "Darwin" ]; then
    export PATH="/opt/homebrew/bin:$PATH"
fi

exec node "$INSTALL_DIR/dist/cli/cli.js" "$@"
WRAPPER
    chmod +x "$INSTALL_DIR/agent-v0"

    # Symlink to /usr/local/bin
    if [ -w /usr/local/bin ] || sudo -n true 2>/dev/null; then
        sudo ln -sf "$INSTALL_DIR/agent-v0" "$BIN_LINK"
        success "'agent-v0' installed to $BIN_LINK"
    else
        # Fallback: add to user's local bin
        mkdir -p "$HOME/.local/bin"
        ln -sf "$INSTALL_DIR/agent-v0" "$HOME/.local/bin/agent-v0"

        local profile="$HOME/.bashrc"
        [ "$PLATFORM" = "macos" ] && profile="$HOME/.zshrc"

        if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$profile"
            warn "Added ~/.local/bin to PATH in $profile -- restart your shell or run: source $profile"
        fi
        success "'agent-v0' installed to ~/.local/bin/agent-v0"
    fi
}

# --------------------------------------------------------------------------
# macOS LaunchAgent (optional daemon auto-start)
# --------------------------------------------------------------------------
setup_launchagent() {
    if [ "$PLATFORM" != "macos" ]; then return; fi

    local plist_dir="$HOME/Library/LaunchAgents"
    local plist_path="$plist_dir/io.agent-v0.daemon.plist"

    mkdir -p "$plist_dir"

    cat > "$plist_path" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.agent-v0.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$INSTALL_DIR/agent-v0</string>
        <string>daemon</string>
        <string>start</string>
        <string>--foreground</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$HOME/.agent-v0/logs/daemon.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.agent-v0/logs/daemon.stderr.log</string>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
</dict>
</plist>
PLIST

    success "LaunchAgent installed at $plist_path"
    info "  To auto-start daemon on login: launchctl load $plist_path"
    info "  To start daemon now:           launchctl start io.agent-v0.daemon"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
    banner

    info "Starting Agent v0 installation on ${BOLD}$OS $ARCH${NC}..."
    echo ""

    # Phase 1: System dependencies
    info "=== Phase 1/7: System Dependencies ==="
    install_system_deps
    echo ""

    # Phase 2: Language runtimes
    info "=== Phase 2/7: Language Runtimes ==="
    ensure_node
    ensure_rust
    ensure_go
    ensure_python
    echo ""

    # Phase 3: Clone repository
    info "=== Phase 3/7: Clone Repository ==="
    clone_repo
    echo ""

    # Phase 4: Build everything
    info "=== Phase 4/7: Build All Components ==="
    build_typescript
    build_rust
    build_go
    install_python_deps
    echo ""

    # Phase 5: Configuration
    info "=== Phase 5/7: Configuration ==="
    setup_config
    echo ""

    # Phase 6: Install command
    info "=== Phase 6/7: Install Command ==="
    install_command
    echo ""

    # Phase 7: Platform-specific extras
    info "=== Phase 7/7: Platform Setup ==="
    setup_launchagent
    echo ""

    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo -e "${GREEN}${BOLD}  Agent v0 installed successfully!${NC}"
    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo ""
    echo -e "  Platform: ${BOLD}$OS $ARCH${NC}"
    if [ "$PLATFORM" = "macos" ]; then
        echo -e "  Sandbox:  ${BOLD}sandbox-exec (Apple Sandbox.framework)${NC}"
    else
        echo -e "  Sandbox:  ${BOLD}bubblewrap (Linux namespaces + seccomp)${NC}"
    fi
    echo ""
    echo -e "  Run ${BOLD}agent-v0${NC} to launch the setup wizard and configure your API keys."
    echo ""
    echo -e "  The setup wizard will walk you through:"
    echo -e "    ${CYAN}1.${NC} Master password for encrypted keystore"
    echo -e "    ${CYAN}2.${NC} AI provider API keys (Anthropic, OpenAI, Gemini)"
    echo -e "    ${CYAN}3.${NC} Bot integrations (Telegram, Discord, WhatsApp)"
    echo -e "    ${CYAN}4.${NC} Daemon & security settings"
    echo ""
    echo -e "  After setup, use ${BOLD}agent-v0 daemon start${NC} to start the daemon."
    echo ""
}

main "$@"
