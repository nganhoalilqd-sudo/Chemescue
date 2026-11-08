# ⚗️ ChemRescue

Nền tảng học tập có yếu tố trò chơi giúp học sinh THCS lấy lại căn bản Hóa học
(chương trình GDPT 2018 – môn KHTN 7–9, tên chất theo IUPAC).

**Công nghệ:** HTML5 · CSS3 · Vanilla JS (giao diện) — Node.js + Express (máy chủ) — SQLite (cơ sở dữ liệu).

## 5 phân hệ

| # | Phân hệ | Nội dung |
|---|---|---|
| 1 | 🩺 Phòng chẩn đoán | Bài test 15 câu theo 5 chủ đề, bản đồ nhiệt lỗ hổng, lộ trình ôn |
| 2 | 🏝️ Đảo Cứu Nguy | Flashcard 3D lặp lại ngắt quãng, Xưởng ghép ion (tên IUPAC) |
| 3 | ⚔️ Đấu trường & Nhiệm vụ | Nhiệm vụ hằng ngày, chuỗi ngày học, đấu 1vs1 |
| 4 | 🌳 Cây kỹ năng & Huy hiệu | 4 nhánh × 4 bậc, 12 huy hiệu |
| 5 | 📊 Dashboard Giáo viên | Kết quả THẬT của cả lớp, cảnh báo tụt hậu, xuất CSV/Excel (cần mã PIN) |

## Đăng nhập

- **Học sinh:** nhập *họ tên + lớp* (vd: `Nguyễn Minh Anh` – `8A1`). Nhập lại đúng họ tên + lớp ở máy khác
  sẽ vào lại đúng tài khoản, tiến độ được lưu trên máy chủ.
- **Giáo viên:** chọn tab *Giáo viên*, nhập mã PIN (biến `TEACHER_PIN` khai báo trên Railway).

> Học sinh không cần mật khẩu cho đơn giản trong lớp học. Vì vậy ai biết họ tên + lớp của một bạn
> cũng vào được tài khoản của bạn đó – phù hợp cho thực nghiệm trên lớp, không dùng cho thi cử.

## Chạy trên máy cá nhân

Cần **Node.js 22 LTS** (https://nodejs.org).

```bash
npm install                    # cài thư viện (chỉ làm lần đầu)
set TEACHER_PIN=123456         # Windows (macOS/Linux: export TEACHER_PIN=123456)
npm start
```

Mở trình duyệt: http://localhost:3000. Lần chạy đầu, server tự tạo file `data/chemrescue.db` và các bảng.

## Cấu trúc

```
server.js                     Điểm khởi động máy chủ
server/config.js              Cổng, đường dẫn CSDL, TEACHER_PIN, múi giờ
server/db/                    Kết nối SQLite, tự tạo bảng (migrations.js), dữ liệu mẫu
server/routes/                auth (đăng nhập) · me (tiến độ học sinh) · teacher (Dashboard) · elements · questions · scores
server/services/              Nghiệp vụ tài khoản học sinh, tính ngày theo giờ Việt Nam
server/middlewares/           Kiểm tra quyền (token học sinh, PIN giáo viên), xử lý lỗi
public/index.html             Khung ứng dụng + màn hình đăng nhập
public/js/session.js          Đăng nhập, tải/lưu tiến độ lên máy chủ, đếm phút học (chạy đầu tiên)
public/js/db.js               Nội dung học (câu hỏi, flashcard, ion, cây kỹ năng) + tiến độ cá nhân
public/js/app.js              Điều hướng, EXP/cấp độ, chuỗi ngày, thông báo
public/js/modules/*.js        5 phân hệ
public/css/                   Giao diện chung + CSS riêng từng phân hệ
```

## Sửa nội dung học

Câu hỏi, flashcard, ion, cây kỹ năng, huy hiệu nằm trong `public/js/db.js` (hàm `content()`).
Sửa xong → Commit + Push: học sinh nhận nội dung mới ngay, **tiến độ cũ vẫn giữ nguyên**.

- Câu chẩn đoán: giữ **3 câu cho mỗi chủ đề** (5 chủ đề × 3 = 15 câu) để bản đồ nhiệt tính đúng.
- `answer`: vị trí đáp án đúng, đếm từ 0 (A = 0, B = 1, C = 2, D = 3).

## API chính

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| GET | `/api/health` | Kiểm tra máy chủ |
| POST | `/api/auth/student` | Đăng nhập học sinh `{ name, className }` |
| POST | `/api/auth/teacher` | Kiểm tra PIN giáo viên `{ pin }` |
| GET | `/api/me` | Tiến độ của học sinh (header `X-Student-Token`) |
| PUT | `/api/me/state` | Lưu tiến độ `{ state }` |
| POST | `/api/me/events` | Ghi hoạt động cho luồng của giáo viên |
| GET | `/api/me/rank` | Thứ hạng trong lớp theo điểm chẩn đoán |
| GET | `/api/teacher/overview` | Dữ liệu Dashboard (header `X-Teacher-Pin`) |
| DELETE | `/api/teacher/students/:id` | Xóa tài khoản học sinh |

## Deploy lên Railway

1. Kết nối kho GitHub với Railway, mỗi lần Push Railway tự deploy lại.
2. **Gắn Volume** vào dịch vụ với mount path `/data` – nếu không, dữ liệu học sinh mất mỗi lần deploy.
3. Tab **Variables** → thêm `TEACHER_PIN` = một dãy số bí mật (vd 6 chữ số). Không có biến này,
   Dashboard Giáo viên bị khóa để bảo vệ dữ liệu học sinh.
