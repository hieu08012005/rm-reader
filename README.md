# RM Reader

Ứng dụng Windows để đọc reference manual/datasheet PDF và dịch phần bôi đen sang tiếng Việt theo ngữ cảnh **lập trình nhúng**.

## Mở ứng dụng

Bản đóng gói được đặt trong `E:\App_RM\release`. Đóng phiên bản cũ rồi chạy `RM-Reader-1.8.0.exe`, hoặc `win-unpacked\RM Reader.exe`. Với bản `win-unpacked`, giữ nguyên toàn bộ thư mục đi kèm. Phiên bản hiện ở bên phải thanh tab. Biểu tượng EXE và logo dùng ảnh người dùng cung cấp. Bản 1.2.1 giảm khoảng trống quanh biểu tượng taskbar, giúp phần hình lớn hơn khoảng 25%; ảnh gốc vẫn được giữ nguyên.

### Giao diện Việt/Anh và học vocab theo folder (1.8.0)

Mở **Cài đặt → Ngôn ngữ giao diện** để chọn Tiếng Việt hoặc English. Lựa chọn áp dụng ngay và được giữ khi mở lại app; nghĩa vocab, bản dịch, văn bản PDF, nội dung chat và tên folder do bạn đặt giữ nguyên.

Khi bôi đen rồi chọn **Lưu vocab**, chọn folder trong app và kiểm tra/bổ sung nghĩa trước khi lưu. Vocab cũ được giữ trong **Chưa phân loại**. Mở biểu tượng quyển sách để tạo/đổi tên folder, thêm từ thủ công hoặc **Sửa / chuyển** từ sang folder khác. Lưu lại cùng từ và PDF trong cùng folder sẽ bổ sung nghĩa, không tạo mục trùng. Folder có từ cần chuyển hết từ trước khi xóa.

Trong danh sách vocab, chọn một folder rồi nhấn **Xuất folder ra PDF** và chọn nơi lưu trên máy. File chỉ chứa các từ của folder đó, gồm cả từ đang bị ẩn bởi ô tìm kiếm; từng từ/ nghĩa có ô riêng, kèm nguồn PDF nếu có, định dạng A4 và số trang. App không có thao tác xuất toàn bộ thư viện.

Chọn folder rồi mở **Flashcard**, **Viết kiểm tra** hoặc **Nối từ với nghĩa**. Flashcard lật từ/nghĩa và tự đánh giá Đã nhớ/Chưa nhớ. Viết kiểm tra cho nghĩa và yêu cầu nhập từ; không phân biệt hoa/thường hoặc khoảng trắng thừa, vẫn phân biệt dấu. Nối từ trộn thứ tự nghĩa, chia lượt tối đa 6 cặp rồi đi tiếp qua folder; từ hoặc nghĩa trùng nhau được bỏ bớt để tránh cặp mơ hồ. Từ chưa có nghĩa không đưa vào bài học. Mỗi phiên tối đa 2.000 từ; kết quả và các từ cần ôn lại được lưu trên máy. Các bài học hoạt động ngoại tuyến.

Kiểm tra với `npm run test:vocabulary`, hoặc `npm run test:vocabulary:packaged` cho bản EXE. Các bài kiểm tra dùng hồ sơ riêng và không gửi yêu cầu AI.

### Ctrl+Z quay lại vị trí đọc (1.7.1)

Sau khi nhấp liên kết xanh hoặc mục lục, nhấn **Ctrl+Z** để quay về vị trí trước đó, gồm trang, cuộn và mức zoom. Có thể nhấn nhiều lần để đi ngược lịch sử của PDF đang đọc. Trong chế độ Hai PDF, phím đi theo khung đang được tương tác, giống Alt+←. Khi con trỏ đang ở ô chat, tìm kiếm, nhập liệu hoặc trình sửa văn bản, Ctrl+Z vẫn hoàn tác văn bản; hộp thoại cũng giữ thao tác của riêng nó.

Kiểm tra với `node tests/navigation-shortcuts-app.mjs`; thêm `--packaged` để chạy trên bản EXE. Bài kiểm tra dùng PDF và hồ sơ riêng.

### Màu theo cấp mục lục (1.7.0)

Nhấn **Màu theo cấp** dưới tiêu đề Mục lục. Cấp 1 là bookmark ngoài cùng; các mục con lần lượt là cấp 2, 3… App tự hiện đủ cấp của PDF đang mở, cùng các cấp đã cấu hình trước đó. Có thể nhấn **Thêm cấp** để chuẩn bị màu cho tài liệu sâu hơn.

Mỗi cấp có ô chọn màu, ba giá trị **R, G, B** (số nguyên từ 0 đến 255) và chữ mẫu. Màu xem trước ngay trong mục lục, gồm cả mục đang chọn và kết quả tìm kiếm. Nhấn **Lưu màu** để lưu trên máy và áp dụng chung cho mọi PDF, kể cả sau khi mở lại app. **Hủy**, nút × hoặc Esc bỏ thay đổi chưa lưu. **Màu mặc định** khôi phục bảng màu mặc định trong phần xem trước; nhấn Lưu màu để xác nhận.

