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
  // Ví dụ phiên bản sau (bỏ chú thích khi cần):
  // { version: 3, name: 'them_cot_lop_hoc', sql: `ALTER TABLE scores ADD COLUMN class_name TEXT;` },
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
