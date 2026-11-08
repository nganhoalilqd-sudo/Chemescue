/**
 * server.js – Điểm khởi động của ChemRescue (Railway chạy file này qua lệnh "npm start").
 *
 * Luồng chạy:
 *   1. Mở/tạo CSDL SQLite → tự tạo bảng → nạp dữ liệu mẫu (nếu trống)
 *   2. Gắn các API (/api/...)
 *   3. Phục vụ giao diện trong thư mục public/
 *   4. Lắng nghe ở cổng PORT do Railway cấp
 */
const express = require('express');
const config = require('./server/config');
const { initDatabase, getDb, closeDatabase } = require('./server/db/database');
const elementsRouter = require('./server/routes/elements');
const questionsRouter = require('./server/routes/questions');
const scoresRouter = require('./server/routes/scores');
const authRouter = require('./server/routes/auth');
const meRouter = require('./server/routes/me');
const teacherRouter = require('./server/routes/teacher');
const { apiNotFound, errorHandler } = require('./server/middlewares/errorHandler');

// ---------- 1. Cơ sở dữ liệu ----------
console.log(`⚗️  ChemRescue đang khởi động... CSDL: ${config.DB_PATH}`);
initDatabase(config.DB_PATH);

// ---------- 2. Ứng dụng Express ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Railway đứng sau proxy → lấy đúng địa chỉ IP người dùng
// Tiến độ học của học sinh có thể lớn hơn → cho phép tới 1MB riêng cho /api/me
app.use('/api/me', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '10kb' })); // Các API khác: tối đa 10KB

// Kiểm tra "sức khỏe" – Railway gọi để biết server còn sống
app.get('/api/health', (req, res) => {
  getDb().prepare('SELECT 1').get();
  res.json({ status: 'ok', app: 'ChemRescue', time: new Date().toISOString() });
});

app.use('/api/elements', elementsRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/scores', scoresRouter);
app.use('/api/auth', authRouter);       // Đăng nhập học sinh / giáo viên
app.use('/api/me', meRouter);           // Tiến độ của học sinh đang đăng nhập
app.use('/api/teacher', teacherRouter); // Dữ liệu cho Dashboard Giáo viên
app.use('/api', apiNotFound); // /api/... không tồn tại → 404 dạng JSON

// ---------- 3. Giao diện (Frontend) ----------
// maxAge 0: trình duyệt luôn hỏi lại máy chủ → học sinh nhận bản mới ngay sau khi cập nhật
app.use(express.static(config.PUBLIC_DIR, { maxAge: 0 }));
// Đường dẫn trang (không có đuôi file) → trả về trang chính; file không tồn tại (vd .js) → 404
app.get('*', (req, res, next) => {
  if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).send('Không tìm thấy file');
  res.sendFile('index.html', { root: config.PUBLIC_DIR });
});

app.use(errorHandler);

// ---------- 4. Khởi chạy ----------
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`🚀 ChemRescue đang chạy tại http://localhost:${config.PORT}`);
  if (!config.TEACHER_PIN) console.warn('⚠️  Chưa đặt TEACHER_PIN → Dashboard Giáo viên đang bị khóa.');
});

// Tắt server an toàn khi Railway dừng/deploy lại (đóng CSDL để không hỏng file .db)
function shutdown(signal) {
  console.log(`\n${signal} → đang tắt ChemRescue...`);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // Ép tắt nếu quá 10 giây
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
