/**
 * server/routes/questions.js
 * API câu hỏi trắc nghiệm.
 *   GET  /api/questions?limit=10&topic=hoa-tri → lấy ngẫu nhiên câu hỏi (KHÔNG kèm đáp án)
 *   GET  /api/questions/topics                 → danh sách chủ đề + số câu
 *   POST /api/questions/:id/check  { choice }  → chấm một câu, trả về đúng/sai + giải thích
 *
 * Đáp án chỉ nằm trên server → học sinh không xem được đáp án bằng cách "soi" mã trang web.
 */
const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

const TOPIC_NAMES = {
  'hoa-tri': 'Hóa trị',
  'cong-thuc': 'Lập công thức hóa học',
  'nguyen-to': 'Nguyên tố & kí hiệu',
};

router.get('/', (req, res) => {
  // Giới hạn số câu trong khoảng 1–20, mặc định 10
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 20);
  const { topic } = req.query;

  let sql = 'SELECT id, topic, content, options FROM questions';
  const params = [];
  if (topic) {
    sql += ' WHERE topic = ?';
    params.push(topic);
  }
  sql += ' ORDER BY RANDOM() LIMIT ?';
  params.push(limit);

  const rows = getDb().prepare(sql).all(...params).map((q) => ({
    ...q,
    options: JSON.parse(q.options), // Chuyển chuỗi JSON thành mảng
    topic_name: TOPIC_NAMES[q.topic] || q.topic,
  }));

  res.json({ count: rows.length, data: rows });
});

router.get('/topics', (req, res) => {
  const rows = getDb()
    .prepare('SELECT topic, COUNT(*) AS total FROM questions GROUP BY topic ORDER BY topic')
    .all()
    .map((r) => ({ ...r, name: TOPIC_NAMES[r.topic] || r.topic }));
  res.json({ data: rows });
});

router.post('/:id/check', (req, res) => {
  const choice = Number(req.body?.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
    return res.status(400).json({ error: 'Phương án chọn (choice) phải là số nguyên từ 0 đến 3' });
  }

  const question = getDb()
    .prepare('SELECT answer_index, explanation FROM questions WHERE id = ?')
    .get(req.params.id);
  if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi' });

  res.json({
    correct: choice === question.answer_index,
    answerIndex: question.answer_index,
    explanation: question.explanation,
  });
});

module.exports = router;
