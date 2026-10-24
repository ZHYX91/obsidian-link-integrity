# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Link Integrity giúp tìm các liên kết không còn hoạt động và những tệp không có kết nối hợp lệ với tệp khác trong kho Obsidian. Plugin chỉ hiển thị kết quả kiểm tra, không sửa liên kết hay xóa tệp.

## Ảnh chụp màn hình

Xem liên kết hỏng và tệp cô lập trong một thanh bên gọn nhẹ:

![Thanh bên Link Integrity](../assets/link-integrity-overview-en.png)

![Tệp cô lập được nhóm theo thư mục](../assets/link-integrity-isolated-en.png)

Quản lý chỉ mục, quy tắc bỏ qua, loại tệp và quy tắc cô lập dự kiến trong phần cài đặt Obsidian:

![Cài đặt Link Integrity](../assets/link-integrity-settings-en.png)

## Tính năng

- Có thể đánh dấu tệp, tiêu đề và khối được xác nhận là thiếu bằng gạch chân lượn sóng màu cảnh báo.
- Tìm các liên kết nội bộ trỏ tới tệp, tiêu đề hoặc khối không tồn tại trong Markdown, nội dung nhúng, Frontmatter, Canvas và các tham chiếu tệp được ghi rõ trong Bases.
- Tìm tệp không có liên kết vào hoặc ra hợp lệ với bất kỳ tệp hiện có nào khác trong Vault. Liên kết tới chính tệp đó và URL bên ngoài không được tính là kết nối trong Vault.
- Cảnh báo riêng khi một tệp cô lập vẫn có liên kết ra bị hỏng, để tránh hiểu nhầm rằng tệp đó rõ ràng có thể xóa.
- Có thể đánh dấu ghi chú định kỳ, mẫu, tệp lưu trữ và các tệp tương tự là Cô lập dự kiến. Việc này chỉ thay đổi cách chúng được phân loại trong kết quả, không thay đổi các liên kết thật.
- Lọc tệp cô lập theo tệp Obsidian, định dạng ảnh, âm thanh, video, PDF và phần mở rộng tệp đính kèm đã cấu hình.
- Tạo chỉ mục đầy đủ khi cần và tự động cập nhật khi Vault thay đổi.
- Mở từng vấn đề tại nguồn nếu có thể xác định chính xác vị trí. Việc quét, đối chiếu và lập chỉ mục đều diễn ra cục bộ.

Kết quả động từ truy vấn Bases không tự động được xem là liên kết. Nếu tệp đích tồn tại nhưng thiếu tiêu đề hoặc khối, hai tệp vẫn được xem là có kết nối và phần bị thiếu sẽ được báo riêng.

## Yêu cầu và khả năng tương thích

- Obsidian 1.12.7 trở lên.
- Hỗ trợ Obsidian trên máy tính và thiết bị di động. Phạm vi kiểm thử chính thức tách máy tính khỏi trình giả lập Android; thiết bị Android thực tế và iOS không thuộc phạm vi nghiệm thu đó.
- Chỉ kiểm tra Vault hiện tại. Không kiểm tra website bên ngoài hoặc tài nguyên từ xa.

## Cài đặt

Mở **Cài đặt → Plugin cộng đồng → Duyệt**, tìm **Link Integrity** và cài đặt. Nếu plugin chưa xuất hiện trong danh mục, hãy tải `link-integrity-<version>.zip` từ [bản phát hành GitHub mới nhất](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest).

Cài thủ công bằng cách đặt `main.js`, `manifest.json` và `styles.css` vào `Vault/.obsidian/plugins/link-integrity/`. Sau đó tải lại Obsidian và bật Link Integrity. Khi nâng cấp, chỉ thay ba tệp này và giữ `data.json`, trừ khi bạn muốn đặt lại cài đặt.

## Cách dùng

1. Bật Link Integrity trong plugin cộng đồng.
2. Mở Link Integrity từ ribbon hoặc bảng lệnh. Thanh bên có **Liên kết hỏng** và **Tệp cô lập**.
3. Chọn một kết quả để mở tệp nguồn. Bộ lọc tệp cô lập chỉ thay đổi chế độ xem hiện tại, không thay đổi giá trị mặc định đã lưu.
4. Quét khi khởi động mặc định bị tắt. Khi mở thanh bên, chỉ mục sẽ được tạo khi cần; bạn cũng có thể dùng **Tạo chỉ mục** hoặc **Tạo lại chỉ mục** trong phần Chung. Sau lần tạo đầu tiên thành công, thay đổi trong Vault sẽ tự động cập nhật kết quả.

