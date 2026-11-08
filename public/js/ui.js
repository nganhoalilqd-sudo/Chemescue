/**
 * public/js/ui.js
 * Các tiện ích giao diện dùng chung: thông báo nổi (toast), chống chèn mã HTML.
 */
let toastTimer;

export function toast(message, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Biến kí tự đặc biệt thành dạng an toàn trước khi chèn vào HTML (chống chèn mã độc qua tên người chơi)
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
