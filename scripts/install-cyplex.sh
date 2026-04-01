#!/usr/bin/env bash
# ============================================================================
# Agent Cyplex — One-Line Installer for Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/centeler34/Agent-cyplex/main/scripts/install-cyplex.sh | bash
# ============================================================================
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="$HOME/.agent-cyplex"
BIN_LINK="/usr/local/bin/agent-cyplex"
REPO_URL="https://github.com/centeler34/Agent-cyplex.git"
NODE_MIN="20"
GO_MIN="1.22"
PYTHON_MIN="3.11"

banner() {
    echo -e "${CYAN}"
    echo "  ___                    _      ____            _           "
    echo " / _ \  __ _  ___ _ __ | |_   / ___|_   _ _ __| | _____  __"
    echo "| |_| |/ _\` |/ _ \ '_ \| __| | |   | | | | '_ \ |/ _ \ \/ /"
    echo "| | | | (_| |  __/ | | | |_  | |___| |_| | |_) | |  __/>  < "
    echo "|_| |_|\__, |\___|_| |_|\__|  \____|\__, | .__/|_|\___/_/\_\\"
    echo "       |___/                         |___/|_|               "
    echo -e "${NC}"
    echo -e "${BOLD}Multi-Agent AI Orchestration CLI Terminal${NC}"
    echo ""
}

info()    { echo -e "${CYAN}[*]${NC} $1"; }
success() { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
fail()    { echo -e "${RED}[x]${NC} $1"; exit 1; }

# --------------------------------------------------------------------------
# Detect package manager
# --------------------------------------------------------------------------
detect_pkg_manager() {
    if command -v apt-get &>/dev/null; then
        echo "apt"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    elif command -v pacman &>/dev/null; then
        echo "pacman"
    elif command -v zypper &>/dev/null; then
        echo "zypper"
    elif command -v apk &>/dev/null; then
        echo "apk"
    else
        echo "unknown"
    fi
}

# --------------------------------------------------------------------------
# Install system packages
# --------------------------------------------------------------------------
install_system_deps() {
    local pm
    pm=$(detect_pkg_manager)
    info "Detected package manager: $pm"

    local pkgs="git curl build-essential"

    case "$pm" in
        apt)
            sudo apt-get update -qq
            sudo apt-get install -y -qq git curl build-essential bubblewrap
            ;;
        dnf)
            sudo dnf install -y git curl gcc gcc-c++ make bubblewrap
            ;;
        pacman)
            sudo pacman -Sy --noconfirm git curl base-devel bubblewrap
            ;;
        zypper)
            sudo zypper install -y git curl gcc gcc-c++ make bubblewrap
            ;;
        apk)
            sudo apk add git curl build-base bubblewrap
            ;;
        *)
            warn "Unknown package manager. Please install git, curl, build tools, and bubblewrap manually."
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
        ver=$(go version | grep -oP '\d+\.\d+' | head -1)
        success "Go $ver found"
        return
    fi

    info "Installing Go ${GO_MIN}..."
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)  arch="amd64" ;;
        aarch64) arch="arm64" ;;
        armv7l)  arch="armv6l" ;;
    esac
    curl -fsSL "https://go.dev/dl/go1.22.10.linux-${arch}.tar.gz" -o /tmp/go.tar.gz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf /tmp/go.tar.gz
    rm /tmp/go.tar.gz
    export PATH="/usr/local/go/bin:$PATH"
    echo 'export PATH="/usr/local/go/bin:$PATH"' >> "$HOME/.bashrc"
    success "Go $(go version | grep -oP '\d+\.\d+\.\d+') installed"
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
        git pull --ff-only origin main || true
    else
        info "Cloning Agent Cyplex..."
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
    mkdir -p dist
    (cd go/ssh-tunnel && go build -o ../../dist/ssh-tunnel .)
    (cd go/net-probe && go build -o ../../dist/net-probe .)
    success "Go build complete"
}

