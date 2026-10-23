#!/usr/bin/env bash
# Tạo icon "GH quầy Tool" trên Desktop + menu ứng dụng (Linux). Chạy lại nếu chuyển thư mục tool.
set -eu
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
chmod +x "$APP_DIR/scripts/launch-ui.sh"

ENTRY="[Desktop Entry]
Type=Application
Name=GH quầy Tool
Comment=Giao hàng tại quầy: Fox ERP → SCM → GHTK lab
Exec=\"$APP_DIR/scripts/launch-ui.sh\" start
Icon=$APP_DIR/assets/icon.svg
Terminal=false
Categories=Development;
Actions=stop;

[Desktop Action stop]
Name=Tắt GH quầy Tool
Exec=\"$APP_DIR/scripts/launch-ui.sh\" stop
"

APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
printf '%s' "$ENTRY" >"$APPS_DIR/gh-quay-tool.desktop"
chmod +x "$APPS_DIR/gh-quay-tool.desktop"
echo "✔ Đã thêm vào menu ứng dụng: $APPS_DIR/gh-quay-tool.desktop"

DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESKTOP_DIR" ]; then
  printf '%s' "$ENTRY" >"$DESKTOP_DIR/gh-quay-tool.desktop"
  chmod +x "$DESKTOP_DIR/gh-quay-tool.desktop"
  # GNOME: đánh dấu tin cậy để bấm đúp chạy được ngay
  gio set "$DESKTOP_DIR/gh-quay-tool.desktop" metadata::trusted true 2>/dev/null || true
  echo "✔ Đã tạo icon trên Desktop: $DESKTOP_DIR/gh-quay-tool.desktop"
fi
