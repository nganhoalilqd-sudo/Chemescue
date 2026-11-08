/**
 * server/routes/teacher.js
 * Dữ liệu cho Dashboard Giáo viên (cần header X-Teacher-Pin).
 *   GET    /api/teacher/overview      → danh sách học sinh + hoạt động 7 ngày + luồng hoạt động
 *   DELETE /api/teacher/students/:id  → xóa một tài khoản học sinh (vd: tài khoản thử nghiệm)
 */
const express = require('express');
const { getDb } = require('../db/database');
const { requireTeacher } = require('../middlewares/auth');
const { parseJSON } = require('../services/students');
const { localDate, lastDays } = require('../services/dates');

const router = express.Router();
router.use(requireTeacher);

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const avgScore = (scores) => Math.round(mean(Object.values(scores)));

router.get('/overview', (req, res) => {
  const week = lastDays(7);
  const rows = getDb().prepare(`
    SELECT id, name, class_name, level, exp, streak, last_active, topic_scores, diagnostics,
           minutes_by_day, active_dates, created_at
    FROM students ORDER BY class_name, name
  `).all();

  // Định dạng giống bảng "students" của Phân hệ 5 để giao diện dùng lại được
  const students = rows.map((r) => {
    const minutes = parseJSON(r.minutes_by_day, {});
    return {
      id: r.id,
      name: r.name,
      class_id: r.class_name,
      level: r.level,
      exp: r.exp,
      streak: r.streak,
      // Học sinh chưa học buổi nào: lấy ngày tạo tài khoản làm mốc
      last_active: r.last_active || String(r.created_at).slice(0, 10),
      minutes_week: week.reduce((s, d) => s + (minutes[d] || 0), 0),
      topic_scores: parseJSON(r.topic_scores, {}),
      diagnostics: r.diagnostics,
      joined: String(r.created_at).slice(0, 10), // ngày tạo tài khoản
      _minutes: minutes,
      _active: new Set(parseJSON(r.active_dates, [])),
    };
  });

  const activity_log = week.map((date, i) => {
    const active = students.filter((s) => (s._minutes[date] || 0) > 0 || s._active.has(date));
    const scored = active.filter((s) => Object.keys(s.topic_scores).length);
    return {
      id: i + 1,
      date,
      active_students: active.length,
      // Ngày không có ai (đã làm chẩn đoán) hoạt động → để trống, biểu đồ không vẽ điểm
      avg_score: scored.length ? Math.round(mean(scored.map((s) => avgScore(s.topic_scores)))) : null,
      total_minutes: students.reduce((sum, s) => sum + (s._minutes[date] || 0), 0),
    };
  });

  const feed = getDb().prepare(`
    SELECT e.icon, e.text, e.created_at, s.name
    FROM events e JOIN students s ON s.id = e.student_id
    ORDER BY e.id DESC LIMIT 20
  `).all().map((e) => ({
    icon: e.icon,
    who: e.name,
    text: e.text,
    at: Date.parse(e.created_at.replace(' ', 'T') + 'Z'), // giờ UTC trong SQLite → mốc thời gian
  }));

  res.json({
    today: localDate(),
    students: students.map(({ _minutes, _active, ...s }) => s),
    activity_log,
    feed,
  });
});

router.delete('/students/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  db.prepare('DELETE FROM events WHERE student_id = ?').run(id);
  const info = db.prepare('DELETE FROM students WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Không tìm thấy học sinh' });
  res.json({ ok: true });
});

module.exports = router;
