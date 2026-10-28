# Bộ lọc bảo mật đóng gói cho Safora

Thư mục này giữ nguyên hai nguồn chính thức được dùng trong hệ sinh thái uBlock Origin Lite, cùng giấy phép và checksum trong `sources.json`. Các bản nguồn chốt ngày 25–26/10/2026 mới hơn dữ liệu của bản uBOL đối chiếu 2026.1021.1354. Vì vậy không dùng chênh lệch số quy tắc để khẳng định chuyển đổi tương đương hoặc mạnh hơn uBOL.

| Nguồn | Quy tắc nguồn, chưa loại nhánh | Nhánh không hoạt động | Bị loại có lý do | Trùng nguyên văn | Được nhận / DNR |
| --- | ---: | ---: | ---: | ---: | ---: |
| uBlock filters – Badware risks, 90003 | 5.003 | 20 | 349 | 8 | 4.626 |
| Malicious URL Blocklist, 90004 | 1.800 | 0 | 0 | 0 | 1.800 |

Số dòng vật lý gồm bình luận khác với số quy tắc trong bảng. Hai danh sách có thể trùng nội dung với nhau hoặc với các danh sách hiện có; không gộp bỏ quy tắc giữa các danh sách vì mỗi danh sách phải vẫn hoạt động đúng khi được bật/tắt độc lập. Một quy tắc DNR của uBOL có thể gộp rất nhiều tên miền; số DNR không đo độ phủ.

`scripts/ubol-native-pack.mjs` biên dịch bằng AdGuard DNR Converter 2.0.0, tạo dữ liệu phù hợp với bộ máy Safora hiện tại và giữ source map. Tái sử dụng trực tiếp JSON của uBOL sẽ bỏ qua định dạng metadata/source map và quy tắc ưu tiên mà Safora đang dùng. Không nhập mã thực thi, scriptlet, CSS hay cơ chế trang cảnh báo strict-block của uBOL trong bổ sung này.

Badware chỉ nhận cú pháp mạng đã kiểm tra. Các dòng chứa modifier không hỗ trợ bị loại toàn bộ, không bỏ riêng modifier rồi biến thành lệnh chặn rộng hơn. 139 dòng cosmetic/scriptlet đang hoạt động và 157 dòng regex đều bị loại; các nhóm còn lại nằm trong `audit-90003.json`. Regex được chủ động giữ ở mức 0 cho bổ sung này, không mô phỏng bộ kiểm tra RE2 của Chrome khi build ngoại tuyến. `!#if` được xử lý theo môi trường Chromium MV3 của Safora, gồm `ext_ubol=false`; các nhánh bị tắt được ghi rõ từng dòng. Không tải nguồn `!#include`.

Ngoại lệ tài liệu uBO và ngoại lệ `$document` của AdGuard có tác dụng khác nhau. Dòng ngoại lệ đang hoạt động cho `toss.onelink.me` được giữ an toàn bằng cách miễn trừ cả tên miền này trong 564 quy tắc Badware có thể tác động tới nó. Đây là ngoại lệ rộng hơn nguồn gốc trong riêng danh sách 90003, có giảm độ phủ trên tên miền đó; các danh sách khác vẫn hoạt động. Dòng ngoại lệ gốc trở thành bình luận có giải thích. Không tạo `allowAllRequests` hoặc vô hiệu hóa CSS/scriptlet trên trang. Mỗi phép đổi có dòng gốc, dòng hiệu lực và lý do trong audit. Ngoại lệ tài liệu còn lại thuộc nhánh mobile nên không hoạt động trên Safora desktop.

Nguồn URLhaus chính thức uBOL dùng là **HOSTS**, không phải danh sách từng đường dẫn URL. Mỗi tên miền hợp lệ được chuyển thành `||tên-miền^$all`, bao gồm tên miền con và điều hướng, như phạm vi resource type của ruleset URLhaus uBOL đối chiếu. Đây không phải lệnh chặn riêng đường dẫn bị báo cáo. HOSTS không hợp lệ làm build thất bại.

Các quy tắc Badware có `$doc` chặn điều hướng; `$all` bao gồm điều hướng. Quy tắc Badware không có modifier loại tài nguyên đi theo ngữ nghĩa AdGuard hiện tại: mặc định không chặn `main_frame`. Không tuyên bố tương đương strict-block của uBO/uBOL.

Nguồn thô được xác minh SHA-256 và kích thước trước khi đọc. Build thất bại nếu nguồn, tổng số kỳ vọng, quota, ngoại lệ chưa hỗ trợ, source map, hoặc kết quả converter thay đổi. `$badfilter` chỉ được nhận khi đích cùng danh sách; thay đổi liên danh sách phải được xem xét riêng. Chỉ loại trùng nguyên văn trong từng nguồn.

Hai nguồn này chỉ cập nhật bằng **bản phát hành Safora mới**. Nút cập nhật các danh sách hiện có không tải hai nguồn đóng gói này. URLhaus có nhịp cập nhật nguồn 12 giờ nhưng bản chốt không tự cập nhật và có thể lỗi thời; cần xem ngày nguồn khi đánh giá hiệu quả. Muốn nâng nguồn: tải từ URL chính thức, lưu nguồn và giấy phép, kiểm tra thay đổi cú pháp/ngoại lệ, cập nhật checksum cùng số đếm kỳ vọng, sinh lại audit và chạy kiểm thử trước khi đóng gói. Cài bản trước là phương án khôi phục gói nguồn trước; Safora xử lý việc khôi phục bật/tắt và lỗi cài ruleset ở lớp runtime.

Giấy phép: Badware là GPL-3.0-only (`uassets-LICENSE`). URLhaus phân phối theo CC0-1.0 và MIT (`urlhaus-LICENSE-CC0.md`, `urlhaus-LICENSE`); `urlhaus-README.md` giữ thông tin ghi công các nguồn URLhaus, Tranco và Umbrella. Metadata nguồn đầy đủ nằm trong `sources.json`.