install_python_deps() {
    info "Installing Python dependencies..."
    pip install -r python/forensics-service/requirements.txt --quiet 2>/dev/null || true
    pip install -r python/osint-utils/requirements.txt --quiet 2>/dev/null || true
    success "Python dependencies installed"
}

setup_config() {
    info "Setting up configuration directories..."
    mkdir -p "$HOME/.cyplex"/{logs,audit,workspaces,sessions}
    mkdir -p "$HOME/.cyplex/quarantine"/{pending,approved,rejected}

    if [ ! -f "$HOME/.cyplex/config.yaml" ]; then
        cp config/config.example.yaml "$HOME/.cyplex/config.yaml"
        success "Default config created at ~/.cyplex/config.yaml"
    else
        warn "Config already exists at ~/.cyplex/config.yaml — skipping"
    fi

}

install_command() {
    info "Installing 'agent-cyplex' command..."

    # Create wrapper script
    cat > "$INSTALL_DIR/agent-cyplex" << 'WRAPPER'
#!/usr/bin/env bash
INSTALL_DIR="$HOME/.agent-cyplex"
export NODE_PATH="$INSTALL_DIR/node_modules"

# Ensure nvm node is available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null

# Ensure cargo/go are in PATH
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env" 2>/dev/null
[ -d "/usr/local/go/bin" ] && export PATH="/usr/local/go/bin:$PATH"

exec node "$INSTALL_DIR/dist/cli/cli.js" "$@"
WRAPPER
    chmod +x "$INSTALL_DIR/agent-cyplex"

    # Symlink to /usr/local/bin
    if [ -w /usr/local/bin ] || sudo -n true 2>/dev/null; then
        sudo ln -sf "$INSTALL_DIR/agent-cyplex" "$BIN_LINK"
        success "'agent-cyplex' installed to $BIN_LINK"
    else
        # Fallback: add to user's local bin
        mkdir -p "$HOME/.local/bin"
        ln -sf "$INSTALL_DIR/agent-cyplex" "$HOME/.local/bin/agent-cyplex"
        if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
            warn "Added ~/.local/bin to PATH in ~/.bashrc — restart your shell or run: source ~/.bashrc"
        fi
        success "'agent-cyplex' installed to ~/.local/bin/agent-cyplex"
    fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
    banner

    info "Starting Agent Cyplex installation..."
    echo ""

    # Phase 1: System dependencies
    info "=== Phase 1/6: System Dependencies ==="
    install_system_deps
    echo ""

    # Phase 2: Language runtimes
    info "=== Phase 2/6: Language Runtimes ==="
    ensure_node
    ensure_rust
    ensure_go
    ensure_python
    echo ""

    # Phase 3: Clone repository
    info "=== Phase 3/6: Clone Repository ==="
    clone_repo
    echo ""

    # Phase 4: Build everything
    info "=== Phase 4/6: Build All Components ==="
    build_typescript
    build_rust
    build_go
    install_python_deps
    echo ""

    # Phase 5: Configuration
    info "=== Phase 5/6: Configuration ==="
    setup_config
    echo ""

    # Phase 6: Install command
    info "=== Phase 6/6: Install Command ==="
    install_command
    echo ""

    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo -e "${GREEN}${BOLD}  Agent Cyplex installed successfully!${NC}"
    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo ""
    echo -e "  Run ${BOLD}agent-cyplex${NC} to launch the setup wizard and configure your API keys."
    echo ""
    echo -e "  The setup wizard will walk you through:"
    echo -e "    ${CYAN}1.${NC} Master password for encrypted keystore"
    echo -e "    ${CYAN}2.${NC} AI provider API keys (Anthropic, OpenAI, Gemini)"
    echo -e "    ${CYAN}3.${NC} Bot integrations (Telegram, Discord, WhatsApp)"
    echo -e "    ${CYAN}4.${NC} Daemon & security settings"
    echo ""
    echo -e "  After setup, use ${BOLD}agent-cyplex daemon start${NC} to start the daemon."
    echo ""
}

main "$@"
