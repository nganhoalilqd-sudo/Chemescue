/* =========================================================
   ChemRescue — App Core
   • Cấu hình điều hướng (1 nguồn duy nhất cho Sidebar + Bottom nav)
   • Hash Router (#/home, #/diagnostic, …)
   • Module Registry: mỗi phân hệ tự đăng ký qua ChemRescue.Modules.register()
   • Hệ thống EXP / Level / Streak, Toast, Modal
   ========================================================= */
(() => {
  'use strict';

  const DB = window.ChemDB;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 1. CẤU HÌNH ĐIỀU HƯỚNG & THÔNG TIN PHÂN HỆ ---------- */
  const NAV = [
    { id: 'home',       group: 'Bắt đầu',   mod: 'm0', icon: '🏠', label: 'Tổng quan',               short: 'Tổng quan',
      subtitle: 'Trạm chỉ huy giải cứu môn Hóa' },
    { id: 'diagnostic', group: 'Học sinh',  mod: 'm1', icon: '🩺', label: 'Phòng chẩn đoán',         short: 'Chẩn đoán', no: 1,
      subtitle: 'Tìm đúng lỗ hổng trước khi chữa' },
    { id: 'island',     group: 'Học sinh',  mod: 'm2', icon: '🏝️', label: 'Đảo Cứu Nguy',            short: 'Đảo',       no: 2,
      subtitle: 'Học cốt lõi: Flashcard 3D & Xưởng ghép ion' },
    { id: 'arena',      group: 'Học sinh',  mod: 'm3', icon: '⚔️', label: 'Đấu trường & Nhiệm vụ',   short: 'Đấu trường', no: 3,
      subtitle: 'Nhiệm vụ hằng ngày và đối kháng 1vs1' },
    { id: 'skills',     group: 'Học sinh',  mod: 'm4', icon: '🌳', label: 'Cây kỹ năng & Huy hiệu',  short: 'Kỹ năng',   no: 4,
      subtitle: 'Mở khóa nhánh kiến thức, sưu tầm huy hiệu' },
    { id: 'teacher',    group: 'Giáo viên', mod: 'm5', icon: '📊', label: 'Dashboard Giáo viên',     short: 'Giáo viên', no: 5,
      subtitle: 'Phân tích học tập & cảnh báo sớm' }
  ];
  const NAV_BY_ID = Object.fromEntries(NAV.map((n) => [n.id, n]));

  const MODULE_INFO = {
    diagnostic: {
      desc: 'Bài test 15 câu chấm theo chủ đề, vẽ bản đồ nhiệt lỗ hổng và gợi ý lộ trình.',
      features: [
        ['📝', 'Bài test 15 câu', 'Chuyển câu mượt, đếm giờ, thanh tiến độ, xem lại đáp án.'],
        ['🌡️', 'Bản đồ nhiệt lỗ hổng', 'Xanh ≥ 80% · Vàng 50–79% · Đỏ < 50% cho từng chủ đề.'],
        ['🧭', 'Lộ trình khuyến nghị', 'Ưu tiên chủ đề đỏ, dẫn thẳng tới bài ôn ở Đảo Cứu Nguy.']
      ],
      tables: ['questions', 'topics', 'quiz_attempts']
    },
    island: {
      desc: 'Ôn bằng Flashcard 3D có lặp lại ngắt quãng và thực hành ghép ion kéo thả.',
      features: [
        ['🃏', 'Trạm Flashcard 3D', 'Lật thẻ bằng CSS 3D Transform, chấm mức nhớ Dễ / Vừa / Khó.'],
        ['⏳', 'Lặp lại ngắt quãng', 'Thuật toán SM-2 rút gọn tính ngày ôn tiếp theo cho từng thẻ.'],
        ['⚗️', 'Xưởng ghép chất ion', 'Kéo thả Cation⁺ / Anion⁻, tổng điện tích = 0 → phát sáng & hiện công thức.']
      ],
      tables: ['flashcards', 'flashcard_reviews', 'ions']
    },
    arena: {
      desc: 'Giữ nhịp học mỗi ngày bằng nhiệm vụ, chuỗi Streak và trận đấu tốc độ.',
      features: [
        ['🎯', 'Daily Quests', '4 nhiệm vụ, thanh EXP và nhận thưởng khi hoàn thành.'],
        ['🔥', 'Streak', 'Đếm số ngày học liên tục, ngọn lửa lớn dần theo chuỗi.'],
        ['⏱️', 'Đấu trường 1vs1', 'Đếm ngược 15 giây, đối thủ ẩn danh, 2 cột điểm đối kháng thời gian thực.']
      ],
      tables: ['quests', 'arena_bots']
    },
    skills: {
      desc: 'Bản đồ tiến bộ kiểu RPG: 4 nhánh kiến thức mở khóa dần và tủ 12 huy hiệu.',
      features: [
        ['🌳', 'Skill Tree 4 nhánh', 'Nguyên tử · Liên kết · Phản ứng · Acid–Base, mở khóa theo điều kiện.'],
        ['🏅', 'Tủ huy hiệu', 'Lưới 12 ô: chưa đạt thì xám, đã mở khóa thì lấp lánh viền vàng.'],
        ['📈', 'Đồng bộ tiến độ', 'Nút kỹ năng sáng lên dựa trên kết quả chẩn đoán và ôn tập.']
      ],
      tables: ['skill_nodes', 'user_skills', 'badges', 'user_badges']
    },
    teacher: {
      desc: 'Bảng điều khiển cho giáo viên: biểu đồ phân tích, cảnh báo tụt hậu, xuất dữ liệu.',
      features: [
        ['📊', 'Biểu đồ Chart.js', 'Hoạt động 7 ngày, điểm trung bình theo chủ đề, cập nhật thời gian thực.'],
        ['🚨', 'Cảnh báo tụt hậu', 'Danh sách học sinh gắn tag Đỏ / Vàng theo điểm và mức độ hoạt động.'],
        ['⬇️', 'Export Data', 'Tải dữ liệu lớp học dạng CSV (mở được bằng Excel, đúng dấu tiếng Việt).']
      ],
      tables: ['students', 'activity_log']
    }
  };

  /* ---------- 2. EVENT BUS ---------- */
  const bus = {
    _h: {},
    on(evt, fn) { (this._h[evt] ||= []).push(fn); return () => this.off(evt, fn); },
    off(evt, fn) { this._h[evt] = (this._h[evt] || []).filter((f) => f !== fn); },
    emit(evt, payload) { (this._h[evt] || []).forEach((fn) => fn(payload)); }
  };

  /* ---------- 3. TIỆN ÍCH NGHIỆP VỤ ---------- */
  const Mastery = {
    level: (pct) => (pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad'),
    label: (lvl) => ({ ok: 'Làm chủ', warn: 'Cần bù đắp', bad: 'Cảnh báo' }[lvl])
  };

  const XP = {
    need: (level) => 100 + (level - 1) * 50, // EXP cần để qua cấp hiện tại

    add(amount, reason = '') {
      const u = DB.currentUser();
      u.exp += amount;
      let leveledUp = false;
      while (u.exp >= XP.need(u.level)) { u.exp -= XP.need(u.level); u.level += 1; leveledUp = true; }
      Streak.touch(u);
      DB.update('users', u.id, u);

      renderTopbarStats(true);
      toast(`<b>+${amount} EXP</b>${reason ? ' · ' + esc(reason) : ''}`, '⚡');
      if (leveledUp) showLevelUp(u.level);
      bus.emit('user:changed', u);
      return u;
    }
  };

  const Streak = {
    // Gọi khi người dùng có hoạt động học: hôm qua có học → +1, bỏ ngày → về 1
    touch(u) {
      const today = DB.localDate();
      if (u.last_active === today) return;
      u.streak = u.last_active === DB.daysAgo(1) ? u.streak + 1 : 1;
      u.last_active = today;
    },
    // Hiển thị: nếu đã bỏ lỡ quá 1 ngày thì chuỗi coi như đã đứt
    display(u) {
      return [DB.localDate(), DB.daysAgo(1)].includes(u.last_active) ? u.streak : 0;
    }
  };

  /* ---------- 4. TOAST & MODAL ---------- */
  function toast(html, icon = '✨', ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span aria-hidden="true">${icon}</span><span>${html}</span>`;
    $('#toastStack').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, ms);
  }

  let lastFocus = null;
  function showLevelUp(level) {
    lastFocus = document.activeElement;
    $('#levelModalValue').textContent = `Lv ${level}`;
    $('#levelModal').hidden = false;
    $('#levelModal .btn').focus();
  }
  function closeModal() {
    $('#levelModal').hidden = true;
    lastFocus?.focus?.();
  }

  /* ---------- 5. RENDER KHUNG: NAV, TOPBAR, USER CARD ---------- */
  function renderNav() {
    let html = '';
    let group = null;
    NAV.forEach((n) => {
      if (n.group !== group) { group = n.group; html += `<p class="nav-group">${esc(group)}</p>`; }
      html += `
        <a class="nav-item" href="#/${n.id}" data-route="${n.id}" data-mod="${n.mod}" title="${esc(n.label)}">
          <span class="nav-item__icon" aria-hidden="true">${n.icon}</span>
          <span class="nav-item__label">${esc(n.label)}<small>${n.no ? 'Phân hệ ' + n.no : 'Bảng điều khiển'}</small></span>
        </a>`;
    });
    $('#sideNav').innerHTML = html;

    $('#bottomNav').innerHTML = NAV.map((n) => `
      <a class="bnav-item" href="#/${n.id}" data-route="${n.id}" data-mod="${n.mod}">
        <span class="bnav-item__icon" aria-hidden="true">${n.icon}</span>
        <span>${esc(n.short)}</span>
      </a>`).join('');
  }

  function setActiveNav(id) {
    document.querySelectorAll('[data-route]').forEach((a) => {
      if (a.dataset.route === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function renderTopbarStats(animate = false) {
    const u = DB.currentUser();
    const need = XP.need(u.level);
    const pct = Math.min(100, Math.round((u.exp / need) * 100));

    $('#streakCount').textContent = Streak.display(u);
    $('#gemCount').textContent = u.gems.toLocaleString('vi-VN');
    $('#levelBadge').textContent = `Lv ${u.level}`;
    $('#xpText').textContent = `${u.exp}/${need}`;
    $('#xpFill').style.width = pct + '%';
    $('#xpBar').setAttribute('aria-valuenow', pct);
    $('#avatarEmoji').textContent = u.avatar;

    $('#userCard').innerHTML = `
      <span class="user-card__avatar" aria-hidden="true">${u.avatar}</span>
      <span class="user-card__info"><b>${esc(u.name)}</b><span>${u.role === 'teacher' ? 'Giáo viên' : `Lớp ${esc(u.class_id)} · Lv ${u.level}`}</span></span>`;

    if (animate) {
      const lvl = $('#levelBadge');
      lvl.classList.remove('bump'); void lvl.offsetWidth; lvl.classList.add('bump');
    }
  }

  /* ---------- 6. MODULE REGISTRY ---------- */
  // Mỗi phân hệ: { render(container, ctx), unmount?() }
  const Modules = {
    _defs: {},
    register(id, def) { this._defs[id] = def; },
    get(id) { return this._defs[id] || createPlaceholder(id); }
  };

  // Khung chờ cho phân hệ chưa được viết chi tiết
  function createPlaceholder(id) {
    return {
      render(view) {
        const n = NAV_BY_ID[id];
        const info = MODULE_INFO[id];
        view.innerHTML = `
          <section class="mod-banner" data-mod="${n.mod}">
            <span class="mod-banner__icon" aria-hidden="true">${n.icon}</span>
            <div>
              <span class="tag">Phân hệ ${n.no}</span>
              <h2>${esc(n.label)}</h2>
              <p>${esc(info.desc)}</p>
            </div>
          </section>

          <div class="section-head">
            <div><h3>Tính năng sẽ xây dựng</h3><p>Khung điều hướng đã sẵn sàng — mã chi tiết sẽ được cắm vào đây.</p></div>
          </div>
          <section class="feature-grid" data-mod="${n.mod}">
            ${info.features.map(([icon, title, text]) => `
              <article class="feature">
                <span class="feature__icon" aria-hidden="true">${icon}</span>
                <b>${esc(title)}</b>
                <p>${esc(text)}</p>
              </article>`).join('')}
          </section>

          <div class="section-head">
            <div><h3>Dữ liệu đã kết nối</h3><p>Các bảng trong CSDL mẫu mà phân hệ này sẽ dùng.</p></div>
          </div>
          <section class="card">
            <div class="db-chips">
              ${info.tables.map((t) => `<span class="db-chip">${t} <em>${DB.count(t)}</em> bản ghi</span>`).join('')}
            </div>
          </section>`;
      }
    };
  }

  /* ---------- 7. TRANG TỔNG QUAN ---------- */
  Modules.register('home', {
    render(view) {
      const u = DB.currentUser();
      const firstName = u.name.trim().split(/\s+/).pop();
      const quests = DB.select('quests');
      const doneQuests = quests.filter((q) => q.progress >= q.target).length;
      const goalPct = quests.length ? Math.round((doneQuests / quests.length) * 100) : 0;
      const topics = DB.select('topics');
      const attempt = DB.select('quiz_attempts', { user_id: u.id }, { orderBy: 'id desc', limit: 1 })[0];
      const badgeCount = DB.count('user_badges', { user_id: u.id });
      const badgeTotal = DB.count('badges');
      const streak = Streak.display(u);

      // Gợi ý bước tiếp theo: chưa chẩn đoán → đi chẩn đoán; có rồi → ôn chủ đề yếu nhất
      let next = { route: 'diagnostic', mod: 'm1', label: 'Làm bài chẩn đoán' };
      if (attempt) {
        const weakest = topics.slice().sort((a, b) => attempt.topic_scores[a.id] - attempt.topic_scores[b.id])[0];
        next = { route: 'island', mod: 'm2', label: `Ôn “${weakest.short}”` };
      }

      const moduleCards = NAV.filter((n) => n.no).map((n) => {
        const pct = u.module_progress[n.id];
        const isTeacher = n.id === 'teacher';
        return `
          <a class="module-card" href="#/${n.id}" data-mod="${n.mod}">
            <div class="module-card__top">
              <span class="module-card__icon" aria-hidden="true">${n.icon}</span>
              <span class="tag">Phân hệ ${n.no}</span>
            </div>
            <h4>${esc(n.label)}</h4>
            <p>${esc(MODULE_INFO[n.id].desc)}</p>
            ${isTeacher ? '' : `<div class="progress" aria-label="Tiến độ ${pct}%"><div class="progress__fill" style="width:${pct}%"></div></div>`}
            <div class="module-card__foot">
              <span>${isTeacher ? '👩‍🏫 Dành cho giáo viên' : pct + '% hoàn thành'}</span>
              <span class="module-card__go">Vào →</span>
            </div>
          </a>`;
      }).join('');

      const heatmap = attempt
        ? topics.map((t) => {
            const p = attempt.topic_scores[t.id] ?? 0;
            const lvl = Mastery.level(p);
            return `
              <div class="heat-tile heat-tile--${lvl}" title="${esc(t.name)}: ${Mastery.label(lvl)}">
                <span class="heat-tile__icon" aria-hidden="true">${t.icon}</span>
                <b>${esc(t.short)}</b>
                <strong>${p}%</strong>
              </div>`;
          }).join('')
        : `<p style="color:var(--muted)">Chưa có dữ liệu — hãy làm bài chẩn đoán đầu tiên.</p>`;

      const questItems = quests.map((q) => {
        const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
        const done = q.progress >= q.target;
        return `
          <li class="quest ${done ? 'quest--done' : ''}" data-mod="m3">
            <span class="quest__icon" aria-hidden="true">${done ? '✅' : q.icon}</span>
            <div class="quest__body">
              <b>${esc(q.title)}</b>
              <div class="progress" aria-label="${q.progress}/${q.target}"><div class="progress__fill" style="width:${pct}%"></div></div>
            </div>
            <span class="quest__reward">+${q.exp_reward} EXP</span>
          </li>`;
      }).join('');

      view.innerHTML = `
        <section class="hero card">
          <div class="hero__text">
            <span class="eyebrow">${streak > 0 ? `🔥 Chuỗi ${streak} ngày học liên tiếp` : '🔥 Bắt đầu chuỗi học hôm nay'}</span>
            <h2>Chào ${esc(firstName)}, sẵn sàng giải cứu môn Hóa chưa?</h2>
            <p>Bạn đã hoàn thành <b>${doneQuests}/${quests.length}</b> nhiệm vụ hôm nay. Hoàn thành tất cả để giữ chuỗi và nhận thêm 💎.</p>
            <div class="hero__actions">
              <a class="btn" href="#/${next.route}" data-mod="${next.mod}">▶ Tiếp tục: ${esc(next.label)}</a>
            </div>
          </div>
          <div class="ring" style="--p:${goalPct}" role="img" aria-label="Mục tiêu ngày ${goalPct}%">
            <div class="ring__inner"><b>${goalPct}%</b><span>mục tiêu ngày</span></div>
          </div>
        </section>

        <section class="stats">
          <div class="card stat" data-mod="m2"><span class="stat__icon">🔥</span><div class="stat__body"><b>${streak} ngày</b><span>Chuỗi học</span></div></div>
          <div class="card stat" data-mod="m0"><span class="stat__icon">⭐</span><div class="stat__body"><b>Cấp ${u.level}</b><span>${u.exp}/${XP.need(u.level)} EXP</span></div></div>
          <div class="card stat" data-mod="m4"><span class="stat__icon">🏅</span><div class="stat__body"><b>${badgeCount}/${badgeTotal}</b><span>Huy hiệu</span></div></div>
          <div class="card stat" data-mod="m1"><span class="stat__icon">🩺</span><div class="stat__body"><b>${attempt ? `${attempt.score}/${attempt.total}` : '—'}</b><span>Điểm chẩn đoán gần nhất</span></div></div>
        </section>

        <div>
          <div class="section-head">
            <div><h3>Bản đồ giải cứu</h3><p>5 phân hệ của ChemRescue</p></div>
          </div>
          <section class="module-grid">${moduleCards}</section>
        </div>

        <section class="split">
          <div class="card">
            <div class="card__head"><h3>🌡️ Bản đồ nhiệt lỗ hổng</h3><a href="#/diagnostic">Làm lại →</a></div>
            <div class="heat-grid">${heatmap}</div>
            <div class="legend">
              <span><i style="background:var(--ok)"></i>Làm chủ ≥ 80%</span>
              <span><i style="background:var(--warn)"></i>Cần bù đắp 50–79%</span>
              <span><i style="background:var(--bad)"></i>Cảnh báo &lt; 50%</span>
            </div>
          </div>
          <div class="card">
            <div class="card__head"><h3>🎯 Nhiệm vụ hôm nay</h3><a href="#/arena">Tất cả →</a></div>
            <ul class="quest-list">${questItems}</ul>
          </div>
        </section>`;
    }
  });

  /* ---------- 8. ROUTER ---------- */
  let current = null;

  function parseHash() {
    const [id, ...params] = location.hash.replace(/^#\/?/, '').split('/');
    return { id: NAV_BY_ID[id] ? id : 'home', params };
  }

  function navigate() {
    const { id, params } = parseHash();
    const n = NAV_BY_ID[id];
    const view = $('#view');

    try { current?.unmount?.(); } catch (e) { console.error(e); }

    view.classList.remove('view--in');
    view.innerHTML = '';
    current = Modules.get(id);
    current.render(view, { params, DB, App: window.ChemRescue });
    void view.offsetWidth;            // reflow để chạy lại animation vào trang
    view.classList.add('view--in');

    setActiveNav(id);
    $('#pageTitle').textContent = n.label;
    $('#pageSubtitle').textContent = n.subtitle;
    document.title = `${n.label} · ChemRescue`;
    window.scrollTo({ top: 0 });
    bus.emit('route:changed', id);
  }

  /* ---------- 9. SỰ KIỆN TOÀN CỤC ---------- */
  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toggleMenu(force) {
    const menu = $('#userMenu');
    const open = force ?? menu.hidden;
    menu.hidden = !open;
    $('#avatarBtn').setAttribute('aria-expanded', String(open));
  }

  const ACTIONS = {
    'export-db': () => { download(`chemrescue-tien-do-${DB.localDate()}.json`, DB.exportJSON(), 'application/json'); toast('Đã tải bản sao tiến độ', '💾'); },
    'reset-db': async () => {
      const ok = await window.ChemSession.confirm('Xóa TOÀN BỘ tiến độ (EXP, bài làm, huy hiệu…) và làm lại từ đầu?\nThao tác này không thể hoàn tác.',
        { title: 'Làm lại từ đầu', okLabel: 'Xóa tiến độ', danger: true, icon: '♻️' });
      if (!ok) return;
      DB.reset(); renderTopbarStats(); navigate(); toast('Đã xóa tiến độ – bắt đầu lại từ đầu', '♻️');
    },
    'logout': () => window.ChemSession?.logout(),
    'close-modal': closeModal
  };

  function bindEvents() {
    window.addEventListener('hashchange', navigate);

    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (actionEl && ACTIONS[actionEl.dataset.action]) {
        toggleMenu(false);
        ACTIONS[actionEl.dataset.action](actionEl, e);
        return;
      }
      if (e.target.closest('#avatarBtn')) { toggleMenu(); return; }
      if (!e.target.closest('.menu-wrap')) toggleMenu(false);
    });

    $('#levelModal').addEventListener('click', (e) => { if (e.target.id === 'levelModal') closeModal(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { toggleMenu(false); if (!$('#levelModal').hidden) closeModal(); }
    });

    // Làm mới khi người dùng quay lại tab sau nửa đêm
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && DB.dailyReset()) { renderTopbarStats(); navigate(); }
    });
  }

  /* ---------- 10. KHỞI ĐỘNG ---------- */
  function init() {
    DB.dailyReset();
    renderNav();
    renderTopbarStats();
    bindEvents();
    if (!location.hash) history.replaceState(null, '', '#/home');
    navigate();
  }

  // API công khai cho các phân hệ (js/modules/*.js)
  window.ChemRescue = { DB, Modules, NAV, XP, Streak, Mastery, bus, toast, esc, download, navigate };

  // Bản kết nối máy chủ: session.js nạp lần lượt các phân hệ rồi mới gọi ChemRescue.start()
  // (khởi động sớm hơn sẽ mở phân hệ khi nó chưa kịp đăng ký → hiện khung chờ)
  window.ChemRescue.start = init;
  if (!window.ChemSession) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