Thử giao diện bằng PDF 8 cấp với `node tests/outline-colors-app.mjs`, hoặc thêm `--packaged` để kiểm tra bản EXE. Kiểm thử dùng hồ sơ riêng và không gửi yêu cầu tới API AI.

### Ghim vào taskbar (1.6.1)

Bản portable giải nén Electron vào thư mục tạm khi chạy. Từ 1.6.1, app đặt thông tin mở lại cho taskbar tới file portable gốc, và đặt AppUserModelID trước khi hiện cửa sổ. Bản `win-unpacked` dùng trực tiếp đường dẫn EXE cố định.

Nếu shortcut đã ghim ở bản cũ báo lỗi, chọn **No** trong hộp thoại, bỏ ghim biểu tượng cũ, mở `E:\App_RM\RM Reader.lnk` hoặc bản portable 1.6.1 rồi ghim lại. Shortcut trong `E:\App_RM` trỏ tới `release\win-unpacked\RM Reader.exe`, nên vẫn dùng đường dẫn đó khi cập nhật tại chỗ. Giữ nguyên thư mục đi kèm; nếu di chuyển app sang nơi khác, cần ghim lại từ vị trí mới.

## Cách sử dụng

1. Nhấn **Mở PDF** hoặc dấu **+**; giữ Ctrl/Shift để chọn nhiều file trong hộp thoại. Có thể kéo thả nhiều PDF vào cửa sổ. Mỗi file mở trong một tab như các trình đọc PDF thông dụng.
2. Nhấp chương/mục trong thanh **Mục lục** hoặc liên kết xanh trong PDF để tới vị trí đích.
3. Nhấn **Ctrl+Z**, **Back trên chuột**, nút Quay lại, hoặc `Alt + ←` để quay lại đúng vị trí trước đó, gồm vị trí cuộn và mức zoom. `Alt + →` hoặc Forward trên chuột để tiến tới.
4. Bôi đen từ/đoạn văn rồi nhấn **Dịch sang tiếng Việt**. Kết quả nằm trong bảng bên phải.
5. `Ctrl + F` để tìm trong PDF; `Enter`/`Shift + Enter` chuyển kết quả. `Ctrl + O` mở tài liệu.
6. Có thể bật **Tự động dịch khi bôi đen** trong bảng dịch, điều chỉnh chiều rộng bằng vạch giữa PDF và bản dịch, và thay đổi cỡ chữ trong Cài đặt.
7. Nhấp tab để chuyển tài liệu, nhấp **×** để đóng. `Ctrl+Tab` / `Ctrl+Shift+Tab` chuyển tab, `Ctrl+W` đóng tab hiện tại. Tab **Start** mở màn hình đầu. Từng tab giữ riêng vị trí cuộn, mức zoom, lịch sử Back/Forward và bản dịch; mở lại cùng một file dùng tab đã có. Tab được giữ trong phiên làm việc; vị trí đọc từng file được lưu qua các lần mở app.
8. Khi bôi đen, chọn **Lưu vocab** cạnh nút Dịch. Nút Lưu vocab trong bảng dịch lưu thêm nghĩa tiếng Việt nếu đã dịch xong. Nhấn biểu tượng quyển sách trên thanh công cụ để xem danh sách, tìm theo từ/nghĩa/tên PDF, sao chép hoặc xóa. Nhấn tên PDF trong vocab để quay về trang nguồn, kể cả khi PDF đã đóng. Danh sách được lưu trên máy và còn sau khi khởi động lại. Lưu lại cùng từ trong cùng tài liệu sẽ bổ sung nghĩa, không tạo mục trùng.
9. Kéo thả tab PDF để đổi thứ tự; vạch xanh cho biết vị trí đặt. Tab Start luôn ở đầu. Khi tab đang được chọn, `Ctrl+Shift+←/→` cũng đổi thứ tự. Trang, zoom và lịch sử đọc vẫn được giữ nguyên.

## Xem hai PDF cạnh nhau

Mở reference manual và datasheet thành các tab, chọn tài liệu muốn đọc bên trái rồi nhấn **Hai PDF**. App mở một tài liệu khác đang có ở bên phải. Có thể dùng **Mở PDF** trong khung bên phải để chọn file khác. Mỗi khung có thanh trang/zoom, vùng cuộn và lịch sử liên kết riêng. Nút Back trên chuột đi theo khung vừa tương tác. Kéo vạch giữa hai khung để điều chỉnh tỷ lệ; nhấn Hai PDF lần nữa để trở về một khung. Mở lại chế độ đối chiếu trong cùng phiên vẫn giữ file và vị trí bên phải.

Mục lục và bảng dịch được thu gọn khi bắt đầu đối chiếu để dành chỗ cho hai tài liệu; có thể bật lại từ thanh công cụ. Bôi đen ở bên phải vẫn dịch vào bảng tiếng Việt chung và lưu vocab/ghi chú đúng tài liệu bên phải.

