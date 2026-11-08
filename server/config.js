/**
 * server/config.js
 * Gom mọi cấu hình của ứng dụng vào một chỗ, đọc từ biến môi trường.
 * Railway tự cấp biến PORT; khi gắn Volume, Railway cấp thêm RAILWAY_VOLUME_MOUNT_PATH.
 */
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

/** Chọn nơi lưu file SQLite theo thứ tự ưu tiên. */
function resolveDbPath() {
  // 1. Người dùng tự chỉ định trong tab Variables
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  // 2. Đã gắn Volume trên Railway → lưu vào Volume để dữ liệu KHÔNG mất khi deploy lại
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'chemrescue.db');
  }
  // 3. Mặc định: thư mục data/ trong dự án (dùng khi chạy trên máy cá nhân)
  return path.join(ROOT_DIR, 'data', 'chemrescue.db');
}

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  HOST: '0.0.0.0', // Bắt buộc 0.0.0.0 để Railway truy cập được từ bên ngoài container
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  DB_PATH: resolveDbPath(),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
};
