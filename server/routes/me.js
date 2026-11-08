/**
 * server/routes/me.js
 * Dữ liệu của học sinh đang đăng nhập (cần header X-Student-Token).
 *   GET  /api/me           → hồ sơ + tiến độ đã lưu
 *   PUT  /api/me/state     → lưu tiến độ  { state }
 *   POST /api/me/events    → ghi một hoạt động cho luồng của giáo viên  { icon, text }
 *   GET  /api/me/rank      → thứ hạng trong lớp theo điểm chẩn đoán (huy hiệu "Nhà vô địch tuần")
 */
const express = require('express');
const { requireStudent } = require('../middlewares/auth');
const { getDb } = require('../db/database');
const { publicProfile, saveState, addEvent, parseJSON } = require('../services/students');

const router = express.Router();
router.use(requireStudent);

router.get('/', (req, res) => {
  res.json({
    student: publicProfile(req.student),
    state: parseJSON(req.student.state, null),
    updated_at: req.student.updated_at,
  });
});

router.put('/state', (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.users)) {
    return res.status(400).json({ error: 'Dữ liệu tiến độ không hợp lệ' });
  }
  const summary = saveState(req.student.id, state);
  res.json({ ok: true, level: summary.level, saved_at: new Date().toISOString() });
});

router.post('/events', (req, res) => {
  const icon = String(req.body?.icon || '•').slice(0, 8);
  const text = String(req.body?.text || '').trim().slice(0, 160);
  if (!text) return res.status(400).json({ error: 'Thiếu nội dung hoạt động' });
  addEvent(req.student.id, icon, text);
  res.status(201).json({ ok: true });
});

router.get('/rank', (req, res) => {
  const avg = (scores) => {
    const v = Object.values(scores);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  // Chỉ xếp hạng các bạn trong cùng lớp đã làm bài chẩn đoán
  const peers = getDb().prepare('SELECT id, topic_scores FROM students WHERE class_name = ?')
    .all(req.student.class_name)
    .map((p) => ({ id: p.id, score: avg(parseJSON(p.topic_scores, {})) }))
    .filter((p) => p.score != null);
  const me = peers.find((p) => p.id === req.student.id);
  if (!me) return res.json({ rank: null, size: peers.length, cls: req.student.class_name });
  const rank = 1 + peers.filter((p) => p.score > me.score).length; // bằng điểm → cùng hạng
  res.json({ rank, size: peers.length, cls: req.student.class_name });
});

module.exports = router;
