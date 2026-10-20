# Chạy FTMS Data Tool trên server dùng chung (hướng A – team nội bộ)

Mục tiêu: 1 server trong mạng nội bộ/VPN, cả team QC mở trình duyệt vào dùng chung, không cần cài trên từng máy.

> ⚠️ **Không mở ra Internet public.** Tool đăng nhập FTMS bằng *tên tài khoản + OTP dùng chung*: ai vào được trang là
> thao tác được dưới tên bất kỳ tài khoản nào (kể cả admin). Lớp bảo vệ duy nhất là mật khẩu trang (`UI_AUTH`)
> + mạng nội bộ. Chỉ đưa mật khẩu cho người trong team.

## Chế độ server làm gì
Bật khi `UI_HOST` khác `127.0.0.1` (vd `0.0.0.0`):
- Bắt buộc `UI_AUTH=<tên>:<mật khẩu>` – trình duyệt hỏi mật khẩu khi vào trang (HTTP Basic). Thiếu → server không chạy.
- Không cho đổi OTP qua web (ẩn "Đổi OTP", API trả 403). OTP chỉ sửa trong `.env` trên server.
- Không tự mở trình duyệt.
- Bảng Kết quả / lịch sử và file `output/` **dùng chung** cả team (ai tạo cũng thấy).

## 1. Chuẩn bị server
- Ubuntu/Linux x64, RAM ≥ 2GB (mỗi lần đăng nhập mở 1 Chrome ẩn ~200–300MB, đóng ngay sau khi lấy token).
- Ra được `https://ftms-stag.fpt.net` và `https://ftisapi-stag.fpt.net`:
  ```bash
  curl -sI https://ftms-stag.fpt.net/ | head -1
  ```
- Có Chrome hoặc Chromium (server không có giao diện vẫn được, tool chạy headless):
  ```bash
  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt install -y ./google-chrome-stable_current_amd64.deb
  ```

## 2. Cài tool
```bash
sudo useradd -r -m -s /usr/sbin/nologin ftmstool          # user riêng để chạy dịch vụ
sudo mkdir -p /opt && sudo tar -xzf ftms-data-tool-<ver>-linux-x64.tar.gz -C /opt
sudo mv /opt/ftms-data-tool* /opt/ftms-data-tool 2>/dev/null || true   # nếu tên thư mục khác
sudo cp /opt/ftms-data-tool/.env.example /opt/ftms-data-tool/.env
sudo nano /opt/ftms-data-tool/.env
```
Trong `.env` điền:
```ini
FTMS_OTP=<OTP dùng chung>
UI_HOST=0.0.0.0
UI_PORT=3000
UI_AUTH=qc:<mật khẩu mạnh, ≥ 8 ký tự>
```
```bash
sudo chown -R ftmstool:ftmstool /opt/ftms-data-tool
sudo chmod 600 /opt/ftms-data-tool/.env
```

## 3. Chạy thành dịch vụ (tự bật lại khi reboot / lỗi)
```bash
sudo cp /opt/ftms-data-tool/scripts/ftms-data-tool.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ftms-data-tool
sudo systemctl status ftms-data-tool        # xem trạng thái
journalctl -u ftms-data-tool -f             # xem log
```
Server cần proxy để ra Internet → bỏ comment dòng `Environment=HTTPS_PROXY=...` trong file service.

## 4. Mở cổng (chỉ cho mạng nội bộ)
```bash
sudo ufw allow from 10.0.0.0/8 to any port 3000 proto tcp   # đổi dải IP cho đúng mạng công ty
```
Team truy cập: `http://<IP-server>:3000` → nhập `qc` / mật khẩu → dùng như bản trên máy.

## 5. (Khuyến nghị) HTTPS qua nginx
Basic auth gửi mật khẩu dạng base64 → nên có HTTPS. Khi đó đặt `UI_HOST=127.0.0.1` và **vẫn giữ** `UI_AUTH`
(hoặc chuyển basic auth sang nginx), để nginx đứng trước:
```nginx
server {
  listen 443 ssl;
  server_name ftms-tool.noibo.local;
  ssl_certificate     /etc/ssl/certs/ftms-tool.crt;
  ssl_certificate_key /etc/ssl/private/ftms-tool.key;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Authorization $http_authorization;
    proxy_read_timeout 120s;   # đăng nhập SSO / duyệt HĐ có thể mất 10–20s
  }
}
```
> Lưu ý: `UI_HOST=127.0.0.1` thì chế độ server **không bật** → "Đổi OTP" lại hiện. Muốn khóa thì đặt `UI_HOST=127.0.0.2`
> (vẫn là loopback, chỉ nginx gọi được) và `proxy_pass http://127.0.0.2:3000`.

## 6. Vận hành
| Việc | Cách làm |
|---|---|
| Đổi OTP / mật khẩu trang | Sửa `.env` → `sudo systemctl restart ftms-data-tool` |
| Cập nhật bản mới | Giải nén đè vào `/opt/ftms-data-tool` (giữ `.env`, `.cache`, `output`) → `chown` lại → `restart` |
| Lỗi đăng nhập | Xem `journalctl -u ftms-data-tool` và ảnh `output/debug/login-fail-*.png` |
| Dọn token đăng nhập | `sudo rm -rf /opt/ftms-data-tool/.cache/*` → `restart` |
| Lấy file kết quả | `/opt/ftms-data-tool/output/*.csv` |
