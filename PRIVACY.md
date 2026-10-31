# Safora — Chính sách quyền riêng tư

Nội dung chính sách cập nhật ngày **28/10/2026**, áp dụng cho **Safora 1.15.1**. Những khác biệt của bản nạp thử được nêu riêng bên dưới. Bản trên GitHub được công bố ngày **31/10/2026**; nội dung mô tả việc xử lý dữ liệu của tiện ích giữ nguyên.

**Tóm tắt:** Safora tiếp cận URL, yêu cầu mạng, nội dung trang và cookie cần thiết để lọc quảng cáo, hạn chế theo dõi và áp dụng ngoại lệ ngay trong trình duyệt. Nhật ký là tùy chọn, mặc định tắt. Tiện ích không gửi dữ liệu duyệt web, cookie, quy tắc cá nhân hoặc nhật ký về nhà phát triển. Khi tải bản sửa lỗi, nhà cung cấp tệp vẫn nhận địa chỉ IP và thông tin kết nối thông thường.

## 1. Thu thập, tiếp cận và xử lý dữ liệu nào?

Safora có mục đích lọc quảng cáo, tài nguyên theo dõi và địa chỉ độc hại theo bộ lọc, đồng thời cho phép quản lý bảo vệ theo website. Không cần tài khoản Safora. “Xử lý” dưới đây bao gồm việc đọc và sử dụng dữ liệu tại thiết bị, kể cả khi dữ liệu không được gửi đi.

- **Hoạt động duyệt web và yêu cầu mạng:** địa chỉ URL, tên miền, trang/khung đang mở, mã tab, loại tài nguyên, thông tin điều hướng và một số tiêu đề yêu cầu/phản hồi. URL có thể chứa tham số, đường dẫn hoặc thông tin riêng tư. Chrome và bộ máy lọc dùng chúng để khớp quy tắc, áp dụng ngoại lệ, hiển thị website được bảo vệ và duy trì trạng thái tab.
- **Nội dung website:** cấu trúc trang (DOM), văn bản, phần tử và thuộc tính HTML cần cho việc ẩn nội dung, áp dụng mã lọc đã đóng gói và chọn phần tử mà bạn muốn chặn. Tính năng tương thích video xử lý cục bộ phần dữ liệu phản hồi liên quan đến quảng cáo. Safora không tạo hồ sơ đọc tin, ghi bàn phím hoặc gửi nội dung trang cho nhà phát triển.
- **Cookie và thông tin có thể liên quan đến xác thực:** quy tắc cookie có thể đọc, xóa hoặc điều chỉnh cookie khớp trong trình duyệt; bộ máy lọc có thể xử lý tiêu đề Cookie/Set-Cookie và giá trị cookie. Cookie có thể chứa mã phiên đăng nhập. Safora không dùng chúng để đăng nhập thay bạn, không xuất chúng trong tệp sao lưu và không tải chúng lên máy chủ Safora. Lọc cookie khác với ẩn bảng thông báo cookie.
- **Dữ liệu bạn nhập:** lựa chọn bộ lọc, trạng thái bảo vệ, giao diện, website ngoại lệ, quy tắc cá nhân và cài đặt nhập từ tệp sao lưu. Dữ liệu này có thể chứa tên miền hoặc chuỗi riêng tư do bạn nhập.
- **Thao tác dùng công cụ:** khi bạn bật bộ chọn phần tử, tiện ích dùng vị trí con trỏ và phần tử được nhấp để tạo quy tắc tại thiết bị; không gửi bản ghi hành vi tương tác để phân tích. Thao tác với công tắc và nút dùng để thực hiện lựa chọn của bạn.

Safora không yêu cầu tên, số điện thoại, thông tin thanh toán, dữ liệu sức khỏe hoặc vị trí GPS để hoạt động. Tuy nhiên, nội dung trang, URL, thuộc tính phần tử hoặc cookie mà bộ lọc tiếp cận có thể chứa thông tin nhạy cảm; không nên hiểu điều này là tiện ích hoàn toàn không xử lý dữ liệu người dùng.

## 2. Mục đích sử dụng và giới hạn sử dụng

