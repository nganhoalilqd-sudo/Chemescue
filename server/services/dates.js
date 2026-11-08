/**
 * server/services/dates.js
 * Tính ngày theo múi giờ Việt Nam (máy chủ Railway chạy giờ UTC, lệch 7 tiếng).
 */
const { TIME_ZONE } = require('../config');

// Trả về 'YYYY-MM-DD' của một thời điểm theo múi giờ cấu hình
function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

// Ngày cách hôm nay n ngày (n = 1 → hôm qua)
function daysAgo(n) {
  return localDate(new Date(Date.now() - n * 86400000));
}

// Danh sách 'YYYY-MM-DD' của n ngày gần nhất, cũ → mới
function lastDays(n) {
  return Array.from({ length: n }, (_, i) => daysAgo(n - 1 - i));
}

module.exports = { localDate, daysAgo, lastDays };
