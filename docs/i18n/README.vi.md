# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity là plugin Obsidian chỉ đọc, chạy hoàn toàn cục bộ, giúp tìm Broken links và Isolated files.

## Ảnh chụp màn hình

Xem liên kết hỏng và tệp cô lập trong một thanh bên gọn nhẹ:

![Thanh bên Link Integrity](../assets/link-integrity-overview-en.png)

![Tệp cô lập được nhóm theo thư mục](../assets/link-integrity-isolated-en.png)

Quản lý chỉ mục, quy tắc bỏ qua, loại tệp và quy tắc cô lập dự kiến trong phần cài đặt Obsidian:

![Cài đặt Link Integrity](../assets/link-integrity-settings-en.png)

## Tính năng

- Tìm các liên kết nội bộ trỏ tới tệp, tiêu đề hoặc khối không tồn tại trong Markdown, nội dung nhúng, Frontmatter, Canvas và các tham chiếu tệp được ghi rõ trong Bases.
- Tìm tệp không có liên kết vào hoặc ra hợp lệ với bất kỳ tệp hiện có nào khác trong Vault. Liên kết tới chính tệp đó và URL bên ngoài không được tính là kết nối trong Vault.
- Cảnh báo riêng khi một tệp cô lập vẫn có liên kết ra bị hỏng, để tránh hiểu nhầm rằng tệp đó rõ ràng có thể xóa.
- Có thể đánh dấu ghi chú định kỳ, mẫu, tệp lưu trữ và các tệp tương tự là Expected isolated. Việc này chỉ thay đổi cách chúng được phân loại trong kết quả, không thay đổi các liên kết thật.
- Lọc tệp cô lập theo tệp Obsidian, định dạng ảnh, âm thanh, video, PDF và phần mở rộng tệp đính kèm đã cấu hình.
- Tạo chỉ mục đầy đủ khi cần và tự động cập nhật khi Vault thay đổi.
- Mở từng vấn đề tại nguồn nếu có thể xác định chính xác vị trí. Việc quét, đối chiếu và lập chỉ mục đều diễn ra cục bộ.

Kết quả động từ truy vấn Bases không tự động được xem là liên kết. Nếu tệp đích tồn tại nhưng thiếu tiêu đề hoặc khối, hai tệp vẫn được xem là có kết nối và phần bị thiếu sẽ được báo riêng.

## Yêu cầu và khả năng tương thích

- Obsidian 1.12.7 trở lên.
- Hỗ trợ Obsidian trên máy tính và thiết bị di động.
- Chỉ kiểm tra Vault hiện tại. Không kiểm tra website bên ngoài hoặc tài nguyên từ xa.

## Cài đặt

Mở **Cài đặt → Plugin cộng đồng → Duyệt**, tìm **Link Integrity** và cài đặt. Nếu plugin chưa xuất hiện trong danh mục, hãy tải `link-integrity-<version>.zip` từ [bản phát hành GitHub mới nhất](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

Cài thủ công bằng cách đặt `main.js`, `manifest.json` và `styles.css` vào `Vault/.obsidian/plugins/link-integrity/`. Khi nâng cấp, chỉ thay ba tệp này và giữ `data.json`, trừ khi bạn muốn đặt lại cài đặt.

## Cách dùng

1. Bật Link Integrity trong plugin cộng đồng.
2. Mở Link Integrity từ ribbon hoặc bảng lệnh. Thanh bên có **Broken links** và **Isolated files**.
3. Chọn một kết quả để mở tệp nguồn. Bộ lọc tệp cô lập chỉ thay đổi chế độ xem hiện tại, không thay đổi giá trị mặc định đã lưu.
4. Quét khi khởi động mặc định bị tắt. Khi mở thanh bên, chỉ mục sẽ được tạo khi cần; bạn cũng có thể dùng **Tạo chỉ mục** hoặc **Tạo lại chỉ mục** trong phần Chung. Sau lần tạo đầu tiên thành công, thay đổi trong Vault sẽ tự động cập nhật kết quả.

## Cài đặt

- **Chung**: ngôn ngữ, quét khi khởi động, chế độ xem mặc định và thao tác tạo/tạo lại chỉ mục. Ngôn ngữ mặc định là **Theo Obsidian**.
- **Broken links**: chọn loại vấn đề cần hiển thị và quản lý quy tắc bỏ qua có tên kèm xem trước số mục khớp.
- **Isolated files**: loại tệp mặc định, chế độ xem tùy chọn “không có liên kết vào”, Expected isolated, quy tắc bỏ qua và quy tắc cô lập dự kiến.
- Quy tắc cô lập dự kiến có thể kết hợp loại tệp, một thư mục hoặc thư mục kèm thư mục con, định dạng ngày, mẫu glob và biểu thức chính quy nâng cao. Cài sẵn ghi chú định kỳ hỗ trợ ngày, tuần, tháng, quý và năm.

Cài đặt và quy tắc của người dùng được lưu trong `data.json`. Chỉ mục liên kết đã tính chỉ được giữ trong bộ nhớ và sẽ được tạo lại sau khi khởi động lại.

## Giới hạn

- Link Integrity không xóa tệp, không tự động viết lại liên kết và không tự quyết định tệp nào nên xóa.
- URL bên ngoài được cố ý loại khỏi phạm vi kiểm tra và không bao giờ được yêu cầu qua mạng.
- Kết quả động của Bases không được tính là kết nối trực tiếp giữa các tệp; chỉ các tham chiếu tệp được ghi rõ mới được tính.
- Quy tắc cô lập dự kiến chỉ thay đổi cách phân loại những tệp vốn đã cô lập. Chúng không ẩn liên kết hỏng và không loại bỏ kết nối thật giữa các tệp.

## Quyền riêng tư và bảo mật

Việc lập chỉ mục và đánh giá quy tắc đều diễn ra cục bộ. Link Integrity không tải nội dung Vault lên, không yêu cầu tài khoản và không sửa ghi chú. Đường dẫn và ví dụ chẩn đoán chỉ nằm trong phiên Obsidian hiện tại, trừ khi bạn tự chia sẻ chúng.

## Phát triển

Dùng Node.js 24.19.0 và npm 11.17.0. Chạy `npm ci`, sau đó `npm run check`.

Tài liệu cho nhà phát triển: [sản phẩm](../product-requirements.en.md), [UX](../ux-spec.en.md), [kiến trúc](../architecture.en.md), [kiểm thử](../testing-strategy.en.md). Bản gốc tiếng Trung tương ứng nằm trong cùng thư mục.

## Hỗ trợ

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a): Câu hỏi về cách sử dụng và cấu hình.
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas): Ý tưởng tính năng và quy trình làm việc đang được thảo luận.
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell): Mẹo sử dụng, quy trình làm việc và ví dụ tham khảo.

Dùng [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose) cho lỗi tái hiện được và yêu cầu cụ thể. Không đăng công khai đường dẫn Vault riêng tư, nội dung ghi chú, ví dụ chẩn đoán hoặc thông tin cá nhân.

## Giấy phép

[MIT](../../LICENSE) © ZhengYX