## Đánh dấu và ghi chú

Thanh công cụ ngay trên trang có **Chọn**, **Tô màu**, **Vẽ**, **Tẩy** và **Text box**. Mỗi khung trong chế độ Hai PDF có bộ công cụ riêng.

- **Tô màu:** chọn màu rồi bôi đen liên tiếp; mỗi vùng tự lưu, không cần mở hộp thoại. Muốn thêm ghi chú cho vùng đã tô, về Chọn rồi nhấn biểu tượng ghi chú cạnh vùng đó.
- **Vẽ:** chọn màu và độ dày nét 1/2/4/8/12, giữ chuột trái kéo trên trang. Màu, độ dày và tọa độ nét được lưu; một lần kéo tạo một nét trên một trang.
- **Tẩy:** chọn kích thước nhỏ/vừa/lớn rồi kéo qua nét vẽ hoặc vùng tô. Tẩy cắt đúng phần đi qua, giữ các phần còn lại. Không tẩy nội dung PDF gốc hoặc text box.
- **Text box:** chọn màu/cỡ chữ, nhấn vào trang rồi nhập. Enter xuống dòng; Ctrl+Enter, nút Lưu hoặc nhấn ra ngoài để lưu. Kéo góc dưới bên phải để đổi kích thước. Nhấn hộp đã có để sửa; nút × trong trình sửa xóa hộp. Esc hủy phần đang nhập. Danh sách ghi chú cũng có thể sửa nội dung/màu của hộp.
- **Chọn** hoặc **Esc:** trở lại bôi đen để dịch và nhấp liên kết.

Nét vẽ và text box cũng có trong danh sách ghi chú, hỗ trợ tìm kiếm, quay về trang nguồn và xóa. Các dấu dùng tọa độ PDF nên đi theo trang khi zoom; lưu cùng ghi chú trên máy và còn sau khi mở lại app.

Bôi đen đoạn văn → **Đánh dấu / Ghi chú** → chọn màu vàng, xanh lá, xanh dương hoặc hồng → nhập ghi chú → **Lưu đánh dấu**. Để trống ghi chú nếu chỉ muốn tô màu. Nút ghi chú nhỏ cạnh đoạn đã tô mở lại trình sửa nội dung/màu.

Nhấn biểu tượng tờ ghi chú trên thanh công cụ để xem và tìm trong tất cả ghi chú. Nhấn một ghi chú để mở file nguồn và quay về đúng đoạn; Back trở lại chỗ đang đọc trước đó. Có thể sửa hoặc xóa từng ghi chú. Đánh dấu dùng tọa độ PDF nên giữ vị trí khi đổi zoom; có thể ghi chú ở cả hai khung đối chiếu.

Ghi chú được lưu trong dữ liệu RM Reader trên máy, còn qua khởi động lại; file PDF gốc không bị sửa. Nếu file nguồn đã thay đổi, app báo ghi chú thuộc phiên bản cũ để tránh áp dụng sai đoạn.

## Giữ xuống dòng khi dịch

Văn bản gốc trong bảng dịch giữ tiêu đề, xuống dòng, gạch đầu dòng và thụt dòng. Với mọi dịch vụ, app bảo vệ ranh giới dòng bằng mã giữ chỗ rồi khôi phục sau khi dịch. Các mục được giữ thành các dòng tương ứng; tên thanh ghi và định danh vẫn được bảo vệ như trước. Nếu model làm mất ranh giới dòng, app báo lỗi để thử lại thay vì gộp toàn bộ danh sách thành một đoạn.

## Tệp đính kèm (Attachments)

Nhấn biểu tượng **kẹp giấy** cạnh nút Mục lục để mở bảng Tệp đính kèm bên trái. Bảng hiện tên file, loại file, mô tả, ô tìm theo tên/mô tả và các nút **Mở**, **Lưu**, **Lưu tất cả**. Nhấn tên file cũng mở được. Nhấn kẹp giấy lần nữa hoặc × để đóng; Mục lục được khôi phục như trước.

App đọc các file nhúng trong danh sách PDF và file gắn trên trang, kể cả trang chưa xem. Nếu cùng một file xuất hiện cả ở danh sách lẫn kẹp giấy trên trang, app đối chiếu nội dung để tránh hiện hai lần. File khác nhau cùng tên vẫn được giữ.

- **PDF:** mở thành tab trong app. Mở lại cùng attachment dùng tab đã có. Bản trích xuất được lưu ổn định trên máy để hỗ trợ vị trí đọc và ghi chú.
- **Excel/Word/ảnh/văn bản:** mở bằng ứng dụng mặc định của Windows; cần cài ứng dụng hỗ trợ định dạng tương ứng. File được trích ra thư mục dữ liệu RM Reader trước khi mở.
- **Lưu:** chọn tên/vị trí bằng hộp thoại Windows để lấy bản sao đúng nội dung nhúng. Không lưu đè lên PDF nguồn.
- **Lưu tất cả:** chọn thư mục, lưu toàn bộ attachment của PDF hiện tại (không bị giới hạn bởi ô tìm kiếm). File đã tồn tại hoặc trùng tên được thêm `(1)`, `(2)`… thay vì ghi đè.
- File thực thi/script/shortcut hỗ trợ **Lưu**, không chạy trực tiếp từ app. Giới hạn một file 512 MB; lưu tất cả tối đa 1 GB / 1.000 file mỗi lượt.

