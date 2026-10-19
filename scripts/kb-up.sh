#!/usr/bin/env bash
# kb-up.sh — bring the local knowledge-base stack up (run after every reboot).
#
#   kb-up.sh              prepare everything + start the GUI, then offer to open Claude Code
#   kb-up.sh --no-launch  same, but never offer to open Claude Code
#   kb-up.sh status       show what is running, change nothing
#   kb-up.sh stop         stop the GUI
#
# The MCP server itself is NOT started here: it is a stdio process that Claude Code
# spawns on launch. This script makes sure that spawn works (right Node, built dist/,
# migrated DB, correct `claude mcp` registration) — then you just open Claude Code.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_DIR="$PWD"            # where the user ran this script — the project to open Claude Code in
GUI_PORT=57891              # must match KB_GUI_PORT default in src/index.ts
MCP_NAME="kb-local"
MCP_SCOPE="user"            # user scope → available in every project folder, not only this repo
STATE_DIR="$HOME/.claude/knowledge-base"
GUI_LOG="$STATE_DIR/gui.log"
GUI_PID_FILE="$STATE_DIR/gui.pid"
MIN_NODE="22.5.0"

if [ -t 1 ]; then G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; B=$'\e[1m'; N=$'\e[0m'; else G=""; Y=""; R=""; B=""; N=""; fi
ok()   { echo "${G}✓${N} $*"; }
warn() { echo "${Y}!${N} $*"; }
die()  { echo "${R}✗ $*${N}" >&2; exit 1; }
step() { echo; echo "${B}== $*${N}"; }

cd "$REPO"
[ -f package.json ] && grep -q '"@vulhdev/knowledge-base"' package.json || die "not the knowledge-base repo: $REPO"

