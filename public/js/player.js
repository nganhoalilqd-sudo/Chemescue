/**
 * public/js/player.js
 * Hồ sơ người chơi lưu ngay trên trình duyệt (localStorage): tên + điểm kinh nghiệm (XP).
 * Cấp độ = 1 + (XP / 100). Mỗi 100 XP lên một cấp.
 */
import { toast } from './ui.js';

const STORAGE_KEY = 'chemrescue.player';
const XP_PER_LEVEL = 100;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { name: '', xp: 0 };
  } catch {
    return { name: '', xp: 0 }; // Trình duyệt chặn localStorage → dùng hồ sơ tạm
  }
}

const state = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* bỏ qua */ }
}

export const Player = {
  get name() { return state.name; },
  get xp() { return state.xp; },
  get level() { return Math.floor(state.xp / XP_PER_LEVEL) + 1; },

  setName(name) {
    state.name = name.trim().slice(0, 30);
    save();
    this.render();
  },

  addXp(amount) {
    const before = this.level;
    state.xp += Math.max(0, amount);
    save();
    this.render();
    if (this.level > before) {
      toast(`🎉 Lên cấp ${this.level}! Tuyệt vời!`);
      const chip = document.getElementById('playerChip');
      chip.classList.remove('level-up');
      void chip.offsetWidth; // Khởi động lại hiệu ứng
      chip.classList.add('level-up');
    }
  },

  // Cập nhật thẻ người chơi trên thanh trên cùng
  render() {
    document.getElementById('playerName').textContent = state.name || 'Nhà hóa học nhí';
    document.getElementById('playerLevel').textContent = `Lv ${this.level}`;
    document.getElementById('xpFill').style.width = `${state.xp % XP_PER_LEVEL}%`;
    if (state.name) document.getElementById('nameInput').value = state.name;
  },
};
