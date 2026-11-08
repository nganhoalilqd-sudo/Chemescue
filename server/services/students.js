/**
 * server/services/students.js
 * Nghiệp vụ tài khoản học sinh: tạo/tìm tài khoản, lưu tiến độ, tóm tắt cho giáo viên.
 */
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { localDate, daysAgo } = require('./dates');

const MAX_EVENTS = 3000; // Giữ tối đa 3000 sự kiện gần nhất cho luồng hoạt động

/* ---------- Chuẩn hóa dữ liệu nhập ---------- */
// Viết hoa chữ cái đầu mỗi từ: "nguyễn văn an" → "Nguyễn Văn An"
const cleanName = (s) => String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ')
  .split(' ').map((w) => w.charAt(0).toLocaleUpperCase('vi') + w.slice(1).toLocaleLowerCase('vi')).join(' ');
const nameKey = (s) => cleanName(s).toLocaleLowerCase('vi');
const cleanClass = (s) => String(s || '').normalize('NFC').trim().replace(/\s+/g, '').toUpperCase();

function validateProfile(name, className) {
  if (name.length < 2 || name.length > 50) return 'Họ tên phải từ 2 đến 50 kí tự';
  if (!/^[\p{L}\s.'-]+$/u.test(name)) return 'Họ tên chỉ gồm chữ cái và dấu cách';
  if (className.length < 1 || className.length > 10) return 'Tên lớp phải từ 1 đến 10 kí tự (vd: 8A1)';
  if (!/^[\p{L}\d./-]+$/u.test(className)) return 'Tên lớp chỉ gồm chữ, số và dấu / . -';
  return null;
}

/* ---------- Đọc JSON an toàn ---------- */
function parseJSON(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

/** Tìm tài khoản theo họ tên + lớp; chưa có thì tạo mới. */
function loginOrCreate(rawName, rawClass) {
  const name = cleanName(rawName);
  const className = cleanClass(rawClass);
  const error = validateProfile(name, className);
  if (error) return { error };

  const db = getDb();
  const found = db.prepare('SELECT * FROM students WHERE name_key = ? AND class_name = ?').get(nameKey(name), className);
  if (found) return { student: found, created: false };

  const token = crypto.randomBytes(24).toString('hex');
  const info = db.prepare('INSERT INTO students (name, name_key, class_name, token) VALUES (?, ?, ?, ?)')
    .run(name, nameKey(name), className, token);
  return { student: db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid), created: true };
}

function findByToken(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  return getDb().prepare('SELECT * FROM students WHERE token = ?').get(token) || null;
}

/** Thông tin công khai trả về cho trình duyệt (không kèm state) */
const publicProfile = (s) => ({ id: s.id, name: s.name, class_name: s.class_name });

/**
 * Rút các chỉ số tóm tắt từ state (dữ liệu tiến độ) do trình duyệt gửi lên.
 * Viết "phòng thủ": dữ liệu sai kiểu thì dùng giá trị mặc định, không làm hỏng server.
 */
function summarize(state) {
  const user = Array.isArray(state.users) ? state.users[0] || {} : {};
  const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
  const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

  const attempts = Array.isArray(state.quiz_attempts) ? state.quiz_attempts : [];
  const latest = attempts.slice().sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const topicScores = {};
  if (latest && latest.topic_scores && typeof latest.topic_scores === 'object') {
    for (const [k, v] of Object.entries(latest.topic_scores)) {
      if (/^[a-z_]{1,30}$/.test(k)) topicScores[k] = Math.min(100, int(v));
    }
  }

  // Phút học theo ngày: chỉ giữ 60 ngày gần nhất
  const minutes = {};
  const rawMinutes = state.meta && typeof state.meta.minutes_by_day === 'object' ? state.meta.minutes_by_day : {};
  const cutoff = daysAgo(60);
  for (const [d, m] of Object.entries(rawMinutes || {})) {
    if (isDate(d) && d >= cutoff) minutes[d] = Math.min(24 * 60, int(m));
  }

  const days = Array.isArray(state.activity_days) ? state.activity_days.map((r) => r && r.date).filter(isDate) : [];
  const activeDates = [...new Set(days)].filter((d) => d >= cutoff).sort();

  // Chuỗi ngày chỉ còn hiệu lực nếu học hôm nay hoặc hôm qua (giống cách hiển thị trên giao diện)
  const lastActive = isDate(user.last_active) ? user.last_active : null;
  const streakAlive = lastActive === localDate() || lastActive === daysAgo(1);

  return {
    level: Math.max(1, int(user.level, 1)),
    exp: int(user.exp),
    streak: streakAlive ? int(user.streak) : 0,
    last_active: lastActive,
    topic_scores: JSON.stringify(topicScores),
    diagnostics: attempts.length,
    minutes_by_day: JSON.stringify(minutes),
    active_dates: JSON.stringify(activeDates),
  };
}

/** Lưu tiến độ của học sinh + cập nhật các cột tóm tắt */
function saveState(studentId, state) {
  const sum = summarize(state);
  getDb().prepare(`
    UPDATE students SET
      state = @state, level = @level, exp = @exp, streak = @streak, last_active = @last_active,
      topic_scores = @topic_scores, diagnostics = @diagnostics,
      minutes_by_day = @minutes_by_day, active_dates = @active_dates,
      updated_at = datetime('now')
    WHERE id = @id
  `).run({ ...sum, state: JSON.stringify(state), id: studentId });
  return sum;
}

function addEvent(studentId, icon, text) {
  const db = getDb();
  db.prepare('INSERT INTO events (student_id, icon, text) VALUES (?, ?, ?)').run(studentId, icon, text);
  // Dọn bớt sự kiện cũ để CSDL không phình to
  db.prepare('DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?').run(MAX_EVENTS);
}

module.exports = { loginOrCreate, findByToken, publicProfile, saveState, addEvent, parseJSON, summarize };
