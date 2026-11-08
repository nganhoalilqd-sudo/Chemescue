/**
 * server/routes/scores.js
 * API Bảng vàng (bảng xếp hạng).
 *   GET  /api/scores?limit=10 → điểm cao nhất của mỗi người chơi
 *   POST /api/scores          → lưu kết quả một lượt chơi
 *        body: { playerName, score, correctCount, total }
 */
const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();
const MAX_POINTS_PER_QUESTION = 20; // 10 điểm gốc + tối đa 10 điểm thưởng chuỗi (combo)

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const rows = getDb().prepare(`
    SELECT player_name,
           MAX(score)      AS best_score,
           COUNT(*)        AS plays,
           MAX(created_at) AS last_played
    FROM scores
    GROUP BY player_name
    ORDER BY best_score DESC, last_played ASC
    LIMIT ?
  `).all(limit);
  res.json({ data: rows });
});

router.post('/', (req, res) => {
  const playerName = String(req.body?.playerName || '').trim().replace(/\s+/g, ' ');
  const score = Number(req.body?.score);
  const correctCount = Number(req.body?.correctCount);
  const total = Number(req.body?.total);

  // Kiểm tra dữ liệu đầu vào để tránh điểm "ảo"
  if (playerName.length < 1 || playerName.length > 30) {
    return res.status(400).json({ error: 'Tên người chơi phải từ 1 đến 30 kí tự' });
  }
  if (![score, correctCount, total].every(Number.isInteger)) {
    return res.status(400).json({ error: 'Điểm, số câu đúng và tổng số câu phải là số nguyên' });
  }
  if (total < 1 || total > 20 || correctCount < 0 || correctCount > total) {
    return res.status(400).json({ error: 'Số câu không hợp lệ' });
  }
  if (score < 0 || score > total * MAX_POINTS_PER_QUESTION) {
    return res.status(400).json({ error: 'Điểm số vượt quá giới hạn cho phép' });
  }

  const result = getDb()
    .prepare('INSERT INTO scores (player_name, score, correct_count, total) VALUES (?, ?, ?, ?)')
    .run(playerName, score, correctCount, total);

  res.status(201).json({ id: Number(result.lastInsertRowid), message: 'Đã lưu điểm vào Bảng vàng!' });
});

module.exports = router;
