/* =========================================================
   ChemRescue — Phân hệ 5: Dashboard Giáo viên (Learning Analytics)
   ---------------------------------------------------------
   #/teacher
   • KPI lớp học · 4 biểu đồ Chart.js (hoạt động 7 ngày, điểm theo chủ đề,
     phân bố mức cảnh báo, thời gian học ↔ điểm) · luồng hoạt động trực tiếp
   • Cảnh báo học sinh tụt hậu: chấm rủi ro theo điểm, số ngày không học,
     thời lượng học/tuần, số chủ đề đỏ → tag Đỏ / Vàng kèm lý do & gợi ý can thiệp
   • Export: CSV (UTF-8 BOM, mở đúng tiếng Việt) và Excel (.xls)
   Chart.js được nạp "lười" khi mở trang; offline → biểu đồ rút gọn bằng CSS.
   DỮ LIỆU THẬT: cần mã PIN giáo viên → tải từ máy chủ (/api/teacher/overview)
   rồi nạp vào bảng students / activity_log; bật "Trực tiếp" → tự tải lại mỗi 15 giây.
   ========================================================= */
(() => {
  'use strict';

  const { DB, Modules, toast, esc, bus, download } = window.ChemRescue;

  /* ---------- CẤU HÌNH ---------- */
  const CHART_SRC = [
    'js/vendor/chart.umd.js',                                  // tùy chọn: đặt file vào đây để chạy offline
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
    'https://unpkg.com/chart.js@4.4.1/dist/chart.umd.js'
  ];
  const LOAD_TIMEOUT = 6000;
  const LIVE_MS = 15000; // Tải lại dữ liệu lớp học mỗi 15 giây khi bật "Trực tiếp"
  const Session = window.ChemSession;
  const C = {
    ok: '#22c55e', warn: '#f5b800', bad: '#ef4444',
    primary: '#5b5bf7', m5: '#1e9bf0', muted: '#6a7096', line: '#e4e7f3', ink: '#1c1f3a'
  };
  const LEVEL = {
    bad:  { label: 'Cần can thiệp', short: 'Đỏ',   color: C.bad,  rank: 2 },
    warn: { label: 'Cần theo dõi',  short: 'Vàng', color: C.warn, rank: 1 },
    ok:   { label: 'Ổn định',       short: 'Xanh', color: C.ok,   rank: 0 }
  };

  /* ---------- TIỆN ÍCH ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const today = () => DB.localDate();
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
  const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const initials = (name) => name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 5) return 'vừa xong';
    if (s < 60) return `${s} giây trước`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} phút trước` : `${Math.round(m / 60)} giờ trước`;
  };
  const idleText = (d) => (d <= 0 ? 'hoạt động hôm nay' : d === 1 ? 'hoạt động hôm qua' : `${d} ngày chưa học`);

  /* ---------- NẠP CHART.JS (lười, có dự phòng) ---------- */
  let chartPromise = null;
  function loadChartJs() {
    if (window.Chart) return Promise.resolve(true);
    if (chartPromise) return chartPromise;
    chartPromise = new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (window.Chart) return resolve(true);
        if (i >= CHART_SRC.length) return resolve(false);
        const s = document.createElement('script');
        s.src = CHART_SRC[i++];
        s.async = true;
        const done = (ok) => { clearTimeout(timer); s.onload = s.onerror = null; if (!ok) s.remove(); window.Chart ? resolve(true) : tryNext(); };
        const timer = setTimeout(() => done(false), LOAD_TIMEOUT);
        s.onload = () => done(true);
        s.onerror = () => done(false);
        document.head.appendChild(s);
      };
      tryNext();
    });
    chartPromise.then((ok) => { if (!ok) chartPromise = null; }); // cho phép thử lại
    return chartPromise;
  }

  /* ---------- DỮ LIỆU TỪ MÁY CHỦ ---------- */
  const Remote = { feed: [] };

  // Tải dữ liệu lớp học thật, nạp vào bảng students / activity_log (chỉ trong bộ nhớ)
  async function fetchOverview() {
    const r = await Session.api('/api/teacher/overview', { pin: Session.teacherPin() });
    DB.replaceTable('students', r.students);
    DB.replaceTable('activity_log', r.activity_log);
    Remote.feed = r.feed || [];
    return r;
  }

  /* =========================================================
     PHÂN TÍCH RỦI RO
     ========================================================= */
  function analyze(s, topics) {
    const score = (t) => s.topic_scores?.[t.id] ?? 0;
    const noDiag = !s.topic_scores || !Object.keys(s.topic_scores).length; // chưa làm bài chẩn đoán
    const avg = Math.round(mean(topics.map(score)));
    const idle = Math.max(0, daysBetween(s.last_active, today()));
    const red = topics.filter((t) => score(t) < 50);
    const weakest = topics.slice().sort((a, b) => score(a) - score(b))[0];
    const reasons = [];
    let level = 'ok';
    const flag = (lv, text) => {
      reasons.push({ lv, text });
      if (LEVEL[lv].rank > LEVEL[level].rank) level = lv;
    };

    if (noDiag) flag('warn', 'Chưa làm bài chẩn đoán');
    else if (avg < 50) flag('bad', `Điểm TB ${avg}%`); else if (avg < 70) flag('warn', `Điểm TB ${avg}%`);
    if (idle >= 5) flag('bad', `${idle} ngày chưa học`); else if (idle >= 3) flag('warn', `${idle} ngày chưa học`);
    // Tài khoản mới (< 7 ngày) chưa đủ một tuần để đánh giá thời lượng học
    const newbie = s.joined && daysBetween(s.joined, today()) < 7;
    if (newbie) { /* bỏ qua tiêu chí phút học/tuần */ }
    else if (s.minutes_week < 30) flag('bad', `Chỉ ${s.minutes_week} phút/tuần`); else if (s.minutes_week < 60) flag('warn', `${s.minutes_week} phút/tuần`);
    if (noDiag) { /* chưa có điểm → không xét chủ đề đỏ */ }
    else if (red.length >= 3) flag('bad', `${red.length} chủ đề đỏ`); else if (red.length === 2) flag('warn', `2 chủ đề đỏ`);

    const actions = [];
    if (noDiag) actions.push('Nhắc làm bài chẩn đoán ở Phân hệ 1');
    else if (weakest && score(weakest) < 80) actions.push(`Giao lộ trình ôn “${weakest.short}”`);
    if (idle >= 3) actions.push('Nhắc lịch học, khôi phục Streak');
    if (!newbie && s.minutes_week < 60) actions.push('Đặt mục tiêu ≥ 15 phút/ngày');

    const risk = (100 - avg) + idle * 8 + Math.max(0, 90 - s.minutes_week) / 3 + red.length * 5;
    return { ...s, avg, noDiag, idle, red, weakest, reasons, level, actions, risk: Math.round(risk) };
  }

  /* =========================================================
     TRẠNG THÁI & VÒNG ĐỜI
     ========================================================= */
  let view = null;
  let cleanup = [];
  let charts = {};
  let hasChart = false;
  const ui = { cls: 'all', filter: 'alerts', q: '', live: true };
  let live = null;

  const on = (el, evt, fn, opt) => { el.addEventListener(evt, fn, opt); cleanup.push(() => el.removeEventListener(evt, fn, opt)); };

  function teardown() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    Object.values(charts).forEach((c) => c?.destroy?.());
    charts = {};
    live = null;
  }

  function dataset() {
    const topics = DB.select('topics');
    const rows = DB.select('students', ui.cls === 'all' ? null : { class_id: ui.cls }).map((s) => analyze(s, topics));
    rows.sort((a, b) => b.risk - a.risk);
    return { topics, rows };
  }

  /* =========================================================
     RENDER KHUNG
     ========================================================= */
  function render() {
    const classes = [...new Set(DB.select('students').map((s) => s.class_id))].sort();
    const log = DB.select('activity_log', null, { orderBy: 'date asc' });
    const todayLog = log.find((l) => l.date === today());
    live = {
      baseActive: todayLog?.active_students ?? 0,
      minutes: todayLog?.total_minutes ?? 0,
      newlyActive: new Set(),
      feed: Remote.feed
    };

    view.innerHTML = `
      <section class="mod-banner" data-mod="m5">
        <span class="mod-banner__icon" aria-hidden="true">📊</span>
        <div>
          <span class="tag">Phân hệ 5</span>
          <h2>Dashboard Giáo viên</h2>
          <p>Theo dõi tiến độ lớp học, phát hiện sớm học sinh tụt hậu và xuất dữ liệu để báo cáo.</p>
        </div>
      </section>

      <section class="card tc-toolbar">
        <div class="tc-seg" role="group" aria-label="Chọn lớp">
          <button class="tc-seg__btn" data-cls="all" aria-pressed="${ui.cls === 'all'}">Toàn khối</button>
          ${classes.map((c) => `<button class="tc-seg__btn" data-cls="${esc(c)}" aria-pressed="${ui.cls === c}">Lớp ${esc(c)}</button>`).join('')}
        </div>
        <button class="tc-live ${ui.live ? 'is-on' : ''}" data-tc="live" aria-pressed="${ui.live}" title="Bật/tắt cập nhật thời gian thực">
          <span class="tc-live__dot" aria-hidden="true"></span><span>Trực tiếp</span>
        </button>
        <div class="tc-export">
          <button class="btn btn--sm" data-mod="m5" data-tc="csv">⬇️ Export CSV</button>
          <button class="btn btn--ghost btn--sm" data-tc="xls">📗 Excel (.xls)</button>
        </div>
      </section>

      <section class="tc-kpis" id="tcKpis"></section>

      <div class="tc-notice" id="tcNotice" hidden></div>

      <div class="tc-grid">
        <section class="card tc-chart tc-chart--activity">
          <div class="card__head"><h3>📈 Hoạt động 7 ngày qua</h3><span class="tag">Toàn khối</span></div>
          <div class="tc-canvas tc-canvas--tall" id="tcActivityBox"><canvas id="tcActivity" role="img" aria-label="Biểu đồ số học sinh hoạt động và điểm trung bình 7 ngày"></canvas></div>
        </section>

        <section class="card tc-feed">
          <div class="card__head"><h3><span class="tc-rec" aria-hidden="true"></span> Luồng hoạt động</h3><span class="dx-muted" id="tcFeedState"></span></div>
          <ul class="tc-feed__list" id="tcFeed" aria-live="polite"></ul>
          <p class="tc-feed__note">Hoạt động thật của học sinh · tự cập nhật mỗi 15 giây khi bật <b>Trực tiếp</b>.</p>
        </section>

        <section class="card tc-chart">
          <div class="card__head"><h3>🧪 Điểm TB theo chủ đề</h3></div>
          <div class="tc-canvas" id="tcTopicsBox"><canvas id="tcTopics" role="img" aria-label="Biểu đồ điểm trung bình theo chủ đề"></canvas></div>
        </section>

        <section class="card tc-chart">
          <div class="card__head"><h3>🚦 Phân bố mức cảnh báo</h3></div>
          <div class="tc-canvas tc-donut" id="tcLevelsBox">
            <canvas id="tcLevels" role="img" aria-label="Biểu đồ phân bố mức cảnh báo"></canvas>
            <div class="tc-donut__center" id="tcDonutCenter"></div>
          </div>
          <ul class="tc-legend" id="tcLevelsLegend"></ul>
        </section>

        <section class="card tc-chart">
          <div class="card__head"><h3>⏱️ Thời gian học ↔ Điểm</h3></div>
          <div class="tc-canvas" id="tcScatterBox"><canvas id="tcScatter" role="img" aria-label="Biểu đồ phân tán thời gian học mỗi tuần và điểm trung bình"></canvas></div>
        </section>
      </div>

      <section class="card tc-alerts">
        <div class="card__head tc-alerts__head">
          <div>
            <h3>🚨 Cảnh báo học sinh tụt hậu</h3>
            <p class="dx-muted">Sắp xếp theo mức rủi ro: điểm, số ngày không học, thời lượng học và số chủ đề đỏ.</p>
          </div>
          <label class="tc-search">
            <span aria-hidden="true">🔎</span>
            <input type="search" id="tcSearch" placeholder="Tìm học sinh…" value="${esc(ui.q)}" aria-label="Tìm học sinh theo tên">
          </label>
        </div>
        <div class="dx-chips" id="tcChips" role="group" aria-label="Lọc theo mức cảnh báo"></div>
        <div class="tc-table" role="table" aria-label="Danh sách học sinh">
          <div class="tc-thead" role="row">
            <span role="columnheader">Học sinh</span>
            <span role="columnheader">Chủ đề</span>
            <span role="columnheader">Điểm TB</span>
            <span role="columnheader">Lý do</span>
            <span role="columnheader">Mức</span>
            <span role="columnheader"><span class="sr-only">Thao tác</span></span>
          </div>
          <div id="tcRows"></div>
        </div>
      </section>`;

    refresh();
    renderFeed();
    bind();
    setupCharts();
  }

  /* ---------- Cập nhật các phần phụ thuộc bộ lọc ---------- */
  function refresh() {
    const D = dataset();
    renderKpis(D);
    renderChips(D);
    renderRows(D);
    if (hasChart) updateCharts(D); else if (charts.fallback) renderFallback(D);
    renderLegend(D);
  }

  function renderKpis(D) {
    const n = D.rows.length;
    const activeToday = D.rows.filter((r) => r.idle === 0 || live.newlyActive.has(r.id)).length;
    const avg = Math.round(mean(D.rows.filter((r) => !r.noDiag).map((r) => r.avg)));
    const bad = D.rows.filter((r) => r.level === 'bad').length;
    const warn = D.rows.filter((r) => r.level === 'warn').length;
    $('#tcKpis').innerHTML = `
      <div class="card tc-kpi"><span class="tc-kpi__icon" aria-hidden="true">👩‍🎓</span><div><b>${n}</b><span>Học sinh${ui.cls === 'all' ? ' toàn khối' : ' lớp ' + esc(ui.cls)}</span></div></div>
      <div class="card tc-kpi"><span class="tc-kpi__icon" aria-hidden="true">🟢</span><div><b id="tcActiveKpi">${activeToday}/${n}</b><span>Hoạt động hôm nay · <span id="tcMinKpi">${live.minutes}</span> phút</span></div></div>
      <div class="card tc-kpi"><span class="tc-kpi__icon" aria-hidden="true">🎯</span><div><b>${avg}%</b><span>Điểm trung bình</span></div></div>
      <div class="card tc-kpi tc-kpi--alert"><span class="tc-kpi__icon" aria-hidden="true">🚨</span>
        <div><b><span class="tc-c-bad">${bad}</span> · <span class="tc-c-warn">${warn}</span></b><span>Đỏ · Vàng cần xử lý</span></div></div>`;
  }

  function renderChips(D) {
    const cnt = { alerts: 0, bad: 0, warn: 0, ok: 0, all: D.rows.length };
    D.rows.forEach((r) => { cnt[r.level] += 1; if (r.level !== 'ok') cnt.alerts += 1; });
    const chip = (f, label) => `<button class="dx-chip tc-chip tc-chip--${f}" data-filter="${f}" aria-pressed="${ui.filter === f}">${label} <b>${cnt[f]}</b></button>`;
    $('#tcChips').innerHTML = chip('alerts', '⚠️ Cần chú ý') + chip('bad', '🔴 Đỏ') + chip('warn', '🟡 Vàng') + chip('ok', '🟢 Ổn định') + chip('all', 'Tất cả');
  }

  function renderRows(D) {
    const reminded = DB.meta().reminders || {};
    const q = fold(ui.q.trim());
    const rows = D.rows.filter((r) => {
      if (ui.filter === 'alerts' && r.level === 'ok') return false;
      if (['bad', 'warn', 'ok'].includes(ui.filter) && r.level !== ui.filter) return false;
      return !q || fold(r.name).includes(q);
    });

    $('#tcRows').innerHTML = rows.length ? rows.map((r, i) => {
      const L = LEVEL[r.level];
      const done = reminded[r.id] === today();
      return `
        <div class="tc-row tc-row--${r.level}" role="row" style="--i:${i}">
          <div class="tc-st" role="cell">
            <span class="tc-ava tc-ava--${r.level}" aria-hidden="true">${initials(r.name)}</span>
            <div><b>${esc(r.name)}</b><small>Lớp ${esc(r.class_id)} · ${idleText(r.idle)} · 🔥${r.streak}</small></div>
          </div>
          <div class="tc-heat" role="cell" aria-label="Điểm theo chủ đề">
            ${D.topics.map((t) => {
              const p = r.topic_scores?.[t.id] ?? 0;
              const lv = p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'bad';
              return `<span class="tc-cell tc-cell--${lv}" title="${esc(t.name)}: ${p}%">${t.icon}</span>`;
            }).join('')}
          </div>
          <div class="tc-avg" role="cell">
            <b>${r.noDiag ? '—' : r.avg + '%'}</b>
            <span class="tc-avg__bar"><span style="width:${r.noDiag ? 0 : r.avg}%;background:${L.color}"></span></span>
          </div>
          <div class="tc-reasons" role="cell">
            ${r.reasons.length ? r.reasons.map((x) => `<span class="tc-reason tc-reason--${x.lv}">${esc(x.text)}</span>`).join('') : '<span class="tc-reason tc-reason--ok">Tiến độ tốt</span>'}
            ${r.actions.length && r.level !== 'ok' ? `<small class="tc-suggest">💡 ${esc(r.actions.join(' · '))}</small>` : ''}
          </div>
          <div role="cell"><span class="tag tag--${r.level}">${L.short} · ${L.label}</span></div>
          <div class="tc-act" role="cell">
            ${r.level === 'ok' ? '' : done
              ? '<span class="tc-done">✓ Đã nhắc</span>'
              : `<button class="btn btn--ghost btn--sm" data-remind="${r.id}">🔔 Nhắc</button>`}
            <button class="btn btn--ghost btn--sm tc-del" data-del="${r.id}" title="Xóa tài khoản ${esc(r.name)}" aria-label="Xóa tài khoản ${esc(r.name)}">🗑</button>
          </div>
        </div>`;
    }).join('') : DB.count('students') === 0
      ? `<p class="tc-empty">Chưa có học sinh nào đăng nhập. Hãy gửi đường link trang web cho học sinh – các em nhập <b>họ tên + lớp</b> để bắt đầu.</p>`
      : `<p class="tc-empty">Không có học sinh nào khớp bộ lọc.</p>`;
  }

  function renderLegend(D) {
    const cnt = { bad: 0, warn: 0, ok: 0 };
    D.rows.forEach((r) => { cnt[r.level] += 1; });
    $('#tcLevelsLegend').innerHTML = ['bad', 'warn', 'ok'].map((k) =>
      `<li><i style="background:${LEVEL[k].color}"></i>${LEVEL[k].label}<b>${cnt[k]}</b></li>`).join('');
    $('#tcDonutCenter').innerHTML = `<b>${cnt.bad + cnt.warn}</b><span>cần chú ý</span>`;
  }

  /* =========================================================
     BIỂU ĐỒ
     ========================================================= */
  async function setupCharts() {
    const notice = $('#tcNotice');
    view.querySelectorAll('.tc-canvas').forEach((b) => b.classList.add('is-loading'));
    const ok = await loadChartJs();
    if (!view || !$('#tcActivity')) return;            // đã rời trang trong lúc chờ
    view.querySelectorAll('.tc-canvas').forEach((b) => b.classList.remove('is-loading'));
    hasChart = ok;
    if (ok) {
      notice.hidden = true;
      makeCharts(dataset());
    } else {
      notice.hidden = false;
      notice.innerHTML = `⚠️ Không tải được thư viện Chart.js (thiết bị đang offline?). Đang hiển thị biểu đồ rút gọn.
        <button class="btn btn--ghost btn--sm" data-tc="retry">↻ Thử lại</button>`;
      charts.fallback = true;
      renderFallback(dataset());
    }
  }

  const levelOf = (p) => (p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'bad');
  const activityData = () => {
    const log = DB.select('activity_log', null, { orderBy: 'date asc' });
    return {
      labels: log.map((l) => (l.date === today() ? 'Hôm nay' : fmtDate(l.date).slice(0, 5))),
      active: log.map((l) => (l.date === today() ? live.baseActive + live.newlyActive.size : l.active_students)),
      score: log.map((l) => l.avg_score)
    };
  };
  const topicData = (D) => D.topics.map((t) => Math.round(mean(D.rows.filter((r) => r.topic_scores?.[t.id] != null).map((r) => r.topic_scores[t.id]))));
  const levelCounts = (D) => ['bad', 'warn', 'ok'].map((k) => D.rows.filter((r) => r.level === k).length);

  function makeCharts(D) {
    const Chart = window.Chart;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = C.muted;
    Chart.defaults.borderColor = C.line;
    Chart.defaults.plugins.tooltip.backgroundColor = C.ink;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    const base = { responsive: true, maintainAspectRatio: false, animation: { duration: reduceMotion() ? 0 : 700 } };

    const A = activityData();
    charts.activity = new Chart($('#tcActivity'), {
      type: 'bar',
      data: {
        labels: A.labels,
        datasets: [
          { type: 'bar', label: 'Học sinh hoạt động', data: A.active, yAxisID: 'y', order: 2,
            backgroundColor: A.labels.map((l) => (l === 'Hôm nay' ? C.m5 : 'rgba(30,155,240,.45)')), borderRadius: 8, maxBarThickness: 38 },
          { type: 'line', label: 'Điểm TB (%)', data: A.score, yAxisID: 'y1', order: 1,
            borderColor: C.primary, backgroundColor: C.primary, borderWidth: 3, tension: 0.35, pointRadius: 4, pointHoverRadius: 6 }
        ]
      },
      options: {
        ...base,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } } },
        scales: {
          y: { beginAtZero: true, suggestedMax: 10, ticks: { precision: 0 }, title: { display: true, text: 'Học sinh' } },
          y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: (v) => `${v}%` }, title: { display: true, text: 'Điểm TB' } },
          x: { grid: { display: false } }
        }
      }
    });

    const T = topicData(D);
    charts.topics = new Chart($('#tcTopics'), {
      type: 'bar',
      data: {
        labels: D.topics.map((t) => `${t.icon} ${t.short}`),
        datasets: [{ label: 'Điểm TB', data: T, backgroundColor: T.map((v) => LEVEL[levelOf(v)].color), borderRadius: 8, maxBarThickness: 22 }]
      },
      options: {
        ...base,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.parsed.x}% · ${LEVEL[levelOf(c.parsed.x)].label}` } }
        },
        scales: { x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } }
      }
    });

    charts.levels = new Chart($('#tcLevels'), {
      type: 'doughnut',
      data: {
        labels: ['bad', 'warn', 'ok'].map((k) => LEVEL[k].label),
        datasets: [{ data: levelCounts(D), backgroundColor: [C.bad, C.warn, C.ok], borderColor: '#fff', borderWidth: 3, hoverOffset: 6 }]
      },
      options: { ...base, cutout: '68%', plugins: { legend: { display: false } } }
    });

    charts.scatter = new Chart($('#tcScatter'), {
      type: 'scatter',
      data: { datasets: [scatterDataset(D)] },
      options: {
        ...base,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.raw.name}: ${c.raw.x} phút/tuần · ${c.raw.y}%` } }
        },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: 'Phút học / tuần' } },
          y: { min: 0, max: 100, title: { display: true, text: 'Điểm TB (%)' }, ticks: { callback: (v) => `${v}%` } }
        }
      }
    });
  }

  function scatterDataset(D) {
    return {
      label: 'Học sinh',
      data: D.rows.map((r) => ({ x: r.minutes_week, y: r.avg, name: r.name })),
      pointBackgroundColor: D.rows.map((r) => LEVEL[r.level].color),
      pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 7, pointHoverRadius: 10
    };
  }

  function updateCharts(D) {
    if (!charts.topics) return;
    const T = topicData(D);
    charts.topics.data.datasets[0].data = T;
    charts.topics.data.datasets[0].backgroundColor = T.map((v) => LEVEL[levelOf(v)].color);
    charts.topics.update();
    charts.levels.data.datasets[0].data = levelCounts(D);
    charts.levels.update();
    charts.scatter.data.datasets[0] = scatterDataset(D);
    charts.scatter.update();
  }

  function updateActivityChart() {
    const A = activityData();
    if (hasChart && charts.activity) {
      charts.activity.data.datasets[0].data = A.active;
      charts.activity.update();
    } else if (charts.fallback) {
      renderFallbackActivity(A);
    }
  }

  /* ---------- Biểu đồ dự phòng bằng CSS (khi không có Chart.js) ---------- */
  function renderFallbackActivity(A) {
    const max = Math.max(10, ...A.active);
    $('#tcActivityBox').innerHTML = `
      <div class="fb-cols">
        ${A.labels.map((l, i) => `
          <div class="fb-col${l === 'Hôm nay' ? ' is-today' : ''}">
            <span class="fb-col__score" title="Điểm TB">${A.score[i] == null ? '—' : A.score[i] + '%'}</span>
            <div class="fb-col__bar" style="height:${(A.active[i] / max) * 100}%"><b>${A.active[i]}</b></div>
            <small>${l}</small>
          </div>`).join('')}
      </div>
      <p class="fb-note">Cột: số học sinh hoạt động · Số phía trên: điểm TB</p>`;
  }

  function renderFallback(D) {
    renderFallbackActivity(activityData());
    const T = topicData(D);
    $('#tcTopicsBox').innerHTML = `<div class="fb-hbars">${D.topics.map((t, i) => `
      <div class="fb-hbar"><span>${t.icon} ${esc(t.short)}</span>
        <div><i style="width:${T[i]}%;background:${LEVEL[levelOf(T[i])].color}"></i></div><b>${T[i]}%</b></div>`).join('')}</div>`;

    const [b, w, o] = levelCounts(D);
    const total = Math.max(1, b + w + o);
    $('#tcLevels')?.remove();
    const box = $('#tcLevelsBox');
    box.style.setProperty('--b', (b / total) * 100);
    box.style.setProperty('--w', (w / total) * 100);
    box.classList.add('fb-donut');

    const maxX = Math.max(60, ...D.rows.map((r) => r.minutes_week));
    $('#tcScatterBox').innerHTML = `
      <div class="fb-scatter">
        ${D.rows.map((r) => `<span class="fb-dot" style="left:${(r.minutes_week / maxX) * 100}%;bottom:${r.avg}%;background:${LEVEL[r.level].color}" title="${esc(r.name)}: ${r.minutes_week} phút · ${r.avg}%"></span>`).join('')}
        <span class="fb-axis fb-axis--x">Phút học / tuần →</span><span class="fb-axis fb-axis--y">Điểm ↑</span>
      </div>`;
  }

  /* =========================================================
     LUỒNG TRỰC TIẾP
     ========================================================= */
  function renderFeed() {
    const items = live.feed.slice().sort((a, b) => b.at - a.at).slice(0, 7);
    $('#tcFeed').innerHTML = items.length ? items.map((e, i) => `
      <li class="tc-ev tc-ev--real${i === 0 && Date.now() - e.at < LIVE_MS ? ' is-new' : ''}">
        <span class="tc-ev__icon" aria-hidden="true">${e.icon}</span>
        <div><b>${esc(e.who)}</b> ${esc(e.text)}<small>${ago(e.at)}</small></div>
      </li>`).join('') : '<li class="tc-empty">Chưa có hoạt động nào…</li>';
    $('#tcFeedState').textContent = ui.live ? '● đang cập nhật' : 'đã tạm dừng';
  }

  // Tải lại dữ liệu thật từ máy chủ (gọi định kỳ khi bật "Trực tiếp")
  async function pollTick() {
    if (!ui.live || !live) return;
    try {
      const r = await fetchOverview();
      if (!live || !view) return;                       // đã rời trang trong lúc chờ
      const todayLog = r.activity_log.find((l) => l.date === today());
      live.baseActive = todayLog?.active_students ?? 0;
      live.minutes = todayLog?.total_minutes ?? 0;
      live.feed = Remote.feed;
      refresh();
      renderFeed();
      const k = $('#tcActiveKpi');
      if (k && !reduceMotion()) { k.classList.remove('bump'); void k.offsetWidth; k.classList.add('bump'); }
    } catch (err) {
      if (err.status === 401 || err.status === 503) { Session.clearTeacherPin(); showPinForm(err.message); }
    }
  }

  /* =========================================================
     EXPORT
     ========================================================= */
  function exportRows() {
    const D = dataset();
    const header = ['Họ tên', 'Lớp', 'Điểm TB (%)', ...D.topics.map((t) => `${t.name} (%)`),
      'Phút học/tuần', 'Chuỗi ngày', 'Hoạt động gần nhất', 'Số ngày chưa học', 'Mức cảnh báo', 'Lý do', 'Gợi ý can thiệp'];
    const body = D.rows.map((r) => [
      r.name, r.class_id, r.avg, ...D.topics.map((t) => r.topic_scores?.[t.id] ?? 0),
      r.minutes_week, r.streak, fmtDate(r.last_active), r.idle,
      `${LEVEL[r.level].short} - ${LEVEL[r.level].label}`,
      r.reasons.map((x) => x.text).join('; '),
      r.actions.join('; ')
    ]);
    return { header, body, levels: D.rows.map((r) => r.level) };
  }

  const fileBase = () => `chemrescue-${ui.cls === 'all' ? 'toan-khoi' : ui.cls}-${today()}`;

  function exportCSV() {
    const { header, body } = exportRows();
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // BOM \uFEFF để Excel nhận đúng UTF-8 (tiếng Việt có dấu); CRLF theo chuẩn RFC 4180
    const csv = '\uFEFF' + [header, ...body].map((r) => r.map(cell).join(',')).join('\r\n');
    download(`${fileBase()}.csv`, csv, 'text/csv;charset=utf-8');
    toast(`Đã xuất <b>${body.length}</b> học sinh ra CSV`, '⬇️');
  }

  function exportXLS() {
    const { header, body, levels } = exportRows();
    const bg = { bad: '#fde8e8', warn: '#fff6d6', ok: '#e6f9ee' };
    const td = (v, style = '') => `<td style="mso-number-format:'\\@';${style}">${esc(v)}</td>`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>ChemRescue</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body><table border="1" style="border-collapse:collapse;font-family:Arial">
<tr>${header.map((h) => `<th style="background:#1e9bf0;color:#fff">${esc(h)}</th>`).join('')}</tr>
${body.map((r, i) => `<tr>${r.map((v, j) => (typeof v === 'number' ? `<td>${v}</td>` : td(v, j === 8 ? `background:${bg[levels[i]]};font-weight:bold` : ''))).join('')}</tr>`).join('\n')}
</table></body></html>`;
    download(`${fileBase()}.xls`, html, 'application/vnd.ms-excel;charset=utf-8');
    toast(`Đã xuất <b>${body.length}</b> học sinh ra Excel`, '📗');
  }

  /* =========================================================
     SỰ KIỆN
     ========================================================= */
  function bind() {
    on(view, 'click', (e) => {
      const cls = e.target.closest('[data-cls]');
      if (cls) {
        ui.cls = cls.dataset.cls;
        view.querySelectorAll('[data-cls]').forEach((b) => b.setAttribute('aria-pressed', String(b === cls)));
        refresh();
        return;
      }
      const f = e.target.closest('[data-filter]');
      if (f) { ui.filter = f.dataset.filter; const D = dataset(); renderChips(D); renderRows(D); return; }

      const r = e.target.closest('[data-remind]');
      if (r) {
        const id = Number(r.dataset.remind);
        const s = DB.get('students', id);
        const reminders = { ...(DB.meta().reminders || {}), [id]: today() };
        DB.meta({ reminders });
        const a = analyze(s, DB.select('topics'));
        toast(`Đã ghi nhận cần nhắc <b>${esc(s.name)}</b>${a.actions[0] ? ': ' + esc(a.actions[0]) : ''}`, '🔔', 3200);
        renderRows(dataset());
        return;
      }

      const del = e.target.closest('[data-del]');
      if (del) { deleteStudent(Number(del.dataset.del)); return; }

      const act = e.target.closest('[data-tc]')?.dataset.tc;
      if (act === 'csv') exportCSV();
      if (act === 'xls') exportXLS();
      if (act === 'live') {
        ui.live = !ui.live;
        const b = e.target.closest('[data-tc]');
        b.classList.toggle('is-on', ui.live);
        b.setAttribute('aria-pressed', String(ui.live));
        renderFeed();
      }
      if (act === 'retry') {
        $('#tcNotice').innerHTML = '⏳ Đang tải lại Chart.js…';
        Object.values(charts).forEach((c) => c?.destroy?.());
        charts = {};
        teardown(); render();
      }
    });

    on(view, 'input', (e) => {
      if (e.target.id !== 'tcSearch') return;
      ui.q = e.target.value;
      renderRows(dataset());
    });

    const timer = setInterval(pollTick, LIVE_MS);
    cleanup.push(() => clearInterval(timer));
  }

  async function deleteStudent(id) {
    const st = DB.get('students', id);
    if (!st) return;
    if (!window.confirm(`Xóa tài khoản "${st.name}" (lớp ${st.class_id})?\nToàn bộ tiến độ học của em này sẽ bị xóa vĩnh viễn.`)) return;
    try {
      await Session.api(`/api/teacher/students/${id}`, { method: 'DELETE', pin: Session.teacherPin() });
      toast(`Đã xóa tài khoản <b>${esc(st.name)}</b>`, '🗑');
      await fetchOverview();
      if (view) { teardown(); render(); }
    } catch (err) {
      toast(esc(err.message), '⚠️', 3500);
    }
  }

  /* =========================================================
     MÃ PIN GIÁO VIÊN & TẢI DỮ LIỆU
     ========================================================= */
  const BANNER = `
    <section class="mod-banner" data-mod="m5">
      <span class="mod-banner__icon" aria-hidden="true">📊</span>
      <div>
        <span class="tag">Phân hệ 5</span>
        <h2>Dashboard Giáo viên</h2>
        <p>Theo dõi tiến độ lớp học, phát hiện sớm học sinh tụt hậu và xuất dữ liệu để báo cáo.</p>
      </div>
    </section>`;

  function showPinForm(message = '') {
    if (!view) return;
    teardown();
    view.innerHTML = `${BANNER}
      <section class="card tc-pin">
        <h3>🔒 Khu vực dành cho giáo viên</h3>
        <p class="dx-muted">Nhập mã PIN giáo viên để xem kết quả học tập của học sinh.</p>
        <form id="tcPinForm" class="tc-pin__form" autocomplete="off">
          <input id="tcPin" type="password" inputmode="numeric" maxlength="32" placeholder="Mã PIN" aria-label="Mã PIN giáo viên" required>
          <button class="btn" data-mod="m5" type="submit">Mở Dashboard</button>
        </form>
        <p class="tc-pin__error" id="tcPinError" role="alert">${esc(message)}</p>
      </section>`;
    const form = $('#tcPinForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = $('#tcPin').value.trim();
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await Session.api('/api/auth/teacher', { method: 'POST', body: { pin } });
        Session.setTeacherPin(pin);
        loadAndRender();
      } catch (err) {
        $('#tcPinError').textContent = err.message;
        btn.disabled = false;
      }
    });
    $('#tcPin').focus();
  }

  async function loadAndRender() {
    if (!view) return;
    if (!Session?.teacherPin()) return showPinForm();
    view.innerHTML = `${BANNER}<section class="card tc-pin"><p>⏳ Đang tải dữ liệu lớp học…</p></section>`;
    try {
      await fetchOverview();
      if (!view) return;
      render();
    } catch (err) {
      if (err.status === 401 || err.status === 503 || err.status === 429) {
        Session.clearTeacherPin();
        showPinForm(err.message);
      } else if (view) {
        view.innerHTML = `${BANNER}<section class="card tc-pin"><p>⚠️ ${esc(err.message)}</p>
          <button class="btn btn--ghost btn--sm" id="tcReload">↻ Thử lại</button></section>`;
        $('#tcReload').addEventListener('click', loadAndRender);
      }
    }
  }

  /* =========================================================
     ĐĂNG KÝ PHÂN HỆ
     ========================================================= */
  Modules.register('teacher', {
    render(container) {
      teardown();
      view = container;
      loadAndRender();
    },
    unmount() { teardown(); view = null; }
  });
})();
