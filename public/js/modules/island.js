/* =========================================================
   ChemRescue — Phân hệ 2: Đảo Cứu Nguy (Học tập cốt lõi)
   ---------------------------------------------------------
   Màn hình:
     #/island                     → Trạm chính (tổng quan 2 trạm)
     #/island/flashcard[/topic]   → Trạm Flashcard 3D + lặp lại ngắt quãng
     #/island/lab                 → Xưởng ghép chất ion (Drag & Drop)
   Thuật toán:
     • Lặp lại ngắt quãng: biến thể SM-2 (ease, interval, reps, lapses).
       "Quên" → thẻ quay lại sau ~3 thẻ trong cùng phiên.
     • Xưởng ion: Σ điện tích = 0, đúng 1 loại cation + 1 loại anion,
       tỉ lệ tối giản (ƯCLN = 1) → phát sáng + công thức + tên gọi.
   ========================================================= */
(() => {
  'use strict';

  const { DB, Modules, XP, Mastery, toast, esc, bus } = window.ChemRescue;

  /* ---------- HẰNG SỐ ---------- */
  const QUEST = { CARDS: 2, LAB: 3 };
  const BADGE = { MEMORY: 7, ALCHEMIST: 8 };
  const NEW_PER_SESSION = 10;     // số thẻ mới tối đa mỗi phiên
  const AGAIN_GAP = 3;            // thẻ "Quên" quay lại sau 3 thẻ
  const MAX_PER_ION = 6;          // giới hạn số ion cùng loại trong lò
  const METER_RANGE = 6;

  const GRADES = [
    { id: 'again', label: 'Quên', key: '1' },
    { id: 'hard',  label: 'Khó',  key: '2' },
    { id: 'good',  label: 'Nhớ',  key: '3' },
    { id: 'easy',  label: 'Dễ',   key: '4' }
  ];

  // Cặp ion cân bằng điện tích nhưng KHÔNG tồn tại/không bền trong thực tế
  const UNSTABLE = {
    'Al|CO3':  'Aluminium carbonate Al₂(CO₃)₃ không tồn tại: gặp nước bị phân hủy tạo Al(OH)₃↓ và CO₂↑.',
    'Fe3|CO3': 'Iron(III) carbonate Fe₂(CO₃)₃ không tồn tại: gặp nước bị phân hủy tạo Fe(OH)₃↓ và CO₂↑.',
    'NH4|OH':  '“NH₄OH” thực chất là dung dịch ammonia (NH₃) trong nước, không tách được thành chất rắn.',
    'NH4|O':   'Không tồn tại oxide của ion ammonium.'
  };

  /* ---------- TIỆN ÍCH ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const uid = () => DB.currentUser().id;
  const today = () => DB.localDate();
  const addDays = (n) => DB.daysAgo(-n);
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const go = (hash) => { if (location.hash === hash) window.ChemRescue.navigate(); else location.hash = hash; };

  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
  const subHTML = (f) => esc(f).replace(/(\d+)/g, '<sub>$1</sub>');
  const subText = (f) => String(f).replace(/\d/g, (d) => SUB[d]);
  const chargeText = (c) => `${Math.abs(c) === 1 ? '' : Math.abs(c)}${c > 0 ? '+' : '−'}`;
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

  function intervalLabel(days) {
    if (days <= 0) return '< 10 phút';
    if (days < 30) return `${days} ngày`;
    return `${Math.round(days / 30)} tháng`;
  }

  /* ---------- PHẦN THƯỞNG DÙNG CHUNG ---------- */
  function bumpQuest(id, n = 1) {
    const q = DB.get('quests', id);
    if (q && q.progress < q.target) {
      const progress = Math.min(q.target, q.progress + n);
      DB.update('quests', id, { progress });
      if (progress === q.target) toast(`Hoàn thành nhiệm vụ: <b>${esc(q.title)}</b>`, '🎯', 3000);
    }
  }

  function unlockBadge(id) {
    if (DB.count('user_badges', { user_id: uid(), badge_id: id })) return;
    DB.insert('user_badges', { user_id: uid(), badge_id: id, unlocked_at: today() });
    const b = DB.get('badges', id);
    if (b) setTimeout(() => toast(`Mở khóa huy hiệu <b>${esc(b.name)}</b>`, b.icon, 3400), 600);
  }

  // Tiến độ phân hệ: 50% từ số thẻ đã thuộc + 50% từ số hợp chất khám phá (mốc 20). Không bao giờ giảm.
  function syncProgress() {
    const total = DB.count('flashcards') || 1;
    const learned = DB.count('flashcard_reviews', (r) => r.user_id === uid() && r.interval >= 1);
    const found = DB.count('lab_discoveries', { user_id: uid() });
    const pct = Math.round((50 * learned) / total + 50 * Math.min(1, found / 20));
    const u = DB.currentUser();
    if (pct > (u.module_progress.island || 0)) {
      DB.update('users', u.id, { module_progress: { ...u.module_progress, island: Math.min(100, pct) } });
    }
  }

  /* ---------- VÒNG ĐỜI PHÂN HỆ ---------- */
  let view = null;
  let cleanup = [];
  let FC = null;    // phiên flashcard
  let LAB = null;   // trạng thái xưởng
  let tMap = new Map();
  let ionMap = new Map();

  const on = (el, evt, fn, opt) => { el.addEventListener(evt, fn, opt); cleanup.push(() => el.removeEventListener(evt, fn, opt)); };

  function teardown() {
    if (FC) awardFlashcards();
    cleanup.forEach((fn) => fn());
    cleanup = [];
    document.querySelectorAll('.ion--ghost').forEach((g) => g.remove());
    FC = null;
    LAB = null;
  }

  function topline(title) {
    return `
      <div class="isl-topline">
        <a class="isl-back" href="#/island"><span aria-hidden="true">←</span> Đảo Cứu Nguy</a>
        <span class="isl-topline__title">${title}</span>
      </div>`;
  }

  /* =========================================================
     LẶP LẠI NGẮT QUÃNG (SM-2 rút gọn)
     ========================================================= */
  function schedule(prev, grade) {
    const r = { ease: 2.5, interval: 0, reps: 0, lapses: 0, review_count: 0, ...prev };
    r.review_count += 1;
    r.last_review = today();

    if (grade === 'again') {
      r.reps = 0; r.lapses += 1; r.interval = 0;
      r.ease = Math.max(1.3, r.ease - 0.2);
    } else {
      if (grade === 'hard') {
        r.interval = r.reps === 0 ? 1 : Math.max(r.interval + 1, Math.round(r.interval * 1.2));
        r.ease = Math.max(1.3, r.ease - 0.15);
      } else if (grade === 'good') {
        r.interval = r.reps === 0 ? 1 : r.reps === 1 ? Math.max(3, r.interval + 1) : Math.max(r.interval + 1, Math.round(r.interval * r.ease));
      } else if (grade === 'easy') {
        r.interval = r.reps === 0 ? 3 : Math.max(r.interval + 2, Math.round(Math.max(r.interval, 1) * r.ease * 1.3));
        r.ease += 0.15;
      }
      r.reps += 1;
    }
    r.ease = Math.round(r.ease * 100) / 100;
    r.due = addDays(r.interval);
    return r;
  }

  const reviewOf = (cardId) => DB.select('flashcard_reviews', { user_id: uid(), card_id: cardId })[0];

  function deckStats(topic) {
    const cards = DB.select('flashcards', topic ? { topic_id: topic } : null);
    const reviews = new Map(DB.select('flashcard_reviews', { user_id: uid() }).map((r) => [r.card_id, r]));
    const t = today();
    let due = 0, fresh = 0, learned = 0;
    cards.forEach((c) => {
      const r = reviews.get(c.id);
      if (!r) fresh += 1;
      else {
        if (r.due <= t) due += 1;
        if (r.interval >= 7) learned += 1;
      }
    });
    return { total: cards.length, due, fresh, learned };
  }

  function buildQueue(topic) {
    const cards = DB.select('flashcards', topic ? { topic_id: topic } : null);
    const reviews = new Map(DB.select('flashcard_reviews', { user_id: uid() }).map((r) => [r.card_id, r]));
    const t = today();
    const due = [], fresh = [];
    cards.forEach((c) => {
      const r = reviews.get(c.id);
      if (!r) fresh.push(c.id);
      else if (r.due <= t) due.push(r);
    });
    due.sort((a, b) => (a.due < b.due ? -1 : 1)); // quá hạn lâu nhất lên trước
    return [...due.map((r) => r.card_id), ...shuffle(fresh).slice(0, NEW_PER_SESSION)];
  }

  /* =========================================================
     MÀN HÌNH 1 — TRẠM CHÍNH
     ========================================================= */
  function renderHub() {
    const fc = deckStats(null);
    const found = DB.count('lab_discoveries', { user_id: uid() });
    const possible = validPairs().length;
    const last = DB.select('quiz_attempts', { user_id: uid() }, { orderBy: 'id desc', limit: 1 })[0];

    const focus = last
      ? [...tMap.values()]
          .map((t) => ({ t, pct: last.topic_scores[t.id] }))
          .filter((x) => x.pct != null && Mastery.level(x.pct) !== 'ok')
          .sort((a, b) => a.pct - b.pct)
      : [];

    const focusHTML = focus.length
      ? focus.map(({ t, pct }) => {
          const lvl = Mastery.level(pct);
          const s = deckStats(t.id);
          return `
            <a class="isl-focus__item isl-focus__item--${lvl}" href="#/island/flashcard/${t.id}">
              <span class="isl-focus__icon" aria-hidden="true">${t.icon}</span>
              <span class="isl-focus__name"><b>${esc(t.name)}</b><small>${s.due + s.fresh} thẻ cần học · chẩn đoán ${pct}%</small></span>
              <span class="tag tag--${lvl}">${Mastery.label(lvl)}</span>
            </a>`;
        }).join('')
      : `<p class="dx-muted">${last ? '🎉 Không có chủ đề nào dưới 80%. Ôn tự do để giữ phong độ nhé!' : 'Làm bài ở Phòng chẩn đoán để nhận gợi ý chủ đề cần ôn.'}</p>`;

    view.innerHTML = `
      <section class="mod-banner" data-mod="m2">
        <span class="mod-banner__icon" aria-hidden="true">🏝️</span>
        <div>
          <span class="tag">Phân hệ 2</span>
          <h2>Đảo Cứu Nguy</h2>
          <p>Hai trạm học cốt lõi: ghi nhớ lâu bằng Flashcard ôn đúng lúc sắp quên, và hiểu bản chất bằng cách tự tay ghép ion thành hợp chất.</p>
        </div>
      </section>

      <section class="isl-stations">
        <a class="isl-station" href="#/island/flashcard" data-mod="m2">
          <div class="isl-station__art isl-station__art--cards" aria-hidden="true"><span></span><span></span><span>🃏</span></div>
          <div class="isl-station__body">
            <span class="tag">Trạm 1</span>
            <h3>Trạm Flashcard 3D</h3>
            <p>Lật thẻ, tự chấm mức nhớ. Thuật toán tự tính ngày ôn tiếp theo cho từng thẻ.</p>
            <ul class="isl-stats">
              <li><b>${fc.due}</b><span>Đến hạn</span></li>
              <li><b>${fc.fresh}</b><span>Thẻ mới</span></li>
              <li><b>${fc.learned}/${fc.total}</b><span>Đã thuộc</span></li>
            </ul>
            <span class="btn" data-mod="m2">${fc.due + fc.fresh ? `▶ Ôn ${Math.min(fc.due + Math.min(fc.fresh, NEW_PER_SESSION), 99)} thẻ hôm nay` : '✓ Đã ôn xong hôm nay'}</span>
          </div>
        </a>

        <a class="isl-station" href="#/island/lab" data-mod="m1">
          <div class="isl-station__art isl-station__art--lab" aria-hidden="true"><span>Na⁺</span><span>⚗️</span><span>Cl⁻</span></div>
          <div class="isl-station__body">
            <span class="tag">Trạm 2</span>
            <h3>Xưởng ghép chất ion</h3>
            <p>Kéo cation (+) và anion (−) vào lò phản ứng. Cân bằng điện tích để điều chế hợp chất.</p>
            <ul class="isl-stats">
              <li><b>${found}/${possible}</b><span>Hợp chất</span></li>
              <li><b>${DB.count('ions', { type: 'cation' })}</b><span>Cation</span></li>
              <li><b>${DB.count('ions', { type: 'anion' })}</b><span>Anion</span></li>
            </ul>
            <span class="btn" data-mod="m1">⚗️ Vào xưởng</span>
          </div>
        </a>
      </section>

      <section class="card isl-focus">
        <div class="card__head">
          <div><h3>🎯 Ưu tiên theo bản đồ nhiệt</h3><p class="dx-muted">Chủ đề yếu nhất từ lần chẩn đoán gần nhất</p></div>
          <a href="#/diagnostic${last ? '/result' : ''}">${last ? 'Xem bản đồ nhiệt →' : 'Làm chẩn đoán →'}</a>
        </div>
        <div class="isl-focus__list">${focusHTML}</div>
      </section>`;
  }

  /* =========================================================
     MÀN HÌNH 2 — TRẠM FLASHCARD 3D
     ========================================================= */
  function renderFlashcards(topic, cram = false) {
    if (topic && !tMap.has(topic)) topic = null;
    const queue = cram
      ? shuffle(DB.select('flashcards', topic ? { topic_id: topic } : null).map((c) => c.id))
      : buildQueue(topic);
    FC = {
      topic, cram, queue,
      idx: 0, flipped: false, reviewed: 0, awarded: false,
      stats: { again: 0, hard: 0, good: 0, easy: 0 },
      cards: new Map(DB.select('flashcards').map((c) => [c.id, c]))
    };

    view.innerHTML = `
      <section class="isl-fc" data-mod="m2">
        ${topline('🃏 Trạm Flashcard 3D')}
        <nav class="isl-decks" id="fcDecks" aria-label="Chọn bộ thẻ">${decksHTML(topic)}</nav>

        <div class="card isl-fc__bar">
          <span class="isl-fc__count" id="fcCount"></span>
          <div class="progress"><div class="progress__fill" id="fcProg" style="width:0"></div></div>
          ${cram ? '<span class="tag">Luyện tự do · không đổi lịch</span>' : `<span class="isl-fc__mix" id="fcMix"></span>`}
        </div>

        <div class="isl-scene" id="fcScene"></div>
        <div class="isl-rate" id="fcRate" aria-live="polite"></div>
      </section>`;

    if (!queue.length) renderDeckDone();
    else showCard(0);

    on(view, 'click', onFlashClick);
    on(document, 'keydown', onFlashKey);
  }

  function decksHTML(topic) {
    const chip = (id, label) => {
      const s = deckStats(id);
      const n = s.due + s.fresh;
      const active = (id || null) === (topic || null);
      return `<a class="isl-deck${active ? ' is-active' : ''}" href="#/island/flashcard${id ? '/' + id : ''}" ${active ? 'aria-current="page"' : ''}>
                ${label}${n ? `<span class="isl-deck__n">${n}</span>` : ''}</a>`;
    };
    return chip(null, '📚 Tất cả') + [...tMap.values()].map((t) => chip(t.id, `${t.icon} ${esc(t.short)}`)).join('');
  }

  function refreshDeckCounts() {
    const nav = $('#fcDecks');
    if (nav && FC) nav.innerHTML = decksHTML(FC.topic);
  }

  function updateFcBar() {
    const total = FC.queue.length;
    const done = Math.min(FC.idx, total);
    $('#fcCount').innerHTML = total ? `Thẻ <b>${Math.min(FC.idx + 1, total)}</b>/${total}` : 'Không có thẻ';
    $('#fcProg').style.width = `${total ? (done / total) * 100 : 100}%`;
    const mix = $('#fcMix');
    if (mix) {
      const rest = FC.queue.slice(FC.idx);
      const fresh = rest.filter((id) => !reviewOf(id)).length;
      mix.innerHTML = `<span title="Thẻ mới">🆕 ${fresh}</span><span title="Thẻ ôn">🔁 ${rest.length - fresh}</span>`;
    }
  }

  function cardHTML(card) {
    const t = tMap.get(card.topic_id);
    const r = FC.cram ? null : reviewOf(card.id);
    const badge = r ? (r.lapses ? `🔁 Ôn lại · từng quên ${r.lapses} lần` : '🔁 Ôn tập') : '🆕 Thẻ mới';
    return `
      <div class="isl-card__inner">
        <div class="isl-face isl-face--front">
          <div class="isl-face__top"><span class="tag">${t.icon} ${esc(t.short)}</span><span class="isl-face__badge">${badge}</span></div>
          ${card.visual ? `<div class="isl-visual">${esc(card.visual)}</div>` : `<div class="isl-visual isl-visual--icon">${t.icon}</div>`}
          <p class="isl-face__q">${esc(card.front)}</p>
          <span class="isl-face__hint">Chạm để lật thẻ ↻</span>
        </div>
        <div class="isl-face isl-face--back">
          <div class="isl-face__top"><span class="tag">Đáp án</span><span class="isl-face__badge">${esc(t.name)}</span></div>
          <p class="isl-face__q isl-face__q--small">${esc(card.front)}</p>
          <p class="isl-face__a">${esc(card.back)}</p>
          <span class="isl-face__hint">Bạn nhớ thẻ này ở mức nào?</span>
        </div>
      </div>`;
  }

  function showCard(dir) {
    const scene = $('#fcScene');
    const card = FC.cards.get(FC.queue[FC.idx]);
    FC.flipped = false;

    scene.querySelectorAll('.isl-card.is-leaving, .isl-empty').forEach((n) => n.remove());
    const old = scene.querySelector('.isl-card');
    if (old) {
      if (reduceMotion()) old.remove();
      else {
        old.classList.add('is-leaving', dir < 0 ? 'fly-left' : 'fly-right');
        old.setAttribute('aria-hidden', 'true');
        old.tabIndex = -1;
        setTimeout(() => old.remove(), 450);
      }
    }

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'isl-card' + (reduceMotion() ? '' : ' is-entering');
    el.setAttribute('aria-pressed', 'false');
    el.setAttribute('aria-label', `Thẻ: ${card.front}. Nhấn để lật xem đáp án.`);
    el.innerHTML = cardHTML(card);
    scene.appendChild(el);

    updateFcBar();
    renderRate();
  }

  function flip() {
    const el = $('#fcScene .isl-card:not(.is-leaving)');
    if (!el) return;
    FC.flipped = !FC.flipped;
    el.classList.toggle('is-flipped', FC.flipped);
    el.classList.remove('is-entering');
    el.setAttribute('aria-pressed', String(FC.flipped));
    const card = FC.cards.get(FC.queue[FC.idx]);
    el.setAttribute('aria-label', FC.flipped ? `Đáp án: ${card.back}` : `Thẻ: ${card.front}. Nhấn để lật xem đáp án.`);
    renderRate();
  }

  function renderRate() {
    const box = $('#fcRate');
    if (!FC.flipped) {
      box.innerHTML = `
        <button class="btn isl-flipbtn" data-isl="flip" data-mod="m2">↻ Lật thẻ</button>
        <p class="isl-keys dx-only-kbd"><kbd>Space</kbd> lật thẻ · <kbd>1</kbd>–<kbd>4</kbd> chấm mức nhớ</p>`;
      return;
    }
    const prev = FC.cram ? null : reviewOf(FC.queue[FC.idx]);
    box.innerHTML = `<div class="isl-grades">${GRADES.map((g) => {
      const preview = FC.cram ? '' : intervalLabel(schedule(prev, g.id).interval);
      return `<button class="isl-grade isl-grade--${g.id}" data-grade="${g.id}">
                <b>${g.label}</b>${preview ? `<small>${preview}</small>` : ''}<kbd>${g.key}</kbd>
              </button>`;
    }).join('')}</div>`;
  }

  function rate(grade) {
    if (!FC || !FC.flipped || FC.idx >= FC.queue.length) return; // chặn chấm sau khi phiên đã kết thúc
    const cardId = FC.queue[FC.idx];
    FC.stats[grade] += 1;
    FC.reviewed += 1;

    if (!FC.cram) {
      const prev = reviewOf(cardId);
      const next = schedule(prev, grade);
      if (prev) DB.update('flashcard_reviews', prev.id, next);
      else DB.insert('flashcard_reviews', { ...next, user_id: uid(), card_id: cardId });
    }
    if (grade === 'again') FC.queue.splice(Math.min(FC.queue.length, FC.idx + 1 + AGAIN_GAP), 0, cardId);

    bumpQuest(QUEST.CARDS, 1);
    FC.idx += 1;
    if (FC.idx >= FC.queue.length) finishDeck(grade);
    else showCard(grade === 'again' ? -1 : 1);
  }

  function awardFlashcards() {
    if (!FC || FC.awarded || !FC.reviewed) return null;
    FC.awarded = true;
    const exp = FC.reviewed * 2 + (FC.reviewed >= 5 ? 10 : 0);
    XP.add(exp, `Ôn ${FC.reviewed} thẻ Flashcard`);
    const totalReviews = DB.select('flashcard_reviews', { user_id: uid() }).reduce((s, r) => s + (r.review_count || 0), 0);
    if (totalReviews >= 100) unlockBadge(BADGE.MEMORY);
    syncProgress();
    bus.emit('flashcards:reviewed', { count: FC.reviewed, stats: { ...FC.stats } });
    return exp;
  }

  function finishDeck(lastGrade) {
    FC.flipped = false;
    const exp = awardFlashcards();
    refreshDeckCounts();
    const s = FC.stats;
    const total = s.again + s.hard + s.good + s.easy;
    const recall = total ? Math.round(((s.good + s.easy + s.hard * 0.5) / total) * 100) : 0;
    const upcoming = DB.select('flashcard_reviews', (r) => r.user_id === uid() && r.due > today(), { orderBy: 'due asc', limit: 1 })[0];

    const scene = $('#fcScene');
    const old = scene.querySelector('.isl-card');
    if (old) { old.classList.add('is-leaving', lastGrade === 'again' ? 'fly-left' : 'fly-right'); setTimeout(() => old.remove(), 450); }

    const el = document.createElement('div');
    el.className = 'card isl-empty isl-summary';
    el.innerHTML = `
      <div class="isl-summary__icon" aria-hidden="true">🏁</div>
      <h3>Hoàn thành phiên ôn!</h3>
      <p>Bạn đã ôn <b>${FC.reviewed}</b> lượt thẻ · tỉ lệ nhớ <b>${recall}%</b>${exp ? ` · <b class="isl-exp">+${exp} EXP</b>` : ''}</p>
      <ul class="isl-summary__grid">
        ${GRADES.map((g) => `<li class="isl-grade--${g.id}"><b>${s[g.id]}</b><span>${g.label}</span></li>`).join('')}
      </ul>
      ${!FC.cram && upcoming ? `<p class="dx-muted">📅 Lượt ôn tiếp theo: ${upcoming.due.split('-').reverse().join('/')}. Thuật toán sẽ nhắc đúng lúc bạn sắp quên.</p>` : ''}
      <div class="dx-actions">
        <a class="btn btn--ghost" href="#/island">🏝️ Về Đảo</a>
        <a class="btn" data-mod="m1" href="#/island/lab">⚗️ Sang Xưởng ion</a>
      </div>`;
    scene.appendChild(el);
    $('#fcRate').innerHTML = '';
    $('#fcCount').innerHTML = 'Đã xong';
    $('#fcProg').style.width = '100%';
    const mix = $('#fcMix'); if (mix) mix.innerHTML = '';
  }

  function renderDeckDone() {
    const next = DB.select('flashcard_reviews', (r) => r.user_id === uid() && r.due > today() &&
      (!FC.topic || FC.cards.get(r.card_id)?.topic_id === FC.topic), { orderBy: 'due asc', limit: 1 })[0];
    $('#fcScene').innerHTML = `
      <div class="card isl-empty">
        <div class="isl-summary__icon" aria-hidden="true">🎉</div>
        <h3>Đã ôn hết thẻ đến hạn của bộ này</h3>
        <p class="dx-muted">${next ? `Lượt ôn tiếp theo vào ${next.due.split('-').reverse().join('/')}. ` : ''}Ôn quá sớm không giúp nhớ lâu hơn, nhưng bạn vẫn có thể luyện tự do (không thay đổi lịch ôn).</p>
        <div class="dx-actions">
          <button class="btn btn--ghost" data-isl="cram">🔀 Luyện tự do</button>
          <a class="btn" data-mod="m1" href="#/island/lab">⚗️ Sang Xưởng ion</a>
        </div>
      </div>`;
    $('#fcRate').innerHTML = '';
    updateFcBar();
  }

  function onFlashClick(e) {
    const grade = e.target.closest('[data-grade]');
    if (grade) { rate(grade.dataset.grade); return; }
    if (e.target.closest('.isl-card:not(.is-leaving)') || e.target.closest('[data-isl="flip"]')) { flip(); return; }
    if (e.target.closest('[data-isl="cram"]')) {
      const topic = FC.topic;
      teardown();
      renderFlashcards(topic, true);
    }
  }

  function onFlashKey(e) {
    if (!FC || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches('input, textarea, select')) return;
    const onButton = e.target.closest('button, a');
    if ((e.key === ' ' || e.key === 'Enter') && !onButton && FC.idx < FC.queue.length) { e.preventDefault(); flip(); return; }
    const g = GRADES.find((x) => x.key === e.key);
    if (g && FC.flipped) { e.preventDefault(); rate(g.id); }
  }

  /* =========================================================
     MÀN HÌNH 3 — XƯỞNG GHÉP CHẤT ION
     ========================================================= */
  const pairKey = (c, a) => `${c.id}|${a.id}`;

  function validPairs() {
    const ions = DB.select('ions');
    const cats = ions.filter((i) => i.type === 'cation');
    const ans = ions.filter((i) => i.type === 'anion');
    return cats.flatMap((c) => ans.map((a) => ({ c, a, key: pairKey(c, a) }))).filter((p) => !UNSTABLE[p.key]);
  }

  // Tỉ lệ tối giản n cation : m anion để Σ điện tích = 0
  function ratio(c, a) {
    const g = gcd(c.charge, Math.abs(a.charge));
    return { n: Math.abs(a.charge) / g, m: c.charge / g };
  }

  function formulaHTML(c, n, a, m) {
    const part = (ion, k) => {
      const base = subHTML(ion.formula);
      if (k === 1) return base;
      return ion.poly ? `(${base})<sub>${k}</sub>` : `${base}<sub>${k}</sub>`;
    };
    return part(c, n) + part(a, m);
  }

  function formulaText(c, n, a, m) {
    const part = (ion, k) => {
      const base = subText(ion.formula);
      if (k === 1) return base;
      return ion.poly ? `(${base})${subText(k)}` : `${base}${subText(k)}`;
    };
    return part(c, n) + part(a, m);
  }

  const compoundName = (c, a) => `${c.name} ${a.name}`;

  function pickTarget(exceptKey) {
    const found = new Set(DB.select('lab_discoveries', { user_id: uid() }).map((d) => d.key));
    const pairs = validPairs().filter((p) => p.key !== exceptKey);
    const fresh = pairs.filter((p) => !found.has(p.key));
    const pool = fresh.length ? fresh : pairs;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function ionChip(ion, opts = {}) {
    const { idx = null, showName = true } = opts;
    const inReactor = idx !== null;
    const label = `${ion.type === 'cation' ? 'Cation' : 'Anion'} ${subText(ion.formula)}${chargeText(ion.charge).replace('−', '-')}, ${ion.name}`;
    return `
      <div class="ion ion--${ion.type}${inReactor ? ' ion--in' : ''}" draggable="true" role="button" tabindex="0"
              data-ion="${ion.id}" ${inReactor ? `data-idx="${idx}"` : ''}
              aria-label="${esc(inReactor ? 'Gỡ ' + label + ' khỏi lò' : 'Thêm ' + label + ' vào lò')}">
        <span class="ion__f">${subHTML(ion.formula)}<sup>${chargeText(ion.charge)}</sup></span>
        ${showName && !inReactor ? `<span class="ion__n">${esc(ion.name)}</span>` : ''}
      </div>`;
  }

  function renderLab() {
    ionMap = new Map(DB.select('ions').map((i) => [i.id, i]));
    LAB = { slots: [], target: pickTarget(), hint: false, solvedKey: null, solvedTarget: false, made: 0, suppressClick: false };

    const tray = (type) => DB.select('ions', { type }).map((ion) => ionChip(ion)).join('');

    view.innerHTML = `
      <section class="lab" data-mod="m1">
        ${topline('⚗️ Xưởng ghép chất ion')}

        <div class="card lab-mission">
          <span class="lab-mission__icon" aria-hidden="true">🎯</span>
          <div class="lab-mission__text">
            <small>Nhiệm vụ điều chế</small>
            <b id="labTarget"></b>
            <span class="lab-mission__hint" id="labHint" hidden></span>
          </div>
          <div class="lab-mission__actions">
            <button class="btn btn--ghost btn--sm" data-isl="hint">💡 Gợi ý</button>
            <button class="btn btn--ghost btn--sm" data-isl="skip">⏭ Đổi mục tiêu</button>
          </div>
        </div>

        <div class="lab-grid">
          <aside class="card lab-tray lab-tray--cation" data-tray="cation" aria-label="Khay cation">
            <h3><span class="lab-sign lab-sign--pos">+</span> Cation</h3>
            <div class="lab-chips">${tray('cation')}</div>
          </aside>

          <div class="lab-center">
            <div class="lab-reactor" id="labReactor" aria-label="Lò phản ứng" aria-describedby="labResult">
              <div class="lab-reactor__glass">
                <div class="lab-slots" id="labSlots"></div>
              </div>
              <div class="lab-fx" id="labFx" aria-hidden="true"></div>
            </div>

            <div class="lab-meter" aria-hidden="true">
              <div class="lab-meter__track">
                <span class="lab-meter__zero"></span>
                <span class="lab-meter__needle" id="labNeedle"></span>
              </div>
              <div class="lab-meter__scale"><span>−${METER_RANGE}</span><span>0</span><span>+${METER_RANGE}</span></div>
            </div>
            <p class="lab-charge">Tổng điện tích: <b id="labCharge">0</b></p>

            <div class="lab-result" id="labResult" aria-live="polite"></div>
            <div class="lab-actions">
              <button class="btn btn--ghost btn--sm" data-isl="clear">🧹 Làm trống lò</button>
            </div>
          </div>

          <aside class="card lab-tray lab-tray--anion" data-tray="anion" aria-label="Khay anion">
            <h3><span class="lab-sign lab-sign--neg">−</span> Anion</h3>
            <div class="lab-chips">${tray('anion')}</div>
          </aside>
        </div>

        <section class="card lab-book">
          <div class="card__head"><h3>📒 Sổ tay hợp chất</h3><span class="tag" id="labBookCount"></span></div>
          <div class="lab-book__list" id="labBook"></div>
        </section>
      </section>`;

    renderTarget();
    renderBook();
    updateLab();
    bindLabEvents();
  }

  function renderTarget() {
    const { c, a } = LAB.target;
    $('#labTarget').textContent = compoundName(c, a);
    const hint = $('#labHint');
    if (LAB.hint) {
      const { n, m } = ratio(c, a);
      hint.hidden = false;
      hint.innerHTML = `Cần ${n} ion ${subHTML(c.formula)}<sup>${chargeText(c.charge)}</sup> và ${m} ion ${subHTML(a.formula)}<sup>${chargeText(a.charge)}</sup>`;
    } else hint.hidden = true;
  }

  function renderBook() {
    const found = DB.select('lab_discoveries', { user_id: uid() }, { orderBy: 'id desc' });
    const total = validPairs().length;
    $('#labBookCount').textContent = `${found.length}/${total}`;
    $('#labBook').innerHTML = found.length
      ? found.map((d) => {
          const [cid, aid] = d.key.split('|');
          const c = ionMap.get(cid), a = ionMap.get(aid);
          if (!c || !a) return '';
          const { n, m } = ratio(c, a);
          return `<span class="lab-entry" title="${esc(compoundName(c, a))}"><b>${formulaHTML(c, n, a, m)}</b><small>${esc(compoundName(c, a))}</small></span>`;
        }).join('')
      : '<p class="dx-muted">Chưa có hợp chất nào. Hãy điều chế hợp chất đầu tiên!</p>';
  }

  function analyze(slots) {
    if (!slots.length) return { state: 'empty', total: 0 };
    const ions = slots.map((id) => ionMap.get(id));
    const total = ions.reduce((s, i) => s + i.charge, 0);
    const cats = [...new Set(ions.filter((i) => i.type === 'cation').map((i) => i.id))];
    const ans = [...new Set(ions.filter((i) => i.type === 'anion').map((i) => i.id))];

    if (cats.length > 1 || ans.length > 1) return { state: 'mixed', total };
    if (!cats.length || !ans.length) return { state: 'one-sign', total };
    if (total !== 0) return { state: 'unbalanced', total };

    const c = ionMap.get(cats[0]), a = ionMap.get(ans[0]);
    const n = slots.filter((id) => id === c.id).length;
    const m = slots.filter((id) => id === a.id).length;
    const g = gcd(n, m);
    if (g > 1) return { state: 'unreduced', total, c, a, n, m, rn: n / g, rm: m / g };
    const key = pairKey(c, a);
    if (UNSTABLE[key]) return { state: 'unstable', total, c, a, n, m, key };
    return { state: 'success', total, c, a, n, m, key };
  }

  function updateLab(addedIdx = null) {
    // Lò: cation trước, anion sau, giữ chỉ số gốc để gỡ đúng ion
    const order = LAB.slots.map((id, i) => ({ id, i })).sort((x, y) => {
      const tx = ionMap.get(x.id).type, ty = ionMap.get(y.id).type;
      return tx === ty ? x.i - y.i : tx === 'cation' ? -1 : 1;
    });
    $('#labSlots').innerHTML = LAB.slots.length
      ? order.map(({ id, i }) => ionChip(ionMap.get(id), { idx: i })).join('')
      : '<p class="lab-placeholder">Kéo ion vào đây<br><small>hoặc chạm vào ion để thêm</small></p>';
    if (addedIdx !== null) $(`#labSlots [data-idx="${addedIdx}"]`)?.classList.add('is-new');

    const res = analyze(LAB.slots);
    const reactor = $('#labReactor');
    reactor.classList.remove('is-success', 'is-warn', 'is-error', 'is-active');
    if (LAB.slots.length) reactor.classList.add('is-active');

    // Đồng hồ điện tích
    const clamp = Math.max(-METER_RANGE, Math.min(METER_RANGE, res.total));
    const needle = $('#labNeedle');
    needle.style.left = `${50 + (clamp / METER_RANGE) * 50}%`;
    needle.dataset.sign = res.total > 0 ? 'pos' : res.total < 0 ? 'neg' : 'zero';
    $('#labCharge').textContent = signed(res.total);
    $('#labCharge').dataset.sign = needle.dataset.sign;

    const box = $('#labResult');
    const msg = (cls, html) => { box.className = `lab-result lab-result--${cls}`; box.innerHTML = html; };

    switch (res.state) {
      case 'empty':
        msg('idle', 'Mục tiêu: <b>tổng điện tích = 0</b> với 1 loại cation và 1 loại anion.');
        break;
      case 'one-sign':
        msg('info', `Cần thêm ion mang điện tích <b>${res.total > 0 ? 'âm (anion)' : 'dương (cation)'}</b>.`);
        break;
      case 'mixed':
        reactor.classList.add('is-error');
        msg('bad', '⚠️ Mỗi lần chỉ ghép <b>1 loại cation</b> với <b>1 loại anion</b>. Chạm vào ion trong lò để gỡ bớt.');
        break;
      case 'unbalanced':
        msg('info', `Tổng điện tích đang là <b>${signed(res.total)}</b>. Cần thêm ion ${res.total > 0 ? '<b>âm</b>' : '<b>dương</b>'} hoặc gỡ bớt ion ${res.total > 0 ? 'dương' : 'âm'}.`);
        break;
      case 'unreduced':
        reactor.classList.add('is-warn');
        msg('warn', `Trung hòa điện rồi! Nhưng tỉ lệ <b>${res.n} : ${res.m}</b> chưa tối giản. Hãy rút gọn còn <b>${res.rn} : ${res.rm}</b>.`);
        break;
      case 'unstable':
        reactor.classList.add('is-warn');
        msg('warn', `
          <div class="lab-formula lab-formula--warn">${formulaHTML(res.c, res.n, res.a, res.m)}</div>
          <p>⚖️ Cân bằng điện tích, nhưng <b>hợp chất này không bền</b>. ${esc(UNSTABLE[res.key])}</p>`);
        break;
      case 'success':
        reactor.classList.add('is-success');
        handleSuccess(res, box);
        break;
      default: break;
    }
    if (res.state !== 'success') LAB.solvedKey = null;
  }

  function handleSuccess(res, box) {
    const isTarget = res.key === LAB.target.key;
    box.className = 'lab-result lab-result--ok';
    box.innerHTML = `
      <div class="lab-formula">${formulaHTML(res.c, res.n, res.a, res.m)}</div>
      <p class="lab-name">${esc(compoundName(res.c, res.a))}</p>
      <p>${isTarget ? '🎯 <b>Khớp nhiệm vụ!</b>' : '✅ Hợp chất trung hòa điện.'}
         ${res.n}×(${signed(res.c.charge)}) + ${res.m}×(${signed(res.a.charge)}) = 0</p>
      ${isTarget || LAB.solvedTarget ? '<button class="btn btn--sm" data-mod="m1" data-isl="next">Nhiệm vụ tiếp theo →</button>' : ''}`;

    if (LAB.solvedKey === res.key) return; // không thưởng lặp khi chỉ sắp xếp lại
    LAB.solvedKey = res.key;
    burst();

    const isNew = !DB.count('lab_discoveries', { user_id: uid(), key: res.key });
    if (isNew) {
      DB.insert('lab_discoveries', { user_id: uid(), key: res.key, found_at: today() });
      toast(`Hợp chất mới vào Sổ tay: <b>${formulaText(res.c, res.n, res.a, res.m)}</b>`, '📒');
      renderBook();
      if (DB.count('lab_discoveries', { user_id: uid() }) >= 20) unlockBadge(BADGE.ALCHEMIST);
    }

    if (isTarget && !LAB.solvedTarget) {
      LAB.solvedTarget = true;
      LAB.made += 1;
      bumpQuest(QUEST.LAB, 1);
      XP.add(LAB.hint ? 8 : 15, `Điều chế ${compoundName(res.c, res.a)}`);
    }
    syncProgress();
    bus.emit('lab:compound', { key: res.key, target: isTarget });
  }

  function burst() {
    if (reduceMotion()) return;
    const fx = $('#labFx');
    fx.innerHTML = '';
    const symbols = ['✦', '✧', '•', '⚛', '✦', '•'];
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      const ang = (Math.PI * 2 * i) / 16 + Math.random() * 0.3;
      const dist = 90 + Math.random() * 70;
      s.textContent = symbols[i % symbols.length];
      s.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
      s.style.setProperty('--y', `${Math.sin(ang) * dist}px`);
      s.style.setProperty('--d', `${Math.random() * 120}ms`);
      fx.appendChild(s);
    }
    setTimeout(() => { fx.innerHTML = ''; }, 1300);
  }

  function addIon(id) {
    const ion = ionMap.get(id);
    if (!ion) return;
    if (LAB.slots.filter((x) => x === id).length >= MAX_PER_ION) {
      toast(`Tối đa ${MAX_PER_ION} ion ${subText(ion.formula)} trong lò`, '⚠️', 2000);
      return;
    }
    LAB.slots.push(id);
    updateLab(LAB.slots.length - 1);
  }

  function removeIon(idx) {
    if (idx < 0 || idx >= LAB.slots.length) return;
    LAB.slots.splice(idx, 1);
    updateLab();
  }

  function newTarget() {
    LAB.target = pickTarget(LAB.target.key);
    LAB.hint = false;
    LAB.solvedTarget = false;
    LAB.solvedKey = null;
    LAB.slots = [];
    renderTarget();
    updateLab();
    const m = $('.lab-mission');
    m.classList.remove('is-new'); void m.offsetWidth; m.classList.add('is-new');
  }

  /* ---------- Kéo thả: HTML5 DnD (chuột) + Pointer (cảm ứng) + chạm/bàn phím ---------- */
  const payloadOf = (chip) => (chip.dataset.idx != null ? `rm:${chip.dataset.idx}` : `add:${chip.dataset.ion}`);

  function applyDrop(payload, target) {
    const [kind, val] = payload.split(':');
    const inReactor = !!target?.closest?.('#labReactor');
    if (kind === 'add' && inReactor) addIon(val);
    if (kind === 'rm' && !inReactor) removeIon(Number(val));
  }

  function bindLabEvents() {
    const reactor = $('#labReactor');

    // Chạm / click / Enter: thêm hoặc gỡ ion
    on(view, 'click', (e) => {
      if (LAB.suppressClick) return;
      const chip = e.target.closest('.ion');
      if (chip) {
        if (chip.dataset.idx != null) removeIon(Number(chip.dataset.idx));
        else addIon(chip.dataset.ion);
        return;
      }
      const btn = e.target.closest('[data-isl]');
      if (!btn) return;
      ({
        clear: () => { LAB.slots = []; updateLab(); },
        hint: () => {
          if (!LAB.hint) { LAB.hint = true; renderTarget(); toast('Dùng gợi ý: phần thưởng còn +8 EXP', '💡', 2200); }
        },
        skip: newTarget,
        next: newTarget
      })[btn.dataset.isl]?.();
    });

    // Bàn phím: ion là div role="button" (Firefox không cho kéo phần tử <button>)
    on(view, 'keydown', (e) => {
      const chip = e.target.closest('.ion');
      if (!chip || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      const wasIdx = chip.dataset.idx;
      chip.click();
      // Giữ focus hợp lý sau khi lò được vẽ lại
      if (wasIdx == null) view.querySelector(`.lab-tray .ion[data-ion="${chip.dataset.ion}"]`)?.focus();
      else (view.querySelector('#labSlots .ion') || view.querySelector('.lab-tray .ion'))?.focus();
    });

    // HTML5 Drag and Drop API
    on(view, 'dragstart', (e) => {
      const chip = e.target.closest('.ion');
      if (!chip) return;
      e.dataTransfer.setData('text/plain', payloadOf(chip));
      e.dataTransfer.effectAllowed = chip.dataset.idx != null ? 'move' : 'copy';
      chip.classList.add('is-dragging');
      if (chip.dataset.idx == null) reactor.classList.add('is-target');
    });
    on(view, 'dragend', (e) => {
      const chip = e.target.closest('.ion');
      chip?.classList.remove('is-dragging');
      reactor.classList.remove('is-target', 'is-over');
      // Kéo ion trong lò ra ngoài rồi thả ở vùng không nhận → gỡ ion
      if (chip?.dataset.idx != null && e.dataTransfer.dropEffect === 'none') removeIon(Number(chip.dataset.idx));
    });
    on(reactor, 'dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; reactor.classList.add('is-over'); });
    on(reactor, 'dragleave', (e) => { if (!reactor.contains(e.relatedTarget)) reactor.classList.remove('is-over'); });
    on(reactor, 'drop', (e) => {
      e.preventDefault();
      reactor.classList.remove('is-over', 'is-target');
      applyDrop(e.dataTransfer.getData('text/plain'), reactor);
    });
    view.querySelectorAll('.lab-tray').forEach((tray) => {
      on(tray, 'dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      on(tray, 'drop', (e) => { e.preventDefault(); applyDrop(e.dataTransfer.getData('text/plain'), tray); });
    });

    // Pointer Events cho màn hình cảm ứng (trình duyệt di động không hỗ trợ đầy đủ HTML5 DnD)
    let drag = null;
    on(view, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const chip = e.target.closest('.ion');
      if (!chip) return;
      drag = { chip, id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null };
    });
    on(window, 'pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.ghost) {
        if (Math.hypot(dx, dy) < 10) return;
        const r = drag.chip.getBoundingClientRect();
        drag.ghost = drag.chip.cloneNode(true);
        drag.ghost.classList.add('ion--ghost');
        drag.ghost.style.width = `${r.width}px`;
        document.body.appendChild(drag.ghost);
        drag.chip.classList.add('is-dragging');
        if (drag.chip.dataset.idx == null) reactor.classList.add('is-target');
      }
      e.preventDefault();
      drag.ghost.style.transform = `translate(${e.clientX - drag.ghost.offsetWidth / 2}px, ${e.clientY - drag.ghost.offsetHeight / 2}px) scale(1.1) rotate(-4deg)`;
      const over = document.elementFromPoint(e.clientX, e.clientY);
      reactor.classList.toggle('is-over', !!over?.closest('#labReactor'));
    }, { passive: false });
    const endDrag = (e, cancelled) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.ghost) {
        drag.ghost.remove();
        drag.chip.classList.remove('is-dragging');
        reactor.classList.remove('is-over', 'is-target');
        if (!cancelled) {
          applyDrop(payloadOf(drag.chip), document.elementFromPoint(e.clientX, e.clientY));
          LAB.suppressClick = true;                       // chặn "click" giả ngay sau khi thả
          setTimeout(() => { if (LAB) LAB.suppressClick = false; }, 50);
        }
      }
      drag = null;
    };
    on(window, 'pointerup', (e) => endDrag(e, false));
    on(window, 'pointercancel', (e) => endDrag(e, true));
  }

  /* =========================================================
     ĐĂNG KÝ PHÂN HỆ
     ========================================================= */
  Modules.register('island', {
    render(container, { params = [] } = {}) {
      teardown();
      view = container;
      tMap = new Map(DB.select('topics').map((t) => [t.id, t]));
      ionMap = new Map(DB.select('ions').map((i) => [i.id, i]));
      const [mode, arg] = params;
      if (mode === 'flashcard') return renderFlashcards(arg || null);
      if (mode === 'lab') return renderLab();
      renderHub();
    },
    unmount() { teardown(); }
  });
})();