Dữ liệu chỉ phục vụ các chức năng lọc đã mô tả, trạng thái bảo vệ theo trang, quy tắc cá nhân, sao lưu/khôi phục do bạn thực hiện và chẩn đoán khi bạn bật nhật ký. Safora không có hệ thống phân tích hành vi từ xa, không bán dữ liệu, không dùng dữ liệu cho quảng cáo cá nhân hóa, môi giới dữ liệu, chấm điểm tín dụng hoặc mục đích cho vay.

Việc sử dụng thông tin nhận được từ các API của Google tuân thủ Chính sách dữ liệu người dùng của Chrome Web Store, bao gồm các yêu cầu về Limited Use (Giới hạn sử dụng). Nhà phát triển không tự động nhận hoặc đọc dữ liệu duyệt web được xử lý trong tiện ích.

## 3. Lưu trữ ở đâu và trong bao lâu?

- **Cài đặt, ngoại lệ và quy tắc cá nhân:** lưu trong vùng cục bộ của hồ sơ trình duyệt cho đến khi bạn sửa/xóa hoặc gỡ tiện ích. Không dùng đồng bộ đám mây của Safora. Nếu cấu hình cũ bị lỗi, một bản cấu hình cách ly có thể được giữ cục bộ để phục hồi; xóa nội dung hiện tại không tự xóa bản cách ly này.
- **Bộ lọc và bộ nhớ đệm:** lưu trong tệp tiện ích, vùng lưu trữ cục bộ và cơ sở dữ liệu cục bộ của bộ máy lọc (IndexedDB), cùng phiên bản, checksum, thời điểm cập nhật và thông tin kiểm tra phiên bản tệp. Bản sửa lỗi được thay khi có cập nhật hợp lệ; bản hoạt động trước được giữ nếu cập nhật thất bại.
- **Trạng thái vận hành:** thông tin tab, khung trang, URL và dữ liệu yêu cầu cần cho bộ máy lọc tồn tại trong bộ nhớ hoặc vùng lưu trữ phiên. Trạng thái được cập nhật/dọn theo vòng đời tab và yêu cầu; một số bộ nhớ đệm phiên có thể còn đến khi kết thúc phiên trình duyệt. Đây không phải kho lịch sử duyệt web do nhà phát triển nhận.
- **Nhật ký tùy chọn:** tối đa 500 sự kiện trong vùng lưu trữ phiên của tiện ích. Xem chi tiết ở mục 4. Xóa nhật ký hoặc tắt ghi nhật ký sẽ xóa các sự kiện của Safora; kết thúc phiên trình duyệt cũng xóa vùng lưu trữ phiên. Việc tắt nhật ký không xóa trạng thái vận hành cần để tiếp tục lọc.
- **Thống kê:** bản Chrome Web Store dùng số lần xử lý quy tắc do Chrome hiển thị trên biểu tượng cho trang hiện tại, không tạo lịch sử yêu cầu mạng chi tiết hay hiển thị biểu đồ lịch sử. Bản nạp thử có quyền phản hồi gỡ lỗi có thể lưu tổng số tích lũy và tối đa 30 ngày số tổng hợp theo nhóm; bảng theo ngày không chứa URL hoặc tên miền. Dữ liệu tổng hợp cũ có thể còn trong hồ sơ sau khi đổi loại gói và không được xuất trong sao lưu cài đặt.
- **Tệp sao lưu:** chỉ được tạo khi bạn chọn xuất cài đặt. Đây là tệp JSON không mã hóa ở nơi bạn chọn, có thể chứa ngoại lệ, quy tắc và trạng thái bật nhật ký. Tệp không chứa cookie, nhật ký, lịch sử thống kê hoặc nội dung bộ lọc tải về. Bạn quản lý thời hạn lưu và tự xóa tệp này.

## 4. Nhật ký chẩn đoán là tùy chọn

Nhật ký mặc định tắt. Khi bật tại **Cài đặt → Nhật ký lọc**, Safora ghi các sự kiện được trình duyệt cung cấp: thời điểm, tab, tên miền/đường dẫn, nhóm bộ lọc, quy tắc và thông tin phần tử bị ẩn. Khả năng ghi sự kiện mạng khác nhau giữa bản cửa hàng và bản nạp thử.

