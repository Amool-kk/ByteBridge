#!/usr/bin/env bash

set -u

REPO_URL="${BYTEBRIDGE_REPO:-https://github.com/Amool-kk/ByteBridge.git}"
BRANCH="${BYTEBRIDGE_BRANCH:-build}"

case "$(uname -s)" in
  Darwin)
    INSTALL_DIR="${HOME}/Library/Application Support/ByteBridge/app"
    ;;
  Linux)
    INSTALL_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/bytebridge/app"
    ;;
  *)
    echo "Unsupported OS for install.sh"
    exit 1
    ;;
esac

need_tool() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$name is required. ${hint}"
    exit 1
  fi
}

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi
  node -p "process.versions.node.split('.')[0]"
}

ensure_node() {
  local major
  major="$(node_major)"
  if [ "$major" -ge 18 ]; then
    return
  fi

  printf "Node.js 18+ is required. Install/update using nvm now? [y/N] "
  read -r answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Node.js 18+ is required to run ByteBridge."
    exit 1
  fi

  export NVM_DIR="${HOME}/.nvm"
  if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
    need_tool curl "Install curl and retry."
    echo "Installing nvm v0.40.3..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi

  # shellcheck disable=SC1090
  . "${NVM_DIR}/nvm.sh"
  nvm install --lts
  nvm use --lts

  major="$(node_major)"
  if [ "$major" -lt 18 ]; then
    echo "Failed to install a usable Node.js version."
    exit 1
  fi
}

ensure_repo() {
  mkdir -p "$(dirname "$INSTALL_DIR")"

  if [ ! -d "$INSTALL_DIR/.git" ]; then
    need_tool git "Install Git and retry."
    echo "Installing ByteBridge into: $INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    return
  fi

  printf "Check for updates and sync to %s? [y/N] " "$BRANCH"
  read -r answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    if git -C "$INSTALL_DIR" fetch origin "$BRANCH"; then
      git -C "$INSTALL_DIR" checkout "$BRANCH" >/dev/null 2>&1 || true
      git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
    else
      echo "Update check failed; starting current local copy."
    fi
  fi
}

PORT_ARG=""
if [ "${1:-}" = "--port" ] && [ -n "${2:-}" ]; then
  PORT_ARG="$2"
fi

ensure_repo
cd "$INSTALL_DIR" || exit 1

ensure_node
need_tool npm "Install Node.js/npm and retry."

if [ ! -d node_modules ]; then
  echo "Installing runtime dependencies..."
  npm ci --omit=dev
fi

echo "Starting ByteBridge from $INSTALL_DIR"
if [ -n "$PORT_ARG" ]; then
  PORT="$PORT_ARG" node server.js
else
  node server.js
fi