Khi xem Hai PDF, bảng dùng tài liệu của khung vừa tương tác; biểu tượng kẹp giấy bên phải cũng mở bảng chung. Mở PDF đính kèm của khung bên phải tạo tab trong chính khung đó. File PDF không có attachment hiển thị thông báo rõ ràng. App chưa hỗ trợ thêm/xóa attachment trong PDF gốc.

## Chat AI — Trợ lý lập trình nhúng (1.4.0)

Bảng bên phải có hai tab **Bản dịch / Chat AI**. Chuyển tab giữ nguyên cả bản dịch và cuộc hội thoại. Bôi đen → **Hỏi AI** mở chat và đính kèm đúng văn bản, tài liệu, trang và vùng nguồn; chưa gọi API cho tới khi Gửi hoặc nhấn một gợi ý. Nhập nhiều dòng bằng Shift+Enter; Enter gửi. Có các gợi ý giải thích đoạn/bit, bước cấu hình, ví dụ C và đối chiếu PDF còn lại. Kéo vạch giữa PDF và bảng bên phải để đổi chiều rộng.

- **Đoạn bôi đen / trang hiện tại:** ưu tiên đoạn được chọn, nếu không có thì lấy lớp văn bản trang đang đọc.
- **Trang hiện tại:** đính kèm văn bản của trang vật lý đang hiển thị.
- **Tìm trong tài liệu:** lập chỉ mục văn bản trên máy, rồi xếp hạng các trích đoạn theo từ khóa kỹ thuật và câu hỏi. Nêu tên thanh ghi, tên bit hoặc thuật ngữ tiếng Anh giúp tìm chính xác hơn. Trong lúc lập chỉ mục vẫn đọc/cuộn PDF được; nút Dừng hủy xử lý. Chỉ mục được lưu cục bộ để dùng lại khi mở app.
- **Đối chiếu hai PDF:** mở Hai PDF, chọn hai tài liệu; chat tìm trích đoạn liên quan riêng ở mỗi file. Có lựa chọn nguồn khung đang đọc, bên trái, bên phải hoặc cả hai. Phạm vi đối chiếu luôn dùng cả hai; nếu một file không có kết quả, app ghi rõ file còn thiếu.

Tên PDF, phạm vi và trang hiện trước ô nhập. Trong chế độ tìm, số trang chính xác chỉ biết sau khi tìm và được ghi cùng câu hỏi. Tài liệu/trang/đoạn và hội thoại đích được chốt ngay lúc nhấn Gửi; đổi tab hoặc cuộn giữa lúc xử lý không thay nguồn. Các trích đoạn được giới hạn và có thể không bao phủ toàn bộ trang/tài liệu.

Câu trả lời hiển thị dần qua streaming của dịch vụ đã chọn, hỗ trợ đoạn văn, danh sách, bảng và khối mã có nút sao chép. Model được hướng dẫn giữ tên thanh ghi, bit, địa chỉ, đơn vị; phân biệt nội dung nguồn, suy luận và kiến thức bổ sung; làm rõ W1C/read-to-clear/read-only/reserved và giả định của mã C/C++. Nếu thiếu thông tin, yêu cầu mở rộng phạm vi. Độ chính xác của diễn giải vẫn cần kiểm chứng bằng nguồn; app không bảo đảm mã minh họa chạy trên MCU/SDK chưa xác định.

Nguồn có dạng **[tên PDF · Trang N]**. N là trang vật lý PDF; nếu nhãn trang trong tài liệu khác, hiển thị thêm nhãn. Chỉ mã trích dẫn khớp trích đoạn thực sự đã cung cấp cho AI mới có liên kết. Mã do model tự tạo hiện “Nguồn chưa được cung cấp”; câu trả lời thiếu dẫn nguồn hợp lệ có thông báo. Mục **Trích đoạn được cung cấp** cho xem các nguồn kể cả khi model chưa dẫn đúng. Nhấn nguồn kích hoạt đúng tab/khung, nhảy về trang/vùng văn bản và làm nổi bật tạm thời; Back trả về vị trí trước đó, kể cả sang PDF khác. File nguồn bị sửa/di chuyển được đánh dấu cũ và không điều hướng vào phiên bản mới.

