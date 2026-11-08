/**
 * public/js/leaderboard.js
 * "Bảng vàng": hiển thị điểm cao nhất của từng người chơi, tô sáng dòng của chính mình.
 */
import { ChemAPI } from './api.js';
import { Player } from './player.js';
import { escapeHtml } from './ui.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export const Leaderboard = {
  async load() {
    const list = document.getElementById('leaderboardList');
    try {
      const { data } = await ChemAPI.getLeaderboard(10);
      if (!data.length) {
        list.innerHTML = '<li class="muted">Chưa có ai trên Bảng vàng. Hãy là người đầu tiên!</li>';
        return;
      }
      list.innerHTML = data.map((row, i) => `
        <li class="${row.player_name === Player.name ? 'me' : ''}">
          <span class="rank">${MEDALS[i] || i + 1}</span>
          <span class="who">${escapeHtml(row.player_name)}<small>${row.plays} lượt chơi</small></span>
          <span class="pts">${row.best_score} điểm</span>
        </li>`).join('');
    } catch (err) {
      list.innerHTML = `<li class="muted">⚠️ ${escapeHtml(err.message)}</li>`;
    }
  },
};
