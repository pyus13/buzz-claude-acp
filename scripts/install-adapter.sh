#!/bin/sh
# Installs what the Claude (ACP) plugin runs: the Claude ACP adapter, pinned,
# and `buzz-claude-acp`, the program the plugin's manifest names, in
# ~/.local/bin (which Buzz searches first). Buzz installs only the plugin, so
# run this once on each computer, and again to repair or update. It needs
# nothing else from the repository:
#
#   curl -fsSL https://raw.githubusercontent.com/pyus13/buzz-claude-acp/main/scripts/install-adapter.sh | sh
#   sh scripts/install-adapter.sh            the same, from a clone
#   sh scripts/install-adapter.sh --check    only check the installation
#
# macOS and Linux. Needs Node.js 20 or later and npm.
set -eu

ADAPTER_PACKAGE="@agentclientprotocol/claude-agent-acp"
ADAPTER_VERSION="0.106.0"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/buzz-claude-acp"
BIN_DIR="$HOME/.local/bin"
WRAPPER="$BIN_DIR/buzz-claude-acp"
ENTRY="$DATA_DIR/node_modules/$ADAPTER_PACKAGE/dist/index.js"

say() { printf '%s\n' "$*"; }
fail() { printf 'buzz-claude-acp: %s\n' "$*" >&2; exit 1; }

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return; }
  done
  return 1
}

# The handshake Buzz makes first: the adapter must answer `initialize`.
check() {
  [ -x "$WRAPPER" ] || fail "$WRAPPER is missing; run this installer without --check"
  answer=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' |
    (cd "${TMPDIR:-/tmp}" && env -i HOME="$HOME" PATH=/usr/bin:/bin "$WRAPPER" 2>/dev/null) | head -n 1) || true
  case "$answer" in
    *'"protocolVersion"'*) say "The adapter answers. Claude (ACP) is ready for Buzz." ;;
    *) fail "the adapter did not answer; run this installer again" ;;
  esac
}

if [ "${1:-}" = "--check" ]; then check; exit 0; fi

NODE=$(find_node) || fail "Node.js was not found; install Node.js 20 or later (https://nodejs.org), then run this again"
# The real executable, not a version manager's shim that needs its manager on
# the PATH Buzz does not give it.
NODE=$("$NODE" -p 'process.execPath')
major=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || fail "Node.js $("$NODE" --version) is too old; install 20 or later"
NPM="$(dirname "$NODE")/npm"
[ -x "$NPM" ] || NPM=$(command -v npm) || fail "npm was not found next to $NODE"

say "Installing $ADAPTER_PACKAGE@$ADAPTER_VERSION into $DATA_DIR"
mkdir -p "$DATA_DIR" "$BIN_DIR"
[ -f "$DATA_DIR/package.json" ] || printf '{ "private": true }\n' >"$DATA_DIR/package.json"
"$NPM" install --prefix "$DATA_DIR" --save-exact --no-audit --no-fund --no-update-notifier --loglevel=error \
  "$ADAPTER_PACKAGE@$ADAPTER_VERSION"
[ -f "$ENTRY" ] || fail "the adapter installed without $ENTRY"

# Buzz starts this with a minimal environment, so it names Node by path and
# falls back to the PATH Buzz gives it. Credentials come from your `claude`
# login, never from an API key in the environment.
cat >"$WRAPPER" <<EOF
#!/bin/sh
# Starts the Claude ACP adapter for Buzz's Claude (ACP) plugin.
# Written by buzz-claude-acp's install-adapter.sh; run it again to update.
NODE="$NODE"
[ -x "\$NODE" ] || NODE=\$(command -v node) || { echo "buzz-claude-acp: Node.js not found" >&2; exit 127; }
ENTRY="$ENTRY"
[ -f "\$ENTRY" ] || { echo "buzz-claude-acp: adapter missing; reinstall it" >&2; exit 127; }
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID
exec "\$NODE" "\$ENTRY" "\$@"
EOF
chmod 755 "$WRAPPER"
say "Wrote $WRAPPER"
check
if command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ]; then
  say "Sign in once with your Claude account if you have not: claude auth login"
else
  say "Next, install Claude Code and sign in once: https://claude.com/claude-code, then claude auth login"
fi
say "Then restart Buzz, or press Check again in Settings → Agent setup."
