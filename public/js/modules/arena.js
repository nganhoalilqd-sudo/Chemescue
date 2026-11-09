/* =========================================================
   ChemRescue — Phân hệ 3: Đấu trường & Nhiệm vụ (Gamification)
   ---------------------------------------------------------
   Màn hình:
     #/arena        → Trạm: Streak (lịch 7 ngày + mốc), Daily Quests, rương thưởng, sảnh 1vs1
     #/arena/match  → Trận 1vs1: ghép đối thủ ẩn danh → 3·2·1 → 5 vòng × 15 giây → kết quả
   Luật đấu:
     • Mỗi bên 100 HP. Trả lời ĐÚNG gây sát thương = 10 + số giây còn lại (tối đa 25).
     • Trả lời sai / hết giờ: không gây sát thương.
     • Hết 5 vòng hoặc một bên về 0 HP → bên còn nhiều HP hơn thắng.
   Đối thủ (bot): trả lời ở thời điểm ngẫu nhiên trong khoảng speed_ms, đúng với xác suất skill.
   ========================================================= */
(() => {
  'use strict';

  const { DB, Modules, XP, Streak, toast, esc, bus } = window.ChemRescue;

  /* ---------- HẰNG SỐ ---------- */
  const ROUNDS = 5;
  const ROUND_MS = 15000;
  const CALC_MS = 40000;   // chỉ để hiển thị: câu tính toán trong db.js có time_ms: 40000
  const REVEAL_MS = 2300;
  const START_HP = 100;
  const QUEST_WIN = 4;
  const BADGE = { STREAK: 2, FAST: 5, FIGHTER: 6 };
  const MILESTONES = [3, 7, 14, 30];
  const CHEST_GEMS = 50;
  const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const LETTERS = ['A', 'B', 'C', 'D'];
  const SEARCH_FACES = ['🦊', '🐼', '🦉', '🐯', '🐸', '🐙', '🦄', '🐨'];
  const REWARD = { win: 50, draw: 25, lose: 15 };

  /* ---------- TIỆN ÍCH ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const uid = () => DB.currentUser().id;
  const today = () => DB.localDate();
  const pad = (n) => String(n).padStart(2, '0');
  const rand = (a, b) => a + Math.random() * (b - a);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const go = (hash) => { if (location.hash === hash) window.ChemRescue.navigate(); else location.hash = hash; };

  function unlockBadge(id) {
    if (DB.count('user_badges', { user_id: uid(), badge_id: id })) return;
    DB.insert('user_badges', { user_id: uid(), badge_id: id, unlocked_at: today() });
    const b = DB.get('badges', id);
    if (b) setTimeout(() => toast(`Mở khóa huy hiệu <b>${esc(b.name)}</b>`, b.icon, 3400), 600);
  }

  function bumpQuest(id, n = 1) {
    const q = DB.get('quests', id);
    if (q && q.progress < q.target) {
      const progress = Math.min(q.target, q.progress + n);
      DB.update('quests', id, { progress });
      if (progress === q.target) toast(`Hoàn thành nhiệm vụ: <b>${esc(q.title)}</b>. Vào Đấu trường để nhận thưởng!`, '🎯', 3200);
    }
  }

  /* ---------- NHẬT KÝ NGÀY HỌC (chạy toàn cục, không phụ thuộc màn hình đang mở) ---------- */
  // XP.add() → Streak.touch() → emit 'user:changed' ⇒ mọi hoạt động có EXP đều được ghi nhận ngày học
  bus.on('user:changed', () => {
    const u = DB.currentUser();
    if (!DB.count('activity_days', { user_id: u.id, date: today() })) {
      DB.insert('activity_days', { user_id: u.id, date: today() });
    }
    if (u.streak >= 7) unlockBadge(BADGE.STREAK);
  });

  /* ---------- VÒNG ĐỜI ---------- */
  let view = null;
  let cleanup = [];
  let M = null;           // trạng thái trận đấu

  const on = (el, evt, fn, opt) => { el.addEventListener(evt, fn, opt); cleanup.push(() => el.removeEventListener(evt, fn, opt)); };
  const every = (fn, ms) => { const id = setInterval(fn, ms); cleanup.push(() => clearInterval(id)); return id; };

  function teardown() {
    if (M) {
      const live = ['countdown', 'round', 'reveal'].includes(M.phase);
      stopMatchTimers();
      if (live) toast('Bạn đã rời trận. Trận này không được tính.', '🏳️', 2600);
      M = null;
    }
    cleanup.forEach((fn) => fn());
    cleanup = [];
  }

  /* =========================================================
     MÀN HÌNH 1 — TRẠM ĐẤU TRƯỜNG
     ========================================================= */
  function questHref(q) {
    const map = { diagnostic: '#/diagnostic', island: '#/island', arena: '#/arena/match' };
    return q.route?.includes('/') ? `#/${q.route}` : map[q.route] || '#/home';
  }

  function streakTier(n) {
    if (n >= 14) return 4;
    if (n >= 7) return 3;
    if (n >= 3) return 2;
    if (n >= 1) return 1;
    return 0;
  }

  function weekHTML() {
    const days = new Set(DB.select('activity_days', { user_id: uid() }).map((d) => d.date));
    const items = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = DB.localDate(d);
      const isToday = i === 0;
      const done = days.has(key);
      items.push(`
        <li class="ar-day ${done ? 'is-on' : ''} ${isToday ? 'is-today' : ''}" title="${pad(d.getDate())}/${pad(d.getMonth() + 1)}${done ? ': có học' : ''}">
          <span>${isToday ? 'Nay' : WEEKDAY[d.getDay()]}</span>
          <i aria-hidden="true">${done ? '🔥' : isToday ? '⏳' : ''}</i>
        </li>`);
    }
    return items.join('');
  }

  function milestonesHTML(streak) {
    const max = MILESTONES[MILESTONES.length - 1];
    const next = MILESTONES.find((m) => m > streak);
    // Vị trí % trên thanh dùng thang căn bậc hai để các mốc nhỏ không bị dồn sát nhau
    const pos = (v) => (Math.sqrt(Math.min(v, max)) / Math.sqrt(max)) * 100;
    return `
      <div class="ar-miles" aria-label="Mốc chuỗi ngày">
        <div class="ar-miles__track"><div class="ar-miles__fill" style="width:${pos(streak)}%"></div></div>
        ${MILESTONES.map((m) => `
          <span class="ar-mile ${streak >= m ? 'is-done' : ''}" style="left:${pos(m)}%">
            <i>${streak >= m ? '✓' : m === 7 ? '🏅' : '★'}</i><small>${m} ngày</small>
          </span>`).join('')}
      </div>
      <p class="ar-miles__note">${next ? `Còn <b>${next - streak}</b> ngày nữa tới mốc ${next} ngày${next === 7 ? ' (mở khóa huy hiệu “Lửa bền bỉ”)' : ''}.` : '🏆 Bạn đã vượt mọi mốc. Huyền thoại!'}</p>`;
  }

  function msToMidnight() {
    const now = new Date();
    const mid = new Date(now); mid.setHours(24, 0, 0, 0);
    return mid - now;
  }
  const fmtHMS = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };

  function renderStreak() {
    const box = $('#arStreak');
    if (!box) return;
    const u = DB.currentUser();
    const streak = Streak.display(u);
    const learnedToday = u.last_active === today();
    box.innerHTML = `
          <div class="ar-flame ar-flame--t${streakTier(streak)}" aria-label="Chuỗi ${streak} ngày">
            <span class="ar-flame__fire" aria-hidden="true">🔥</span>
            <b>${streak}</b>
            <small>ngày liên tiếp</small>
          </div>
          <div class="ar-streak__body">
            <h3>${learnedToday ? '🔥 Đã giữ lửa hôm nay!' : streak ? '⚠️ Học ngay để giữ chuỗi' : '🌱 Bắt đầu chuỗi mới'}</h3>
            <p class="dx-muted">${learnedToday
              ? 'Tuyệt vời! Quay lại vào ngày mai để chuỗi tiếp tục tăng.'
              : `Chỉ cần hoàn thành 1 hoạt động có EXP trước nửa đêm. Còn <b class="ar-live" data-countdown>${fmtHMS(msToMidnight())}</b>.`}</p>
            <ol class="ar-week">${weekHTML()}</ol>
            ${milestonesHTML(streak)}
          </div>
        `;
  }

  function renderHub() {
    const u = DB.currentUser();
    const matches = DB.select('arena_matches', { user_id: uid() }, { orderBy: 'id desc' });
    const rec = { win: 0, lose: 0, draw: 0 };
    matches.forEach((m) => { rec[m.result] += 1; });

    view.innerHTML = `
      <section class="mod-banner" data-mod="m3">
        <span class="mod-banner__icon" aria-hidden="true">⚔️</span>
        <div>
          <span class="tag">Phân hệ 3</span>
          <h2>Đấu trường & Nhiệm vụ</h2>
          <p>Giữ lửa mỗi ngày, hoàn thành nhiệm vụ để nhận EXP và kim cương, rồi so tài tốc độ trong trận 1vs1.</p>
        </div>
      </section>

      <div class="ar-hub">
        <section class="card ar-streak" id="arStreak"></section>

        <section class="card ar-lobby" data-mod="m3">
          <div class="ar-lobby__vs" aria-hidden="true">
            <span class="ar-ava ar-ava--me">${u.avatar}</span>
            <b>VS</b>
            <span class="ar-ava ar-ava--bot">❓</span>
          </div>
          <h3>Đấu trường 1vs1</h3>
          <p class="dx-muted">${ROUNDS} vòng, mỗi câu ${ROUND_MS / 1000} giây (câu tính toán ${CALC_MS / 1000} giây). Trả lời <b>đúng và nhanh</b> để gây nhiều sát thương hơn đối thủ ẩn danh.</p>
          <ul class="ar-record">
            <li class="is-win"><b>${rec.win}</b><span>Thắng</span></li>
            <li class="is-lose"><b>${rec.lose}</b><span>Thua</span></li>
            <li><b>${rec.draw}</b><span>Hòa</span></li>
          </ul>
          ${matches.length ? `<div class="ar-recent" aria-label="5 trận gần nhất">${matches.slice(0, 5).map((m) =>
            `<span class="ar-pill ar-pill--${m.result}" title="${esc(m.played_at)}">${{ win: 'T', lose: 'B', draw: 'H' }[m.result]}</span>`).join('')}</div>` : ''}
          <a class="btn ar-findbtn" href="#/arena/match" data-mod="m3">⚔️ Tìm đối thủ</a>
        </section>

        <section class="card ar-quests" id="arQuests"></section>
      </div>`;

    renderStreak();
    renderQuests();
    // EXP từ nhận thưởng → streak/ngày học thay đổi → vẽ lại khung Streak ngay
    cleanup.push(bus.on('user:changed', () => renderStreak()));

    every(() => {
      const ms = fmtHMS(msToMidnight());
      view.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = ms; });
    }, 1000);

    on(view, 'click', (e) => {
      const claim = e.target.closest('[data-claim]');
      if (claim) { claimQuest(Number(claim.dataset.claim), claim.closest('.ar-quest')); return; }
      if (e.target.closest('[data-ar="chest"]')) openChest();
    });
  }

  function renderQuests() {
    const quests = DB.select('quests');
    const total = quests.reduce((s, q) => s + q.exp_reward, 0);
    const claimedExp = quests.filter((q) => q.claimed).reduce((s, q) => s + q.exp_reward, 0);
    const claimedN = quests.filter((q) => q.claimed).length;
    const chestOpened = DB.meta().chest_date === today();
    const chestReady = claimedN === quests.length && !chestOpened;

    $('#arQuests').innerHTML = `
      <div class="card__head ar-quests__head">
        <div>
          <h3>🎯 Nhiệm vụ hằng ngày</h3>
          <p class="dx-muted">Làm mới sau <b class="ar-live" data-countdown>${fmtHMS(msToMidnight())}</b></p>
        </div>
        <div class="ar-qexp">
          <span>EXP nhiệm vụ hôm nay</span>
          <div class="ar-qexp__bar"><div class="ar-qexp__fill" style="width:${(claimedExp / total) * 100}%"></div></div>
          <b>${claimedExp}/${total} EXP</b>
        </div>
      </div>

      <ul class="ar-qlist">
        ${quests.map((q) => {
          const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
          const done = q.progress >= q.target;
          const state = q.claimed ? 'claimed' : done ? 'ready' : 'todo';
          const action = {
            claimed: '<span class="ar-qbtn ar-qbtn--done">✓ Đã nhận</span>',
            ready: `<button class="btn btn--sm ar-qbtn ar-qbtn--claim" data-claim="${q.id}">🎁 Nhận +${q.exp_reward} EXP</button>`,
            todo: `<a class="btn btn--ghost btn--sm ar-qbtn" href="${questHref(q)}">Làm ngay →</a>`
          }[state];
          return `
            <li class="ar-quest ar-quest--${state}">
              <span class="ar-quest__icon" aria-hidden="true">${q.claimed ? '✅' : q.icon}</span>
              <div class="ar-quest__body">
                <b>${esc(q.title)}</b>
                <div class="ar-quest__meta">
                  <div class="progress"><div class="progress__fill" style="width:${pct}%"></div></div>
                  <span>${Math.min(q.progress, q.target)}/${q.target}</span>
                </div>
              </div>
              <span class="ar-quest__reward">+${q.exp_reward} EXP<br><small>+5 💎</small></span>
              ${action}
            </li>`;
        }).join('')}
      </ul>

      <div class="ar-chest ${chestReady ? 'is-ready' : ''} ${chestOpened ? 'is-open' : ''}">
        <span class="ar-chest__icon" aria-hidden="true">${chestOpened ? '🪙' : '🎁'}</span>
        <div class="ar-chest__text">
          <b>${chestOpened ? 'Đã mở rương hôm nay' : 'Rương thưởng ngày'}</b>
          <span>${chestOpened ? `Bạn đã nhận +${CHEST_GEMS} 💎. Quay lại ngày mai nhé!` : chestReady ? 'Rương đã sẵn sàng!' : `Nhận thưởng đủ ${claimedN}/${quests.length} nhiệm vụ để mở · +${CHEST_GEMS} 💎`}</span>
        </div>
        ${chestReady ? '<button class="btn ar-chest__btn" data-ar="chest">Mở rương</button>' : ''}
      </div>`;
  }

  function floatText(anchor, text, cls = '') {
    if (!anchor || reduceMotion()) return;
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = `ar-float ${cls}`;
    el.textContent = text;
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top}px`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function claimQuest(id, card) {
    const q = DB.get('quests', id);
    if (!q || q.claimed || q.progress < q.target) return;
    DB.update('quests', id, { claimed: true });
    const u = DB.currentUser();
    DB.update('users', u.id, { gems: u.gems + 5 });
    floatText(card?.querySelector('[data-claim]'), `+${q.exp_reward} EXP`, 'ar-float--gold');
    XP.add(q.exp_reward, q.title);
    card?.classList.add('is-claiming');
    setTimeout(renderQuests, reduceMotion() ? 0 : 450);
  }

  function openChest() {
    const quests = DB.select('quests');
    if (DB.meta().chest_date === today() || quests.some((q) => !q.claimed)) return;
    DB.meta({ chest_date: today() });
    const u = DB.currentUser();
    DB.update('users', u.id, { gems: u.gems + CHEST_GEMS });
    const chest = $('.ar-chest');
    chest.classList.add('is-opening');
    floatText(chest.querySelector('.ar-chest__icon'), `+${CHEST_GEMS} 💎`, 'ar-float--gem');
    XP.add(20, 'Mở rương thưởng ngày');
    setTimeout(renderQuests, reduceMotion() ? 0 : 900);
  }

  /* =========================================================
     MÀN HÌNH 2 — TRẬN 1VS1
     ========================================================= */
  function stopMatchTimers() {
    if (!M) return;
    M.timers.forEach(clearTimeout);
    M.timers = [];
    cancelAnimationFrame(M.raf);
  }
  const later = (fn, ms) => { const id = setTimeout(fn, ms); M.timers.push(id); return id; };

  function pickBot() {
    const bots = DB.select('arena_bots');
    const lvl = DB.currentUser().level;
    // Ghép theo trình độ: cấp càng cao càng gặp đối thủ giỏi hơn
    const pool = bots.filter((b) => b.skill <= 0.55 + lvl * 0.06);
    const list = pool.length ? pool : bots;
    return list[Math.floor(Math.random() * list.length)];
  }

  const RECENT_KEEP = ROUNDS * 3;   // không lặp câu đã gặp trong 3 trận gần nhất
  const MAX_PER_TOPIC = 2;           // mỗi trận tối đa 2 câu cùng chủ đề → trải đều ≥ 3 chủ đề

  function buildRounds() {
    // Ưu tiên câu thuộc chủ đề yếu (từ lần chẩn đoán gần nhất), tránh câu vừa gặp, trải đều chủ đề
    const all = DB.select('questions');
    const recent = new Set(DB.meta().arena_recent || []);
    const fresh = all.filter((q) => !recent.has(q.id));
    const pool = fresh.length >= ROUNDS * 2 ? fresh : all;   // ngân hàng quá nhỏ → cho phép lặp
    const last = DB.select('quiz_attempts', { user_id: uid() }, { orderBy: 'id desc', limit: 1 })[0];
    const weight = (q) => (last ? 100 - (last.topic_scores[q.topic_id] ?? 50) : 50) + Math.random() * 80;

    const picked = [];
    const perTopic = {};
    for (const { q } of pool.map((q) => ({ q, w: weight(q) })).sort((a, b) => b.w - a.w)) {
      if ((perTopic[q.topic_id] || 0) >= MAX_PER_TOPIC) continue;
      perTopic[q.topic_id] = (perTopic[q.topic_id] || 0) + 1;
      picked.push(q);
      if (picked.length === ROUNDS) break;
    }

    // Ghi nhớ các câu vừa dùng (giữ RECENT_KEEP câu gần nhất)
    DB.meta({ arena_recent: [...picked.map((q) => q.id), ...(DB.meta().arena_recent || [])].slice(0, RECENT_KEEP) });
    return shuffle(picked).map((q) => ({ q, opts: shuffle(q.options.map((_, i) => i)) }));
  }

  function renderMatch() {
    const u = DB.currentUser();
    M = {
      phase: 'search', bot: pickBot(), rounds: buildRounds(), round: -1,
      hp: { me: START_HP, bot: START_HP }, pts: { me: 0, bot: 0 },
      log: [], cur: null, timers: [], raf: 0
    };

    view.innerHTML = `
      <section class="ar-match" data-mod="m3">
        <div class="isl-topline">
          <a class="isl-back ar-leave" href="#/arena"><span aria-hidden="true">←</span> Rời trận</a>
          <span class="isl-topline__title">Vòng <b id="arRound">–</b>/${ROUNDS}</span>
        </div>

        <div class="ar-stage">
          <div class="ar-fighter ar-fighter--me" id="arMe" style="--hp:100">
            <span class="ar-ava ar-ava--me">${u.avatar}</span>
            <b class="ar-fighter__name">Bạn</b>
            <span class="ar-fighter__pts"><b id="arMePts">0</b> điểm</span>
            <div class="ar-hp" aria-label="Máu của bạn"><div class="ar-hp__fill"></div><span class="ar-hp__txt" id="arMeHp">100</span></div>
            <span class="ar-status" id="arMeStatus"></span>
          </div>

          <div class="ar-center card" id="arCenter" aria-live="polite"></div>

          <div class="ar-fighter ar-fighter--bot" id="arBot" style="--hp:100">
            <span class="ar-ava ar-ava--bot" id="arBotAva">❓</span>
            <b class="ar-fighter__name" id="arBotName">Đang tìm…</b>
            <span class="ar-fighter__pts"><b id="arBotPts">0</b> điểm</span>
            <div class="ar-hp" aria-label="Máu đối thủ"><div class="ar-hp__fill"></div><span class="ar-hp__txt" id="arBotHp">100</span></div>
            <span class="ar-status" id="arBotStatus"></span>
          </div>
        </div>
      </section>`;

    showSearch();

    on(view, 'click', (e) => {
      const opt = e.target.closest('.ar-opt');
      if (opt) { playerAnswer(Number(opt.dataset.orig)); return; }
      const act = e.target.closest('[data-ar]');
      if (act?.dataset.ar === 'rematch') { teardown(); renderMatch(); }
    });
    on(document, 'keydown', (e) => {
      if (!M || M.phase !== 'round' || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const pos = '1234'.includes(k) ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
      if (k.length === 1 && pos >= 0 && M.cur && pos < M.cur.opts.length) { e.preventDefault(); playerAnswer(M.cur.opts[pos]); }
    });
  }

  /* ---------- Ghép đối thủ ---------- */
  function showSearch() {
    $('#arCenter').innerHTML = `
      <div class="ar-search">
        <div class="ar-radar" aria-hidden="true"><span></span><span></span><span></span><i>⚔️</i></div>
        <h3>Đang tìm đối thủ ngang tài…</h3>
        <p class="dx-muted">Đối thủ được ẩn danh để trận đấu công bằng</p>
      </div>`;
    const ava = $('#arBotAva');
    let k = 0;
    const spin = () => {
      if (!M || M.phase !== 'search') return;
      ava.textContent = SEARCH_FACES[k++ % SEARCH_FACES.length];
      later(spin, 140);
    };
    spin();
    later(() => {
      M.phase = 'found';
      ava.textContent = M.bot.avatar;
      ava.classList.add('is-reveal');
      $('#arBotName').textContent = M.bot.alias;
      $('#arCenter').innerHTML = `
        <div class="ar-search">
          <div class="ar-found" aria-hidden="true">${M.bot.avatar}</div>
          <h3>Đã tìm thấy: ${esc(M.bot.alias)}</h3>
          <p class="dx-muted">Độ khó: ${'★'.repeat(Math.round(M.bot.skill * 5))}${'☆'.repeat(5 - Math.round(M.bot.skill * 5))}</p>
        </div>`;
      later(() => whenNoModal(countdown), 1200);
    }, reduceMotion() ? 300 : 1900);
  }

  // Không bắt đầu đếm giờ khi hộp thoại (vd. "Lên cấp!") đang che màn hình
  function whenNoModal(fn) {
    const open = [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
    if (!open) fn();
    else later(() => whenNoModal(fn), 250);
  }

  function countdown() {
    M.phase = 'countdown';
    const steps = ['3', '2', '1', 'Bắt đầu!'];
    let i = 0;
    const tick = () => {
      if (!M) return;
      $('#arCenter').innerHTML = `<div class="ar-count" aria-live="assertive"><span class="${i === 3 ? 'is-go' : ''}">${steps[i]}</span></div>`;
      i += 1;
      if (i < steps.length) later(tick, 700);
      else later(nextRound, 650);
    };
    tick();
  }

  /* ---------- Vòng đấu ---------- */
  function nextRound() {
    M.round += 1;
    if (M.round >= ROUNDS || M.hp.me <= 0 || M.hp.bot <= 0) { endMatch(); return; }

    const R = M.rounds[M.round];
    // Thời gian mỗi câu: câu tính toán có time_ms riêng (vd 40 giây), câu khác 15 giây
    const limit = R.q.time_ms || ROUND_MS;
    M.cur = { ...R, limit, start: performance.now(), me: null, bot: null };
    M.phase = 'round';
    $('#arRound').textContent = M.round + 1;
    setStatus('me', ''); setStatus('bot', '');

    $('#arCenter').innerHTML = `
      <div class="ar-q">
        <div class="ar-timer" id="arTimer" style="--t:100"><b id="arSec">${Math.round(limit / 1000)}</b></div>
        <p class="ar-q__meta">Câu ${M.round + 1} · ${esc(DB.get('topics', R.q.topic_id)?.short || '')}</p>
        <h2 class="ar-q__text">${esc(R.q.text)}</h2>
        <div class="ar-opts">
          ${R.opts.map((orig, k) => `
            <button class="ar-opt" data-orig="${orig}">
              <span class="ar-opt__key">${LETTERS[k]}</span>
              <span class="ar-opt__text">${esc(R.q.options[orig])}</span>
              <span class="ar-opt__who"></span>
            </button>`).join('')}
        </div>
      </div>`;

    // Lịch trả lời của đối thủ
    const [lo, hi] = M.bot.speed_ms;
    const scale = limit / ROUND_MS; // câu dài hơn → đối thủ cũng "suy nghĩ" lâu hơn tương ứng
    const botAt = Math.min(limit - 400, rand(lo * scale, hi * scale));
    const botRight = Math.random() < M.bot.skill;
    later(() => botAnswer(botRight), botAt);

    // Đồng hồ đếm ngược chạy bằng requestAnimationFrame (chính xác, mượt)
    const timerEl = $('#arTimer'), secEl = $('#arSec');
    let lastSec = Math.round(limit / 1000);
    const frame = (now) => {
      if (!M || M.phase !== 'round') return;
      const left = Math.max(0, limit - (now - M.cur.start));
      timerEl.style.setProperty('--t', (left / limit) * 100);
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        secEl.textContent = sec;
        timerEl.classList.toggle('is-danger', sec <= 5);
        if (sec <= 5 && !reduceMotion()) { secEl.classList.remove('tick'); void secEl.offsetWidth; secEl.classList.add('tick'); }
      }
      if (left <= 0) { timeUp(); return; }
      M.raf = requestAnimationFrame(frame);
    };
    M.raf = requestAnimationFrame(frame);
  }

  const timeLeftMs = () => Math.max(0, M.cur.limit - (performance.now() - M.cur.start));
  // Sát thương 10 … 25 theo TỈ LỆ thời gian còn lại (câu 15 giây hay 40 giây đều công bằng)
  const damageFor = (leftMs) => 10 + Math.ceil((leftMs / M.cur.limit) * 15);

  function setStatus(who, html) {
    const el = $(who === 'me' ? '#arMeStatus' : '#arBotStatus');
    if (el) el.innerHTML = html;
  }

  function hit(target, dmg) {
    M.hp[target] = Math.max(0, M.hp[target] - dmg);
    const attacker = target === 'me' ? 'bot' : 'me';
    M.pts[attacker] += dmg;

    const box = $(target === 'me' ? '#arMe' : '#arBot');
    box.style.setProperty('--hp', M.hp[target]);
    $(target === 'me' ? '#arMeHp' : '#arBotHp').textContent = M.hp[target];
    $(attacker === 'me' ? '#arMePts' : '#arBotPts').textContent = M.pts[attacker];
    box.classList.toggle('is-low', M.hp[target] <= 30);
    if (!reduceMotion()) { box.classList.remove('is-hit'); void box.offsetWidth; box.classList.add('is-hit'); }
    floatText(box.querySelector('.ar-ava'), `−${dmg}`, 'ar-float--dmg');
  }

  function playerAnswer(orig) {
    if (!M || M.phase !== 'round' || M.cur.me) return;
    const left = timeLeftMs();
    const correct = orig === M.cur.q.answer;
    M.cur.me = { orig, correct, ms: Math.round(M.cur.limit - left) };

    view.querySelectorAll('.ar-opt').forEach((b) => { b.disabled = true; });
    const btn = view.querySelector(`.ar-opt[data-orig="${orig}"]`);
    btn.classList.add('is-mine', correct ? 'is-right' : 'is-wrong');

    if (correct) {
      const dmg = damageFor(left);
      hit('bot', dmg);
      setStatus('me', `<span class="ar-st ar-st--ok">✓ Đúng · ${(M.cur.me.ms / 1000).toFixed(1)}s</span>`);
    } else {
      setStatus('me', '<span class="ar-st ar-st--bad">✕ Sai</span>');
    }
    if (M.cur.bot || M.hp.bot <= 0) reveal();
    else $('#arCenter .ar-q__meta').insertAdjacentHTML('beforeend', ' · <span class="ar-wait">Đang chờ đối thủ…</span>');
  }

  function botAnswer(right) {
    if (!M || M.phase !== 'round' || M.cur.bot) return;
    const left = timeLeftMs();
    const wrongs = M.cur.q.options.map((_, i) => i).filter((i) => i !== M.cur.q.answer);
    const orig = right ? M.cur.q.answer : wrongs[Math.floor(Math.random() * wrongs.length)];
    M.cur.bot = { orig, correct: right, ms: Math.round(M.cur.limit - left) };

    setStatus('bot', '<span class="ar-st">⚡ Đã chốt đáp án!</span>');
    if (right) hit('me', damageFor(left));
    if (M.cur.me || M.hp.me <= 0) reveal();
  }

  function timeUp() {
    if (!M || M.phase !== 'round') return;
    if (!M.cur.me) {
      M.cur.me = { orig: null, correct: false, ms: M.cur.limit };
      setStatus('me', '<span class="ar-st ar-st--bad">⏰ Hết giờ</span>');
    }
    if (!M.cur.bot) M.cur.bot = { orig: null, correct: false, ms: M.cur.limit };
    reveal();
  }

  function reveal() {
    if (M.phase !== 'round') return;
    M.phase = 'reveal';
    cancelAnimationFrame(M.raf);
    M.timers.forEach(clearTimeout); M.timers = [];

    const { q, me, bot } = M.cur;
    view.querySelectorAll('.ar-opt').forEach((b) => {
      b.disabled = true;
      const o = Number(b.dataset.orig);
      if (o === q.answer) b.classList.add('is-answer');
      if (bot?.orig === o) b.querySelector('.ar-opt__who').innerHTML = `<span class="ar-opt__bot" title="${esc(M.bot.alias)}">${M.bot.avatar}</span>`;
    });
    if (bot?.orig != null) setStatus('bot', bot.correct
      ? `<span class="ar-st ar-st--ok">✓ Đúng · ${(bot.ms / 1000).toFixed(1)}s</span>`
      : '<span class="ar-st ar-st--bad">✕ Sai</span>');
    else setStatus('bot', '<span class="ar-st ar-st--bad">⏰ Hết giờ</span>');

    $('#arCenter .ar-wait')?.remove();
    $('#arCenter .ar-q').insertAdjacentHTML('beforeend', `<p class="ar-explain">💡 ${esc(q.explain)}</p>`);

    M.log.push({ qid: q.id, me: me || { orig: null, correct: false, ms: M.cur.limit }, bot });
    later(nextRound, REVEAL_MS);
  }

  /* ---------- Kết thúc trận ---------- */
  function endMatch() {
    M.phase = 'end';
    stopMatchTimers();
    const result = M.hp.me > M.hp.bot ? 'win' : M.hp.me < M.hp.bot ? 'lose' : 'draw';
    const answered = M.log.filter((l) => l.me.orig !== null);
    const correct = M.log.filter((l) => l.me.correct).length;
    const avgMs = answered.length ? Math.round(answered.reduce((s, l) => s + l.me.ms, 0) / answered.length) : 0;
    const exp = REWARD[result] + correct * 5;
    const gems = result === 'win' ? 10 : 0;

    DB.insert('arena_matches', {
      user_id: uid(), bot_id: M.bot.id, result,
      my_hp: M.hp.me, bot_hp: M.hp.bot, correct, total: M.log.length, avg_ms: avgMs,
      played_at: `${today()} ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`
    });
    if (gems) { const u = DB.currentUser(); DB.update('users', u.id, { gems: u.gems + gems }); }
    if (result === 'win') bumpQuest(QUEST_WIN, 1);
    const u = DB.currentUser();
    DB.update('users', u.id, { module_progress: { ...u.module_progress, arena: Math.min(100, (u.module_progress.arena || 0) + (result === 'win' ? 10 : 5)) } });
    XP.add(exp, { win: 'Chiến thắng Đấu trường', draw: 'Hòa trận Đấu trường', lose: 'Hoàn thành trận đấu' }[result]);

    if (DB.count('arena_matches', { user_id: uid(), result: 'win' }) >= 5) unlockBadge(BADGE.FIGHTER);
    if (M.log.some((l) => l.me.correct && l.me.ms <= 3000)) unlockBadge(BADGE.FAST);
    bus.emit('arena:finished', { result, correct });

    $('#arMe').classList.toggle('is-winner', result === 'win');
    $('#arBot').classList.toggle('is-winner', result === 'lose');
    $('#arRound').parentElement.textContent = 'Kết thúc trận';

    const title = { win: '🏆 CHIẾN THẮNG!', lose: '💥 THẤT BẠI', draw: '🤝 HÒA' }[result];
    const sub = {
      win: M.hp.bot <= 0 ? 'Hạ gục đối thủ! Phản xạ hóa học tuyệt vời.' : 'Bạn trụ vững và áp đảo về sát thương.',
      lose: 'Đối thủ nhanh hơn một nhịp. Ôn lại các câu sai rồi phục thù nhé!',
      draw: 'Ngang tài ngang sức! Thêm một trận để phân thắng bại?'
    }[result];

    $('#arCenter').innerHTML = `
      <div class="ar-end ar-end--${result}">
        <h2>${title}</h2>
        <p class="dx-muted">${sub}</p>
        <ul class="ar-end__stats">
          <li><b>${correct}/${M.log.length}</b><span>Câu đúng</span></li>
          <li><b>${avgMs ? (avgMs / 1000).toFixed(1) + 's' : '—'}</b><span>Tốc độ TB</span></li>
          <li><b>${M.pts.me}</b><span>Sát thương</span></li>
        </ul>
        <p class="ar-end__reward">⚡ +${exp} EXP${gems ? ` · 💎 +${gems}` : ''}</p>
        <ol class="ar-end__log">
          <li class="ar-end__logh"><span></span><i>Bạn</i><i>${M.bot.avatar}</i></li>
          ${M.log.map((l, i) => `
            <li>
              <span>Câu ${i + 1}</span>
              <i class="${l.me.correct ? 'ok' : 'bad'}" title="Bạn">${l.me.correct ? '✓' : '✕'}</i>
              <i class="${l.bot?.correct ? 'ok' : 'bad'}" title="Đối thủ">${l.bot?.correct ? '✓' : '✕'}</i>
            </li>`).join('')}
        </ol>
        <div class="dx-actions">
          <a class="btn btn--ghost" href="#/arena">🏟️ Về Đấu trường</a>
          <button class="btn" data-mod="m3" data-ar="rematch">⚔️ Đấu trận mới</button>
        </div>
      </div>`;
  }

  /* =========================================================
     ĐĂNG KÝ PHÂN HỆ
     ========================================================= */
  Modules.register('arena', {
    render(container, { params = [] } = {}) {
      teardown();
      view = container;
      if (params[0] === 'match') return renderMatch();
      renderHub();
    },
    unmount() { teardown(); }
  });
})();
