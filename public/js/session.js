/* =========================================================
   ChemRescue — Phiên đăng nhập & đồng bộ với máy chủ
   ---------------------------------------------------------
   File này chạy ĐẦU TIÊN, trước mọi file khác:
     1. Hiện màn hình đăng nhập (học sinh: họ tên + lớp · giáo viên: mã PIN)
     2. Tải tiến độ đã lưu trên máy chủ về trình duyệt
     3. Nạp lần lượt db.js → app.js → 5 phân hệ
     4. Mỗi khi tiến độ thay đổi → tự lưu lên máy chủ (sau 1,5 giây)
     5. Đếm số phút học thực tế & gửi hoạt động cho Dashboard Giáo viên
   ========================================================= */
(() => {
  'use strict';

  const SESSION_KEY = 'chemrescue.session';
  const PIN_KEY = 'chemrescue.teacherPin';
  const SCRIPTS = [
    'js/db.js',
    'js/app.js',
    'js/modules/diagnostic.js',
    'js/modules/island.js',
    'js/modules/arena.js',
    'js/modules/skills.js',
    'js/modules/teacher.js'
  ];
  const SYNC_DELAY = 1500;     // chờ 1,5 giây sau thay đổi cuối rồi mới gửi (gộp nhiều thay đổi)
  const RETRY_DELAY = 15000;   // mất mạng → thử gửi lại sau 15 giây
  const IDLE_LIMIT = 120000;   // không thao tác quá 2 phút → không tính là đang học

  const $ = (sel) => document.querySelector(sel);

  /* ---------- Lưu trữ an toàn (trình duyệt chặn bộ nhớ vẫn chạy được) ---------- */
  const store = {
    get(key, area = localStorage) { try { return JSON.parse(area.getItem(key)); } catch { return null; } },
    set(key, val, area = localStorage) { try { area.setItem(key, JSON.stringify(val)); } catch { /* bỏ qua */ } },
    del(key, area = localStorage) { try { area.removeItem(key); } catch { /* bỏ qua */ } }
  };

  /* ---------- Gọi API máy chủ ---------- */
  async function api(path, { method = 'GET', body, token, pin, keepalive = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['X-Student-Token'] = token;
    if (pin) headers['X-Teacher-Pin'] = pin;
    let res;
    try {
      res = await fetch(path, { method, headers, keepalive, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      const err = new Error('Không kết nối được máy chủ. Kiểm tra mạng Internet rồi thử lại.');
      err.status = 0;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Lỗi máy chủ (${res.status})`);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  /* =========================================================
     ĐỐI TƯỢNG PHIÊN (các file khác dùng qua window.ChemSession)
     ========================================================= */
  const Session = {
    role: null,          // 'student' | 'teacher'
    profile: null,       // { id, name, class_name }
    token: null,
    storageKey: null,    // ngăn lưu riêng trong trình duyệt của tài khoản này
    api,
    teacherPin: () => store.get(PIN_KEY, sessionStorage),
    setTeacherPin: (pin) => store.set(PIN_KEY, pin, sessionStorage),
    clearTeacherPin: () => store.del(PIN_KEY, sessionStorage),
    onPersist: null,     // db.js gọi mỗi khi tiến độ thay đổi
    classRank: null,     // { rank, size, cls } – thứ hạng trong lớp (huy hiệu "Nhà vô địch tuần")
    logout
  };
  window.ChemSession = Session;

  const keyFor = (s) => (s.role === 'student' ? `chemrescue.db.${s.id}` : 'chemrescue.db.teacher');
  const pendingKey = () => `${Session.storageKey}.pending`; // đánh dấu "còn thay đổi chưa gửi lên máy chủ"

  /* =========================================================
     ĐỒNG BỘ TIẾN ĐỘ LÊN MÁY CHỦ
     ========================================================= */
  const Sync = { timer: null, latest: null, busy: false, again: false };

  function onPersist(state) {
    if (Session.role !== 'student') return;
    Sync.latest = state;
    store.set(pendingKey(), 1);
    clearTimeout(Sync.timer);
    Sync.timer = setTimeout(push, SYNC_DELAY);
  }

  async function push({ keepalive = false } = {}) {
    clearTimeout(Sync.timer);
    if (Session.role !== 'student' || !store.get(pendingKey())) return;
    const state = Sync.latest || store.get(Session.storageKey);
    if (!state) return;
    if (Sync.busy) { Sync.again = true; return; }   // đang gửi → gửi lại ngay sau khi xong
    Sync.busy = true;
    try {
      await api('/api/me/state', { method: 'PUT', body: { state }, token: Session.token, keepalive });
      if (Sync.latest === state) store.del(pendingKey());
      setSyncBadge('ok');
    } catch (err) {
      if (err.status === 401) return sessionExpired();
      setSyncBadge('offline');
      Sync.timer = setTimeout(push, RETRY_DELAY);
    } finally {
      Sync.busy = false;
      if (Sync.again) { Sync.again = false; push(); }
    }
  }

  // Rời trang / ẩn tab → gửi ngay phần còn lại (keepalive: vẫn gửi được khi trang đang đóng)
  function flushOnLeave() {
    if (!store.get(pendingKey())) return;
    const state = Sync.latest || store.get(Session.storageKey);
    const small = state && JSON.stringify(state).length < 60000; // giới hạn của keepalive ≈ 64KB
    push({ keepalive: Boolean(small) });
  }

  function setSyncBadge(status) {
    const el = $('#syncBadge');
    if (!el) return;
    el.dataset.status = status;
    el.title = status === 'ok' ? 'Tiến độ đã được lưu trên máy chủ' : 'Mất kết nối – tiến độ đang lưu tạm trên máy, sẽ gửi lại khi có mạng';
    el.textContent = status === 'ok' ? '☁️ Đã lưu' : '⚠️ Chưa lưu';
  }

  function sessionExpired() {
    store.del(SESSION_KEY);
    alert('Phiên đăng nhập đã hết hạn hoặc tài khoản đã bị giáo viên xóa. Vui lòng đăng nhập lại.');
    location.reload();
  }

  async function logout() {
    if (Session.role === 'student') {
      if (!confirm('Đăng xuất khỏi ChemRescue?')) return;
      await push();
      if (store.get(pendingKey())) {
        if (!confirm('Một phần tiến độ chưa gửi được lên máy chủ (mất mạng). Vẫn đăng xuất và bỏ phần đó?')) return;
      }
      // Xóa bản lưu trên máy này (máy dùng chung) – tiến độ vẫn còn trên máy chủ
      store.del(Session.storageKey);
      store.del(pendingKey());
    } else {
      Session.clearTeacherPin();
    }
    store.del(SESSION_KEY);
    location.hash = '';
    location.reload();
  }

  /* =========================================================
     ĐẾM PHÚT HỌC & GỬI HOẠT ĐỘNG CHO GIÁO VIÊN
     ========================================================= */
  function startTracking() {
    if (Session.role !== 'student') return;

    // 1) Phút học: chỉ tính khi tab đang mở và có thao tác trong 2 phút gần nhất
    let lastInput = Date.now();
    const touch = () => { lastInput = Date.now(); };
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((e) => document.addEventListener(e, touch, { passive: true }));
    setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput < IDLE_LIMIT) window.ChemDB.addStudyMinute();
    }, 60000);

    // 2) Hoạt động nổi bật → luồng "Trực tiếp" của giáo viên
    const send = (icon, text) => api('/api/me/events', { method: 'POST', body: { icon, text }, token: Session.token }).catch(() => {});
    const { bus } = window.ChemRescue;
    bus.on('diagnostic:completed', (a) => {
      send('🩺', `hoàn thành bài chẩn đoán: ${a.score}/${a.total} câu đúng`);
      setTimeout(() => push().then(loadRank), SYNC_DELAY + 200); // lưu điểm mới rồi cập nhật thứ hạng
    });
    bus.on('flashcards:reviewed', (e) => send('🃏', `ôn ${e.count} thẻ Flashcard`));
    bus.on('arena:finished', (e) => send('⚔️', `${{ win: 'thắng', lose: 'thua', draw: 'hòa' }[e.result] || 'chơi'} một trận 1vs1 (${e.correct} câu đúng)`));
    bus.on('lab:compound', (e) => { if (e?.target) send('⚗️', 'hoàn thành nhiệm vụ điều chế ở Xưởng ion'); });
    bus.on('skills:unlocked', () => send('🌳', 'mở khóa một nút kỹ năng'));

    // 3) Gửi nốt thay đổi khi rời trang / chuyển tab / có mạng trở lại
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnLeave(); });
    window.addEventListener('pagehide', flushOnLeave);
    window.addEventListener('online', () => push());
  }

  // Thứ hạng trong lớp theo điểm chẩn đoán
  async function loadRank() {
    if (Session.role !== 'student') return;
    try { Session.classRank = await api('/api/me/rank', { token: Session.token }); } catch { /* bỏ qua khi mất mạng */ }
  }

  /* =========================================================
     KHỞI ĐỘNG ỨNG DỤNG
     ========================================================= */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Không tải được ${src}`));
      document.body.appendChild(s);
    });
  }

  // Chọn bản tiến độ mới nhất: còn thay đổi chưa gửi trên máy → dùng bản máy; ngược lại → bản máy chủ
  function adoptServerState(sess, serverState) {
    const key = keyFor(sess);
    const hasPending = store.get(`${key}.pending`) && store.get(key);
    if (hasPending) return;                     // sẽ được đẩy lên máy chủ ngay sau khi khởi động
    if (serverState) store.set(key, serverState);
    else store.del(key);                        // tài khoản mới → db.js tạo tiến độ trống
  }

  async function start(sess) {
    Session.role = sess.role;
    Session.profile = sess.role === 'student' ? { id: sess.id, name: sess.name, class_name: sess.class_name } : null;
    Session.token = sess.token || null;
    Session.storageKey = keyFor(sess);
    Session.onPersist = onPersist;

    if (sess.role === 'teacher' && !location.hash.startsWith('#/teacher')) history.replaceState(null, '', '#/teacher');

    $('#gate').hidden = true;
    $('#boot').hidden = false;
    await loadRank();
    try {
      for (const src of SCRIPTS) await loadScript(src);
    } catch (err) {
      $('#boot').innerHTML = `⚠️ ${err.message}. Hãy tải lại trang.`;
      return;
    }
    window.ChemRescue.start();                  // mọi phân hệ đã đăng ký → khởi động giao diện
    $('#boot').hidden = true;
    document.body.classList.remove('is-booting');
    startTracking();
    if (sess.role === 'student') {
      setSyncBadge('ok');
      if (store.get(pendingKey())) push();      // còn thay đổi cũ chưa gửi → gửi ngay
    }
  }

  /* ---------- Màn hình đăng nhập ---------- */
  function showGate(message = '') {
    $('#boot').hidden = true;
    $('#gate').hidden = false;
    $('#gateError').textContent = message;
    const last = store.get('chemrescue.lastLogin');
    if (last) { $('#gName').value = last.name || ''; $('#gClass').value = last.class_name || ''; }
    ($('#gName').value ? $('#gClass') : $('#gName')).focus();
  }

  function bindGate() {
    document.querySelectorAll('[data-gate-tab]').forEach((tab) => tab.addEventListener('click', () => {
      const teacher = tab.dataset.gateTab === 'teacher';
      document.querySelectorAll('[data-gate-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $('#gateStudent').hidden = teacher;
      $('#gateTeacher').hidden = !teacher;
      $('#gateError').textContent = '';
      (teacher ? $('#gPin') : $('#gName')).focus();
    }));

    $('#gateStudent').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('button');
      btn.disabled = true;
      $('#gateError').textContent = '';
      try {
        const r = await api('/api/auth/student', { method: 'POST', body: { name: $('#gName').value, className: $('#gClass').value } });
        const sess = { role: 'student', id: r.student.id, name: r.student.name, class_name: r.student.class_name, token: r.token };
        store.set(SESSION_KEY, sess);
        store.set('chemrescue.lastLogin', { name: r.student.name, class_name: r.student.class_name });
        adoptServerState(sess, r.state);
        await start(sess);
        if (r.created) window.ChemRescue?.toast(`Chào mừng <b>${r.student.name}</b> đến với ChemRescue! Hãy bắt đầu bằng bài chẩn đoán.`, '👋', 4000);
        else window.ChemRescue?.toast(`Chào mừng <b>${r.student.name}</b> quay lại – tiến độ đã được khôi phục.`, '👋', 3500);
      } catch (err) {
        $('#gateError').textContent = err.message;
        btn.disabled = false;
      }
    });

    $('#gateTeacher').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('button');
      btn.disabled = true;
      $('#gateError').textContent = '';
      const pin = $('#gPin').value.trim();
      try {
        await api('/api/auth/teacher', { method: 'POST', body: { pin } });
        Session.setTeacherPin(pin);
        const sess = { role: 'teacher' };
        store.set(SESSION_KEY, sess);
        await start(sess);
      } catch (err) {
        $('#gateError').textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  async function boot() {
    bindGate();
    const sess = store.get(SESSION_KEY);

    if (sess?.role === 'student' && sess.token) {
      try {
        const r = await api('/api/me', { token: sess.token });
        Object.assign(sess, { name: r.student.name, class_name: r.student.class_name });
        store.set(SESSION_KEY, sess);
        adoptServerState(sess, r.state);
      } catch (err) {
        if (err.status === 401) { store.del(SESSION_KEY); return showGate('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'); }
        // Mất mạng: chỉ cho học tiếp nếu máy này đã có bản lưu (sẽ đồng bộ khi có mạng).
        // Máy chưa có bản lưu → KHÔNG tạo tiến độ trống (tránh ghi đè tiến độ thật trên máy chủ).
        if (!store.get(keyFor(sess))) return showGate(err.message);
      }
      return start(sess);
    }
    if (sess?.role === 'teacher') return start(sess);
    showGate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