# ---------------------------------------------------------------- Node
pick_node() {
  local candidates=() n
  # Prefer the newest nvm Node 22 — native addons in node_modules are built for it.
  for n in "$HOME"/.nvm/versions/node/v22.*/bin/node; do [ -x "$n" ] && candidates+=("$n"); done
  if [ ${#candidates[@]} -gt 0 ]; then
    printf '%s\n' "${candidates[@]}" | sort -V | tail -1
    return
  fi
  command -v node || true
}

node_ok() { # $1 = node binary; true when version >= MIN_NODE
  "$1" -e "
    const [a,b,c] = process.versions.node.split('.').map(Number);
    const [x,y,z] = '$MIN_NODE'.split('.').map(Number);
    process.exit(a>x||(a===x&&(b>y||(b===y&&c>=z)))?0:1)" 2>/dev/null
}

NODE="$(pick_node)"
[ -n "$NODE" ] && [ -x "$NODE" ] || die "no Node found. Install Node 22: nvm install 22"
node_ok "$NODE" || die "Node $("$NODE" -v) at $NODE is below $MIN_NODE. Run: nvm install 22"
export PATH="$(dirname "$NODE"):$PATH"   # npm / npx below use the same Node

gui_pid() { { lsof -nP -iTCP:"$GUI_PORT" -sTCP:LISTEN -t 2>/dev/null || true; } | head -1; }

stop_gui() {
  local pid
  if [ -f "$GUI_PID_FILE" ]; then
    pid="$(cat "$GUI_PID_FILE")"
    kill "$pid" 2>/dev/null || true
    rm -f "$GUI_PID_FILE"
  fi
  pid="$(gui_pid)"
  if [ -n "$pid" ]; then
    # Only kill what is ours: a knowledge-base GUI started from any checkout.
    if ps -o command= -p "$pid" | grep -Eq 'cli\.(js|ts) gui|bin/gui\.(js|ts)|knowledge-base.* gui'; then
      kill "$pid" 2>/dev/null || true
    else
      die "port $GUI_PORT is used by another program: $(ps -o command= -p "$pid"). Free it, then re-run."
    fi
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(gui_pid)" ] && return 0; sleep 0.3; done
  die "GUI on port $GUI_PORT did not stop"
}

settings_value() { # $1 = key in settings.json
  "$NODE" -e "try{console.log(require('$STATE_DIR/settings.json')['$1']??'')}catch{console.log('')}"
}

model_ready() {
  local dir; dir="$(settings_value model_cache_dir)"
  [ -n "$dir" ] && [ -n "$(ls -A "$dir/Xenova/paraphrase-multilingual-MiniLM-L12-v2" 2>/dev/null)" ]
}

mcp_registered_ok() {
  # `claude mcp get` also health-checks the server and may exit non-zero; only the config lines matter.
  local out; out="$(claude mcp get "$MCP_NAME" </dev/null 2>/dev/null || true)"
  echo "$out" | grep -qi "Scope: $MCP_SCOPE" \
    && echo "$out" | grep -q "Command: $NODE\$" && echo "$out" | grep -q "Args: $REPO/dist/bin/cli.js\$"
}

# MCP servers Claude Code has spawned for this repo (one per open session), split by whether
# they started before or after the current dist/ build. Prints "<fresh> <stale>".
mcp_processes() {
  local built fresh=0 stale=0 pid started
  built="$(stat -f %m "$REPO/dist/bin/cli.js" 2>/dev/null || echo 0)"
  for pid in $(pgrep -f "$REPO/dist/bin/cli.js\$" 2>/dev/null || true); do
    started="$(date -j -f '%a %b %d %T %Y' "$(ps -o lstart= -p "$pid" | tr -s ' ')" +%s 2>/dev/null || echo 0)"
    if [ "$started" -ge "$built" ]; then fresh=$((fresh + 1)); else stale=$((stale + 1)); fi
  done
  echo "$fresh $stale"
}

status() {
  step "Status"
  echo "repo:  $REPO"
  echo "node:  $NODE ($("$NODE" -v))"
  [ -f dist/bin/cli.js ] && echo "dist:  built $(stat -f '%Sm' dist/bin/cli.js)" || echo "dist:  NOT BUILT"
  local pid; pid="$(gui_pid)"
  [ -n "$pid" ] && echo "gui:   http://localhost:$GUI_PORT (pid $pid)" || echo "gui:   not running"
  model_ready && echo "model: ready" || echo "model: MISSING (search_semantic will fail)"
  if command -v claude >/dev/null; then
    mcp_registered_ok && echo "mcp:   $MCP_NAME registered with this Node + dist" || echo "mcp:   $MCP_NAME missing or pointing elsewhere"
  fi
  local counts; counts="$(mcp_processes)"
  echo "mcp:   running in Claude Code — ${counts% *} on current build, ${counts#* } on an OLD build"
}

CMD="up"; NO_LAUNCH=0
for arg in "$@"; do
  case "$arg" in
    --no-launch) NO_LAUNCH=1 ;;
    *)           CMD="$arg" ;;
  esac
done

case "$CMD" in
  status) status; exit 0 ;;
  stop)   stop_gui; ok "GUI stopped"; exit 0 ;;
  up)     ;;
  *)      die "usage: $(basename "$0") [up|status|stop] [--no-launch]" ;;
esac

mkdir -p "$STATE_DIR"

# ---------------------------------------------------------------- 1. dependencies
step "1/6 Node + dependencies"
ok "Node $("$NODE" -v) — $NODE"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  warn "node_modules missing or stale → npm install"
  npm install
  touch node_modules/.package-lock.json   # "up to date" leaves it untouched → would re-run every time
fi
if ! "$NODE" -e "const D=require('better-sqlite3'); new D(':memory:').close()" 2>/dev/null; then
  warn "better-sqlite3 not built for this Node (ABI mismatch) → npm rebuild better-sqlite3"
  npm rebuild better-sqlite3
  "$NODE" -e "const D=require('better-sqlite3'); new D(':memory:').close()" \
    || die "better-sqlite3 still fails to load. Check build tools: xcode-select --install"
