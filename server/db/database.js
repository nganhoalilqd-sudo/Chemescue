/**
 * server/db/database.js
 * Mở kết nối SQLite, tự tạo thư mục + file .db nếu chưa có, chạy migrate và nạp dữ liệu mẫu.
 * Các file khác lấy kết nối qua hàm getDb().
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');
const { seedIfEmpty } = require('./seed');

let db = null;

function initDatabase(dbPath) {
  // Tạo thư mục chứa file .db nếu chưa tồn tại (tránh lỗi "unable to open database file")
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // better-sqlite3 tự tạo file .db trống nếu file chưa có
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // Đọc/ghi đồng thời nhanh hơn
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  seedIfEmpty(db);
  return db;
}

function getDb() {
  if (!db) throw new Error('CSDL chưa được khởi tạo. Hãy gọi initDatabase() trước.');
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { initDatabase, getDb, closeDatabase };
