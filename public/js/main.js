/**
 * public/js/main.js
 * Điểm khởi đầu của Frontend: gắn sự kiện và tải dữ liệu ban đầu.
 */
import { ChemAPI } from './api.js';
import { Player } from './player.js';
import { Quiz } from './quiz.js';
import { Elements } from './elements.js';
import { Leaderboard } from './leaderboard.js';
import { toast } from './ui.js';

// Hiển thị trạng thái máy chủ ở chân trang
async function checkServer() {
  const el = document.getElementById('serverStatus');
  try {
    await ChemAPI.health();
    el.className = 'status online';
    el.innerHTML = '<i></i> Máy chủ hoạt động';
  } catch {
    el.className = 'status offline';
    el.innerHTML = '<i></i> Mất kết nối máy chủ';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  Player.render();
  Quiz.bind();
  Elements.bind();

  // Nhập tên rồi bắt đầu chơi
  document.getElementById('startForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('nameInput').value.trim();
    if (!name) return;
    Player.setName(name);
    toast(`👋 Chào ${Player.name}! Bắt đầu nhiệm vụ nào.`);
    Quiz.start();
  });

  // Các nút "Chơi ngay"
  document.querySelectorAll('[data-action="play"]').forEach((btn) =>
    btn.addEventListener('click', () => Quiz.start())
  );

  Elements.load();
  Leaderboard.load();
  checkServer();
});
