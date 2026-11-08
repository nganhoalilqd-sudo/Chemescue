/**
 * public/js/elements.js
 * "Kho nguyên tố": tải danh sách từ API, lọc theo nhóm và tìm kiếm ngay trên trình duyệt.
 */
import { ChemAPI } from './api.js';
import { escapeHtml } from './ui.js';

const CATEGORY_NAMES = { 'kim-loai': 'Kim loại', 'phi-kim': 'Phi kim', 'khi-hiem': 'Khí hiếm' };
const grid = () => document.getElementById('elementGrid');

let allElements = [];
let currentCategory = '';

// Bỏ dấu tiếng Việt để tìm "sat" vẫn ra "Sắt"
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

function render() {
  const keyword = normalize(document.getElementById('elementSearch').value);
  const list = allElements.filter((el) =>
    (!currentCategory || el.category === currentCategory) &&
    (!keyword || normalize(el.name_vi).includes(keyword) || normalize(el.symbol) === keyword)
  );

  if (!list.length) {
    grid().innerHTML = '<p class="muted">Không tìm thấy nguyên tố phù hợp.</p>';
    return;
  }

  grid().innerHTML = list.map((el, i) => `
    <article class="element" data-category="${el.category}" style="animation-delay:${i * 25}ms"
             title="${escapeHtml(CATEGORY_NAMES[el.category])}">
      <span class="z">${el.atomic_number}</span>
      <div class="symbol">${escapeHtml(el.symbol)}</div>
      <div class="name">${escapeHtml(el.name_vi)}</div>
      <div class="meta">NTK: ${el.atomic_mass}<br>Hóa trị: ${escapeHtml(el.valence || '—')}</div>
    </article>`).join('');
}

export const Elements = {
  async load() {
    try {
      const { data } = await ChemAPI.getElements();
      allElements = data;
      render();
    } catch (err) {
      grid().innerHTML = `<p class="muted">⚠️ ${escapeHtml(err.message)}</p>`;
    }
  },

  bind() {
    document.getElementById('elementSearch').addEventListener('input', render);
    document.getElementById('categoryChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('#categoryChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      currentCategory = chip.dataset.category;
      render();
    });
  },
};
