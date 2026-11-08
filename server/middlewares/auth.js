/**
 * server/middlewares/auth.js
 * Kiểm tra quyền truy cập:
 *  - Học sinh: gửi kèm header "X-Student-Token" (mã nhận được khi đăng nhập)
 *  - Giáo viên: gửi kèm header "X-Teacher-Pin" (mã PIN khai báo trên Railway)
 */
const crypto = require('crypto');
const { TEACHER_PIN } = require('../config');
const { findByToken } = require('../services/students');

function requireStudent(req, res, next) {
  const student = findByToken(req.get('X-Student-Token'));
  if (!student) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại' });
  req.student = student;
  next();
}

// So sánh PIN theo thời gian cố định (tránh đoán PIN bằng cách đo thời gian phản hồi)
function pinMatches(pin) {
  if (!TEACHER_PIN || typeof pin !== 'string') return false;
  const a = crypto.createHash('sha256').update(pin.trim()).digest();
  const b = crypto.createHash('sha256').update(TEACHER_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

// Chặn dò PIN: sai quá 10 lần trong 10 phút từ cùng một địa chỉ → tạm khóa
const failures = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 10;

function tooManyFails(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) return false;
  return f.count >= MAX_FAILS;
}
function recordFail(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(ip, { first: Date.now(), count: 1 });
  else f.count += 1;
}

function checkTeacherPin(req, res) {
  if (!TEACHER_PIN) {
    res.status(503).json({ error: 'Chưa đặt mã PIN giáo viên. Hãy khai báo biến TEACHER_PIN trong tab Variables của Railway.', code: 'NO_PIN' });
    return false;
  }
  const ip = req.ip;
  if (tooManyFails(ip)) {
    res.status(429).json({ error: 'Nhập sai PIN quá nhiều lần. Vui lòng thử lại sau 10 phút.' });
    return false;
  }
  const pin = req.get('X-Teacher-Pin') ?? req.body?.pin;
  if (!pinMatches(pin)) {
    recordFail(ip);
    res.status(401).json({ error: 'Mã PIN giáo viên không đúng', code: 'BAD_PIN' });
    return false;
  }
  failures.delete(ip);
  return true;
}

function requireTeacher(req, res, next) {
  if (checkTeacherPin(req, res)) next();
}

module.exports = { requireStudent, requireTeacher, checkTeacherPin };
