/* =========================================================
   ChemRescue — Phân hệ 1: Phòng chẩn đoán kiến thức
   ---------------------------------------------------------
   Màn hình (điều khiển bằng hash để nút Back hoạt động):
     #/diagnostic            → Giới thiệu
     #/diagnostic/quiz       → Làm bài (tự khôi phục nếu đang làm dở)
     #/diagnostic/result[/id]→ Kết quả: điểm, Heatmap, lộ trình, xem lại
   Thuật toán:
     • Đảo thứ tự câu hỏi & phương án (Fisher–Yates), lưu ánh xạ về chỉ số gốc
     • Đo thời gian thực làm bài (tạm dừng khi rời tab / rời trang)
     • Điểm chủ đề = số câu đúng / số câu của chủ đề → Xanh ≥80, Vàng 50–79, Đỏ <50
     • Lộ trình = sắp xếp tô-pô theo quan hệ kiến thức tiên quyết,
       hòa thì ưu tiên chủ đề điểm thấp hơn
   ========================================================= */
(() => {
  'use strict';

  const { DB, Modules, Mastery, XP, toast, esc, bus } = window.ChemRescue;

  /* ---------- HẰNG SỐ ---------- */
  const SESSION_KEY = 'chemrescue.diagnostic.session';
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const AUTO_NEXT_MS = 450;          // tự chuyển câu sau khi chọn lần đầu
  const FAST_ANSWER_MS = 3000;       // ngưỡng huy hiệu "Phản xạ ánh sáng"
  const BADGE = { FIRST: 1, ATOM: 3, FAST: 5, PH: 10 };
  const QUEST_ID = 1;

  // Quan hệ tiên quyết giữa các chủ đề (chủ đề → các chủ đề cần học trước)
  const PREREQ = {
    atom: [],
    periodic: ['atom'],
    bonding: ['atom', 'periodic'],
    redox: ['bonding'],
    solution: ['bonding']
  };
  const STUDY_MIN = { bad: 25, warn: 15 };

  const RANK = [
    { min: 80, icon: '🧪', title: 'Phòng thí nghiệm vững vàng!',
      desc: 'Nền tảng chắc chắn. Hãy giữ phong độ ở Đấu trường và chinh phục các nhánh nâng cao.' },
    { min: 50, icon: '💪', title: 'Đang hồi phục tốt',
      desc: 'Bạn đã nắm phần lớn kiến thức. Lấp nốt các ô vàng và đỏ bên dưới là bứt phá.' },
    { min: 0,  icon: '🚑', title: 'Cần cấp cứu kiến thức',
      desc: 'Đừng lo, đây chính là lý do ChemRescue tồn tại. Đi theo lộ trình bên dưới, bắt đầu từ phần nền tảng.' }
  ];

  /* ---------- TIỆN ÍCH ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtClock = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const fmtDuration = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return m ? `${m} phút ${s} giây` : `${s} giây`; };
  const nowStamp = () => { const d = new Date(); return `${DB.localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDate = (stamp) => {
    const [date, time] = String(stamp).split(' ');
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}${time ? ' · ' + time : ''}`;
  };

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function go(hash) {
    if (location.hash === hash) window.ChemRescue.navigate();
    else location.hash = hash;
  }

  const userId = () => DB.currentUser().id;
  const latestAttempt = () => DB.select('quiz_attempts', { user_id: userId() }, { orderBy: 'id desc', limit: 1 })[0];

  /* ---------- PHIÊN LÀM BÀI (lưu localStorage → F5 không mất bài) ---------- */
  const Session = {
    load() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
    },
    save(s) {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* bộ nhớ đầy: bỏ qua */ }
    },
    clear() { localStorage.removeItem(SESSION_KEY); },
    create() {
      const qs = shuffle(DB.select('questions'));
      return {
        started_at: Date.now(),
        elapsed_ms: 0,
        index: 0,
        items: qs.map((q) => ({
          qid: q.id,
          opts: shuffle(q.options.map((_, i) => i)), // thứ tự hiển thị → chỉ số gốc
          chosen: null,      // chỉ số phương án GỐC đã chọn
          flagged: false,
          time_ms: 0,        // tổng thời gian dừng ở câu này
          first_ms: null     // thời gian tới lần chọn đầu tiên
        }))
      };
    },
    isValid(s) {
      if (!s || !Array.isArray(s.items) || !s.items.length) return false;
      const ids = new Set(DB.select('questions').map((q) => q.id));
      return s.items.every((it) => ids.has(it.qid));
    }
  };

  /* ---------- TRẠNG THÁI NỘI BỘ PHÂN HỆ ---------- */
  let view = null;
  let S = null;                 // phiên đang làm
  let qMap = new Map();         // id câu hỏi → câu hỏi
  let tMap = new Map();         // id chủ đề → chủ đề
  let timerId = null, resumedAt = 0, qShownAt = 0, autoT = null, rafId = null;
  let dialogClose = null;
  let cleanup = [];

  const on = (el, evt, fn, opt) => { el.addEventListener(evt, fn, opt); cleanup.push(() => el.removeEventListener(evt, fn, opt)); };

  function loadMaps() {
    qMap = new Map(DB.select('questions').map((q) => [q.id, q]));
    tMap = new Map(DB.select('topics').map((t) => [t.id, t]));
  }

  function teardown() {
    if (S) pauseClock();
    clearTimeout(autoT);
    cancelAnimationFrame(rafId);
    dialogClose?.();
    cleanup.forEach((fn) => fn());
    cleanup = [];
  }

  /* =========================================================
     ĐỒNG HỒ
     ========================================================= */
  const elapsed = () => S.elapsed_ms + (resumedAt ? Date.now() - resumedAt : 0);

  function commitQuestionTime() {
    if (!qShownAt) return;
    const now = Date.now();
    S.items[S.index].time_ms += now - qShownAt;
    qShownAt = now;
  }

  function startClock() {
    resumedAt = qShownAt = Date.now();
    clearInterval(timerId);
    timerId = setInterval(renderClock, 500);
    renderClock();
  }

  function pauseClock() {
    if (!S) return;
    commitQuestionTime();
    if (resumedAt) { S.elapsed_ms += Date.now() - resumedAt; resumedAt = 0; }
    qShownAt = 0;
    clearInterval(timerId); timerId = null;
    Session.save(S);
  }

  function renderClock() {
    const el = $('#dxTime');
    if (el && S) el.textContent = fmtClock(elapsed());
  }

  /* =========================================================
     MÀN HÌNH 1 — GIỚI THIỆU
     ========================================================= */
  function renderIntro() {
    loadMaps();
    const total = qMap.size;
    const last = latestAttempt();
    const saved = Session.load();
    const resumable = Session.isValid(saved) ? saved : null;
    const answered = resumable ? resumable.items.filter((i) => i.chosen !== null).length : 0;

    const topicRows = [...tMap.values()].map((t) => {
      const n = [...qMap.values()].filter((q) => q.topic_id === t.id).length;
      const pct = last?.topic_scores?.[t.id];
      const lvl = pct == null ? null : Mastery.level(pct);
      return `
        <li class="dx-topic">
          <span class="dx-topic__icon" aria-hidden="true">${t.icon}</span>
          <span class="dx-topic__name"><b>${esc(t.name)}</b><small>${n} câu hỏi</small></span>
          ${lvl ? `<span class="tag tag--${lvl}">${pct}%</span>` : '<span class="tag">Chưa làm</span>'}
        </li>`;
    }).join('');

    view.innerHTML = `
      <section class="mod-banner" data-mod="m1">
        <span class="mod-banner__icon" aria-hidden="true">🩺</span>
        <div>
          <span class="tag">Phân hệ 1</span>
          <h2>Phòng chẩn đoán kiến thức</h2>
          <p>${total} câu hỏi trải đều ${tMap.size} chủ đề. Kết quả cho bạn một bản đồ nhiệt chỉ rõ lỗ hổng cần vá trước.</p>
        </div>
      </section>

      <section class="dx-intro">
        <div class="card dx-brief" data-mod="m1">
          <h3>Trước khi bắt đầu</h3>
          <ul class="dx-facts">
            <li><span aria-hidden="true">📝</span><b>${total} câu</b><small>Trắc nghiệm 4 phương án</small></li>
            <li><span aria-hidden="true">⏱️</span><b>~${Math.ceil(total * 0.6)} phút</b><small>Không giới hạn thời gian</small></li>
            <li><span aria-hidden="true">🧩</span><b>${tMap.size} chủ đề</b><small>3 câu mỗi chủ đề</small></li>
            <li><span aria-hidden="true">⚡</span><b>+${total * 10 + 20} EXP</b><small>Tối đa khi đúng hết</small></li>
          </ul>
          <ul class="dx-tips">
            <li>Không trừ điểm. Câu nào không chắc thì cứ chọn phương án bạn nghĩ là đúng nhất, để kết quả phản ánh đúng thực lực.</li>
            <li>Bấm <b>🚩 Đánh dấu</b> với câu còn phân vân để quay lại xem trước khi nộp.</li>
            <li class="dx-only-kbd">Phím tắt: <kbd>1</kbd>–<kbd>4</kbd> hoặc <kbd>A</kbd>–<kbd>D</kbd> để chọn, <kbd>←</kbd> <kbd>→</kbd> để chuyển câu, <kbd>F</kbd> để đánh dấu.</li>
          </ul>
          <div class="dx-actions">
            ${resumable
              ? `<button class="btn" data-mod="m1" data-dx="resume">▶ Tiếp tục bài đang làm (${answered}/${resumable.items.length})</button>
                 <button class="btn btn--ghost" data-dx="start">↺ Làm bài mới</button>`
              : `<button class="btn" data-mod="m1" data-dx="start">🚀 Bắt đầu chẩn đoán</button>`}
            ${last ? `<a class="btn btn--ghost" href="#/diagnostic/result">📊 Xem kết quả gần nhất</a>` : ''}
          </div>
        </div>

        <div class="card dx-topics">
          <div class="card__head"><h3>Chủ đề được kiểm tra</h3>${last ? `<span class="dx-muted">Lần gần nhất: ${last.score}/${last.total}</span>` : ''}</div>
          <ul>${topicRows}</ul>
        </div>
      </section>`;

    on(view, 'click', (e) => {
      const btn = e.target.closest('[data-dx]');
      if (!btn) return;
      if (btn.dataset.dx === 'start') {
        const begin = () => { Session.save(Session.create()); go('#/diagnostic/quiz'); };
        if (resumable && answered > 0) {
          openDialog({
            icon: '↺', title: 'Bỏ bài đang làm?',
            html: `Bạn đã trả lời <b>${answered}</b> câu. Làm bài mới sẽ xóa tiến độ hiện tại.`,
            actions: [{ label: 'Giữ lại', ghost: true }, { label: 'Làm bài mới', onClick: begin }]
          });
        } else begin();
      }
      if (btn.dataset.dx === 'resume') go('#/diagnostic/quiz');
    });
  }

  /* =========================================================
     MÀN HÌNH 2 — LÀM BÀI
     ========================================================= */
  function renderQuiz() {
    loadMaps();
    const total = S.items.length;
    S.index = Math.min(Math.max(0, S.index || 0), total - 1);

    view.innerHTML = `
      <section class="dx-quiz" data-mod="m1">
        <header class="card dx-qhead">
          <div class="dx-qhead__row">
            <span class="dx-counter">Câu <b id="dxNum">1</b><span>/${total}</span></span>
            <span class="tag" id="dxTopic"></span>
            <span class="dx-timer" title="Thời gian làm bài"><span aria-hidden="true">⏱</span> <b id="dxTime">00:00</b></span>
            <button class="dx-exit" data-dx="exit" aria-label="Tạm dừng và thoát">✕</button>
          </div>
          <div class="dx-progress" aria-hidden="true"><div class="dx-progress__fill" id="dxProg"></div></div>
          <nav class="dx-dots" id="dxDots" aria-label="Danh sách câu hỏi"></nav>
        </header>

        <div class="dx-stage" id="dxStage" aria-live="polite"></div>

        <footer class="dx-qfoot">
          <button class="btn btn--ghost" id="dxPrev" data-dx="prev"><span aria-hidden="true">←</span><span class="dx-hide-xs">Câu trước</span></button>
          <button class="btn btn--ghost dx-flag" id="dxFlag" data-dx="flag" aria-pressed="false">🚩<span class="dx-hide-xs">Đánh dấu</span></button>
          <button class="btn" id="dxNext" data-dx="next" data-mod="m1">Tiếp <span aria-hidden="true">→</span></button>
        </footer>
      </section>`;

    showQuestion(0);
    startClock();

    on(view, 'click', onQuizClick);
    on(document, 'keydown', onQuizKey);
    on(document, 'visibilitychange', () => {
      if (!S) return;
      if (document.visibilityState === 'hidden') pauseClock();
      else if (!timerId) startClock();
    });
    on(window, 'pagehide', () => S && pauseClock());
  }

  function answeredCount() { return S.items.filter((i) => i.chosen !== null).length; }

  function showQuestion(dir = 0) {
    const it = S.items[S.index];
    const q = qMap.get(it.qid);
    const t = tMap.get(q.topic_id);
    const stage = $('#dxStage');

    $('#dxNum').textContent = S.index + 1;
    $('#dxTopic').textContent = `${t.icon} ${t.short}`;

    // Dọn thẻ cũ còn đang chạy hiệu ứng (khi bấm chuyển câu liên tục)
    stage.querySelectorAll('.dx-card.is-leaving').forEach((n) => n.remove());
    const old = stage.querySelector('.dx-card');

    const card = document.createElement('article');
    card.className = 'card dx-card';
    card.setAttribute('aria-labelledby', 'dxQText');
    card.innerHTML = `
      <p class="dx-card__meta">${esc(t.name)}${it.flagged ? ' · <span class="dx-flagged">🚩 Đã đánh dấu</span>' : ''}</p>
      <h2 class="dx-card__q" id="dxQText">${esc(q.text)}</h2>
      <div class="dx-options" role="radiogroup" aria-labelledby="dxQText">
        ${it.opts.map((orig, k) => `
          <button class="dx-opt" role="radio" aria-checked="${it.chosen === orig}" data-orig="${orig}">
            <span class="dx-opt__key">${LETTERS[k]}</span>
            <span class="dx-opt__text">${esc(q.options[orig])}</span>
          </button>`).join('')}
      </div>`;

    const animate = !reduceMotion();
    if (old) {
      old.removeAttribute('aria-labelledby');
      old.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      if (animate) {
        old.classList.add('is-leaving', dir < 0 ? 'to-right' : 'to-left');
        old.setAttribute('aria-hidden', 'true');
        setTimeout(() => old.remove(), 360);
      } else old.remove();
    }
    if (animate) card.classList.add(dir < 0 ? 'from-left' : dir > 0 ? 'from-right' : 'from-fade');
    stage.appendChild(card);

    updateChrome();
  }

  function updateChrome() {
    const total = S.items.length;
    const it = S.items[S.index];
    const isLast = S.index === total - 1;

    $('#dxProg').style.width = `${(answeredCount() / total) * 100}%`;
    $('#dxPrev').disabled = S.index === 0;

    const flag = $('#dxFlag');
    flag.setAttribute('aria-pressed', String(it.flagged));
    flag.classList.toggle('is-on', it.flagged);

    const next = $('#dxNext');
    next.innerHTML = isLast ? 'Nộp bài <span aria-hidden="true">✓</span>' : 'Tiếp <span aria-hidden="true">→</span>';
    next.classList.toggle('dx-pulse', isLast && answeredCount() === total);

    $('#dxDots').innerHTML = S.items.map((x, i) => {
      const cls = ['dx-dot',
        x.chosen !== null && 'is-done',
        x.flagged && 'is-flag',
        i === S.index && 'is-current'].filter(Boolean).join(' ');
      const state = [x.chosen !== null ? 'đã trả lời' : 'chưa trả lời', x.flagged && 'đã đánh dấu'].filter(Boolean).join(', ');
      return `<button class="${cls}" data-i="${i}" aria-label="Câu ${i + 1}: ${state}"${i === S.index ? ' aria-current="step"' : ''}>${i + 1}</button>`;
    }).join('');
  }

  function goTo(i) {
    if (i < 0 || i >= S.items.length || i === S.index) return;
    clearTimeout(autoT);
    commitQuestionTime();
    const dir = i > S.index ? 1 : -1;
    S.index = i;
    Session.save(S);
    showQuestion(dir);
  }

  function next() {
    if (S.index < S.items.length - 1) goTo(S.index + 1);
    else openSubmit();
  }

  function choose(orig) {
    const idx = S.index;
    const it = S.items[idx];
    const firstTime = it.chosen === null;
    if (it.first_ms == null) it.first_ms = Math.round(it.time_ms + (Date.now() - qShownAt));
    it.chosen = orig;
    Session.save(S);

    $('#dxStage .dx-card:not(.is-leaving)').querySelectorAll('.dx-opt').forEach((b) => {
      b.setAttribute('aria-checked', String(Number(b.dataset.orig) === orig));
    });
    updateChrome();

    // Lần chọn đầu → tự chuyển câu cho mượt; đổi đáp án thì giữ nguyên để người học xem lại
    if (firstTime && idx < S.items.length - 1) {
      clearTimeout(autoT);
      autoT = setTimeout(() => { if (S && S.index === idx) goTo(idx + 1); }, AUTO_NEXT_MS);
    }
  }

  function toggleFlag() {
    const it = S.items[S.index];
    it.flagged = !it.flagged;
    Session.save(S);
    const meta = $('#dxStage .dx-card:not(.is-leaving) .dx-card__meta');
    const t = tMap.get(qMap.get(it.qid).topic_id);
    if (meta) meta.innerHTML = `${esc(t.name)}${it.flagged ? ' · <span class="dx-flagged">🚩 Đã đánh dấu</span>' : ''}`;
    updateChrome();
  }

  function onQuizClick(e) {
    const opt = e.target.closest('.dx-opt');
    if (opt && !opt.closest('.is-leaving')) { choose(Number(opt.dataset.orig)); return; }
    const dot = e.target.closest('[data-i]');
    if (dot) { goTo(Number(dot.dataset.i)); return; }
    const btn = e.target.closest('[data-dx]');
    if (!btn) return;
    ({
      prev: () => goTo(S.index - 1),
      next,
      flag: toggleFlag,
      exit: () => { pauseClock(); toast('Đã lưu tiến độ. Quay lại bất cứ lúc nào!', '💾'); go('#/diagnostic'); }
    })[btn.dataset.dx]?.();
  }

  function onQuizKey(e) {
    if (dialogClose || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    const it = S.items[S.index];
    const pos = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
    if (pos >= 0 && pos < it.opts.length && k.length === 1) { e.preventDefault(); choose(it.opts[pos]); return; }
    if (k === 'arrowright') { e.preventDefault(); next(); }
    else if (k === 'arrowleft') { e.preventDefault(); goTo(S.index - 1); }
    else if (k === 'f') { e.preventDefault(); toggleFlag(); }
    else if (k === 'enter' && !e.target.closest('button, a')) { e.preventDefault(); next(); }
  }

  /* ---------- Hộp thoại xác nhận dùng chung ---------- */
  function openDialog({ icon, title, html, actions }) {
    dialogClose?.();
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal dx-dialog';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'dxDlgTitle');
    wrap.innerHTML = `
      <div class="modal__card" data-mod="m1">
        <div class="dx-dialog__icon" aria-hidden="true">${icon}</div>
        <h2 id="dxDlgTitle">${esc(title)}</h2>
        <p>${html}</p>
        <div class="dx-dialog__actions">
          ${actions.map((a, i) => `<button class="btn ${a.ghost ? 'btn--ghost' : ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      dialogClose = null;
      prevFocus?.focus?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return close();
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const action = actions[Number(b.dataset.a)];
      close();
      action.onClick?.();
    });
    dialogClose = close;
    wrap.querySelector('.btn:last-child').focus();
  }

  function openSubmit() {
    const total = S.items.length;
    const unanswered = S.items.map((x, i) => (x.chosen === null ? i : -1)).filter((i) => i >= 0);
    const flagged = S.items.map((x, i) => (x.flagged ? i : -1)).filter((i) => i >= 0);
    const firstPending = unanswered[0] ?? flagged[0];

    const notes = [];
    if (unanswered.length) notes.push(`<b>${unanswered.length}</b> câu chưa trả lời (tính là sai)`);
    if (flagged.length) notes.push(`<b>${flagged.length}</b> câu đang đánh dấu`);

    openDialog({
      icon: unanswered.length ? '⚠️' : '✅',
      title: unanswered.length ? 'Còn câu chưa làm' : 'Nộp bài chẩn đoán?',
      html: `Bạn đã trả lời <b>${total - unanswered.length}/${total}</b> câu.${notes.length ? '<br>' + notes.join(' · ') + '.' : ' Sẵn sàng xem bản đồ nhiệt của mình chưa?'}`,
      actions: [
        firstPending != null
          ? { label: unanswered.length ? 'Làm tiếp câu bỏ trống' : 'Xem câu đã đánh dấu', ghost: true, onClick: () => goTo(firstPending) }
          : { label: 'Kiểm tra lại', ghost: true },
        { label: 'Nộp bài', onClick: submit }
      ]
    });
  }

  /* =========================================================
     CHẤM ĐIỂM & GHI CSDL
     ========================================================= */
  function grade(session) {
    const per = {};
    tMap.forEach((t) => { per[t.id] = { c: 0, n: 0 }; });

    const answers = session.items.map((it) => {
      const q = qMap.get(it.qid);
      const correct = it.chosen === q.answer;
      per[q.topic_id].n += 1;
      if (correct) per[q.topic_id].c += 1;
      return { qid: it.qid, chosen: it.chosen, correct, time_ms: Math.round(it.time_ms), first_ms: it.first_ms };
    });

    const topic_scores = {};
    Object.entries(per).forEach(([id, v]) => { if (v.n) topic_scores[id] = Math.round((v.c / v.n) * 100); });

    return { answers, topic_scores, score: answers.filter((a) => a.correct).length, total: answers.length };
  }

  function unlockBadge(badgeId) {
    const uid = userId();
    if (DB.count('user_badges', { user_id: uid, badge_id: badgeId })) return;
    DB.insert('user_badges', { user_id: uid, badge_id: badgeId, unlocked_at: DB.localDate() });
    const b = DB.get('badges', badgeId);
    if (b) setTimeout(() => toast(`Mở khóa huy hiệu <b>${esc(b.name)}</b>`, b.icon, 3400), 700);
  }

  function submit() {
    pauseClock();
    const session = S;
    const result = grade(session);
    const expGained = result.score * 10 + 20;

    const attempt = DB.insert('quiz_attempts', {
      user_id: userId(),
      taken_at: nowStamp(),
      score: result.score,
      total: result.total,
      duration_sec: Math.round(session.elapsed_ms / 1000),
      topic_scores: result.topic_scores,
      answers: result.answers,
      exp_gained: expGained
    });

    // Kết thúc phiên TRƯỚC khi điều hướng để unmount không lưu lại phiên cũ
    S = null;
    Session.clear();

    // Cập nhật hồ sơ người học
    const u = DB.currentUser();
    DB.update('users', u.id, {
      gems: u.gems + result.score,
      module_progress: { ...u.module_progress, diagnostic: 100 }
    });

    // Nhiệm vụ ngày
    const quest = DB.get('quests', QUEST_ID);
    if (quest) DB.update('quests', quest.id, { progress: Math.min(quest.target, quest.progress + 1) });

    // (Dashboard Giáo viên nhận kết quả qua máy chủ – session.js tự đồng bộ tiến độ)

    XP.add(expGained, 'Hoàn thành bài chẩn đoán');

    // Huy hiệu
    unlockBadge(BADGE.FIRST);
    if ((result.topic_scores.atom ?? 0) >= 80) unlockBadge(BADGE.ATOM);
    if ((result.topic_scores.solution ?? 0) >= 80) unlockBadge(BADGE.PH);
    if (result.answers.some((a) => a.correct && a.first_ms != null && a.first_ms <= FAST_ANSWER_MS)) unlockBadge(BADGE.FAST);

    bus.emit('diagnostic:completed', attempt);
    go(`#/diagnostic/result/${attempt.id}`);
  }

  /* =========================================================
     LỘ TRÌNH KHUYẾN NGHỊ
     ========================================================= */
  function buildRoadmap(scores) {
    const topics = [...tMap.values()].filter((t) => scores[t.id] != null);
    const weak = topics.filter((t) => Mastery.level(scores[t.id]) !== 'ok');
    const strong = topics.filter((t) => Mastery.level(scores[t.id]) === 'ok');
    const weakIds = new Set(weak.map((t) => t.id));

    // Sắp xếp tô-pô: chỉ chọn chủ đề khi các chủ đề tiên quyết (đang yếu) đã được xếp trước
    const order = [];
    const placed = new Set();
    while (order.length < weak.length) {
      const remaining = weak.filter((t) => !placed.has(t.id));
      const ready = remaining.filter((t) => (PREREQ[t.id] || []).every((p) => !weakIds.has(p) || placed.has(p)));
      const pool = (ready.length ? ready : remaining).sort((a, b) => scores[a.id] - scores[b.id]);
      order.push(pool[0]);
      placed.add(pool[0].id);
    }

    const steps = order.map((t) => {
      const pct = scores[t.id];
      const lvl = Mastery.level(pct);
      const dependents = weak.filter((w) => (PREREQ[w.id] || []).includes(t.id)).map((w) => w.short);
      const cards = DB.count('flashcards', { topic_id: t.id });

      const why = dependents.length
        ? `Là nền tảng cho ${dependents.join(', ')}. Vá trước để học phần sau dễ hơn.`
        : lvl === 'bad'
          ? 'Tỉ lệ đúng dưới 50%: nên học lại từ lý thuyết cốt lõi.'
          : 'Đã nắm một phần, cần luyện thêm để chắc chắn.';

      const todo = [];
      if (lvl === 'bad') todo.push(`Đọc lại tóm tắt lý thuyết “${t.name}”`);
      if (cards) todo.push(`Ôn ${cards} thẻ Flashcard chủ đề này tại Đảo Cứu Nguy`);
      if (t.id === 'solution') todo.push('Ghép đúng 3 hợp chất tại Xưởng ghép ion');
      todo.push('Làm lại các câu sai trong phần xem lại đáp án');

      return { topic: t, pct, lvl, why, todo, minutes: STUDY_MIN[lvl], href: `#/island/flashcard/${t.id}` };
    });

    return { steps, strong, minutes: steps.reduce((s, x) => s + x.minutes, 0) };
  }

  /* =========================================================
     MÀN HÌNH 3 — KẾT QUẢ
     ========================================================= */
  function renderResult(attempt) {
    loadMaps();
    const pct = Math.round((attempt.score / attempt.total) * 100);
    const rank = RANK.find((r) => pct >= r.min);
    const lvl = Mastery.level(pct);
    const prev = DB.select('quiz_attempts', (a) => a.user_id === attempt.user_id && a.id < attempt.id, { orderBy: 'id desc', limit: 1 })[0];
    const scores = attempt.topic_scores;
    const redCount = Object.values(scores).filter((p) => Mastery.level(p) === 'bad').length;
    const road = buildRoadmap(scores);

    view.innerHTML = `
      <section class="card dx-hero dx--${lvl}" data-mod="m1">
        <div class="dx-score" id="dxScoreRing" style="--p:0" role="img" aria-label="${attempt.score} trên ${attempt.total} câu đúng">
          <div class="dx-score__inner"><b id="dxScore">0</b><span>/${attempt.total} câu đúng</span></div>
        </div>
        <div class="dx-hero__text">
          <span class="dx-eyebrow">Kết quả chẩn đoán · ${fmtDate(attempt.taken_at)}</span>
          <h2><span aria-hidden="true">${rank.icon}</span> ${rank.title}</h2>
          <p>${rank.desc}</p>
          <ul class="dx-kpis">
            <li>🎯 Chính xác <b>${pct}%</b></li>
            <li>⏱ ${fmtDuration(attempt.duration_sec || 0)}</li>
            <li>${redCount ? `🔴 <b>${redCount}</b> chủ đề cảnh báo` : '🟢 Không có chủ đề đỏ'}</li>
            ${attempt.exp_gained ? `<li class="dx-kpi--exp">⚡ +${attempt.exp_gained} EXP</li>` : ''}
            ${prev ? deltaChip(attempt.score - prev.score, ' câu so với lần trước') : ''}
          </ul>
        </div>
      </section>

      <section class="card dx-heat">
        <div class="card__head dx-heat__head">
          <div>
            <h3>🌡️ Bản đồ nhiệt lỗ hổng kiến thức</h3>
            <p class="dx-muted">Mỗi ô vuông là một câu hỏi. Màu nền của hàng thể hiện mức độ làm chủ chủ đề.</p>
          </div>
          <div class="legend">
            <span><i style="background:var(--ok)"></i>Làm chủ ≥ 80%</span>
            <span><i style="background:var(--warn)"></i>Cần bù đắp 50–79%</span>
            <span><i style="background:var(--bad)"></i>Cảnh báo &lt; 50%</span>
          </div>
        </div>
        <div class="dx-matrix" role="table" aria-label="Bản đồ nhiệt theo chủ đề">
          <div class="dx-mhead" role="row">
            <span role="columnheader">Chủ đề</span>
            <span role="columnheader">Từng câu</span>
            <span role="columnheader">Mức độ làm chủ</span>
            <span role="columnheader">Trạng thái</span>
          </div>
          ${heatRows(attempt, prev)}
        </div>
      </section>

      <div class="dx-split">
        <section class="card dx-road" data-mod="m2">
          <div class="card__head">
            <div>
              <h3>🧭 Lộ trình khuyến nghị</h3>
              <p class="dx-muted">Sắp theo thứ tự kiến thức nền tảng → nâng cao</p>
            </div>
            ${road.minutes ? `<span class="tag">~${road.minutes} phút · ${Math.ceil(road.minutes / 20)} buổi</span>` : ''}
          </div>
          ${roadmapHTML(road)}
        </section>

        <section class="card dx-review">
          <div class="card__head"><h3>📋 Xem lại đáp án</h3></div>
          ${reviewHTML(attempt)}
        </section>
      </div>

      <div class="dx-actions dx-actions--end">
        <a class="btn btn--ghost" href="#/home">🏠 Về tổng quan</a>
        <button class="btn" data-mod="m1" data-dx="retake">↺ Làm bài chẩn đoán mới</button>
      </div>`;

    // Hiệu ứng: thanh % chạy, điểm đếm tăng, vòng điểm quay
    requestAnimationFrame(() => {
      view.querySelectorAll('.dx-bar__fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
      animateScore(attempt.score, attempt.total);
    });

    on(view, 'click', (e) => {
      const btn = e.target.closest('[data-dx]');
      if (!btn) return;
      if (btn.dataset.dx === 'retake') { Session.save(Session.create()); go('#/diagnostic/quiz'); }
      if (btn.dataset.dx === 'filter') filterReview(btn);
    });
  }

  function deltaChip(d, suffix = '') {
    if (!d) return '<li class="dx-delta dx-delta--flat">＝ Bằng lần trước</li>';
    return `<li class="dx-delta dx-delta--${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ '}${d}${suffix}</li>`;
  }

  function heatRows(attempt, prev) {
    const byTopic = {};
    if (Array.isArray(attempt.answers)) {
      attempt.answers.forEach((a, idx) => {
        const q = qMap.get(a.qid);
        if (!q) return;
        (byTopic[q.topic_id] ||= []).push({ ...a, no: idx + 1 });
      });
    }

    let i = 0;
    return [...tMap.values()].filter((t) => attempt.topic_scores[t.id] != null).map((t) => {
      const pct = attempt.topic_scores[t.id];
      const lvl = Mastery.level(pct);

      // Lượt làm không lưu chi tiết (dữ liệu mẫu) → dựng lại ô từ tỉ lệ %
      let cells = byTopic[t.id];
      if (!cells) {
        const n = [...qMap.values()].filter((q) => q.topic_id === t.id).length;
        const c = Math.round((pct / 100) * n);
        cells = Array.from({ length: n }, (_, k) => ({ correct: k < c, chosen: 0, no: null }));
      }
      const cellHTML = cells.map((c) => {
        const st = c.chosen === null ? 'skip' : c.correct ? 'ok' : 'bad';
        const label = { ok: 'Đúng', bad: 'Sai', skip: 'Bỏ trống' }[st];
        return `<span class="dx-cell dx-cell--${st}" title="${c.no ? 'Câu ' + c.no + ': ' : ''}${label}">${{ ok: '✓', bad: '✕', skip: '–' }[st]}</span>`;
      }).join('');

      const before = prev?.topic_scores?.[t.id];
      const d = before == null ? null : pct - before;
      const delta = d == null ? '' : `<span class="dx-mini-delta dx-mini-delta--${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '▲' : d < 0 ? '▼' : '＝'}${d ? Math.abs(d) : ''}</span>`;

      return `
        <div class="dx-row dx-row--${lvl}" role="row" style="--i:${i++}">
          <span class="dx-row__topic" role="cell"><span aria-hidden="true">${t.icon}</span><b>${esc(t.name)}</b></span>
          <span class="dx-cells" role="cell">${cellHTML}</span>
          <span class="dx-bar" role="cell">
            <span class="dx-bar__track"><span class="dx-bar__fill" data-w="${pct}"></span></span>
            <b>${pct}%</b>${delta}
          </span>
          <span role="cell"><span class="tag tag--${lvl}">${Mastery.label(lvl)}</span></span>
        </div>`;
    }).join('');
  }

  function roadmapHTML(road) {
    if (!road.steps.length) {
      return `<div class="dx-empty">🏆 Bạn đã làm chủ tất cả chủ đề! Lên Đấu trường để giữ phong độ nhé.
              <a class="btn btn--sm" data-mod="m3" href="#/arena">⚔️ Vào Đấu trường</a></div>`;
    }
    const items = road.steps.map((s, k) => `
      <li class="dx-step dx-step--${s.lvl}" style="--i:${k}">
        <span class="dx-step__node">${k + 1}</span>
        <div class="dx-step__body">
          <div class="dx-step__head">
            <b><span aria-hidden="true">${s.topic.icon}</span> ${esc(s.topic.name)}</b>
            <span class="tag tag--${s.lvl}">${s.pct}%</span>
          </div>
          <p class="dx-step__why">${esc(s.why)}</p>
          <ul class="dx-step__todo">${s.todo.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <div class="dx-step__foot">
            <span class="dx-muted">⏱ ~${s.minutes} phút</span>
            <a class="btn btn--sm ${k ? 'btn--ghost' : ''}" href="${s.href}">${k ? 'Ôn chủ đề này' : '▶ Bắt đầu bước 1'}</a>
          </div>
        </div>
      </li>`).join('');

    const keep = road.strong.length ? `
      <li class="dx-step dx-step--ok" style="--i:${road.steps.length}">
        <span class="dx-step__node">★</span>
        <div class="dx-step__body">
          <div class="dx-step__head"><b>Duy trì phong độ</b><span class="tag tag--ok">Làm chủ</span></div>
          <p class="dx-step__why">${road.strong.map((t) => esc(t.short)).join(', ')}: ôn nhanh qua Đấu trường 1vs1 để không quên.</p>
          <div class="dx-step__foot"><span class="dx-muted">⏱ ~5 phút/ngày</span><a class="btn btn--sm btn--ghost" href="#/arena">⚔️ Đấu trường</a></div>
        </div>
      </li>` : '';

    return `<ol class="dx-steps">${items}${keep}</ol>`;
  }

  function reviewHTML(attempt) {
    if (!Array.isArray(attempt.answers)) {
      return `<div class="dx-empty">Lượt làm này là dữ liệu mẫu nên không lưu chi tiết từng câu. Hãy làm một bài chẩn đoán mới để xem lại đáp án.</div>`;
    }
    const cnt = { all: attempt.answers.length, bad: 0, ok: 0, skip: 0 };
    const items = attempt.answers.map((a, k) => {
      const q = qMap.get(a.qid);
      if (!q) return '';
      const st = a.chosen === null ? 'skip' : a.correct ? 'ok' : 'bad';
      cnt[st] += 1;
      return `
        <details class="dx-rv dx-rv--${st}" data-st="${st}">
          <summary>
            <span class="dx-rv__no">${k + 1}</span>
            <span class="dx-rv__q">${esc(q.text)}</span>
            <span class="dx-rv__st" aria-label="${{ ok: 'Đúng', bad: 'Sai', skip: 'Bỏ trống' }[st]}">${{ ok: '✓', bad: '✕', skip: '–' }[st]}</span>
          </summary>
          <ul class="dx-rv__opts">
            ${q.options.map((o, i) => `
              <li class="${i === q.answer ? 'is-correct' : ''} ${i === a.chosen && !a.correct ? 'is-wrong' : ''}">
                <span class="dx-rv__key">${LETTERS[i]}</span><span>${esc(o)}</span>
                ${i === a.chosen ? '<em>Bạn chọn</em>' : ''}
              </li>`).join('')}
          </ul>
          <p class="dx-rv__exp">💡 ${esc(q.explain)}</p>
        </details>`;
    }).join('');

    const chip = (f, label) => `<button class="dx-chip" data-dx="filter" data-f="${f}" aria-pressed="${f === 'all'}">${label} <b>${cnt[f]}</b></button>`;
    return `
      <div class="dx-chips" role="group" aria-label="Lọc câu hỏi">
        ${chip('all', 'Tất cả')}${chip('bad', 'Sai')}${chip('ok', 'Đúng')}${cnt.skip ? chip('skip', 'Bỏ trống') : ''}
      </div>
      <div class="dx-rv-list">${items}</div>`;
  }

  function filterReview(btn) {
    const f = btn.dataset.f;
    view.querySelectorAll('.dx-chip').forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
    view.querySelectorAll('.dx-rv').forEach((d) => { d.hidden = f !== 'all' && d.dataset.st !== f; });
  }

  function animateScore(score, total) {
    const ring = $('#dxScoreRing');
    const num = $('#dxScore');
    if (!ring || !num) return;
    const target = (score / total) * 100;
    const D = reduceMotion() ? 0 : 1100;
    const t0 = performance.now();
    const step = (now) => {
      const k = D ? Math.min(1, (now - t0) / D) : 1;
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      num.textContent = Math.round(score * e);
      ring.style.setProperty('--p', (target * e).toFixed(1));
      if (k < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  /* =========================================================
     ĐĂNG KÝ PHÂN HỆ VỚI ROUTER
     ========================================================= */
  Modules.register('diagnostic', {
    render(container, { params = [] } = {}) {
      teardown();
      view = container;
      const [mode, id] = params;

      if (mode === 'quiz') {
        const saved = Session.load();
        if (Session.isValid(saved)) { S = saved; return renderQuiz(); }
        S = null;
      }
      if (mode === 'result') {
        const a = id ? DB.get('quiz_attempts', Number(id)) : latestAttempt();
        if (a) return renderResult(a);
      }
      S = null;
      renderIntro();
    },
    unmount() {
      teardown();
      S = null;
    }
  });
})();