Đối với trường URL mạng của nhật ký, tham số truy vấn và phần fragment được loại bỏ trước khi ghi. Điều đó **không có nghĩa mọi dữ liệu nhật ký đã được ẩn danh**: đường dẫn, dòng quy tắc và chuỗi mô tả phần tử có thể chứa thông tin riêng tư. Chuỗi phần tử được giới hạn 300 ký tự và có thể bao gồm thuộc tính HTML như liên kết, tên lớp hoặc giá trị thuộc tính. Không tự động gửi nhật ký đi. Hãy kiểm tra và che dữ liệu riêng tư trước khi tự chia sẻ ảnh hoặc sao chép nội dung để nhờ hỗ trợ.

## 5. Kết nối mạng và chia sẻ dữ liệu với bên nào?

**Nhà phát triển Safora:** tiện ích không có máy chủ nhận lịch sử duyệt web, nội dung trang, cookie, nhật ký, quy tắc hay cấu hình của bạn. Không gửi dữ liệu này để quảng cáo hoặc bán cho bên thứ ba.

**GitHub, nhà cung cấp tệp bộ lọc:** tiện ích kiểm tra và tải một danh sách sửa lỗi văn bản qua HTTPS từ `raw.githubusercontent.com`, khi khởi động/đến hạn hoặc khi bạn bấm “Kiểm tra ngay”. Việc kiểm tra được lên lịch theo giờ, còn thời điểm tải lại phụ thuộc hạn dữ liệu từ 1–24 giờ. Yêu cầu dùng địa chỉ tệp cố định; không đính kèm cookie, referrer, URL trang bạn đang xem, nhật ký, ngoại lệ hoặc quy tắc cá nhân. Có thể gửi thông tin phiên bản tệp đã tải (ETag/Last-Modified) để tránh tải lại dữ liệu giống nhau.

