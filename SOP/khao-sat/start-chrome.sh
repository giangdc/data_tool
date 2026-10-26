#!/usr/bin/env bash
# Chrome ẩn dùng profile đã đăng nhập (.cache/browser-profile), mở cổng debug 9333 chỉ trên máy này
cd "$(dirname "$0")/.."
exec google-chrome --headless=new --remote-debugging-port=9333 --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$PWD/.cache/browser-profile" --window-size=1440,900 --no-first-run \
  https://portal-sop-stg.fpt.vn/quan-ly-khach-hang/khach-hang/danh-sach
