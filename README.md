# ⚗️ ChemRescue

Nền tảng học tập có yếu tố trò chơi giúp học sinh THCS lấy lại căn bản Hóa học
(hóa trị, lập công thức hóa học, kí hiệu nguyên tố).

**Công nghệ:** HTML5 · CSS3 · Vanilla JS (giao diện) — Node.js + Express (máy chủ) — SQLite (cơ sở dữ liệu).

## Chạy trên máy cá nhân

Cần cài **Node.js 22 LTS** (https://nodejs.org).

```bash
npm install     # cài thư viện (chỉ làm lần đầu)
npm start       # chạy server
```

Mở trình duyệt: http://localhost:3000

Lần chạy đầu, server tự tạo file `data/chemrescue.db`, tự tạo bảng và nạp dữ liệu mẫu.

## Danh sách API

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| GET | `/api/health` | Kiểm tra server còn hoạt động |
| GET | `/api/elements` | Danh sách nguyên tố (`?category=kim-loai`, `?search=natri`) |
| GET | `/api/elements/:symbol` | Chi tiết một nguyên tố, vd `/api/elements/Fe` |
| GET | `/api/questions` | Câu hỏi ngẫu nhiên, không kèm đáp án (`?limit=10&topic=hoa-tri`) |
| GET | `/api/questions/topics` | Các chủ đề và số câu hỏi |
| POST | `/api/questions/:id/check` | Chấm một câu – body `{ "choice": 0..3 }` |
| GET | `/api/scores` | Bảng vàng |
| POST | `/api/scores` | Lưu điểm – body `{ playerName, score, correctCount, total }` |

## Thêm câu hỏi / nguyên tố

Sửa file `server/db/seed-data.js` (tên nguyên tố theo IUPAC – chương trình GDPT 2018), rồi Commit + Push.
Khi khởi động, server tự nhận ra file đã thay đổi và cập nhật bảng nguyên tố + câu hỏi.
Điểm số trong Bảng vàng được giữ nguyên.

## Deploy lên Railway

Xem hướng dẫn từng bước trong tài liệu đi kèm. Lưu ý quan trọng: hãy **gắn Volume**
cho dịch vụ trên Railway, nếu không điểm số sẽ bị xóa mỗi lần deploy lại.
