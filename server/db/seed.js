/**
 * server/db/seed.js
 * Nạp dữ liệu mẫu khi bảng còn TRỐNG (chỉ xảy ra ở lần chạy đầu tiên).
 * Nhờ kiểm tra "bảng trống" nên khởi động lại server không làm trùng dữ liệu.
 */
const { ELEMENTS, QUESTIONS } = require('./seed-data');

function isEmpty(db, table) {
  return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total === 0;
}

function seedIfEmpty(db) {
  if (isEmpty(db, 'elements')) {
    const insert = db.prepare(`
      INSERT INTO elements (atomic_number, symbol, name_vi, atomic_mass, valence, category)
      VALUES (@atomic_number, @symbol, @name_vi, @atomic_mass, @valence, @category)
    `);
    db.exec('BEGIN');
    ELEMENTS.forEach((el) => insert.run(el));
    db.exec('COMMIT');
    console.log(`  ✔ Đã nạp ${ELEMENTS.length} nguyên tố mẫu`);
  }

  if (isEmpty(db, 'questions')) {
    const insert = db.prepare(`
      INSERT INTO questions (topic, content, options, answer_index, explanation)
      VALUES (@topic, @content, @options, @answer_index, @explanation)
    `);
    db.exec('BEGIN');
    QUESTIONS.forEach((q) => insert.run({ ...q, options: JSON.stringify(q.options) }));
    db.exec('COMMIT');
    console.log(`  ✔ Đã nạp ${QUESTIONS.length} câu hỏi mẫu`);
  }
}

module.exports = { seedIfEmpty };