fi
ok "dependencies + native addon OK"

# ---------------------------------------------------------------- 2. build
step "2/6 Build"
if [ ! -f dist/bin/cli.js ] || [ -n "$(find src package.json tsconfig.json -newer dist/bin/cli.js -print -quit)" ]; then
  warn "src/ changed since last build → npm run build"
  npm run build
fi
ok "dist/ up to date"

# ---------------------------------------------------------------- 3. DB + MCP server smoke test
step "3/6 DB migrations + MCP handshake"
# Starting the server runs openDb() → applySchema() → every migration, on the real DB.
HANDSHAKE='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"kb-up","version":"1"}}}'
ERR_FILE="$(mktemp)"
OUT="$(printf '%s\n' "$HANDSHAKE" | "$NODE" dist/bin/cli.js 2>"$ERR_FILE" || true)"
if ! echo "$OUT" | grep -q '"serverInfo"'; then
  cat "$ERR_FILE" >&2; rm -f "$ERR_FILE"
  die "MCP server failed to start (stderr above)"
fi
rm -f "$ERR_FILE"
DB_PATH="$(settings_value db_path)"
ok "MCP server answers initialize"
ok "DB: $DB_PATH ($(du -h "$DB_PATH" | cut -f1))"

# ---------------------------------------------------------------- 4. embedding model
step "4/6 Embedding model"
if model_ready; then
  ok "model cached in $(settings_value model_cache_dir)"
else
  warn "model not downloaded — everything works except search_semantic."
  warn "download once (~465 MB): $NODE $REPO/dist/bin/cli.js init"
fi

# ---------------------------------------------------------------- 5. Claude Code registration
step "5/6 Claude Code MCP registration ($MCP_NAME)"
if ! command -v claude >/dev/null; then
  warn "'claude' CLI not on PATH — skipped. Register by hand:"
  warn "  claude mcp add -s $MCP_SCOPE $MCP_NAME -- $NODE $REPO/dist/bin/cli.js"
elif mcp_registered_ok; then
  ok "$MCP_NAME → $NODE $REPO/dist/bin/cli.js"
else
  warn "$MCP_NAME missing, in the wrong scope, or pointing elsewhere → registering in scope '$MCP_SCOPE'"
  # Drop any older registration (the first versions of this script used scope 'local' = this repo only).
  claude mcp remove -s local "$MCP_NAME" </dev/null >/dev/null 2>&1 || true
  claude mcp remove -s user "$MCP_NAME" </dev/null >/dev/null 2>&1 || true
  claude mcp add -s "$MCP_SCOPE" "$MCP_NAME" -- "$NODE" "$REPO/dist/bin/cli.js" </dev/null
  ok "$MCP_NAME registered for every project folder (scope: $MCP_SCOPE)"
fi

# ---------------------------------------------------------------- 6. GUI
step "6/6 GUI on port $GUI_PORT"
stop_gui   # always restart, so the GUI runs the code just built
# Start the GUI in its own session (detached → setsid), so closing this terminal tab — or
# quitting a Claude Code session launched from it — does not kill it. macOS has no setsid(1).
PORT="$GUI_PORT" "$NODE" -e '
  const fs = require("fs");
  const [cli, log] = process.argv.slice(1);
  const out = fs.openSync(log, "a");
  const child = require("child_process").spawn(process.execPath, [cli, "gui"], {
    detached: true, stdio: ["ignore", out, out], env: process.env,
  });
  child.unref();
  console.log(child.pid);
' "$REPO/dist/bin/cli.js" "$GUI_LOG" >"$GUI_PID_FILE"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://localhost:$GUI_PORT/" 2>/dev/null && break
  sleep 0.3
done
curl -fsS -o /dev/null "http://localhost:$GUI_PORT/" 2>/dev/null \
  || { tail -20 "$GUI_LOG" >&2; die "GUI did not come up (log: $GUI_LOG)"; }
