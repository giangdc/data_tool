#!/usr/bin/env bash
# Bật server giao diện (nếu chưa chạy) rồi mở trình duyệt. Dùng: launch-ui.sh [start|stop]
set -u
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$APP_DIR/output"
PID_FILE="$APP_DIR/.cache/ui-server.pid"
PORT="$(grep -E '^UI_PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-3004}"
URL="http://localhost:$PORT"

notify() { command -v notify-send >/dev/null && notify-send -i "$APP_DIR/assets/icon.svg" "GH quầy Tool" "$1"; }

# Launcher của desktop không nạp ~/.bashrc -> tự tìm node (ưu tiên nvm)
find_node() {
  # Bản đóng gói có kèm Node portable
  [ -x "$APP_DIR/runtime/node/bin/node" ] && echo "$APP_DIR/runtime/node/bin/node" && return
  command -v node && return
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 && command -v node && return
  ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1
}

is_up() { curl -s -m 1 "$URL/api/config" >/dev/null 2>&1; }

stop_server() {
  if [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null; then
    rm -f "$PID_FILE"
    notify "Đã tắt server"
  else
    notify "Server không chạy"
  fi
}

start_server() {
  if ! is_up; then
    NODE_BIN="$(find_node)"
    if [ -z "$NODE_BIN" ]; then
      notify "Không tìm thấy Node.js. Cài Node >= 20 rồi thử lại."
      exit 1
    fi
    mkdir -p "$LOG_DIR" "$(dirname "$PID_FILE")"
    cd "$APP_DIR" || exit 1
    nohup "$NODE_BIN" src/server.js --no-open >>"$LOG_DIR/ui-server.log" 2>&1 &
    echo $! >"$PID_FILE"
    for _ in $(seq 1 30); do
      is_up && break
      sleep 0.3
    done
    if ! is_up; then
      notify "Không bật được server. Xem log: $LOG_DIR/ui-server.log"
      exit 1
    fi
  fi
  xdg-open "$URL" >/dev/null 2>&1 &
}

case "${1:-start}" in
  stop) stop_server ;;
  *) start_server ;;
esac
