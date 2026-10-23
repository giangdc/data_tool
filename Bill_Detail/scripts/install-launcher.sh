#!/usr/bin/env bash
# Tạo icon "Bill Detail Tool" trên Desktop + menu ứng dụng (Linux). Chạy lại nếu chuyển thư mục tool.
set -eu
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
chmod +x "$APP_DIR/scripts/launch-ui.sh"

ENTRY="[Desktop Entry]
Type=Application
Name=Bill Detail Tool
Comment=Tra cứu chi tiết hóa đơn (Liệt kê cước inside.fpt.net)
Exec=\"$APP_DIR/scripts/launch-ui.sh\" start
Icon=$APP_DIR/assets/icon.svg
Terminal=false
Categories=Development;
Actions=stop;

[Desktop Action stop]
Name=Tắt Bill Detail Tool
Exec=\"$APP_DIR/scripts/launch-ui.sh\" stop
"

APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
printf '%s' "$ENTRY" >"$APPS_DIR/bill-detail-tool.desktop"
chmod +x "$APPS_DIR/bill-detail-tool.desktop"
echo "✔ Đã thêm vào menu ứng dụng: $APPS_DIR/bill-detail-tool.desktop"

DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESKTOP_DIR" ]; then
  printf '%s' "$ENTRY" >"$DESKTOP_DIR/bill-detail-tool.desktop"
  chmod +x "$DESKTOP_DIR/bill-detail-tool.desktop"
  # GNOME: đánh dấu tin cậy để bấm đúp chạy được ngay
  gio set "$DESKTOP_DIR/bill-detail-tool.desktop" metadata::trusted true 2>/dev/null || true
  echo "✔ Đã tạo icon trên Desktop: $DESKTOP_DIR/bill-detail-tool.desktop"
fi
