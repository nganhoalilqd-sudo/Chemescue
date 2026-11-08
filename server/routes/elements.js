/**
 * server/routes/elements.js
 * API nguyên tố hóa học.
 *   GET /api/elements                 → toàn bộ danh sách
 *   GET /api/elements?category=kim-loai → lọc theo nhóm (kim-loai | phi-kim | khi-hiem)
 *   GET /api/elements?search=sat      → tìm theo tên hoặc kí hiệu (không phân biệt dấu, hoa/thường)
 *   GET /api/elements/Fe              → chi tiết một nguyên tố theo kí hiệu
 */
const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();
const CATEGORIES = ['kim-loai', 'phi-kim', 'khi-hiem'];

// Bỏ dấu tiếng Việt để tìm "sat" cũng ra "Sắt" (Iron)
const normalize = (text) =>
  String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

router.get('/', (req, res) => {
  const { category, search } = req.query;
  let sql = 'SELECT * FROM elements';
  const params = [];

  if (category) {
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Nhóm không hợp lệ. Chọn một trong: ${CATEGORIES.join(', ')}` });
    }
    sql += ' WHERE category = ?';
    params.push(category);
  }
  sql += ' ORDER BY atomic_number';

  let rows = getDb().prepare(sql).all(...params);

  // Lọc tìm kiếm bằng JavaScript vì SQLite không tự bỏ dấu tiếng Việt
  if (search) {
    const keyword = normalize(search);
    rows = rows.filter((el) =>
      normalize(el.name).includes(keyword) ||
      normalize(el.common_name || '').includes(keyword) ||
      normalize(el.symbol) === keyword
    );
  }

  res.json({ count: rows.length, data: rows });
});

router.get('/:symbol', (req, res) => {
  const element = getDb()
    .prepare('SELECT * FROM elements WHERE symbol = ? COLLATE NOCASE')
    .get(req.params.symbol);

  if (!element) return res.status(404).json({ error: `Không tìm thấy nguyên tố "${req.params.symbol}"` });
  res.json({ data: element });
});

module.exports = router;