Hỏi tiếp gửi các lượt hoàn chỉnh gần nhất trong ngân sách lịch sử 16.000 ký tự; lịch sử quá dài được rút gọn và thông báo. Bản lưu trên máy vẫn giữ toàn bộ câu hỏi, câu trả lời và nguồn. Hội thoại tách theo PDF/cặp PDF; đổi tài liệu mở trạng thái chat mới để tránh trộn. Dùng danh sách phía trên để chủ động mở hội thoại cũ, **Đổi tên**, **Xóa** hoặc **Mới**. Nếu nguồn đang chọn khác bộ tài liệu của hội thoại cũ, câu hỏi mới tạo hội thoại riêng.

Chat AI dùng key đã mã hóa của dịch vụ được chọn, không yêu cầu nhập lại. Trong Cài đặt có **Model Chat AI** riêng (để trống để dùng model cấu hình), giới hạn văn bản PDF mặc định 24.000 ký tự (4.000–64.000), đầu ra mặc định 4.096 token (512–8.192). Gemini giữ tùy chọn dự phòng cho cả chat và dịch: chỉ chọn model được Google liệt kê, hiển thị model thực tế; lỗi tạm thời thử lại tối đa một lần mỗi model, quota ngày/zero quota không thử lặp trên model đó. Các dịch vụ khác dùng đúng model đã cấu hình. Dừng hủy HTTP; giới hạn chờ cả lượt 3 phút. Phản hồi một phần được giữ nếu dừng/mất mạng; Thử lại dùng câu hỏi và nguồn đã chốt. Nếu có usage metadata, hiện token đã dùng, không đoán quota còn lại.

PDF, chỉ mục và hội thoại ở trên máy; dịch vụ đã chọn nhận câu hỏi, trích đoạn, ảnh được chọn và lịch sử đã giới hạn. API key đã lưu chỉ giải mã ở backend, không trả về UI/log/lưu chat. Nội dung PDF/attachment là dữ liệu tham khảo, không là chỉ thị. Tìm trong tài liệu vẫn dùng lớp văn bản; hình/scan cần chủ động khoanh vùng để gửi ảnh. Chưa đọc trực tiếp nội dung Excel/Word attachment. PDF đính kèm được mở thành tab thì dùng chat như PDF thông thường.