Bật **Hiển thị liên kết hỏng trong nội dung** trong **Liên kết hỏng** để thấy cảnh báo khi đọc hoặc chỉnh sửa. Tùy chọn này mặc định tắt và không thay đổi cách mở liên kết. Chạy **Chẩn đoán liên kết hỏng trong ghi chú hiện tại** từ bảng lệnh để xem nguyên nhân và chuyển đến nguồn. Liên kết đang cập nhật hoặc chưa xác định được vị trí chính xác sẽ không được đánh dấu; hãy kiểm tra trong thanh bên.

## Cài đặt

**Hướng dẫn sử dụng** và **Báo cáo sự cố** nằm trong **Chung → Trợ giúp và hỗ trợ**. Hướng dẫn mở bằng ngôn ngữ giao diện hiện tại.

Ví dụ, `A.md` liên kết tới `[[B]]` và `B.md` tồn tại thì `A.md` không cô lập dù không có liên kết nào trỏ vào nó. Nếu chỉ có `[[Missing]]` mà không có kết nối hợp lệ khác, tệp vẫn được xem là cô lập nhưng phải kiểm tra trước khi xóa.

- **Chung**: ngôn ngữ, quét khi khởi động, chế độ xem mặc định và thao tác tạo/tạo lại chỉ mục. Ngôn ngữ mặc định là **Theo Obsidian**.
- **Liên kết hỏng**: chọn loại vấn đề cần hiển thị và quản lý quy tắc bỏ qua có tên kèm xem trước số mục khớp.
- **Tệp cô lập**: loại tệp mặc định, chế độ xem tùy chọn “không có liên kết vào”, Cô lập dự kiến, quy tắc bỏ qua và quy tắc cô lập dự kiến.
- Quy tắc cô lập dự kiến có thể kết hợp loại tệp, một thư mục hoặc thư mục kèm thư mục con, định dạng ngày, mẫu glob và biểu thức chính quy nâng cao. Cài sẵn ghi chú định kỳ hỗ trợ ngày, tuần, tháng, quý và năm.

**Lưu ý về quy tắc bỏ qua nâng cao:** Đánh dấu «Cô lập dự kiến» hoặc chỉ ẩn kết quả không làm thay đổi số kết nối. Tuy nhiên, tùy chọn nâng cao loại các liên kết khớp khỏi phép tính kết nối sẽ khiến chúng không còn được tính; vì vậy tệp thực sự có liên kết cũng có thể hiện là cô lập. Hãy xem trước các mục khớp trước khi áp dụng.

Cài đặt và quy tắc của người dùng được lưu trong `data.json`. Chỉ mục liên kết đã tính chỉ được giữ trong bộ nhớ và sẽ được tạo lại sau khi khởi động lại.

Mở rộng một quy tắc bỏ qua hoặc chọn **Thêm quy tắc bỏ qua**. Đặt **Phạm vi**, **Cách so khớp** và **Giá trị cần khớp**, rồi chọn **Xem trước**. Kiểm tra số mục khớp, ví dụ, số tệp và kết nối liên quan trước khi chọn **Lưu**. Thay đổi chỉ nằm trong bản nháp; **Hủy** sẽ bỏ các thay đổi đó. Khi quy tắc hoặc chỉ mục thay đổi, bạn cần xem trước lại. Nếu chưa có chỉ mục mới nhất, hãy tạo trong **Chung** trước. Bạn cũng có thể xem trước quy tắc đang tắt để biết phạm vi ảnh hưởng khi bật.

## Giới hạn

- Link Integrity không xóa tệp hay viết lại liên kết. Liên kết chưa xác định được vị trí sẽ không có gạch chân; xem thanh bên để kiểm tra thêm.
- URL bên ngoài được cố ý loại khỏi phạm vi kiểm tra và không bao giờ được yêu cầu qua mạng.
- Kết quả động của Bases không được tính là kết nối trực tiếp giữa các tệp; chỉ các tham chiếu tệp được ghi rõ mới được tính.
- Quy tắc cô lập dự kiến chỉ thay đổi cách phân loại những tệp vốn đã cô lập. Chúng không ẩn liên kết hỏng và không loại bỏ kết nối thật giữa các tệp.

## Quyền riêng tư và bảo mật

Lập chỉ mục chạy cục bộ. Plugin không tải Vault lên, không yêu cầu tài khoản và không đổi nội dung. Chỉ mục dẫn xuất nằm trong bộ nhớ.

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
