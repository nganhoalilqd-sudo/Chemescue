/* =========================================================
   ChemRescue — Cơ sở dữ liệu phía trình duyệt
   ---------------------------------------------------------
   • Mỗi "bảng" là một mảng bản ghi, khóa chính là `id`.
   • API mô phỏng thao tác SQL:
       select(table, where?, { orderBy: 'col desc', limit })
       get(table, id) · insert · update · remove · count
   • Dữ liệu chia 3 nhóm:
       1. NỘI DUNG HỌC (CONTENT_TABLES): câu hỏi, flashcard, ion, cây kỹ năng…
          → luôn lấy từ mã nguồn, giống nhau cho mọi học sinh.
       2. TIẾN ĐỘ CÁ NHÂN (USER_TABLES + meta): EXP, bài làm, thẻ đã ôn…
          → lưu trên trình duyệt VÀ đồng bộ lên máy chủ Railway (qua session.js).
       3. DỮ LIỆU LỚP HỌC (students, activity_log): chỉ nạp tạm khi giáo viên mở Dashboard.
   • Nội dung theo chương trình GDPT 2018 – môn KHTN (THCS), tên chất theo IUPAC.
   ========================================================= */
const ChemDB = (() => {
  'use strict';

  const Session = window.ChemSession || null;
  // Mỗi học sinh một ngăn lưu riêng → nhiều em dùng chung một máy không lẫn dữ liệu
  const STORAGE_KEY = Session?.storageKey || 'chemrescue.db';
  const SCHEMA_VERSION = 2;

  const CONTENT_TABLES = ['topics', 'questions', 'flashcards', 'ions', 'arena_bots', 'skill_nodes', 'badges'];
  const USER_TABLES = ['users', 'quiz_attempts', 'flashcard_reviews', 'lab_discoveries', 'quests',
    'activity_days', 'arena_matches', 'user_skills', 'user_badges'];
  const CLASS_TABLES = ['students', 'activity_log'];

  /* ---------- Tiện ích ngày (theo giờ địa phương) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDate(d); };

  /* =========================================================
     1. NỘI DUNG HỌC (KHTN 7–9, tên IUPAC)
     ========================================================= */
  function content() {
    return {
      /* ===== Chủ đề kiến thức (trục của Bản đồ nhiệt & Cây kỹ năng) ===== */
      topics: [
        { id: 'atom',     name: 'Nguyên tử',                    short: 'Nguyên tử', icon: '⚛️', branch: 'atom' },
        { id: 'periodic', name: 'Nguyên tố & bảng tuần hoàn',   short: 'Nguyên tố', icon: '🧩', branch: 'atom' },
        { id: 'bonding',  name: 'Liên kết, hóa trị & công thức', short: 'Liên kết',  icon: '🔗', branch: 'bond' },
        { id: 'redox',    name: 'Phản ứng hóa học & mol',       short: 'Phản ứng',  icon: '🔥', branch: 'reaction' },
        { id: 'solution', name: 'Acid – Base – Muối',           short: 'Acid–Base', icon: '💧', branch: 'solution' }
      ],

      /* ===== Phân hệ 1: Ngân hàng 15 câu chẩn đoán (3 câu / chủ đề) ===== */
      questions: [
        { id: 1, topic_id: 'atom', text: 'Hạt nào mang điện tích dương trong hạt nhân nguyên tử?',
          options: ['Electron', 'Proton', 'Neutron', 'Ion'], answer: 1,
          explain: 'Hạt nhân gồm proton (mang điện tích dương) và neutron (không mang điện).' },
        { id: 2, topic_id: 'atom', text: 'Nguyên tử sodium có 11 proton. Số electron của nguyên tử sodium là:',
          options: ['10', '11', '12', '23'], answer: 1,
          explain: 'Nguyên tử trung hòa về điện nên số electron = số proton = 11.' },
        { id: 3, topic_id: 'atom', text: 'Nguyên tử carbon có 6 electron. Số electron ở lớp ngoài cùng là:',
          options: ['2', '4', '6', '8'], answer: 1,
          explain: 'Lớp thứ nhất chứa tối đa 2 electron; 4 electron còn lại nằm ở lớp thứ hai (lớp ngoài cùng).' },

        { id: 4, topic_id: 'periodic', text: 'Kí hiệu hóa học của nguyên tố potassium (kali) là:',
          options: ['P', 'Po', 'K', 'Ka'], answer: 2,
          explain: 'Potassium có tên Latin là Kalium nên kí hiệu là K. (P là phosphorus.)' },
        { id: 5, topic_id: 'periodic', text: 'Magnesium (Z = 12) có các lớp electron 2, 8, 2. Magnesium nằm ở:',
          options: ['Chu kì 2, nhóm IIA', 'Chu kì 3, nhóm IIA', 'Chu kì 3, nhóm IIIA', 'Chu kì 2, nhóm IIIA'], answer: 1,
          explain: 'Có 3 lớp electron → chu kì 3; có 2 electron lớp ngoài cùng → nhóm IIA.' },
        { id: 6, topic_id: 'periodic', text: 'Nguyên tố nào sau đây là khí hiếm?',
          options: ['Oxygen', 'Neon', 'Nitrogen', 'Chlorine'], answer: 1,
          explain: 'Neon (Ne) thuộc nhóm VIIIA – nhóm khí hiếm, rất khó tham gia phản ứng hóa học.' },

        { id: 7, topic_id: 'bonding', text: 'Liên kết trong sodium chloride (NaCl) là:',
          options: ['Liên kết ion', 'Liên kết cộng hóa trị', 'Liên kết kim loại', 'Liên kết hydrogen'], answer: 0,
          explain: 'Na nhường 1 electron thành ion Na⁺, Cl nhận 1 electron thành ion Cl⁻; hai ion trái dấu hút nhau.' },
        { id: 8, topic_id: 'bonding', text: 'Hóa trị của Al trong hợp chất Al₂O₃ là:',
          options: ['I', 'II', 'III', 'IV'], answer: 2,
          explain: 'O có hóa trị II. Theo quy tắc hóa trị: 2 × a = 3 × II → a = III.' },
        { id: 9, topic_id: 'bonding', text: 'Công thức hóa học của hợp chất tạo bởi Ca (II) và nhóm PO₄ (III) là:',
          options: ['CaPO₄', 'Ca₂(PO₄)₃', 'Ca₃(PO₄)₂', 'Ca₃PO₄'], answer: 2,
          explain: 'x × II = y × III → x : y = 3 : 2 → Ca₃(PO₄)₂.' },

        { id: 10, topic_id: 'redox', text: 'Quá trình nào sau đây là biến đổi hóa học?',
          options: ['Nước đá tan thành nước lỏng', 'Cồn để trong lọ hở bay hơi', 'Đốt than tạo khí carbon dioxide', 'Hòa tan muối ăn vào nước'], answer: 2,
          explain: 'Đốt than tạo ra chất mới (carbon dioxide). Các quá trình còn lại không tạo chất mới → biến đổi vật lí.' },
        { id: 11, topic_id: 'redox', text: 'Đốt cháy hoàn toàn 12 g carbon cần 32 g oxygen. Khối lượng carbon dioxide tạo thành là:',
          options: ['20 g', '32 g', '44 g', '12 g'], answer: 2,
          explain: 'Định luật bảo toàn khối lượng: m(CO₂) = 12 + 32 = 44 g.' },
        { id: 12, topic_id: 'redox', text: 'Khối lượng mol của nước H₂O là (H = 1, O = 16):',
          options: ['17 g/mol', '18 g/mol', '32 g/mol', '34 g/mol'], answer: 1,
          explain: 'M(H₂O) = 2 × 1 + 16 = 18 g/mol.' },

        { id: 13, topic_id: 'solution', text: 'Dung dịch có pH = 3 có môi trường:',
          options: ['Acid', 'Trung tính', 'Base', 'Không xác định được'], answer: 0,
          explain: 'pH < 7 → môi trường acid; pH = 7 trung tính; pH > 7 base.' },
        { id: 14, topic_id: 'solution', text: 'Chất nào sau đây là base?',
          options: ['HCl', 'NaOH', 'NaCl', 'CO₂'], answer: 1,
          explain: 'NaOH (sodium hydroxide) có nguyên tử kim loại liên kết với nhóm hydroxide (OH) → base.' },
        { id: 15, topic_id: 'solution', text: 'Nhỏ dung dịch hydrochloric acid (HCl) vào giấy quỳ tím, quỳ tím chuyển sang màu:',
          options: ['Đỏ', 'Xanh', 'Không đổi màu', 'Vàng'], answer: 0,
          explain: 'Dung dịch acid làm quỳ tím hóa đỏ; dung dịch base làm quỳ tím hóa xanh.' }
      ],

      /* ===== Phân hệ 2: Flashcard (16 thẻ) ===== */
      flashcards: [
        { id: 1,  topic_id: 'atom',     visual: 'p⁺ n⁰ e⁻',    front: 'Nguyên tử được cấu tạo từ những hạt nào?',            back: 'Proton (+) và neutron (không mang điện) ở hạt nhân; electron (−) chuyển động ở lớp vỏ.' },
        { id: 2,  topic_id: 'atom',     visual: '1 amu',       front: 'Đơn vị khối lượng nguyên tử là gì?',                  back: 'amu (atomic mass unit). Khối lượng 1 proton ≈ khối lượng 1 neutron ≈ 1 amu.' },
        { id: 3,  topic_id: 'atom',     visual: '2 · 8 · 8',   front: 'Lớp electron thứ nhất và thứ hai chứa tối đa bao nhiêu electron?', back: 'Lớp thứ nhất tối đa 2 electron; lớp thứ hai tối đa 8 electron.' },
        { id: 4,  topic_id: 'periodic', visual: 'Z',           front: 'Số hiệu nguyên tử (Z) cho biết điều gì?',             back: 'Số proton trong hạt nhân = số thứ tự ô của nguyên tố trong bảng tuần hoàn.' },
        { id: 5,  topic_id: 'periodic', visual: '→ chu kì',    front: 'Số thứ tự của chu kì cho biết điều gì?',              back: 'Số lớp electron của nguyên tử các nguyên tố trong chu kì đó.' },
        { id: 6,  topic_id: 'periodic', visual: '↓ nhóm A',    front: 'Số thứ tự của nhóm A cho biết điều gì?',              back: 'Số electron ở lớp ngoài cùng của nguyên tử (vd: nhóm IA có 1 electron lớp ngoài cùng).' },
        { id: 7,  topic_id: 'bonding',  visual: 'Na⁺ Cl⁻',     front: 'Liên kết ion hình thành như thế nào?',                back: 'Nguyên tử kim loại nhường electron thành ion dương, phi kim nhận electron thành ion âm; các ion trái dấu hút nhau.' },
        { id: 8,  topic_id: 'bonding',  visual: 'H : H',       front: 'Liên kết cộng hóa trị là gì?',                        back: 'Liên kết được tạo nên bởi các cặp electron dùng chung giữa hai nguyên tử (thường là phi kim).' },
        { id: 9,  topic_id: 'bonding',  visual: 'x·a = y·b',   front: 'Quy tắc hóa trị trong hợp chất AₓBᵧ?',               back: 'Tích chỉ số và hóa trị của nguyên tố này bằng tích chỉ số và hóa trị của nguyên tố kia: x · a = y · b.' },
        { id: 10, topic_id: 'bonding',  visual: 'SO₄ ?',       front: 'Nhóm sulfate (SO₄) có hóa trị bao nhiêu?',            back: 'Hóa trị II (ion sulfate SO₄²⁻).' },
        { id: 11, topic_id: 'redox',    visual: 'm₁ + m₂ = m₃', front: 'Định luật bảo toàn khối lượng phát biểu thế nào?',    back: 'Trong một phản ứng hóa học, tổng khối lượng các chất sản phẩm bằng tổng khối lượng các chất tham gia.' },
        { id: 12, topic_id: 'redox',    visual: 'n = m / M',   front: 'Công thức tính số mol theo khối lượng?',              back: 'n = m / M (n: số mol; m: khối lượng, gam; M: khối lượng mol, g/mol).' },
        { id: 13, topic_id: 'redox',    visual: '6,022·10²³',  front: '1 mol chất chứa bao nhiêu hạt (nguyên tử/phân tử)?',   back: 'Khoảng 6,022 × 10²³ hạt (số Avogadro).' },
        { id: 14, topic_id: 'solution', visual: 'H⁺',          front: 'Acid là gì?',                                         back: 'Hợp chất trong phân tử có nguyên tử hydrogen liên kết với gốc acid; khi tan trong nước tạo ra ion H⁺. Vd: HCl, H₂SO₄.' },
        { id: 15, topic_id: 'solution', visual: 'OH⁻',         front: 'Base là gì?',                                         back: 'Hợp chất trong phân tử có nguyên tử kim loại liên kết với nhóm hydroxide; khi tan trong nước tạo ra ion OH⁻. Vd: NaOH, Ca(OH)₂.' },
        { id: 16, topic_id: 'solution', visual: 'pH 7',        front: 'Thang pH: môi trường acid, trung tính, base?',        back: 'pH < 7: acid · pH = 7: trung tính · pH > 7: base.' }
      ],

      /* Ion cho Xưởng ghép chất — formula dạng thô, chữ số được hiển thị thành chỉ số dưới.
         Tên theo IUPAC: tên hợp chất = tên cation + tên anion (vd: Sodium chloride). */
      ions: [
        { id: 'Na',   type: 'cation', formula: 'Na',  charge: 1,  name: 'Sodium',     poly: false },
        { id: 'K',    type: 'cation', formula: 'K',   charge: 1,  name: 'Potassium',  poly: false },
        { id: 'NH4',  type: 'cation', formula: 'NH4', charge: 1,  name: 'Ammonium',   poly: true  },
        { id: 'Mg',   type: 'cation', formula: 'Mg',  charge: 2,  name: 'Magnesium',  poly: false },
        { id: 'Ca',   type: 'cation', formula: 'Ca',  charge: 2,  name: 'Calcium',    poly: false },
        { id: 'Cu',   type: 'cation', formula: 'Cu',  charge: 2,  name: 'Copper(II)', poly: false },
        { id: 'Al',   type: 'cation', formula: 'Al',  charge: 3,  name: 'Aluminium',  poly: false },
        { id: 'Fe3',  type: 'cation', formula: 'Fe',  charge: 3,  name: 'Iron(III)',  poly: false },
        { id: 'Cl',   type: 'anion',  formula: 'Cl',  charge: -1, name: 'chloride',   poly: false },
        { id: 'OH',   type: 'anion',  formula: 'OH',  charge: -1, name: 'hydroxide',  poly: true  },
        { id: 'NO3',  type: 'anion',  formula: 'NO3', charge: -1, name: 'nitrate',    poly: true  },
        { id: 'O',    type: 'anion',  formula: 'O',   charge: -2, name: 'oxide',      poly: false },
        { id: 'SO4',  type: 'anion',  formula: 'SO4', charge: -2, name: 'sulfate',    poly: true  },
        { id: 'CO3',  type: 'anion',  formula: 'CO3', charge: -2, name: 'carbonate',  poly: true  },
        { id: 'PO4',  type: 'anion',  formula: 'PO4', charge: -3, name: 'phosphate',  poly: true  }
      ],

      /* ===== Phân hệ 3: Đối thủ ẩn danh ở Đấu trường ===== */
      arena_bots: [
        { id: 1, alias: 'Nguyên Tử Ẩn Danh', avatar: '🦊', skill: 0.55, speed_ms: [4000, 11000] },
        { id: 2, alias: 'Phân Tử Bí Ẩn',     avatar: '🐼', skill: 0.70, speed_ms: [3000, 9000]  },
        { id: 3, alias: 'Ion Tàng Hình',     avatar: '🦉', skill: 0.85, speed_ms: [2500, 7000]  }
      ],

      /* ===== Phân hệ 4: Cây kỹ năng (4 nhánh × 4 bậc) & Huy hiệu ===== */
      skill_nodes: [
        { id: 'a1', branch: 'atom',     tier: 1, name: 'Hạt cơ bản',              requires: [] },
        { id: 'a2', branch: 'atom',     tier: 2, name: 'Lớp electron',            requires: ['a1'] },
        { id: 'a3', branch: 'atom',     tier: 3, name: 'Nguyên tố & kí hiệu',     requires: ['a2'] },
        { id: 'a4', branch: 'atom',     tier: 4, name: 'Bảng tuần hoàn',          requires: ['a3'] },
        { id: 'b1', branch: 'bond',     tier: 1, name: 'Đơn chất – hợp chất',     requires: [] },
        { id: 'b2', branch: 'bond',     tier: 2, name: 'Liên kết ion',            requires: ['b1'] },
        { id: 'b3', branch: 'bond',     tier: 3, name: 'Liên kết cộng hóa trị',   requires: ['b2'] },
        { id: 'b4', branch: 'bond',     tier: 4, name: 'Hóa trị & công thức',     requires: ['b3'] },
        { id: 'r1', branch: 'reaction', tier: 1, name: 'Biến đổi hóa học',        requires: [] },
        { id: 'r2', branch: 'reaction', tier: 2, name: 'Bảo toàn khối lượng',     requires: ['r1'] },
        { id: 'r3', branch: 'reaction', tier: 3, name: 'Phương trình hóa học',    requires: ['r2'] },
        { id: 'r4', branch: 'reaction', tier: 4, name: 'Mol & tính theo PTHH',    requires: ['r3'] },
        { id: 's1', branch: 'solution', tier: 1, name: 'Acid',                    requires: [] },
        { id: 's2', branch: 'solution', tier: 2, name: 'Base',                    requires: ['s1'] },
        { id: 's3', branch: 'solution', tier: 3, name: 'Thang pH',                requires: ['s2'] },
        { id: 's4', branch: 'solution', tier: 4, name: 'Oxide & muối',            requires: ['s3'] }
      ],
      badges: [
        { id: 1,  icon: '🧪', name: 'Tân binh phòng Lab',    desc: 'Hoàn thành bài chẩn đoán đầu tiên' },
        { id: 2,  icon: '🔥', name: 'Lửa bền bỉ',            desc: 'Duy trì chuỗi 7 ngày' },
        { id: 3,  icon: '⚛️', name: 'Bậc thầy nguyên tử',    desc: 'Đạt ≥80% chủ đề Nguyên tử' },
        { id: 4,  icon: '🔗', name: 'Kiến trúc sư liên kết', desc: 'Mở khóa toàn bộ nhánh Liên kết' },
        { id: 5,  icon: '⚡', name: 'Phản xạ ánh sáng',      desc: 'Trả lời đúng trong 3 giây' },
        { id: 6,  icon: '⚔️', name: 'Đấu sĩ',                desc: 'Thắng 5 trận Đấu trường' },
        { id: 7,  icon: '🃏', name: 'Trí nhớ thép',          desc: 'Ôn 100 thẻ Flashcard' },
        { id: 8,  icon: '⚗️', name: 'Nhà giả kim',           desc: 'Ghép đúng 20 hợp chất ion' },
        { id: 9,  icon: '🌳', name: 'Cây đại thụ',           desc: 'Mở khóa 12 nút kỹ năng' },
        { id: 10, icon: '💧', name: 'Chuyên gia pH',         desc: 'Đạt ≥80% chủ đề Acid – Base – Muối' },
        { id: 11, icon: '🏆', name: 'Nhà vô địch tuần',      desc: 'Top 1 bảng xếp hạng lớp' },
        { id: 12, icon: '👑', name: 'Huyền thoại ChemRescue', desc: 'Đạt cấp độ 20' }
      ]
    };
  }

  /* =========================================================
     2. TIẾN ĐỘ CÁ NHÂN (bắt đầu từ con số 0 cho mỗi học sinh)
     ========================================================= */
  function freshUserData() {
    const profile = Session?.profile || {};
    const isTeacher = Session?.role === 'teacher';
    return {
      meta: { schema_version: SCHEMA_VERSION, created_at: new Date().toISOString(), quest_date: localDate(), minutes_by_day: {} },
      users: [{
        id: 1,
        name: profile.name || (isTeacher ? 'Giáo viên' : 'Học sinh'),
        role: isTeacher ? 'teacher' : 'student',
        class_id: profile.class_name || (isTeacher ? '—' : ''),
        avatar: isTeacher ? '👩‍🏫' : '🧑‍🔬',
        level: 1, exp: 0, gems: 0, streak: 0, last_active: null,
        module_progress: { diagnostic: 0, island: 0, arena: 0, skills: 0 }
      }],
      quiz_attempts: [],
      flashcard_reviews: [],
      lab_discoveries: [],
      quests: [
        { id: 1, icon: '🩺', title: 'Hoàn thành 1 bài chẩn đoán nhanh', target: 1,  progress: 0, exp_reward: 40, route: 'diagnostic',       claimed: false },
        { id: 2, icon: '🃏', title: 'Ôn 10 thẻ Flashcard',            target: 10, progress: 0, exp_reward: 30, route: 'island/flashcard', claimed: false },
        { id: 3, icon: '⚗️', title: 'Ghép đúng 3 hợp chất ion',        target: 3,  progress: 0, exp_reward: 35, route: 'island/lab',       claimed: false },
        { id: 4, icon: '⚔️', title: 'Thắng 1 trận Đấu trường 1vs1',    target: 1,  progress: 0, exp_reward: 50, route: 'arena/match',      claimed: false }
      ],
      activity_days: [],
      arena_matches: [],
      user_skills: [],
      user_badges: []
    };
  }

  function seed() {
    return { ...content(), ...freshUserData(), students: [], activity_log: [] };
  }

  /* ---------- LƯU TRỮ ---------- */
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

  // Phần dữ liệu cần lưu/đồng bộ: tiến độ cá nhân + meta (không gồm nội dung học & dữ liệu lớp)
  function userState(d) {
    const out = { meta: d.meta };
    USER_TABLES.forEach((k) => { out[k] = d[k]; });
    return out;
  }

  function persist(d) {
    const state = userState(d);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('[ChemDB] Không thể ghi localStorage – dữ liệu chỉ tồn tại trong phiên này.', e); }
    Session?.onPersist?.(state); // → đồng bộ lên máy chủ
  }

  // Ghép: nội dung học mới nhất (từ mã nguồn) + tiến độ cá nhân đã lưu
  function load() {
    const fresh = seed();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); }
    catch (e) { console.warn('[ChemDB] Dữ liệu lưu bị hỏng, khởi tạo lại.', e); }

    if (!saved || !Array.isArray(saved.users) || !saved.users.length) {
      persist(fresh);
      return fresh;
    }
    const d = { ...fresh };
    USER_TABLES.forEach((k) => { if (Array.isArray(saved[k])) d[k] = saved[k]; });
    d.meta = { ...fresh.meta, ...(saved.meta || {}), schema_version: SCHEMA_VERSION };
    // Họ tên & lớp luôn theo tài khoản đăng nhập
    if (Session?.profile) Object.assign(d.users[0], { name: Session.profile.name, class_id: Session.profile.class_name });
    d.users[0].module_progress = { diagnostic: 0, island: 0, arena: 0, skills: 0, ...(d.users[0].module_progress || {}) };
    return d;
  }

  let data = load();

  /* ---------- TRUY VẤN KIỂU SQL ---------- */
  function table(name) {
    if (!Array.isArray(data[name])) throw new Error(`[ChemDB] Bảng "${name}" không tồn tại`);
    return data[name];
  }

  // where: object {col: value | [values]} (≈ WHERE col = ? / IN (...)) hoặc hàm điều kiện
  function matches(row, where) {
    if (!where) return true;
    if (typeof where === 'function') return where(row);
    return Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v));
  }

  function select(name, where, opts = {}) {
    let rows = table(name).filter((r) => matches(r, where));
    if (opts.orderBy) {
      const [col, dir = 'asc'] = opts.orderBy.split(/\s+/);
      const sign = dir.toLowerCase() === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * sign);
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return clone(rows);
  }

  function get(name, id) {
    const row = table(name).find((r) => r.id === id);
    return row ? clone(row) : null;
  }

  function insert(name, row) {
    const t = table(name);
    const rec = { ...row };
    if (rec.id == null) { // AUTOINCREMENT
      const ids = t.map((r) => r.id).filter(Number.isInteger);
      rec.id = (ids.length ? Math.max(...ids) : 0) + 1;
    }
    t.push(rec);
    persist(data);
    return clone(rec);
  }

  function update(name, id, patch) {
    const t = table(name);
    const i = t.findIndex((r) => r.id === id);
    if (i < 0) return null;
    t[i] = { ...t[i], ...patch, id };
    persist(data);
    return clone(t[i]);
  }

  function remove(name, id) {
    const t = table(name);
    const i = t.findIndex((r) => r.id === id);
    if (i < 0) return false;
    t.splice(i, 1);
    persist(data);
    return true;
  }

  // Thay toàn bộ một bảng dữ liệu lớp học (Dashboard Giáo viên) – chỉ trong bộ nhớ, không lưu/đồng bộ
  function replaceTable(name, rows) {
    if (!CLASS_TABLES.includes(name)) throw new Error(`[ChemDB] Không được thay bảng "${name}"`);
    data[name] = clone(rows);
  }

  const count = (name, where) => table(name).filter((r) => matches(r, where)).length;
  const tables = () => Object.keys(data).filter((k) => Array.isArray(data[k]));

  function meta(patch) {
    if (patch) { Object.assign(data.meta, patch); persist(data); }
    return clone(data.meta);
  }

  /* ---------- NGHIỆP VỤ CHUNG ---------- */
  const currentUser = () => get('users', 1);

  // Reset tiến độ nhiệm vụ khi sang ngày mới
  function dailyReset() {
    const today = localDate();
    if (data.meta.quest_date === today) return false;
    data.quests.forEach((q) => { q.progress = 0; q.claimed = false; });
    data.meta.quest_date = today;
    persist(data);
    return true;
  }

  // Cộng 1 phút học vào ngày hôm nay (session.js gọi mỗi phút khi học sinh đang thao tác)
  function addStudyMinute() {
    const m = { ...(data.meta.minutes_by_day || {}) };
    const today = localDate();
    m[today] = (m[today] || 0) + 1;
    const cutoff = daysAgo(60);
    Object.keys(m).forEach((d) => { if (d < cutoff) delete m[d]; });
    meta({ minutes_by_day: m });
  }

  // Làm lại từ đầu: xóa tiến độ cá nhân (nội dung học giữ nguyên)
  function reset() { data = seed(); persist(data); }
  const exportJSON = () => JSON.stringify(userState(data), null, 2);

  return {
    select, get, insert, update, remove, count, tables, meta, replaceTable,
    currentUser, dailyReset, addStudyMinute, reset, exportJSON,
    localDate, daysAgo
  };
})();

// `const` cấp cao nhất không tự gắn vào window → xuất tường minh cho app.js & các phân hệ
window.ChemDB = ChemDB;
