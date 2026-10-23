#!/usr/bin/env bash
# Đóng gói tool thành 1 file dist/thanh-toan-tool-<ver>-linux-x64.tar.gz (kèm Node portable).
# Không đóng gói .env / .cache / output (chứa mật khẩu, token, dữ liệu).
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-v24.17.0}"
NODE_DIST="node-$NODE_VERSION-linux-x64"
VERSION="$(node -p "require('$APP_DIR/package.json').version")"
NAME="thanh-toan-tool"
DIST="$APP_DIR/dist"
STAGE="$DIST/stage/$NAME"
DL_DIR="$DIST/downloads"

rm -rf "$DIST/stage"
mkdir -p "$STAGE" "$DL_DIR"

echo "→ Copy mã nguồn"
cp -r "$APP_DIR"/{src,public,config,assets,scripts} "$STAGE/"
cp "$APP_DIR"/{package.json,package-lock.json,.env.example,README.md,install.sh} "$STAGE/"
(cd "$STAGE" && npm ci --omit=dev --silent)

echo "→ Node portable $NODE_VERSION"
if [ ! -f "$DL_DIR/$NODE_DIST.tar.xz" ]; then
  curl -fsSL -o "$DL_DIR/$NODE_DIST.tar.xz" "https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.tar.xz"
  curl -fsSL -o "$DL_DIR/SHASUMS256-$NODE_VERSION.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
fi
(cd "$DL_DIR" && grep " $NODE_DIST.tar.xz\$" "SHASUMS256-$NODE_VERSION.txt" | sha256sum -c --quiet)
mkdir -p "$STAGE/runtime/node/bin"
# Chỉ cần file thực thi node (bỏ npm/headers cho nhẹ)
tar -xJf "$DL_DIR/$NODE_DIST.tar.xz" -C "$STAGE/runtime/node/bin" --strip-components=2 "$NODE_DIST/bin/node"

chmod +x "$STAGE"/install.sh "$STAGE"/scripts/*.sh "$STAGE"/runtime/node/bin/node

OUT="$DIST/$NAME-$VERSION-linux-x64.tar.gz"
tar -czf "$OUT" -C "$DIST/stage" "$NAME"
rm -rf "$DIST/stage"
echo "✔ Đã tạo: $OUT ($(du -h "$OUT" | cut -f1))"