ok "GUI http://localhost:$GUI_PORT (pid $(cat "$GUI_PID_FILE"), log $GUI_LOG)"

# ---------------------------------------------------------------- done
# The MCP server is not a daemon: each Claude Code session spawns its own copy over stdio.
# So "ready" is only claimed when such a copy is actually running the current build.
read -r FRESH STALE <<<"$(mcp_processes)"
SELF="$REPO/scripts/kb-up.sh"
LINE="────────────────────────────────────────────────────────────────────"

echo
echo "$LINE"
echo "  [done]  Node, dependencies, build, DB migrations, model, MCP registration"
echo "  [done]  GUI running            → http://localhost:$GUI_PORT"

if [ "$STALE" -gt 0 ]; then
  echo "  [TODO]  MCP server ($MCP_NAME)  → $STALE open Claude Code session(s) still run the OLD code"
  echo "$LINE"
  cat <<EOF

${B}Why:${N} the code was rebuilt, but those sessions started $MCP_NAME before that
and keep running the old copy until it is restarted.

${B}What to do — in EACH open Claude Code session:${N}
  1. type   /mcp
  2. pick   $MCP_NAME
  3. pick   Reconnect          (restarts $MCP_NAME on the new code, about 1-2 s)

${B}How to confirm:${N}  $SELF status
  last line must say:  0 on an OLD build
EOF

elif [ "$FRESH" -gt 0 ]; then
  echo "  [done]  MCP server ($MCP_NAME)  → running in $FRESH Claude Code session(s), current code"
  echo "$LINE"
  cat <<EOF

${G}${B}knowledge-base is READY — nothing left to do.${N}
Ask Claude in that session, e.g.  "list docs in my knowledge-base workspace"
EOF

else
  echo "  [next]  MCP server ($MCP_NAME)  → starts when you open Claude Code (normal after a reboot)"
  echo "$LINE"
  cat <<EOF

${B}How the MCP server starts:${N}
  $MCP_NAME is not a background service like the GUI. Claude Code launches it
  automatically every time you open a session — in ANY project folder — and stops
  it when you quit. Everything it needs is prepared above — you do not start it by hand.

${B}Last step:${N} open Claude Code in the project you work on, as usual, e.g.
  cd /path/to/your-project && claude

  Claude Code opens there, starts $MCP_NAME by itself, and the knowledge-base tools
  (create_content, search_semantic, ...) are available in that session. Paths to the
  project's code and docs stay relative to that project — nothing points here.

${B}How to confirm (optional):${N}
  in Claude Code type  /mcp   → $MCP_NAME must show as connected
  or from a terminal:  $SELF status   → "1 on current build"

${B}Several sessions at once:${N}
  open one terminal tab per task, cd into that task's project, run  claude.
  Each session starts its own $MCP_NAME; all of them share one DB and this one GUI.
  Do NOT re-run this script per session — once after a reboot is enough.

${Y}Note:${N} which KB workspace a project uses comes from the line
  KNOWLEDGE_BASE_WORKSPACE=<name>  in that project's CLAUDE.md.
  A project without it can still use the tools, but Claude has to be told the workspace.
EOF

  # Offer to do the last step right here, so one command is enough after a reboot.
  if [ "$NO_LAUNCH" = 0 ] && [ -t 0 ] && [ -t 1 ] && command -v claude >/dev/null; then
    echo
    echo "Open a Claude Code session in $START_DIR now?"
    echo "  y / Enter → yes, this terminal becomes that session"
    echo "  n         → no; everything stays ready, open sessions yourself later"
    read -r -p "[Y/n] " ANSWER </dev/tty || ANSWER=n   # EOF / no tty → no
    case "${ANSWER:-Y}" in
      [Yy]*) cd "$START_DIR" && exec claude ;;
      *)     echo "OK. GUI keeps running. Open a session any time:  cd <project> && claude" ;;
    esac
  fi
fi
