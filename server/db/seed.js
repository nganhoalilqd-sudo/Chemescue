/**
 * server/db/seed.js
 * Đồng bộ dữ liệu mẫu (nguyên tố + câu hỏi) từ file seed-data.js vào CSDL.
 *
 * Cách hoạt động:
 *  - Mỗi lần khởi động, server tính "dấu vân tay" (mã băm) của toàn bộ seed-data.js.
 *  - Nếu giống lần trước → không làm gì (khởi động nhanh, không ghi thừa).
 *  - Nếu khác (giáo viên vừa sửa/thêm câu hỏi, đổi tên nguyên tố...) → cập nhật lại
 *    bảng elements và questions cho khớp với file.
 *  - Bảng scores (điểm của học sinh) KHÔNG bao giờ bị động tới.
 */
const crypto = require('crypto');
const { ELEMENTS, QUESTIONS } = require('./seed-data');

function seedVersion() {
  return crypto.createHash('sha256').update(JSON.stringify({ ELEMENTS, QUESTIONS })).digest('hex').slice(0, 16);
}

function syncSeedData(db) {
  const version = seedVersion();
  const current = db.prepare("SELECT value FROM app_meta WHERE key = 'seed_version'").get();
  if (current && current.value === version) return; // Dữ liệu đã mới nhất

  const upsertElement = db.prepare(`
    INSERT INTO elements (atomic_number, symbol, name, common_name, atomic_mass, valence, category)
    VALUES (@atomic_number, @symbol, @name, @common_name, @atomic_mass, @valence, @category)
    ON CONFLICT (symbol) DO UPDATE SET
      atomic_number = excluded.atomic_number,
      name          = excluded.name,
      common_name   = excluded.common_name,
      atomic_mass   = excluded.atomic_mass,
      valence       = excluded.valence,
      category      = excluded.category
  `);
  const insertQuestion = db.prepare(`
    INSERT INTO questions (topic, content, options, answer_index, explanation)
    VALUES (@topic, @content, @options, @answer_index, @explanation)
  `);

  db.exec('BEGIN');
  try {
    // 1. Nguyên tố: cập nhật theo kí hiệu, thêm mới nếu chưa có, xóa nguyên tố không còn trong file
    ELEMENTS.forEach((el) => upsertElement.run(el));
    const symbols = ELEMENTS.map((el) => el.symbol);
    db.prepare(`DELETE FROM elements WHERE symbol NOT IN (${symbols.map(() => '?').join(',')})`).run(...symbols);

    // 2. Câu hỏi: thay toàn bộ bằng nội dung mới trong file
    db.exec('DELETE FROM questions');
    QUESTIONS.forEach((q) => insertQuestion.run({ ...q, options: JSON.stringify(q.options) }));

    // 3. Ghi lại phiên bản để lần sau không phải làm lại
    db.prepare(`
      INSERT INTO app_meta (key, value) VALUES ('seed_version', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `).run(version);

    db.exec('COMMIT');
    console.log(`  ✔ Đã đồng bộ dữ liệu mẫu: ${ELEMENTS.length} nguyên tố, ${QUESTIONS.length} câu hỏi (phiên bản ${version})`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw new Error(`Đồng bộ dữ liệu mẫu thất bại: ${err.message}`);
  }
}

module.exports = { syncSeedData };
