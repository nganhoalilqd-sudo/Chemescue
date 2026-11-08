/**
 * server/routes/auth.js
 * Đăng nhập.
 *   POST /api/auth/student  { name, className } → tìm hoặc tạo tài khoản học sinh
 *   POST /api/auth/teacher  { pin }             → kiểm tra mã PIN giáo viên
 *
 * Học sinh đăng nhập bằng HỌ TÊN + LỚP (không cần mật khẩu, phù hợp lớp học).
 * Nhập lại đúng họ tên + lớp ở máy khác sẽ vào lại đúng tài khoản cũ.
 */
const express = require('express');
const { loginOrCreate, publicProfile, parseJSON } = require('../services/students');
const { checkTeacherPin } = require('../middlewares/auth');

const router = express.Router();

router.post('/student', (req, res) => {
  const result = loginOrCreate(req.body?.name, req.body?.className);
  if (result.error) return res.status(400).json({ error: result.error });
  const s = result.student;
  res.status(result.created ? 201 : 200).json({
    student: publicProfile(s),
    token: s.token,
    created: result.created,
    state: parseJSON(s.state, null),
    updated_at: s.updated_at,
  });
});

router.post('/teacher', (req, res) => {
  if (checkTeacherPin(req, res)) res.json({ ok: true });
});

module.exports = router;
