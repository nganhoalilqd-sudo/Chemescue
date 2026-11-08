/* =========================================================
   ChemRescue — Phân hệ 4: Cây kỹ năng & Tủ huy hiệu
   ---------------------------------------------------------
   Màn hình:
     #/skills          → Cây kỹ năng RPG (4 nhánh × 4 bậc, gốc ở dưới)
     #/skills/badges   → Tủ huy hiệu (12 ô)
   Luật mở khóa nút kỹ năng (cả 3 điều kiện):
     1. Đã mở nút tiên quyết (bậc dưới cùng nhánh)
     2. Độ nắm vững nhánh ≥ ngưỡng bậc (0 / 40 / 60 / 80%)
        Nắm vững = 70% điểm chẩn đoán gần nhất + 30% tỉ lệ thẻ Flashcard đã thuộc (của các chủ đề trong nhánh)
     3. Đủ Điểm kỹ năng (SP): mỗi cấp độ = 2 SP; bậc 1–2 tốn 1 SP, bậc 3 tốn 2, bậc 4 tốn 3
   Huy hiệu: được đánh giá tự động từ dữ liệu của mọi phân hệ (toàn cục, qua event bus).
   ========================================================= */
(() => {
  'use strict';

  const { DB, Modules, XP, toast, esc, bus } = window.ChemRescue;

  /* ---------- CẤU HÌNH ---------- */
  const BRANCHES = [
    { id: 'atom',     name: 'Nguyên tử', icon: '⚛️', mod: 'm1', topics: ['atom', 'periodic'] },
    { id: 'bond',     name: 'Liên kết',  icon: '🔗', mod: 'm4', topics: ['bonding'] },
    { id: 'reaction', name: 'Phản ứng',  icon: '🔥', mod: 'm2', topics: ['redox'] },
    { id: 'solution', name: 'Acid–Base', icon: '💧', mod: 'm5', topics: ['solution'] }
  ];
  const BRANCH = Object.fromEntries(BRANCHES.map((b) => [b.id, b]));
  const COST = { 1: 1, 2: 1, 3: 2, 4: 3 };
  const GATE = { 1: 0, 2: 40, 3: 60, 4: 80 };
  const SP_PER_LEVEL = 2;
  const UNLOCK_EXP = 10;

  // Mô tả từng nút kỹ năng – theo chương trình KHTN 7–9 (THCS)
  const NODE_INFO = {
    a1: ['⚛️', 'Proton, neutron, electron: điện tích, khối lượng (amu) và vị trí trong nguyên tử.'],
    a2: ['🌀', 'Sự sắp xếp electron thành các lớp: lớp 1 tối đa 2, lớp 2 tối đa 8 electron.'],
    a3: ['🔤', 'Nguyên tố hóa học, số hiệu nguyên tử và kí hiệu theo tên IUPAC.'],
    a4: ['🧩', 'Ô, chu kì, nhóm; vị trí của kim loại, phi kim và khí hiếm trong bảng tuần hoàn.'],
    b1: ['🧱', 'Phân biệt đơn chất (một nguyên tố) và hợp chất (từ hai nguyên tố trở lên); phân tử.'],
    b2: ['🧲', 'Kim loại nhường electron, phi kim nhận electron → ion trái dấu hút nhau.'],
    b3: ['🤝', 'Các nguyên tử phi kim dùng chung cặp electron để đạt lớp vỏ bền vững.'],
    b4: ['✍️', 'Quy tắc hóa trị x·a = y·b; lập công thức hóa học và tính phần trăm nguyên tố.'],
    r1: ['🔥', 'Nhận biết biến đổi vật lí – biến đổi hóa học; dấu hiệu có chất mới tạo thành.'],
    r2: ['⚖️', 'Tổng khối lượng chất sản phẩm bằng tổng khối lượng chất tham gia.'],
    r3: ['📝', 'Lập phương trình hóa học: viết sơ đồ, cân bằng số nguyên tử mỗi nguyên tố.'],
    r4: ['🧮', 'Mol, khối lượng mol, n = m / M; tính lượng chất theo phương trình hóa học.'],
    s1: ['🍋', 'Acid tạo ion H⁺ trong nước, làm quỳ tím hóa đỏ; tác dụng với kim loại, base.'],
    s2: ['🧼', 'Base tạo ion OH⁻ trong nước, làm quỳ tím hóa xanh; base tan (kiềm) và base không tan.'],
    s3: ['🌡️', 'Thang pH: pH < 7 acid, pH = 7 trung tính, pH > 7 base; ý nghĩa trong đời sống.'],
    s4: ['🧂', 'Oxide acid – oxide base; muối: tên gọi IUPAC, tính tan và cách điều chế.']
  };

  /* ---------- TIỆN ÍCH ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const today = () => DB.localDate();
  const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

  /* =========================================================
     TÍNH TOÁN TRẠNG THÁI
     ========================================================= */
  function latestAttempt(uid) {
    return DB.select('quiz_attempts', { user_id: uid }, { orderBy: 'id desc', limit: 1 })[0];
  }

  function branchMastery(branchId, uid, last = latestAttempt(uid)) {
    const topics = BRANCH[branchId].topics;
    const diag = last ? avg(topics.map((t) => last.topic_scores[t] ?? 0)) : 0;
    const cards = DB.select('flashcards', (c) => topics.includes(c.topic_id)).map((c) => c.id);
    const learned = DB.count('flashcard_reviews', (r) => r.user_id === uid && cards.includes(r.card_id) && r.interval >= 1);
    const fc = cards.length ? (learned / cards.length) * 100 : 0;
    return { value: Math.round(diag * 0.7 + fc * 0.3), diag: Math.round(diag), fc: Math.round(fc) };
  }

  function snapshot() {
    const u = DB.currentUser();
    const nodes = DB.select('skill_nodes');
    const ownedRows = DB.select('user_skills', { user_id: u.id });
    const owned = new Map(ownedRows.map((s) => [s.node_id, s]));
    const spent = nodes.filter((n) => owned.has(n.id)).reduce((s, n) => s + COST[n.tier], 0);
    const spTotal = u.level * SP_PER_LEVEL;
    const last = latestAttempt(u.id);
    const mastery = Object.fromEntries(BRANCHES.map((b) => [b.id, branchMastery(b.id, u.id, last)]));

    const status = {};
    nodes.forEach((n) => {
      if (owned.has(n.id)) { status[n.id] = 'on'; return; }
      const prereqOk = n.requires.every((r) => owned.has(r));
      const gateOk = mastery[n.branch].value >= GATE[n.tier];
      const spOk = spTotal - spent >= COST[n.tier];
      status[n.id] = !prereqOk ? 'locked' : gateOk && spOk ? 'ready' : 'near';
    });

    return { u, nodes, owned, spent, spTotal, sp: spTotal - spent, mastery, status, byId: new Map(nodes.map((n) => [n.id, n])) };
  }

  /* =========================================================
     HUY HIỆU — tiến độ & tự động mở khóa
     ========================================================= */
  function classRank(u) {
    // Bản kết nối máy chủ: thứ hạng thật trong lớp (session.js tải từ /api/me/rank)
    // Cần ít nhất 3 bạn trong lớp đã làm chẩn đoán thì xếp hạng mới có ý nghĩa
    const real = window.ChemSession?.classRank;
    if (real) return real.rank && real.size >= 3 ? real : null;
    const me = DB.select('students', { name: u.name })[0];
    if (!me) return null;
    const peers = DB.select('students', { class_id: me.class_id });
    const score = (s) => avg(Object.values(s.topic_scores));
    const sorted = peers.slice().sort((a, b) => score(b) - score(a));
    return { rank: sorted.findIndex((s) => s.id === me.id) + 1, size: peers.length, cls: me.class_id };
  }

  // Trả về { value, target, text } — target null nghĩa là không đo được tiến độ (sự kiện tức thời)
  function badgeProgress(id, uid) {
    const u = DB.currentUser();
    const last = latestAttempt(uid);
    const owned = new Set(DB.select('user_skills', { user_id: uid }).map((s) => s.node_id));
    const pct = (t) => last?.topic_scores?.[t] ?? 0;
    switch (id) {
      case 1: { const n = DB.count('quiz_attempts', { user_id: uid }); return { value: Math.min(n, 1), target: 1, text: `${Math.min(n, 1)}/1 bài chẩn đoán` }; }
      case 2: return { value: Math.min(u.streak, 7), target: 7, text: `Chuỗi ${u.streak}/7 ngày` };
      case 3: return { value: Math.min(pct('atom'), 80), target: 80, text: `Nguyên tử ${pct('atom')}% / 80%` };
      case 4: { const n = ['b1', 'b2', 'b3', 'b4'].filter((x) => owned.has(x)).length; return { value: n, target: 4, text: `${n}/4 nút nhánh Liên kết` }; }
      case 5: return { value: 0, target: null, text: 'Trả lời đúng trong ≤ 3 giây ở Chẩn đoán hoặc Đấu trường' };
      case 6: { const n = DB.count('arena_matches', { user_id: uid, result: 'win' }); return { value: Math.min(n, 5), target: 5, text: `${n}/5 trận thắng` }; }
      case 7: { const n = DB.select('flashcard_reviews', { user_id: uid }).reduce((s, r) => s + (r.review_count || 0), 0); return { value: Math.min(n, 100), target: 100, text: `${n}/100 lượt ôn thẻ` }; }
      case 8: { const n = DB.count('lab_discoveries', { user_id: uid }); return { value: Math.min(n, 20), target: 20, text: `${n}/20 hợp chất` }; }
      case 9: return { value: Math.min(owned.size, 12), target: 12, text: `${owned.size}/12 nút kỹ năng` };
      case 10: return { value: Math.min(pct('solution'), 80), target: 80, text: `Acid–Base ${pct('solution')}% / 80%` };
      case 11: { const r = classRank(u); return r ? { value: r.rank === 1 ? 1 : 0, target: 1, text: `Hạng hiện tại: #${r.rank}/${r.size} lớp ${r.cls}` } : { value: 0, target: 1, text: 'Chưa xếp hạng (cần ≥ 3 bạn trong lớp làm chẩn đoán)' }; }
      case 12: return { value: Math.min(u.level, 20), target: 20, text: `Cấp ${u.level}/20` };
      default: return { value: 0, target: null, text: '' };
    }
  }

  // Mở khóa mọi huy hiệu đã đạt điều kiện. Trả về danh sách id mới mở.
  function evaluateBadges({ silent = false } = {}) {
    const uid = DB.currentUser().id;
    const have = new Set(DB.select('user_badges', { user_id: uid }).map((b) => b.badge_id));
    const fresh = [];
    DB.select('badges').forEach((b) => {
      if (have.has(b.id)) return;
      const p = badgeProgress(b.id, uid);
      if (p.target != null && p.value >= p.target) {
        DB.insert('user_badges', { user_id: uid, badge_id: b.id, unlocked_at: today() });
        fresh.push(b.id);
        if (!silent) setTimeout(() => toast(`Mở khóa huy hiệu <b>${esc(b.name)}</b>`, b.icon, 3400), 500);
      }
    });
    return fresh;
  }

  // Đánh giá toàn cục sau mỗi thay đổi EXP/cấp/chuỗi (từ bất kỳ phân hệ nào)
  bus.on('user:changed', () => evaluateBadges());

  /* =========================================================
     VÒNG ĐỜI
     ========================================================= */
  let view = null;
  let cleanup = [];
  let selected = null;
  let activeBranch = null;
  let freshBadges = new Set();

  const on = (el, evt, fn, opt) => { el.addEventListener(evt, fn, opt); cleanup.push(() => el.removeEventListener(evt, fn, opt)); };

  function teardown() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    document.querySelectorAll('.sk-modal').forEach((m) => m.remove());
  }

  function syncProgress(S) {
    const pct = Math.round((S.owned.size / S.nodes.length) * 100);
    if (pct !== S.u.module_progress.skills) {
      DB.update('users', S.u.id, { module_progress: { ...S.u.module_progress, skills: pct } });
    }
  }

  function shell(tab) {
    const S = snapshot();
    const badgeN = DB.count('user_badges', { user_id: S.u.id });
    view.innerHTML = `
      <section class="mod-banner" data-mod="m4">
        <span class="mod-banner__icon" aria-hidden="true">🌳</span>
        <div>
          <span class="tag">Phân hệ 4</span>
          <h2>Cây kỹ năng & Tủ huy hiệu</h2>
          <p>Mỗi nút kỹ năng là một mảng kiến thức. Học thật để tăng độ nắm vững, lên cấp để có Điểm kỹ năng, rồi mở khóa dần từng nhánh.</p>
        </div>
      </section>

      <section class="card sk-summary">
        <div class="sk-stat sk-stat--sp" title="Điểm kỹ năng khả dụng">
          <span class="sk-stat__icon" aria-hidden="true">✨</span>
          <div><b id="skSp">${S.sp}</b><span>Điểm kỹ năng</span></div>
        </div>
        <div class="sk-stat"><span class="sk-stat__icon" aria-hidden="true">🌿</span><div><b>${S.owned.size}/${S.nodes.length}</b><span>Nút đã mở</span></div></div>
        <div class="sk-stat"><span class="sk-stat__icon" aria-hidden="true">🏅</span><div><b>${badgeN}/${DB.count('badges')}</b><span>Huy hiệu</span></div></div>
        <div class="sk-stat"><span class="sk-stat__icon" aria-hidden="true">⭐</span><div><b>Cấp ${S.u.level}</b><span>+${SP_PER_LEVEL} SP mỗi cấp</span></div></div>
      </section>

      <nav class="sk-tabs" aria-label="Chọn khu vực">
        <a href="#/skills" class="sk-tab ${tab === 'tree' ? 'is-active' : ''}" ${tab === 'tree' ? 'aria-current="page"' : ''}>🌳 Cây kỹ năng</a>
        <a href="#/skills/badges" class="sk-tab ${tab === 'badges' ? 'is-active' : ''}" ${tab === 'badges' ? 'aria-current="page"' : ''}>🏅 Tủ huy hiệu</a>
      </nav>

      <div id="skBody"></div>`;
    return S;
  }

  /* =========================================================
     MÀN HÌNH 1 — CÂY KỸ NĂNG
     ========================================================= */
  function defaultSelection(S) {
    return S.nodes.find((n) => S.status[n.id] === 'ready')?.id
      || S.nodes.find((n) => S.status[n.id] === 'near')?.id
      || S.nodes[0].id;
  }

  function renderTree(justUnlocked = null) {
    const S = snapshot();
    syncProgress(S);
    if (!selected || !S.byId.has(selected)) selected = defaultSelection(S);
    if (!activeBranch) activeBranch = S.byId.get(selected).branch;

    const header = BRANCHES.map((b, i) => {
      const m = S.mastery[b.id].value;
      return `
        <div class="sk-bhead" data-mod="${b.mod}" data-branch="${b.id}" style="grid-column:${i + 1}">
          <span class="sk-bhead__icon" aria-hidden="true">${b.icon}</span>
          <b>${b.name}</b>
          <div class="sk-bhead__bar" title="Nắm vững ${m}%"><div style="width:${m}%"></div></div>
          <small>Nắm vững ${m}%</small>
        </div>`;
    }).join('');

    const nodes = S.nodes.map((n) => {
      const b = BRANCH[n.branch];
      const st = S.status[n.id];
      const [icon] = NODE_INFO[n.id] || ['•'];
      const col = BRANCHES.indexOf(b) + 1;
      return `
        <button class="sk-node sk-node--${st}${n.id === selected ? ' is-selected' : ''}${n.id === justUnlocked ? ' just-unlocked' : ''}"
                data-node="${n.id}" data-branch="${n.branch}" data-mod="${b.mod}"
                style="grid-column:${col};grid-row:${6 - n.tier}"
                aria-label="${esc(n.name)}, bậc ${n.tier}, ${{ on: 'đã mở khóa', ready: 'có thể mở khóa', near: 'chưa đủ điều kiện', locked: 'đang khóa' }[st]}">
          <span class="sk-node__orb">
            <span class="sk-node__icon" aria-hidden="true">${st === 'locked' ? '🔒' : icon}</span>
            ${st === 'ready' ? `<span class="sk-node__cost">${COST[n.tier]} SP</span>` : ''}
          </span>
          <span class="sk-node__name">${esc(n.name)}</span>
          <span class="sk-node__tier">Bậc ${n.tier}</span>
        </button>`;
    }).join('');

    $('#skBody').innerHTML = `
      <div class="sk-layout">
        <section class="card sk-treecard">
          <div class="sk-btabs" role="tablist" aria-label="Chọn nhánh">
            ${BRANCHES.map((b) => `<button class="sk-btab ${b.id === activeBranch ? 'is-active' : ''}" data-btab="${b.id}" data-mod="${b.mod}" role="tab" aria-selected="${b.id === activeBranch}">${b.icon} ${b.name}</button>`).join('')}
          </div>
          <div class="sk-tree" id="skTree" data-active="${activeBranch}">
            <svg class="sk-links" id="skLinks" aria-hidden="true"></svg>
            ${header}
            ${nodes}
            <div class="sk-root" style="grid-row:6">
              <span class="sk-root__orb" aria-hidden="true">🌱</span>
              <b>Nền tảng Hóa học</b>
            </div>
          </div>
          <ul class="sk-legend">
            <li><i class="sk-dot sk-dot--on"></i>Đã mở</li>
            <li><i class="sk-dot sk-dot--ready"></i>Có thể mở</li>
            <li><i class="sk-dot sk-dot--near"></i>Chưa đủ điều kiện</li>
            <li><i class="sk-dot sk-dot--locked"></i>Đang khóa</li>
          </ul>
        </section>
        <aside class="card sk-panel" id="skPanel" aria-live="polite"></aside>
      </div>`;

    renderPanel(S);
    requestAnimationFrame(() => drawLinks(S, justUnlocked));
  }

  function drawLinks(S, justUnlocked) {
    const tree = $('#skTree');
    const svg = $('#skLinks');
    if (!tree || !svg) return;
    const box = tree.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);

    const center = (el) => {
      if (!el || !el.offsetParent) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    };
    const orb = (id) => center(tree.querySelector(`[data-node="${id}"] .sk-node__orb`));
    const root = center(tree.querySelector('.sk-root__orb'));

    const paths = [];
    S.nodes.forEach((n) => {
      const to = orb(n.id);
      if (!to) return;
      const fromId = n.requires[0];
      const from = fromId ? orb(fromId) : root;
      if (!from) return;
      const fromOn = fromId ? S.status[fromId] === 'on' : true;
      const st = S.status[n.id] === 'on' && fromOn ? 'on' : fromOn ? 'next' : 'off';
      const midY = (from.y + to.y) / 2;
      const d = `M${from.x},${from.y} C${from.x},${midY} ${to.x},${midY} ${to.x},${to.y}`;
      const color = getComputedStyle(tree.querySelector(`[data-node="${n.id}"]`)).getPropertyValue('--c').trim();
      paths.push(`<path class="sk-link sk-link--${st}${n.id === justUnlocked ? ' is-new' : ''}" d="${d}" style="--lc:${color}"/>`);
      if (st === 'on') paths.push(`<path class="sk-flow" d="${d}" style="--lc:${color}"/>`);
    });
    svg.innerHTML = paths.join('');

    const fresh = svg.querySelector('.is-new');
    if (fresh && !reduceMotion()) {
      const len = fresh.getTotalLength();
      fresh.style.strokeDasharray = len;
      fresh.style.strokeDashoffset = len;
      fresh.getBoundingClientRect();
      fresh.style.transition = 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)';
      fresh.style.strokeDashoffset = 0;
    }
  }

  function renderPanel(S) {
    const n = S.byId.get(selected);
    const b = BRANCH[n.branch];
    const st = S.status[n.id];
    const [icon, desc] = NODE_INFO[n.id] || ['•', ''];
    const m = S.mastery[n.branch];
    const prereq = n.requires.map((r) => S.byId.get(r));
    const prereqOk = n.requires.every((r) => S.owned.has(r));
    const gateOk = m.value >= GATE[n.tier];
    const spOk = S.sp >= COST[n.tier];
    const ownedRow = S.owned.get(n.id);
    const weakestTopic = b.topics.slice().sort((x, y) => (latestAttempt(S.u.id)?.topic_scores?.[x] ?? 0) - (latestAttempt(S.u.id)?.topic_scores?.[y] ?? 0))[0];

    const req = (ok, html) => `<li class="${ok ? 'is-ok' : 'is-no'}"><i aria-hidden="true">${ok ? '✓' : '✕'}</i><span>${html}</span></li>`;

    let action;
    if (st === 'on') {
      action = `<p class="sk-owned">✓ Đã mở khóa ngày ${fmtDate(ownedRow?.unlocked_at)}</p>`;
    } else if (st === 'ready') {
      action = `<button class="btn sk-unlock" data-mod="${b.mod}" data-unlock="${n.id}">🔓 Mở khóa (−${COST[n.tier]} SP)</button>`;
    } else {
      const tips = [];
      if (!prereqOk) tips.push(`Mở khóa <b>${esc(prereq.map((p) => p.name).join(', '))}</b> trước.`);
      if (!gateOk) tips.push(`Ôn thêm để tăng nắm vững nhánh lên ${GATE[n.tier]}%. <a href="#/island/flashcard/${weakestTopic}">Ôn Flashcard →</a> hoặc <a href="#/diagnostic">làm lại chẩn đoán →</a>`);
      if (!spOk) tips.push(`Cần thêm ${COST[n.tier] - S.sp} SP: lên cấp để nhận +${SP_PER_LEVEL} SP. <a href="#/arena">Kiếm EXP ở Đấu trường →</a>`);
      action = `<div class="sk-tips">${tips.map((t) => `<p>${t}</p>`).join('')}</div>`;
    }

    $('#skPanel').innerHTML = `
      <div class="sk-panel__head" data-mod="${b.mod}">
        <span class="sk-panel__orb sk-panel__orb--${st}" aria-hidden="true">${st === 'locked' ? '🔒' : icon}</span>
        <div>
          <small>${b.icon} Nhánh ${b.name} · Bậc ${n.tier}</small>
          <h3>${esc(n.name)}</h3>
        </div>
      </div>
      <p class="sk-panel__desc">${esc(desc)}</p>

      <h4>Điều kiện mở khóa</h4>
      <ul class="sk-reqs">
        ${req(prereqOk, prereq.length ? `Đã mở: ${esc(prereq.map((p) => p.name).join(', '))}` : 'Nút gốc của nhánh, không cần nút trước')}
        ${req(gateOk, `Nắm vững nhánh ≥ ${GATE[n.tier]}% <em>(hiện ${m.value}%)</em>
          <span class="sk-gate"><span style="width:${Math.min(100, m.value)}%"></span><i style="left:${GATE[n.tier]}%"></i></span>`)}
        ${req(spOk || st === 'on', `${COST[n.tier]} Điểm kỹ năng <em>(đang có ${S.sp} SP)</em>`)}
      </ul>
      ${action}
      <p class="sk-formula">Nắm vững = 70% điểm chẩn đoán (${m.diag}%) + 30% thẻ đã thuộc (${m.fc}%)</p>`;
  }

  function unlock(nodeId) {
    const S = snapshot();
    if (S.status[nodeId] !== 'ready') return;
    const n = S.byId.get(nodeId);
    DB.insert('user_skills', { user_id: S.u.id, node_id: nodeId, unlocked_at: today() });
    toast(`Mở khóa kỹ năng <b>${esc(n.name)}</b>`, NODE_INFO[nodeId]?.[0] || '🌿');
    XP.add(UNLOCK_EXP, 'Mở khóa kỹ năng');   // có thể kích hoạt lên cấp → thêm SP
    evaluateBadges();
    bus.emit('skills:unlocked', { node: nodeId });

    // Cập nhật SP trong thẻ tổng quan mà không vẽ lại toàn trang
    const after = snapshot();
    const spEl = $('#skSp');
    if (spEl) { spEl.textContent = after.sp; spEl.classList.remove('bump'); void spEl.offsetWidth; spEl.classList.add('bump'); }
    renderTree(nodeId);
  }

  function bindTree() {
    on(view, 'click', (e) => {
      const u = e.target.closest('[data-unlock]');
      if (u) { unlock(u.dataset.unlock); return; }
      const node = e.target.closest('[data-node]');
      if (node) {
        selected = node.dataset.node;
        view.querySelectorAll('.sk-node.is-selected').forEach((x) => x.classList.remove('is-selected'));
        node.classList.add('is-selected');
        renderPanel(snapshot());
        if (isMobile()) $('#skPanel').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
        return;
      }
      const tab = e.target.closest('[data-btab]');
      if (tab) {
        // Mobile: hiển thị 1 nhánh/lần; chọn sẵn nút chưa mở đầu tiên của nhánh
        activeBranch = tab.dataset.btab;
        const S = snapshot();
        const branchNodes = S.nodes.filter((n) => n.branch === activeBranch);
        selected = (branchNodes.find((n) => S.status[n.id] !== 'on') || branchNodes[0]).id;
        renderTree();
      }
    });

    // Vẽ lại đường nối khi kích thước cây thay đổi (xoay máy, thu phóng, đổi bố cục)
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if ($('#skTree')) drawLinks(snapshot()); });
    });
    const observe = () => { const t = $('#skTree'); if (t) ro.observe(t); };
    observe();
    const mo = new MutationObserver(() => { ro.disconnect(); observe(); });
    mo.observe($('#skBody'), { childList: true });
    cleanup.push(() => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); });
  }

  /* =========================================================
     MÀN HÌNH 2 — TỦ HUY HIỆU
     ========================================================= */
  function renderBadges(filter = 'all') {
    const uid = DB.currentUser().id;
    const owned = new Map(DB.select('user_badges', { user_id: uid }).map((b) => [b.badge_id, b]));
    const badges = DB.select('badges');
    const nOn = badges.filter((b) => owned.has(b.id)).length;

    const cells = badges.map((b, i) => {
      const row = owned.get(b.id);
      const p = badgeProgress(b.id, uid);
      const isNew = row && (freshBadges.has(b.id) || row.unlocked_at === today());
      const hidden = (filter === 'on' && !row) || (filter === 'off' && row);
      const pct = p.target ? Math.round((p.value / p.target) * 100) : 0;
      return `
        <button class="sk-badge ${row ? 'sk-badge--on' : 'sk-badge--off'}${freshBadges.has(b.id) ? ' is-revealing' : ''}" data-badge="${b.id}" style="--i:${i}" ${hidden ? 'hidden' : ''}
                aria-label="${esc(b.name)}: ${row ? 'đã mở khóa' : 'chưa đạt'}">
          ${isNew ? '<span class="sk-badge__new">Mới!</span>' : ''}
          <span class="sk-medal">
            <span class="sk-medal__icon" aria-hidden="true">${b.icon}</span>
            ${row ? '<span class="sk-sparkles" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i></span>' : '<span class="sk-medal__lock" aria-hidden="true">🔒</span>'}
          </span>
          <b class="sk-badge__name">${esc(b.name)}</b>
          <small class="sk-badge__desc">${row ? `Đạt ngày ${fmtDate(row.unlocked_at)}` : esc(b.desc)}</small>
          ${!row && p.target ? `<span class="sk-badge__bar"><span style="width:${pct}%"></span></span>` : ''}
        </button>`;
    }).join('');

    const chip = (f, label, n) => `<button class="dx-chip" data-filter="${f}" aria-pressed="${filter === f}">${label} <b>${n}</b></button>`;

    $('#skBody').innerHTML = `
      <section class="card sk-cabinet">
        <div class="card__head sk-cabinet__head">
          <div>
            <h3>🏅 Tủ huy hiệu</h3>
            <p class="dx-muted">Huy hiệu tự mở khi bạn đạt điều kiện ở bất kỳ phân hệ nào.</p>
          </div>
          <div class="dx-chips" role="group" aria-label="Lọc huy hiệu">
            ${chip('all', 'Tất cả', badges.length)}${chip('on', 'Đã đạt', nOn)}${chip('off', 'Chưa đạt', badges.length - nOn)}
          </div>
        </div>
        <div class="sk-shelf">
          <div class="sk-badges">${cells}</div>
        </div>
      </section>`;
    freshBadges = new Set();
  }

  function openBadge(id) {
    const uid = DB.currentUser().id;
    const b = DB.get('badges', id);
    const row = DB.select('user_badges', { user_id: uid, badge_id: id })[0];
    const p = badgeProgress(id, uid);
    const pct = p.target ? Math.round((p.value / p.target) * 100) : 0;
    const prevFocus = document.activeElement;

    const wrap = document.createElement('div');
    wrap.className = 'modal sk-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'skBadgeTitle');
    wrap.innerHTML = `
      <div class="modal__card sk-modal__card ${row ? 'is-on' : 'is-off'}">
        <div class="sk-bigmedal" aria-hidden="true"><span>${b.icon}</span></div>
        <h2 id="skBadgeTitle">${esc(b.name)}</h2>
        <p>${esc(b.desc)}</p>
        ${row
          ? `<p class="sk-modal__status sk-modal__status--on">✓ Đã mở khóa ngày ${fmtDate(row.unlocked_at)}</p>`
          : `<p class="sk-modal__status">🔒 Chưa đạt</p>
             ${p.target ? `<div class="sk-modal__bar"><span style="width:${pct}%"></span></div>` : ''}
             <p class="dx-muted">${esc(p.text)}</p>`}
        <button class="btn" data-mod="m4" data-close>Đóng</button>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); prevFocus?.focus?.(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    wrap.querySelector('[data-close]').focus();
  }

  function bindBadges() {
    on(view, 'click', (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) { renderBadges(f.dataset.filter); return; }
      const b = e.target.closest('[data-badge]');
      if (b) openBadge(Number(b.dataset.badge));
    });
  }

  /* =========================================================
     ĐĂNG KÝ PHÂN HỆ
     ========================================================= */
  Modules.register('skills', {
    render(container, { params = [] } = {}) {
      teardown();
      view = container;
      // Đồng bộ huy hiệu trước khi hiển thị (bắt kịp mọi thành tích đã đạt ở phân hệ khác)
      evaluateBadges({ silent: true }).forEach((id) => freshBadges.add(id));
      if (freshBadges.size) {
        const names = [...freshBadges].map((id) => DB.get('badges', id)?.name).filter(Boolean);
        setTimeout(() => toast(`Mở khóa ${names.length} huy hiệu mới: <b>${esc(names.join(', '))}</b>`, '🏅', 3600), 400);
      }

      if (params[0] === 'badges') {
        shell('badges');
        renderBadges();
        bindBadges();
      } else {
        shell('tree');
        renderTree();
        bindTree();
      }
    },
    unmount() { teardown(); }
  });

  // Cho phân hệ khác dùng lại (vd. Dashboard giáo viên)
  window.ChemRescue.Skills = { branchMastery, evaluateBadges, badgeProgress };
})();