Giao thức Gemini dùng [API REST streamGenerateContent chính thức](https://ai.google.dev/api/generate-content).

## Hỏi AI bằng hình, sơ đồ và bảng (1.5.0)

- Nhấn **Hỏi hình/bảng** trên thanh công cụ PDF rồi kéo khoanh vùng trên một trang. App mở Chat AI, đặt sẵn câu hỏi “Giải thích hình/bảng này” và hiển thị ảnh xem trước. Hoạt động cả ở khung PDF bên phải và trang scan không có lớp văn bản. Esc hủy thao tác khoanh vùng.
- Nhấn **Thêm ảnh** để chọn PNG/JPEG, hoặc dán ảnh từ clipboard vào ô nhập. Có thể hỏi chỉ bằng ảnh khi chưa mở PDF.
- Nhấn ảnh xem trước để xem lớn, dùng **Phóng to 100%** khi cần đọc chữ nhỏ; **Bỏ ảnh** gỡ ảnh chưa gửi. Chỉ nhấn **Gửi** mới gọi dịch vụ AI. Có thể viết câu hỏi riêng; để trống câu hỏi với ảnh sẽ dùng “Giải thích hình/bảng này”.
- Mỗi câu hỏi tối đa 3 ảnh PNG/JPEG, tệp gốc tối đa 12 MB. App tối ưu mỗi ảnh xuống tối đa 2 MB, cạnh dài tối đa 3072 px. Ảnh PDF được dựng lại từ trang gốc ở độ phân giải riêng, không phụ thuộc chất lượng canvas đang hiển thị hay các ghi chú phủ trên PDF.
- Ảnh vùng PDF lưu tên tài liệu, trang vật lý, nhãn trang, tọa độ vùng và phần văn bản nằm trong vùng nếu có. Nhấn trích dẫn hoặc **Về vùng PDF nguồn** để quay lại vùng đó; Back trở lại chỗ đang đọc. Ảnh ngoài PDF mở ảnh gốc khi nhấn trích dẫn, không tạo trang PDF giả.
- Mặc định, câu hỏi có ảnh chỉ gửi ảnh đã chọn và văn bản trong vùng ảnh. Bật **Kèm văn bản PDF theo phạm vi đã chọn** để thêm nguồn văn bản theo các tùy chọn Phạm vi/Nguồn. Cuộn hoặc đổi trang sau khi chọn không làm đổi ảnh đã chốt.
- Ảnh đã gửi lưu riêng trong thư mục dữ liệu app, có ảnh thu nhỏ trong lịch sử và còn sau khi khởi động lại. Hỏi tiếp dùng ảnh trong các lượt hoàn chỉnh gần nhất; lịch sử ảnh giới hạn tối đa 3 ảnh/6 MB, ngoài ảnh của câu hỏi mới. **Thử lại** dùng đúng ảnh đã gửi; **Dùng lại ảnh** đính kèm ảnh cũ vào câu hỏi mới khi cần. Xóa hội thoại xóa ảnh không còn được hội thoại nào tham chiếu.
- App kiểm tra ảnh nguồn còn nguyên trước khi gửi lại; PDF đã đổi/di chuyển vẫn được đánh dấu nguồn cũ. Không tự gửi toàn bộ trang hoặc mọi hình trong tài liệu. Khi chữ/đường nối không rõ, AI được yêu cầu nêu phần chưa đọc được và đề nghị chọn lại vùng rõ hơn.

Ảnh gửi trong cùng yêu cầu streaming: Gemini dùng `inlineData` theo [GenerateContent](https://ai.google.dev/api/generate-content); OpenAI/DeepSeek/OpenRouter/API tương thích dùng `image_url` data URL theo [OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision); Claude dùng image source base64 theo [Messages](https://platform.claude.com/docs/en/api/messages/create); Ollama dùng trường `images` theo [Chat API](https://docs.ollama.com/api/chat). Cần chọn model hỗ trợ nhận ảnh; không dùng dịch vụ OCR riêng.

## Thu gọn Chat AI (1.4.1)

Nhấn **Hội thoại** ở phía trên bảng chat để thu gọn/mở lại tiêu đề và các nút quản lý hội thoại. Nhấn **Gợi ý & nguồn** phía trên ô nhập để thu gọn/mở lại gợi ý, phạm vi và nguồn PDF. Hai phần có thể thu gọn độc lập để dành thêm diện tích cho tin nhắn; khi thu gọn, tên hội thoại và nguồn hiện trên một dòng nhỏ, có thể rê chuột để xem đầy đủ.

Thu gọn giữ nguyên câu hỏi đang viết, lựa chọn nguồn và vị trí đọc. Ô nhập và các thao tác gửi, dừng, thử lại, đóng bảng vẫn hoạt động như trước. App nhớ lựa chọn khi chuyển tab, đóng/mở bảng và khởi động lại. Nút hỗ trợ Tab, Enter/Space và trạng thái mở/đóng cho trình đọc màn hình.

## Dịch theo ngữ cảnh nhúng

Từ điển tích hợp tra ngoại tuyến hơn 100 thuật ngữ: `register → thanh ghi`, `interrupt → ngắt`, `clock → xung nhịp`, `prescaler → bộ chia tần số trước`, `write one to clear → ghi 1 để xóa bit/cờ`… Tra một thuật ngữ có sẵn **không cần API key**.

Dịch cả đoạn văn cần cấu hình một trong hai dịch vụ:

### Google Gemini

1. Vào **Cài đặt dịch** → chọn **Google Gemini**.
2. Lấy API key từ [Google AI Studio](https://aistudio.google.com/apikey), dán vào ô API key.
3. Nhập model được tài khoản của bạn hỗ trợ; có thể thay đổi tên model trong Cài đặt.
4. Nhấn **Lưu cài đặt**, bôi đen đoạn cần dịch và nhấn Dịch.

API key được mã hóa bằng Windows DPAPI; không được lưu trong mã nguồn, không trả lại cho giao diện và không đưa vào URL yêu cầu. File PDF không được tải lên; yêu cầu dịch chỉ gồm đoạn được chọn và hướng dẫn/từ điển kỹ thuật. Kết nối mạng và hạn mức API của tài khoản là cần thiết để dịch qua Gemini.

### Ollama trên máy này

Cài [Ollama](https://ollama.com/), tải model có khả năng dịch tiếng Việt, rồi chọn **Ollama** trong Cài đặt. Nhập đúng tên model đã tải và địa chỉ mặc định `http://127.0.0.1:11434`. Chất lượng dịch và tốc độ phụ thuộc model và cấu hình máy. Ứng dụng không tự tải model hoặc cài Ollama.

Các định danh như `GPIOA`, `TIMx_CR1`, hằng số hex và lời gọi hàm được che bằng mã giữ chỗ rồi khôi phục sau khi dịch. Nếu dịch vụ làm mất/thay đổi mã giữ chỗ, app báo lỗi thay vì hiển thị bản dịch sai mã. Phần hướng dẫn dịch ưu tiên vi điều khiển, thanh ghi, bit, ngoại vi, ngắt, DMA, RTOS và C/C++.

Từ bản 1.0.1, Gemini được thử lại tối đa hai lần sau lỗi tạm thời, với thời gian chờ tăng dần. App hiển thị trạng thái đang thử lại. Model phản hồi quá chậm có thời hạn riêng; khi quá tải hoặc model hết hạn mức, app có thể chọn một model Flash-Lite/Flash dự phòng trong danh sách được API trả về. Nguồn bản dịch luôn ghi rõ model thực tế. Tắt tùy chọn này trong Cài đặt nếu chỉ muốn dùng model đã chọn. Key sai hoặc bị chặn được báo rõ và không tự thử liên tục. Tự động dịch chỉ gửi đoạn đã chọn khi người dùng thả chuột.

## Ghi nhớ vị trí

Ứng dụng lưu danh sách tài liệu gần đây và vị trí đọc vào thư mục dữ liệu người dùng của Windows. Mở lại tài liệu từ màn hình đầu hoặc nút Mở PDF để tiếp tục đọc. File bị thay đổi được xem là phiên bản mới để tránh khôi phục vị trí sai. Cuộn chuột không tạo thêm mục vào lịch sử Back/Forward.

## Giới hạn phiên bản đầu

- PDF cần có lớp văn bản để bôi đen và dịch; chưa có OCR cho file scan.
- Mục lục dùng bookmarks thật của file; app không tự tạo mục lục khi file thiếu bookmarks.
- Liên kết nội bộ dùng đích đến được nhúng trong PDF; chữ xanh không có liên kết không tự nhảy.
- Liên kết tới website mở bằng trình duyệt mặc định. File đính kèm được mở/lưu từ bảng kẹp giấy; liên kết tới file ngoài không được nhúng vẫn cần mở file đích thủ công.
- Thứ tự chọn văn bản phụ thuộc lớp văn bản của PDF; tài liệu có cấu trúc nhiều cột bất thường có thể cần chọn từng cột/đoạn.
- Chưa có xuất bản PDF đã sửa, chỉnh nội dung hay in tài liệu. Đánh dấu/ghi chú được lưu riêng trong dữ liệu app.
- Bản build phát triển chưa có chữ ký số Windows.

## Chạy từ mã nguồn

Cần Node.js 22.12+; dùng Node.js 24 LTS để phát triển.

```powershell
npm.cmd install
npm.cmd run dev
```

Build giao diện rồi chạy Electron:

```powershell
npm.cmd run build
npm.cmd start
```

Đóng gói Windows:

```powershell
npm.cmd run package
npm.cmd run portable
```

`package` tạo thư mục chạy trực tiếp. `portable` tạo một file EXE; lần đầu công cụ có thể cần tải Electron/NSIS. Đường dẫn đầu ra cấu hình trong `package.json`.

## Kiểm thử

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:app
npm.cmd run test:packaged
npm.cmd run test:compare
npm.cmd run test:compare:packaged
npm.cmd run test:markup
npm.cmd run test:markup:packaged
npm.cmd run test:attachments
npm.cmd run test:attachments:packaged
npm.cmd run test:chat
npm.cmd run test:chat:packaged
npm.cmd run test:chat-images
npm.cmd run test:chat-images:packaged
```

- Kiểm thử lõi: lịch sử điều hướng, thuật ngữ kỹ thuật, chuẩn hóa văn bản, giữ nguyên định danh, cấu hình dịch, giao thức Gemini/Ollama và lỗi dịch vụ.
- Kiểm thử app: Electron ẩn, PDF tự tạo 400 trang, mục lục phân cấp, liên kết trực tiếp/đích có tên, chọn văn bản bằng chuột, Back/Forward, tìm kiếm, khôi phục vị trí đọc và kết quả dịch cũ không ghi đè đoạn mới.
- Kiểm thử AI dùng phản hồi giả lập cục bộ để kiểm tra giao thức và hành vi; đánh giá chất lượng bản dịch thực tế cần API key hoặc model Ollama của người dùng.
- `node tests/gemini-live.mjs` là kiểm tra có gọi API Gemini thật, chỉ chạy khi người dùng cho phép sử dụng tài khoản đã cấu hình. Nó mở cửa sổ ẩn, đọc key qua app và dịch hai đoạn kỹ thuật mẫu; không ghi key ra log. Thêm `--packaged` để kiểm tra trên EXE đã đóng gói.
- Ảnh chụp và kết quả kiểm thử nằm trong `test-results/`, không đưa vào Git.
- `test:packaged` chạy các kiểm tra trực tiếp trên `E:\App_RM\release\win-unpacked\RM Reader.exe` sau khi đóng gói.

## Cấu trúc mã

- `electron/main.cjs`: mở file, phục vụ PDF theo byte range, lưu vị trí, mã hóa key, gọi dịch vụ và nhận nút chuột Windows.
- `electron/preload.cjs`: cầu nối IPC có giới hạn giữa giao diện và Windows.
- `src/app.mjs`: trình đọc PDF.js, mục lục, lựa chọn văn bản, bảng dịch và lịch sử.
- `src/core/glossary.mjs`: từ điển thuật ngữ nhúng.
- `src/core/translation.mjs`: hướng dẫn dịch kỹ thuật, bảo vệ mã và dịch vụ Gemini/Ollama.
- `src/core/history.mjs`: lịch sử vị trí cuộn/zoom.
- `src/markup.mjs`: chế độ tô liên tục, bút, tẩy từng phần và hộp văn bản trực tiếp.
- `src/core/annotations.mjs`: kiểm tra dữ liệu, tọa độ PDF và hình học cắt vùng tô/nét vẽ.
- `src/attachments.mjs`: danh sách/lọc attachment, file nhúng và file gắn trên trang, nguồn từ từng khung PDF.
- `electron/attachments.cjs`: trích xuất, mở bằng ứng dụng Windows, lưu bản sao và tránh trùng tên khi lưu hàng loạt.

Tài liệu API: [PDF.js](https://mozilla.github.io/pdf.js/), [Electron app-command](https://www.electronjs.org/docs/latest/api/browser-window#event-app-command-windows-linux), [Gemini generateContent](https://ai.google.dev/api/generate-content), [Ollama chat](https://docs.ollama.com/api/chat).


## Tải bản đã đóng gói trên GitHub

Repo riêng tư: https://github.com/hieu08012005/rm-reader (cần đăng nhập tài khoản có quyền truy cập).

Tải tại [Release v1.5.0](https://github.com/hieu08012005/rm-reader/releases/tag/v1.5.0):
- `RM-Reader-1.5.0.exe`: bản portable, mở trực tiếp trên Windows.
- `RM-Reader-1.5.0-Windows.zip`: toàn bộ thư mục bản chạy Windows; giải nén và mở `RM Reader.exe`, giữ nguyên các tệp đi kèm.
- `SHA256SUMS.txt`: mã kiểm tra các tệp phát hành.

Mã nguồn, lockfile, script build, icon, kiểm thử, tài liệu phiên bản và PDF demo đều được lưu trong repo. Hướng dẫn/báo cáo nằm trong `docs/`, ảnh kiểm tra bản 1.5.0 nằm trong `docs/verification/1.5.0/`, PDF demo nằm trong `examples/`.
`node_modules`, cache, dữ liệu tài khoản, API key và lịch sử chat cá nhân là dữ liệu cục bộ. Cài lại phụ thuộc bằng `npm.cmd ci` rồi build theo hướng dẫn ở trên. GitHub cũng cung cấp Source code ZIP/TAR của release.
## Kéo rộng bảng Bản dịch / Chat AI (1.5.1)

Kéo vạch dọc ở mép trái bảng bên phải sang trái để mở rộng. Bảng có thể rộng hơn 550 px; giới hạn dựa trên chiều rộng cửa sổ và các bảng đang mở, dành khoảng 300 px cho PDF khi đọc một tài liệu. Khi Hai PDF đang mở, giới hạn dành đủ chỗ cho mỗi khung theo tỷ lệ hiện tại.

App nhớ chiều rộng bạn đã chọn. Khi thu nhỏ cửa sổ hoặc mở thêm bảng bên trái, chiều rộng tự điều chỉnh để vừa cửa sổ; mở rộng cửa sổ lại sẽ khôi phục chiều rộng ưu tiên nếu đủ chỗ. Có thể chọn vạch bằng Tab rồi dùng mũi tên trái/phải để tăng/giảm 20 px.
## Nhiều nhà cung cấp AI (v1.6.0)

Cài đặt → chọn Gemini, OpenAI, Claude/Anthropic, DeepSeek, OpenRouter, Ollama hoặc API tương thích OpenAI. Nhập API key rồi bấm **Tải danh sách model**; chọn từ gợi ý hoặc nhập model ID trực tiếp (hỗ trợ `vendor/model:free`, model tùy chỉnh/fine-tuned). Model Chat AI để trống sẽ dùng cùng model dịch; có thể chọn model khác của cùng dịch vụ.

Dịch vụ có sẵn tự cấu hình địa chỉ API. Với **API tương thích OpenAI**, nhập Base URL (ví dụ `https://example.com/v1`, LM Studio `http://localhost:1234/v1`); app gọi `/chat/completions` và `/models`. Ollama dùng API riêng `/api/chat`, `/api/tags`, không cần key. HTTP chỉ dùng trên máy cục bộ. Các giao thức cloud khác như Bedrock/Azure đặc thù chưa được cấu hình trực tiếp.

API key giúp xác thực; model vẫn phải hỗ trợ sinh văn bản/chat và tài khoản có quyền/hạn mức. Hỏi ảnh cần model nhận ảnh; danh sách model có thể gồm embeddings/audio không dùng được cho chat. Khi API không hỗ trợ liệt kê model, tự nhập ID vẫn dùng được. App không tự chuyển nhà cung cấp; Gemini giữ tùy chọn model dự phòng.

Key được mã hóa bằng Windows safeStorage, lưu riêng theo dịch vụ; API tùy chỉnh lưu riêng theo Base URL. Đổi dịch vụ nhớ model/địa chỉ lần lưu trước. Key Gemini cũ vẫn dùng được; key không xuất hiện trong settings gửi về UI hoặc mã nguồn. Dịch vụ đã chọn nhận đoạn văn/ảnh đã gửi và lịch sử trong giới hạn cấu hình; PDF gốc vẫn trên máy.

Kiểm tra: `npm test`, `npm run test:ai-providers`, `npm run test:chat-images` và các bản `:packaged`. Giao thức nhà cung cấp mới được kiểm thử bằng phản hồi mô phỏng; không tuyên bố đã kiểm thử tài khoản thật khi chưa có API key của dịch vụ đó.
