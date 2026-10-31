# Safora 1.15.1

Safora là tiện ích chặn quảng cáo, theo dõi và một số tên miền độc hại cho trình duyệt Chromium Manifest V3. Tiện ích dùng quy tắc mạng của trình duyệt, CSS và mã hỗ trợ được đóng gói cục bộ; có ngoại lệ website, quy tắc cá nhân và sao lưu cài đặt.

Đây là mã nguồn tương ứng của Safora **1.15.1**. `src/`, `public/`, các đầu vào bộ lọc và phiên bản dependency được giữ nguyên từ bản phát hành. Kho này chỉ giữ công cụ dựng, đóng gói và kiểm thử cần thiết; các báo cáo nghiên cứu, so sánh hiệu năng dùng bản đối chiếu cũ, dữ liệu duyệt web thử nghiệm và dự án khác không được đưa vào.

- [Chính sách quyền riêng tư](https://github.com/nguyenphat2007/safora/blob/main/PRIVACY.md)
- [Mã nguồn phiên bản 1.15.1](https://github.com/nguyenphat2007/safora/tree/v1.15.1)
- Hỗ trợ: **nguyenduyphat0207@gmail.com**

## Dựng từ mã nguồn

Cần Node.js và npm; phiên bản Node tham chiếu ở `.nvmrc`. Lệnh đóng gói cần thêm Python 3.

```sh
npm ci
npm test
npm run build
```

`npm run build` kiểm tra TypeScript, lint, tạo thư mục `dist/` rồi xác minh tài nguyên, bộ lọc và giấy phép. Dependency được khóa trong `package-lock.json`; dùng `npm ci` để giữ đúng phiên bản. Lần cài dependency cần kết nối đến npm.

Để tạo gói Chrome Web Store cùng ZIP mã nguồn:

```sh
npm run package:webstore
```

Kết quả nằm trong `release/`:

- `Safora-1.15.1-chrome-webstore.zip`: gói tải lên cửa hàng.
- `Safora-1.15.1-source.zip`: mã nguồn và hướng dẫn dựng.
- `chrome-webstore/`: thư mục có thể nạp để kiểm tra bản cửa hàng.

Bản cửa hàng bỏ các quyền `tabs`, `privacy` và `declarativeNetRequestFeedback` khỏi bản dựng thử. Khả năng thống kê/nhật ký mạng của hai loại gói khác nhau; chính sách quyền riêng tư giải thích chi tiết. Gói tự dựng chưa phải bản được Google ký hoặc phê duyệt.

## Cài để thử

1. Chạy lệnh dựng hoặc đóng gói ở trên.
2. Mở `chrome://extensions`, bật **Chế độ dành cho nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén** và chọn `dist/` hoặc `release/chrome-webstore/`.
4. Tải lại website muốn kiểm tra. Giữ thư mục đã chọn ở vị trí cố định.

Chrome/Edge/Brave máy tính cần hỗ trợ Manifest V3 và đáp ứng phiên bản Chromium tối thiểu trong manifest. Trước khi thay bản đang dùng, xuất sao lưu cài đặt; chuyển sang thư mục mới có thể tạo ID tiện ích khác và không tự chuyển dữ liệu.

## Kiểm thử

```sh
npm test
npm run test:browser
npm run test:webstore
```

Chạy `npm run build` trước `test:browser`, và `npm run package:webstore` trước `test:webstore`. Kiểm thử trình duyệt dùng `playwright-core` và một bản Chromium/Chrome for Testing cài sẵn, tạo hồ sơ riêng cho từng lần thử. Chúng không kèm trình duyệt tải sẵn. Các script hiện tham chiếu bố cục bộ nhớ đệm Playwright trên macOS; có thể cần điều chỉnh phần tìm chương trình trình duyệt khi dùng hệ điều hành khác. `CHROMIUM_PATH` là đường dẫn chương trình dùng cho các script có hỗ trợ tùy chọn này.

Các tình huống thử cục bộ không đại diện cho mọi website thật. Safora không cam kết chặn toàn bộ quảng cáo, không thay thế phần mềm diệt virus và không tuyên bố mạnh hơn/nhẹ hơn tiện ích khác chỉ dựa vào số quy tắc.

## Cấu trúc và giấy phép

- `src/`: mã tiện ích và các đầu vào bộ lọc do dự án giữ.
- `public/`: giao diện, manifest, biểu tượng và chính sách đóng gói.
- `scripts/`, `tests/`: dựng, đóng gói, kiểm thử và dữ liệu thử tổng hợp.
- `store/privacy-policy.html`: bản chính sách chuẩn để đối chiếu trong kiểm thử.
- `licenses/`: các giấy phép và ghi công đi kèm bản phát hành, gồm bảng dependency và nguồn bộ lọc.

Safora được phân phối theo **GPL-3.0-only**; xem [LICENSE](LICENSE) và [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Giấy phép riêng của từng thành phần và bộ lọc được giữ nguyên. `licenses/npm-dependencies.json` ghi phiên bản, nguồn và tên tệp giấy phép của dependency. Các snapshot bổ sung có nguồn, checksum và ghi công trong `src/filters/ubol/`; quá trình dựng tạo thêm metadata, báo cáo chuyển đổi và nguồn bộ lọc trong `dist/`.

Đây là dự án độc lập, không phải sản phẩm chính thức của các dự án thượng nguồn. Khi phân phối bản dựng hoặc sửa đổi, giữ thông báo giấy phép, ghi công và cung cấp mã nguồn tương ứng theo các giấy phép áp dụng.

`node_modules/`, `dist/`, `release/`, kết quả thử nghiệm và tệp môi trường không được theo dõi trong Git.
