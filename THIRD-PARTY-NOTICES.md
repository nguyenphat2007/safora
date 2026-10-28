# Safora — thông tin nguồn và giấy phép

Safora 1.15.1 sử dụng các thành phần nguồn mở dưới đây. Phần tiện ích được phân phối theo GPL-3.0-only; xem `LICENSE`. Giấy phép, thông báo bản quyền và ghi công của từng thành phần được bảo toàn. Safora là dự án độc lập, không phải sản phẩm chính thức của AdGuard hay uBlock Origin Lite.

| Thành phần | Phiên bản / nguồn | Giấy phép và thông tin đi kèm |
|---|---|---|
| AdGuard TsWebExtension | 6.0.1 | GPL-3.0-only |
| AdGuard tsurlfilter | 6.0.4 | GPL-3.0-only |
| AdGuard DNR converter | 2.0.0 | GPL-3.0-only |
| AdGuard DNR rulesets | 5.0.20261013160024 | GPL-3.0-only; giữ thông báo riêng trong metadata từng danh sách |
| AdGuard Extended CSS | 2.2.0 | GPL-3.0 |
| AdGuard Scriptlets | 2.5.1 | GPL-3.0 |
| AdGuard AGTree | 4.3.0 | MIT |
| ABPVN | [abpvn/abpvn](https://github.com/abpvn/abpvn), filter214 trong bộ dữ liệu đã khóa | GPL-3.0; thông báo gốc trong metadata |
| uAssets Quick fixes | [uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets/blob/master/filters/quick-fixes.txt) | GPL-3.0; nguồn được giữ trong metadata và cấu hình cập nhật |
| uBlock filters – Badware risks | Snapshot tại commit `651b917a3f7185db80d66412f019a1106c6bc13d` | GPL-3.0-only; `src/filters/ubol/uassets-LICENSE` |
| Malicious URL Blocklist / URLhaus | [malware-filter/urlhaus-filter](https://gitlab.com/malware-filter/urlhaus-filter), snapshot ngày 26/10/2026 | CC0-1.0 cho dữ liệu và MIT cho công cụ nguồn; các tệp `urlhaus-LICENSE*` và `urlhaus-README.md` |
| Các phần có nguồn gốc từ REA | Thông báo bản quyền gốc được giữ | `licenses/REA-MIT.txt`; kho này không bao gồm ứng dụng REA độc lập |
| Safora Việt Nam / Safora Web | `src/filters/safora-vietnam.txt`, `src/filters/safora-web.txt` | GPL-3.0-only; giữ ghi công nguồn chuyển thể ngay trong tệp và metadata |

Danh sách dependency đầy đủ, phiên bản, địa chỉ kho nguồn và tên các tệp giấy phép có trong `licenses/npm-dependencies.json`. Các bản văn giấy phép trong `licenses/` được lấy từ gói phát hành Safora 1.15.1. Khi dựng lại, công cụ dựng thu thập giấy phép từ dependency đã cài và tạo thư mục `dist/licenses/`.

`src/filters/ubol/sources.json` giữ địa chỉ nguồn, revision, SHA-256, giấy phép và các khác biệt chuyển đổi. `src/filters/ubol/` giữ đầu vào thô cùng thông báo nguồn. Các đường dẫn `filters/ubol-audit-*.json` được nhắc trong `licenses/FILTER-SOURCES.txt` là đầu ra bên trong `dist/` sau khi dựng. Quy tắc bổ sung chỉ dùng tập con mạng đã kiểm tra; số lượng không phải cam kết tương đương uBlock Origin Lite.

Bộ dựng giữ nguồn và thông báo của danh sách trong metadata, chuyển đổi theo API của thư viện đã khóa và kiểm tra tính nhất quán của source map. Hash của đầu vào và đầu ra là thông tin riêng. SHA-256 nhận dạng nội dung, không phải chữ ký nhà phát hành.

Cập nhật lúc chạy chỉ nhận tập con quy tắc mạng/CSS phù hợp. JavaScript, scriptlet từ xa và biến đổi nội dung phản hồi không hỗ trợ không được cài từ văn bản tải về; mã thực thi được đóng gói trong bản phát hành.

Khi phân phối bản dựng, cung cấp mã nguồn tương ứng, các bản sửa đổi, package/lockfile và công cụ dựng theo các giấy phép áp dụng. Không xóa hoặc đổi tên tác giả trong thông báo giấy phép; không trình bày nhãn hiệu thượng nguồn như thương hiệu riêng của Safora.
