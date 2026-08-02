# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity là plugin chẩn đoán Obsidian chỉ đọc, chạy cục bộ cho Broken links và Isolated files.

## Ảnh chụp màn hình

Xem liên kết hỏng và tệp cô lập trong thanh bên gọn nhẹ:

![Thanh bên Link Integrity](../assets/link-integrity-overview-en.png)

Cấu hình chỉ mục, quy tắc bỏ qua, loại tệp và trạng thái cô lập dự kiến trong cài đặt Obsidian:

![Cài đặt Link Integrity](../assets/link-integrity-settings-en.png)

## Tính năng

- Báo cáo tham chiếu nội bộ hỏng tới tệp, tiêu đề và khối từ Markdown, nội dung nhúng, Frontmatter, Canvas và tham chiếu tệp rõ ràng của Bases.
- Tìm tệp không có kết nối vào hoặc ra hợp lệ với tệp Vault hiện có khác; liên kết tự thân và URL bên ngoài không tạo kết nối.
- Đánh dấu tệp cô lập có liên kết ra hỏng với độ tin cậy thấp hơn.
- Hiển thị tùy chọn ghi chú định kỳ, mẫu và kho lưu trữ dưới dạng Expected isolated mà không tạo cạnh giả.
- Lọc tệp Obsidian, nhóm định dạng ảnh, âm thanh, video, PDF và phần mở rộng tệp đính kèm đã cấu hình.
- Tạo đường cơ sở đầy đủ khi cần rồi duy trì bằng cập nhật tăng dần.
- Mở nguồn của từng chẩn đoán; mọi phân tích và lập chỉ mục đều ở cục bộ.

Kết quả truy vấn Bases động không phải cạnh rõ ràng. Nếu tệp được giải quyết nhưng thiếu tiêu đề hoặc khối, kết nối cấp tệp vẫn hợp lệ và lỗi đường dẫn con được báo riêng.

## Yêu cầu và khả năng tương thích

- Obsidian 1.12.7 trở lên.
- Dành cho máy tính và thiết bị di động; mỗi máy chủ và thiết bị thật là một ranh giới nghiệm thu riêng.
- Chỉ chẩn đoán Vault hiện tại, không kiểm tra Web bên ngoài.

## Cài đặt

Bản công khai đầu tiên đang chờ nghiệm thu cuối. Sau khi phát hành, cài từ **Cài đặt → Plugin cộng đồng → Duyệt** hoặc tải `link-integrity-<version>.zip` từ [bản phát hành mới nhất](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

Cài thủ công bằng cách đặt `main.js`, `manifest.json` và `styles.css` vào `Vault/.obsidian/plugins/link-integrity/`. Khi nâng cấp, chỉ thay ba tệp này và giữ `data.json` trừ khi muốn đặt lại cài đặt.

## Cách dùng

1. Bật Link Integrity trong plugin cộng đồng.
2. Mở thanh bên từ ribbon hoặc bảng lệnh rồi chuyển giữa **Broken links** và **Isolated files**.
3. Chọn chẩn đoán để mở nguồn; bộ lọc chỉ thay đổi chế độ xem hiện tại.
4. Nếu tắt quét khi khởi động hoặc đường cơ sở thất bại, dùng **Tạo chỉ mục** hoặc **Tạo lại chỉ mục** trong cài đặt Chung. Sau đó cập nhật tăng dần sẽ tự giữ kết quả mới nhất.

## Cài đặt

- **Chung**: ngôn ngữ, quét khi khởi động, nhóm kết quả và thao tác chỉ mục. Mặc định là **Theo Obsidian**.
- **Broken links**: loại chẩn đoán và quy tắc bỏ qua có tên kèm bản xem trước.
- **Isolated files**: loại tệp mặc định, phân tích tùy chọn không có liên kết vào, hiển thị Expected isolated và quy tắc.
- Quy tắc cô lập dự kiến có thể kết hợp loại, thư mục chính xác hoặc đệ quy, định dạng ngày, glob và biểu thức chính quy; cài sẵn ghi chú định kỳ hỗ trợ ngày, tuần, tháng, quý và năm.

Cài đặt và quy tắc được lưu trong `data.json`; đồ thị dẫn xuất không được lưu.

## Giới hạn

- Không xóa tệp hoặc tự động viết lại liên kết.
- Không yêu cầu URL bên ngoài qua mạng.
- Truy vấn Bases động không được tính là kết nối rõ ràng.
- Quy tắc Expected isolated chỉ ảnh hưởng phép chiếu ứng viên và không bao giờ ẩn liên kết hỏng.
- Kiểm thử tự động không thay thế nghiệm thu trên phiên bản và thiết bị Obsidian thật.

## Quyền riêng tư và bảo mật

Mọi xử lý diễn ra cục bộ. Link Integrity không tải nội dung Vault lên, không yêu cầu tài khoản, không sửa ghi chú và không lưu đồ thị dẫn xuất.

## Phát triển

Dùng Node.js 24.18.0 và npm 11.16.0. Chạy `npm ci`, sau đó `npm run check`.

Hợp đồng ổn định: [sản phẩm](../product.en.md), [UX](../ux.en.md), [kiến trúc](../architecture.en.md), [kiểm thử](../testing-strategy.en.md) và [phát hành](../release.en.md). Nguồn tiếng Trung tương ứng nằm trong cùng thư mục.

## Hỗ trợ

Dùng [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues) cho lỗi tái hiện được và yêu cầu cụ thể. Không đăng công khai đường dẫn Vault, nội dung ghi chú hoặc mẫu chẩn đoán riêng tư.

## Giấy phép

[MIT](../../LICENSE) © ZhengYX
