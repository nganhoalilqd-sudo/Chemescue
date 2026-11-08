/**
 * server/middlewares/errorHandler.js
 * Xử lý lỗi tập trung: mọi lỗi đều trả về JSON dễ đọc thay vì làm sập server.
 */

// Gọi khi đường dẫn /api/... không tồn tại
function apiNotFound(req, res) {
  res.status(404).json({ error: `Không có API ${req.method} ${req.originalUrl}` });
}

// Express nhận ra đây là middleware xử lý lỗi nhờ có đủ 4 tham số
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Dữ liệu gửi lên không phải JSON hợp lệ' });
  }
  console.error('✖ Lỗi máy chủ:', err);
  res.status(500).json({ error: 'Máy chủ gặp sự cố, vui lòng thử lại sau' });
}

module.exports = { apiNotFound, errorHandler };