Máy chủ GitHub và hạ tầng phân phối của họ vẫn nhận địa chỉ IP, thời điểm và thông tin HTTP/kết nối cần để phục vụ tệp. Safora không che địa chỉ IP và không kiểm soát nhật ký hay thời hạn lưu của nhà cung cấp này. Xem [chính sách quyền riêng tư của GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Chỉ dữ liệu quy tắc mạng/CSS phù hợp được nhận; mã thực thi được đóng gói cùng tiện ích.

**Google/Chrome và trang bạn truy cập:** việc cài đặt, cập nhật tiện ích qua cửa hàng và các yêu cầu duyệt web thông thường do trình duyệt/website xử lý theo chính sách của họ. Safora không tự gửi một bản sao dữ liệu duyệt web đến Google. Nếu bạn mở một liên kết ra ngoài hoặc xem bản chính sách trên một website công khai, nhà cung cấp website đó nhận thông tin kết nối thông thường theo chính sách riêng của họ. Bản chính sách đóng gói trong tiện ích không tải script, phông chữ, ảnh hay công cụ phân tích từ xa.

**Hỗ trợ do bạn chủ động liên hệ:** khi gửi email, nhà phát triển và nhà cung cấp email nhận địa chỉ người gửi, nội dung và tệp đính kèm bạn chọn gửi. Thông tin này được dùng để trả lời hoặc xử lý yêu cầu hỗ trợ; không được tiện ích tự gửi. Thư hỗ trợ được giữ trong thời gian cần giải quyết yêu cầu và nghĩa vụ lưu giữ áp dụng; bạn có thể yêu cầu xem, sửa hoặc xóa qua email bên dưới. Không gửi mật khẩu, mã đăng nhập, cookie hoặc tệp chứa bí mật.

## 6. Quyền kiểm soát và xóa dữ liệu

- Tại **Nhật ký lọc**, bấm “Xóa nhật ký” để xóa sự kiện đã ghi hoặc tắt “Ghi nhật ký lọc” để dừng ghi và xóa nhật ký phiên.
- Tại **Website ngoại lệ** hoặc **Quy tắc cá nhân**, sửa/xóa nội dung rồi lưu. Tại **Quyền riêng tư → Sao lưu và khôi phục cài đặt**, bạn có thể xuất hoặc chọn tệp để xem trước khi khôi phục. Khôi phục thay cấu hình hiện có, có thể bật lại nhật ký nếu tệp đã lưu lựa chọn đó.
- Bạn có thể tạm dừng bảo vệ, tắt theo website hoặc giới hạn quyền truy cập website trong Chrome. Việc tạm tắt lọc không phải thao tác xóa dữ liệu hoặc công tắc tắt riêng việc tải bản sửa lỗi.
- Để dừng toàn bộ hoạt động của tiện ích, tắt tiện ích trong trang quản lý của Chrome. Để xóa vùng lưu trữ do tiện ích quản lý, gỡ Safora theo cơ chế của trình duyệt. Gỡ tiện ích không xóa tệp sao lưu bạn đã xuất, thư bạn đã gửi, dữ liệu website/cookie của chính website hoặc bản sao lưu hồ sơ do hệ điều hành/công cụ khác tạo.

Nhà phát triển không có bản sao dữ liệu cục bộ của bạn để xem hoặc xóa từ xa. Bạn có thể liên hệ để được hướng dẫn; dữ liệu do GitHub/Google hay dịch vụ khác lưu được quản lý theo cơ chế của dịch vụ đó.

## 7. Bảo vệ dữ liệu

Kết nối tải bộ lọc dùng HTTPS, không gửi thông tin xác thực, từ chối chuyển hướng ngoài nguồn cố định và kiểm tra dữ liệu trước khi áp dụng. Dữ liệu cục bộ dựa vào cơ chế bảo vệ hồ sơ trình duyệt và thiết bị; Safora không tuyên bố mã hóa riêng cài đặt hoặc tệp sao lưu. Cần bảo vệ tài khoản hệ điều hành, hồ sơ trình duyệt và các tệp bạn xuất.

## 8. Thay đổi chính sách

Ngày cập nhật và phiên bản áp dụng được ghi ở đầu trang. Nếu thay đổi cách xử lý dữ liệu, Safora sẽ cập nhật chính sách và thông tin hiển thị tương ứng; những cách sử dụng dữ liệu cần sự đồng ý mới phải được thông báo trước khi áp dụng.

## 9. Liên hệ

**Nhà phát triển:** Safora.

**Email hỗ trợ và quyền riêng tư:**[nguyenduyphat0207@gmail.com](mailto:nguyenduyphat0207@gmail.com).

Ghi “Safora — quyền riêng tư” trong tiêu đề để yêu cầu giải thích, hướng dẫn truy cập/xóa dữ liệu hoặc xử lý thông tin bạn đã gửi qua hỗ trợ.

## 10. Mã nguồn và giấy phép

Mã nguồn Safora được công bố tại [kho GitHub của Safora](https://github.com/nguyenphat2007/safora). Bạn có thể xem [mã nguồn đúng phiên bản 1.15.1](https://github.com/nguyenphat2007/safora/tree/v1.15.1), gồm công cụ dựng, đầu vào bộ lọc và hướng dẫn cài thử.

Safora được phân phối theo [giấy phép GPL-3.0-only](https://github.com/nguyenphat2007/safora/blob/v1.15.1/LICENSE). Giấy phép và ghi công của các thành phần nguồn mở được giữ trong [thông báo thành phần bên thứ ba](https://github.com/nguyenphat2007/safora/blob/v1.15.1/THIRD-PARTY-NOTICES.md) và thư mục giấy phép của mã nguồn.

Mở liên kết GitHub sẽ truy cập website bên ngoài và chịu chính sách quyền riêng tư của GitHub được dẫn ở mục 5.

## 11. Trang chính sách trên GitHub

Bản chính sách này được hiển thị công khai trong kho mã nguồn Safora trên GitHub. Khi bạn đọc trang, GitHub xử lý thông tin truy cập và kết nối, bao gồm địa chỉ IP, theo [chính sách quyền riêng tư của GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Đây không phải dữ liệu duyệt web do tiện ích Safora tải lên.

**Nhà phát triển:** Safora

**Email hỗ trợ và quyền riêng tư:** [nguyenduyphat0207@gmail.com](mailto:nguyenduyphat0207@gmail.com)
