/**
 * public/js/api.js
 * Mọi lời gọi tới Backend đều đi qua file này.
 * Đổi địa chỉ API hay cách xử lý lỗi chỉ cần sửa ở đây.
 */
async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi kết nối máy chủ (${res.status})`);
  return data;
}

export const ChemAPI = {
  health: () => request('/api/health'),

  getElements: (category = '') =>
    request(`/api/elements${category ? `?category=${encodeURIComponent(category)}` : ''}`),

  getQuestions: (limit = 10, topic = '') =>
    request(`/api/questions?limit=${limit}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`),

  checkAnswer: (questionId, choice) =>
    request(`/api/questions/${questionId}/check`, { method: 'POST', body: JSON.stringify({ choice }) }),

  getLeaderboard: (limit = 10) => request(`/api/scores?limit=${limit}`),

  saveScore: (payload) => request('/api/scores', { method: 'POST', body: JSON.stringify(payload) }),
};
