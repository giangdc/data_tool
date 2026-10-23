#!/usr/bin/env bash
# Cài đặt Thanh toán Tool trên máy Ubuntu/Linux: tạo icon Desktop + menu, rồi mở tool.
# Chạy: bash install.sh   (hoặc chuột phải -> Run as a Program)
set -eu
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"
chmod +x scripts/*.sh runtime/node/bin/node 2>/dev/null || true

if [ ! -x runtime/node/bin/node ] && ! command -v node >/dev/null; then
  echo "✖ Không tìm thấy Node.js. Dùng bản đóng gói (có thư mục runtime/) hoặc cài Node >= 20."
  exit 1
fi
# Cài từ mã nguồn (git clone) chưa có node_modules -> cài thư viện
if [ ! -d node_modules/playwright-core ]; then
  if ! command -v npm >/dev/null; then
    echo "✖ Chưa có node_modules và không tìm thấy npm. Cài Node.js >= 20.12 (kèm npm) rồi chạy lại."
    exit 1
  fi
  echo "→ Cài thư viện (npm ci)..."
  npm ci --omit=dev --no-audit --no-fund
fi
if ! command -v google-chrome >/dev/null && ! command -v microsoft-edge >/dev/null; then
  echo "⚠ Không thấy Google Chrome / Microsoft Edge — cần 1 trong 2 để tool điều khiển trình duyệt."
fi

bash scripts/install-launcher.sh
echo "✔ Cài đặt xong. Lần sau bấm icon 'Thanh toán Tool' để mở."
bash scripts/launch-ui.sh start
