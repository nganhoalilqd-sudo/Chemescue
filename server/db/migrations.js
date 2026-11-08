/**
 * server/db/migrations.js
 * Tự động tạo bảng (auto-migrate) mỗi khi server khởi động.
 *
 * Cách hoạt động:
 *  - Bảng schema_migrations ghi lại các "phiên bản" cấu trúc CSDL đã chạy.
 *  - Mỗi lần khởi động, server chỉ chạy những phiên bản CHƯA có trong bảng đó.
 *  - Muốn thêm bảng/cột mới về sau: thêm một phần tử mới vào cuối mảng MIGRATIONS
 *    với version tăng dần (2, 3, ...). KHÔNG sửa các phiên bản cũ đã chạy.
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'tao_cac_bang_co_ban',
    sql: `
      -- Bảng nguyên tố hóa học (chương trình KHTN THCS)
      CREATE TABLE IF NOT EXISTS elements (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        atomic_number INTEGER NOT NULL UNIQUE,          -- Số hiệu nguyên tử (Z)
        symbol        TEXT    NOT NULL UNIQUE,          -- Kí hiệu hóa học, vd: Na
        name_vi       TEXT    NOT NULL,                 -- Tên tiếng Việt, vd: Natri
        atomic_mass   REAL    NOT NULL,                 -- Nguyên tử khối (amu)
        valence       TEXT,                             -- Hóa trị, vd: 'II, III'
        category      TEXT    NOT NULL
                      CHECK (category IN ('kim-loai', 'phi-kim', 'khi-hiem'))
      );

      -- Ngân hàng câu hỏi trắc nghiệm
      CREATE TABLE IF NOT EXISTS questions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        topic        TEXT    NOT NULL,                  -- 'hoa-tri' | 'cong-thuc' | 'nguyen-to'
        content      TEXT    NOT NULL,                  -- Nội dung câu hỏi
        options      TEXT    NOT NULL,                  -- Mảng 4 phương án, lưu dạng JSON
        answer_index INTEGER NOT NULL CHECK (answer_index BETWEEN 0 AND 3),
        explanation  TEXT                               -- Lời giải thích hiện sau khi trả lời
      );

      -- Điểm số mỗi lượt chơi (dùng cho Bảng vàng)
      CREATE TABLE IF NOT EXISTS scores (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        player_name   TEXT    NOT NULL,
        score         INTEGER NOT NULL,
        correct_count INTEGER NOT NULL,
        total         INTEGER NOT NULL,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions (topic);
      CREATE INDEX IF NOT EXISTS idx_scores_score    ON scores (score DESC);
    `,
  },
  {
    version: 2,
    name: 'ten_nguyen_to_iupac',
    sql: `
      -- Chuyển sang tên IUPAC theo chương trình GDPT 2018 (môn KHTN):
      --   name        : tên IUPAC, vd 'Sodium'
      --   common_name : tên tiếng Việt quen gọi (nếu có), vd 'Natri'
      ALTER TABLE elements RENAME COLUMN name_vi TO name;
      ALTER TABLE elements ADD COLUMN common_name TEXT;

      -- Bảng ghi thông tin nội bộ của ứng dụng (vd: phiên bản dữ liệu mẫu đã nạp)
      CREATE TABLE IF NOT EXISTS app_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: 'tai_khoan_hoc_sinh_va_su_kien',
    sql: `
      -- Tài khoản học sinh + toàn bộ tiến độ học của 5 phân hệ
      CREATE TABLE IF NOT EXISTS students (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,                -- Họ tên hiển thị, vd 'Nguyễn Minh Anh'
        name_key       TEXT    NOT NULL,                -- Họ tên chuẩn hóa (chữ thường) để tìm lại tài khoản
        class_name     TEXT    NOT NULL,                -- Lớp, vd '8A1'
        token          TEXT    NOT NULL UNIQUE,         -- Mã bí mật trình duyệt dùng để lưu tiến độ
        state          TEXT,                            -- Tiến độ đầy đủ (JSON) của 5 phân hệ
        -- Các cột tóm tắt, tính sẵn từ state để Dashboard Giáo viên đọc nhanh:
        level          INTEGER NOT NULL DEFAULT 1,
        exp            INTEGER NOT NULL DEFAULT 0,
        streak         INTEGER NOT NULL DEFAULT 0,
        last_active    TEXT,                            -- 'YYYY-MM-DD'
        topic_scores   TEXT    NOT NULL DEFAULT '{}',   -- JSON {chủ đề: %} của bài chẩn đoán gần nhất
        diagnostics    INTEGER NOT NULL DEFAULT 0,      -- Số lần làm bài chẩn đoán
        minutes_by_day TEXT    NOT NULL DEFAULT '{}',   -- JSON {'YYYY-MM-DD': số phút học}
        active_dates   TEXT    NOT NULL DEFAULT '[]',   -- JSON ['YYYY-MM-DD', ...]
        created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (name_key, class_name)
      );

      -- Luồng hoạt động hiển thị cho giáo viên (vd: "ôn 10 thẻ Flashcard")
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        icon       TEXT,
        text       TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_events_student ON events (student_id);
    `,
  },
  // Ví dụ phiên bản sau (bỏ chú thích khi cần):
  // { version: 4, name: 'them_cot_truong', sql: `ALTER TABLE students ADD COLUMN school TEXT;` },
];

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    // Chạy trong giao dịch (transaction): lỗi giữa chừng thì hoàn tác toàn bộ
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
      db.exec('COMMIT');
      console.log(`  ✔ Đã tạo cấu trúc CSDL phiên bản ${migration.version}: ${migration.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} thất bại: ${err.message}`);
    }
  }
}

module.exports = { runMigrations };
