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

      /* ===== Ngân hàng câu hỏi: 150 câu (30 câu / chủ đề) – dùng cho Phân hệ 1 (Chẩn đoán) và Phân hệ 3 (Đấu trường) =====
         Chẩn đoán rút ngẫu nhiên 3 câu/chủ đề; Đấu trường rút 5 câu, tránh câu đã gặp trong 3 trận gần nhất. */
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
          explain: 'Dung dịch acid làm quỳ tím hóa đỏ; dung dịch base làm quỳ tím hóa xanh.' },

        /* ----- Ngân hàng mở rộng (id 16–50): mỗi chủ đề đủ 10 câu.
                 Chẩn đoán rút ngẫu nhiên 3 câu/chủ đề; Đấu trường rút 5 câu, tránh câu vừa gặp. ----- */
        { id: 16, topic_id: 'atom', text: 'Khối lượng của nguyên tử tập trung chủ yếu ở:',
          options: ['Lớp vỏ electron', 'Hạt nhân', 'Electron lớp ngoài cùng', 'Phân bố đều khắp nguyên tử'], answer: 1,
          explain: 'Proton và neutron nặng hơn electron khoảng 1840 lần, nên khối lượng nguyên tử tập trung ở hạt nhân.' },
        { id: 17, topic_id: 'atom', text: 'Hạt nào sau đây KHÔNG mang điện?',
          options: ['Proton', 'Electron', 'Neutron', 'Ion'], answer: 2,
          explain: 'Neutron không mang điện; proton mang điện dương, electron mang điện âm.' },
        { id: 18, topic_id: 'atom', text: 'Nguyên tử oxygen có 8 proton và 8 neutron. Khối lượng nguyên tử oxygen xấp xỉ:',
          options: ['8 amu', '16 amu', '24 amu', '32 amu'], answer: 1,
          explain: 'Khối lượng nguyên tử ≈ số proton + số neutron = 8 + 8 = 16 amu (electron rất nhẹ, bỏ qua).' },
        { id: 19, topic_id: 'atom', text: 'Nguyên tử magnesium có 12 electron. Số lớp electron của nguyên tử magnesium là:',
          options: ['2', '3', '4', '12'], answer: 1,
          explain: '12 electron xếp thành 3 lớp: 2, 8, 2.' },
        { id: 20, topic_id: 'atom', text: 'Nguyên tử chlorine có 17 electron. Số electron ở lớp ngoài cùng là:',
          options: ['1', '5', '7', '8'], answer: 2,
          explain: '17 electron xếp thành các lớp 2, 8, 7 → lớp ngoài cùng có 7 electron.' },
        { id: 21, topic_id: 'atom', text: 'Nguyên tử trung hòa về điện vì:',
          options: ['Số proton bằng số neutron', 'Số proton bằng số electron', 'Số neutron bằng số electron', 'Không có hạt nào mang điện'], answer: 1,
          explain: 'Tổng điện tích dương của proton bằng tổng điện tích âm của electron.' },
        { id: 22, topic_id: 'atom', text: 'Nguyên tử aluminium có 13 proton và 14 neutron. Tổng số hạt (p, n, e) trong nguyên tử là:',
          options: ['27', '40', '26', '13'], answer: 1,
          explain: 'Số electron = số proton = 13 → tổng = 13 + 14 + 13 = 40 hạt.' },

        { id: 23, topic_id: 'periodic', text: 'Kí hiệu hóa học của nguyên tố iron (sắt) là:',
          options: ['Ir', 'I', 'Fe', 'Fr'], answer: 2,
          explain: 'Iron có tên Latin là Ferrum nên kí hiệu là Fe. (I là iodine.)' },
        { id: 24, topic_id: 'periodic', text: 'Nguyên tố có kí hiệu Cu là:',
          options: ['Calcium', 'Copper (đồng)', 'Chlorine', 'Carbon'], answer: 1,
          explain: 'Cu (Latin: Cuprum) là copper – đồng. Calcium là Ca, chlorine là Cl, carbon là C.' },
        { id: 25, topic_id: 'periodic', text: 'Các nguyên tố trong bảng tuần hoàn được sắp xếp theo chiều tăng dần của:',
          options: ['Khối lượng nguyên tử', 'Số hiệu nguyên tử (Z)', 'Số neutron', 'Số lớp electron'], answer: 1,
          explain: 'Bảng tuần hoàn hiện đại xếp nguyên tố theo chiều tăng dần điện tích hạt nhân (số hiệu nguyên tử Z).' },
        { id: 26, topic_id: 'periodic', text: 'Các nguyên tố trong cùng một nhóm A có cùng:',
          options: ['Số lớp electron', 'Số electron lớp ngoài cùng', 'Số proton', 'Khối lượng nguyên tử'], answer: 1,
          explain: 'Cùng nhóm A → cùng số electron lớp ngoài cùng → tính chất hóa học tương tự nhau.' },
        { id: 27, topic_id: 'periodic', text: 'Nguyên tố nào sau đây là kim loại?',
          options: ['Sulfur', 'Phosphorus', 'Sodium', 'Chlorine'], answer: 2,
          explain: 'Sodium (Na) là kim loại nhóm IA; sulfur, phosphorus, chlorine là phi kim.' },
        { id: 28, topic_id: 'periodic', text: 'Sodium (Z = 11) có các lớp electron 2, 8, 1. Sodium nằm ở:',
          options: ['Chu kì 3, nhóm IA', 'Chu kì 1, nhóm IIIA', 'Chu kì 2, nhóm IA', 'Chu kì 3, nhóm IIIA'], answer: 0,
          explain: '3 lớp electron → chu kì 3; 1 electron lớp ngoài cùng → nhóm IA.' },
        { id: 29, topic_id: 'periodic', text: 'Kí hiệu hóa học của nguyên tố calcium là:',
          options: ['C', 'Ca', 'Cl', 'Co'], answer: 1,
          explain: 'Calcium là Ca. C là carbon, Cl là chlorine, Co là cobalt.' },

        { id: 30, topic_id: 'bonding', text: 'Chất nào sau đây là đơn chất?',
          options: ['H₂O', 'CO₂', 'O₂', 'NaCl'], answer: 2,
          explain: 'O₂ chỉ gồm một nguyên tố (oxygen) → đơn chất. Các chất còn lại gồm từ hai nguyên tố trở lên.' },
        { id: 31, topic_id: 'bonding', text: 'Chất nào sau đây là hợp chất?',
          options: ['N₂', 'Cu', 'Cl₂', 'H₂O'], answer: 3,
          explain: 'H₂O tạo bởi hai nguyên tố hydrogen và oxygen → hợp chất.' },
        { id: 32, topic_id: 'bonding', text: 'Liên kết giữa các nguyên tử trong phân tử nước (H₂O) là:',
          options: ['Liên kết ion', 'Liên kết cộng hóa trị', 'Liên kết kim loại', 'Không có liên kết'], answer: 1,
          explain: 'H và O là phi kim, liên kết bằng các cặp electron dùng chung → liên kết cộng hóa trị.' },
        { id: 33, topic_id: 'bonding', text: 'Hóa trị của Fe trong hợp chất Fe₂O₃ là:',
          options: ['I', 'II', 'III', 'IV'], answer: 2,
          explain: 'O có hóa trị II: 2 × a = 3 × II → a = III.' },
        { id: 34, topic_id: 'bonding', text: 'Công thức hóa học của hợp chất tạo bởi Mg (II) và Cl (I) là:',
          options: ['MgCl', 'MgCl₂', 'Mg₂Cl', 'Mg₂Cl₃'], answer: 1,
          explain: 'x × II = y × I → x : y = 1 : 2 → MgCl₂ (magnesium chloride).' },
        { id: 35, topic_id: 'bonding', text: 'Hóa trị của P trong hợp chất P₂O₅ là:',
          options: ['III', 'IV', 'V', 'II'], answer: 2,
          explain: 'O có hóa trị II: 2 × a = 5 × II → a = V.' },
        { id: 36, topic_id: 'bonding', text: 'Công thức của aluminium hydroxide (Al hóa trị III, nhóm OH hóa trị I) là:',
          options: ['AlOH', 'Al(OH)₂', 'Al(OH)₃', 'Al₃OH'], answer: 2,
          explain: 'x × III = y × I → x : y = 1 : 3 → Al(OH)₃.' },

        { id: 37, topic_id: 'redox', text: 'Dấu hiệu nào cho biết đã có phản ứng hóa học xảy ra?',
          options: ['Chất thay đổi hình dạng', 'Có chất khí thoát ra hoặc màu sắc thay đổi', 'Chất bị nghiền nhỏ', 'Chất bị nóng chảy'], answer: 1,
          explain: 'Có chất mới tạo thành thường kèm dấu hiệu: tạo khí, đổi màu, tạo kết tủa, tỏa nhiệt hoặc phát sáng.' },
        { id: 38, topic_id: 'redox', text: 'Số mol của 8 g khí oxygen (O₂) là (O = 16):',
          options: ['0,25 mol', '0,5 mol', '1 mol', '2 mol'], answer: 0,
          explain: 'M(O₂) = 32 g/mol → n = m / M = 8 / 32 = 0,25 mol.' },
        { id: 39, topic_id: 'redox', text: 'Khối lượng mol của carbon dioxide (CO₂) là (C = 12, O = 16):',
          options: ['28 g/mol', '44 g/mol', '32 g/mol', '40 g/mol'], answer: 1,
          explain: 'M(CO₂) = 12 + 2 × 16 = 44 g/mol.' },
        { id: 40, topic_id: 'redox', text: 'Phương trình hóa học nào dưới đây đã được cân bằng đúng?',
          options: ['H₂ + O₂ → H₂O', '2H₂ + O₂ → 2H₂O', 'H₂ + 2O₂ → 2H₂O', '2H₂ + 2O₂ → 2H₂O'], answer: 1,
          explain: 'Vế trái: 4 H, 2 O; vế phải: 4 H, 2 O → số nguyên tử mỗi nguyên tố bằng nhau.' },
        { id: 41, topic_id: 'redox', text: 'Khối lượng của 2 mol nước (H₂O) là (H = 1, O = 16):',
          options: ['18 g', '20 g', '36 g', '9 g'], answer: 2,
          explain: 'm = n × M = 2 × 18 = 36 g.' },
        { id: 42, topic_id: 'redox', text: 'Ở điều kiện chuẩn (25 °C, 1 bar), 1 mol khí bất kì chiếm thể tích khoảng:',
          options: ['22,4 L', '24,79 L', '1 L', '6,02 L'], answer: 1,
          explain: 'Theo chương trình KHTN 8, ở điều kiện chuẩn (25 °C, 1 bar) thể tích mol khí là 24,79 L/mol.' },
        { id: 43, topic_id: 'redox', text: 'Trong phản ứng: zinc + hydrochloric acid → zinc chloride + hydrogen, các chất sản phẩm là:',
          options: ['Zinc và hydrochloric acid', 'Zinc chloride và hydrogen', 'Zinc và hydrogen', 'Chỉ có hydrogen'], answer: 1,
          explain: 'Chất sản phẩm đứng sau mũi tên: zinc chloride (ZnCl₂) và hydrogen (H₂).' },

        { id: 44, topic_id: 'solution', text: 'Dung dịch base làm quỳ tím chuyển sang màu:',
          options: ['Đỏ', 'Xanh', 'Không đổi màu', 'Vàng'], answer: 1,
          explain: 'Dung dịch base (có ion OH⁻) làm quỳ tím hóa xanh.' },
        { id: 45, topic_id: 'solution', text: 'Chất nào sau đây là acid?',
          options: ['NaOH', 'H₂SO₄', 'CaO', 'KCl'], answer: 1,
          explain: 'H₂SO₄ (sulfuric acid) có nguyên tử hydrogen liên kết với gốc acid (SO₄).' },
        { id: 46, topic_id: 'solution', text: 'Dung dịch có pH = 7 có môi trường:',
          options: ['Acid', 'Trung tính', 'Base', 'Không xác định được'], answer: 1,
          explain: 'pH = 7 là môi trường trung tính, ví dụ nước cất.' },
        { id: 47, topic_id: 'solution', text: 'Chất nào sau đây là muối?',
          options: ['HCl', 'KOH', 'NaCl', 'SO₂'], answer: 2,
          explain: 'NaCl (sodium chloride) gồm cation kim loại Na⁺ và anion gốc acid Cl⁻ → muối.' },
        { id: 48, topic_id: 'solution', text: 'Carbon dioxide (CO₂) thuộc loại:',
          options: ['Oxide acid', 'Oxide base', 'Base', 'Muối'], answer: 0,
          explain: 'CO₂ là oxide của phi kim, tác dụng với dung dịch base tạo muối và nước → oxide acid.' },
        { id: 49, topic_id: 'solution', text: 'Calcium oxide (CaO) thuộc loại:',
          options: ['Oxide acid', 'Oxide base', 'Acid', 'Muối'], answer: 1,
          explain: 'CaO là oxide của kim loại, tác dụng với acid tạo muối và nước → oxide base.' },
        { id: 50, topic_id: 'solution', text: 'Tên gọi theo IUPAC của muối NaCl là:',
          options: ['Sodium chloride', 'Sodium chlorine', 'Natri clorua', 'Sodium chlorate'], answer: 0,
          explain: 'Tên muối = tên kim loại + tên gốc acid: sodium + chloride → sodium chloride.' },

        /* ----- Vận dụng thấp: tính toán theo công thức (id 51–70), chủ đề "Phản ứng hóa học & mol".
                 time_ms: 40000 → ở Đấu trường câu này được 40 giây thay vì 15 giây.
                 Công thức (KHTN 8): n = m / M · V(khí, đkc 25 °C, 1 bar) = n × 24,79 · C_M = n / V(L)
                                     C% = m_ct / m_dd × 100% · d(A/B) = M_A / M_B · d(A/kk) = M_A / 29 ----- */
        // — Số mol & khối lượng
        { id: 51, topic_id: 'redox', time_ms: 40000, text: 'Số mol của 5,6 g iron (Fe) là (Fe = 56):',
          options: ['0,1 mol', '0,2 mol', '1 mol', '0,56 mol'], answer: 0,
          explain: 'n = m / M = 5,6 / 56 = 0,1 mol.' },
        { id: 52, topic_id: 'redox', time_ms: 40000, text: 'Số mol của 9,8 g sulfuric acid (H₂SO₄) là (H = 1, S = 32, O = 16):',
          options: ['0,2 mol', '0,1 mol', '1 mol', '0,98 mol'], answer: 1,
          explain: 'M(H₂SO₄) = 2 × 1 + 32 + 4 × 16 = 98 g/mol → n = 9,8 / 98 = 0,1 mol.' },
        { id: 53, topic_id: 'redox', time_ms: 40000, text: 'Khối lượng của 0,25 mol calcium carbonate (CaCO₃) là (Ca = 40, C = 12, O = 16):',
          options: ['10 g', '40 g', '25 g', '100 g'], answer: 2,
          explain: 'M(CaCO₃) = 40 + 12 + 3 × 16 = 100 g/mol → m = n × M = 0,25 × 100 = 25 g.' },
        { id: 54, topic_id: 'redox', time_ms: 40000, text: 'Khối lượng của 0,5 mol sodium hydroxide (NaOH) là (Na = 23, O = 16, H = 1):',
          options: ['40 g', '80 g', '10 g', '20 g'], answer: 3,
          explain: 'M(NaOH) = 23 + 16 + 1 = 40 g/mol → m = 0,5 × 40 = 20 g.' },

        // — Thể tích khí ở điều kiện chuẩn (25 °C, 1 bar): 24,79 L/mol
        { id: 55, topic_id: 'redox', time_ms: 40000, text: 'Thể tích của 0,2 mol khí oxygen (O₂) ở điều kiện chuẩn (25 °C, 1 bar) là:',
          options: ['4,958 L', '4,48 L', '24,79 L', '49,58 L'], answer: 0,
          explain: 'V = n × 24,79 = 0,2 × 24,79 = 4,958 L. (4,48 L là cách tính cũ theo 22,4 L/mol.)' },
        { id: 56, topic_id: 'redox', time_ms: 40000, text: 'Số mol của 12,395 L khí carbon dioxide (CO₂) ở điều kiện chuẩn là:',
          options: ['0,25 mol', '0,5 mol', '1 mol', '2 mol'], answer: 1,
          explain: 'n = V / 24,79 = 12,395 / 24,79 = 0,5 mol.' },
        { id: 57, topic_id: 'redox', time_ms: 40000, text: 'Thể tích của 3,2 g khí oxygen (O₂) ở điều kiện chuẩn là (O = 16):',
          options: ['2,24 L', '4,958 L', '2,479 L', '24,79 L'], answer: 2,
          explain: 'n = 3,2 / 32 = 0,1 mol → V = 0,1 × 24,79 = 2,479 L.' },
        { id: 58, topic_id: 'redox', time_ms: 40000, text: 'Ở điều kiện chuẩn, 7,437 L khí hydrogen (H₂) có khối lượng là (H = 1):',
          options: ['0,3 g', '6 g', '0,15 g', '0,6 g'], answer: 3,
          explain: 'n = 7,437 / 24,79 = 0,3 mol → m = 0,3 × 2 = 0,6 g.' },

        // — Nồng độ mol: C_M = n / V (V tính bằng lít)
        { id: 59, topic_id: 'redox', time_ms: 40000, text: 'Hòa tan 0,2 mol NaCl vào nước được 500 mL dung dịch. Nồng độ mol của dung dịch là:',
          options: ['0,1 M', '0,4 M', '1 M', '0,04 M'], answer: 1,
          explain: 'Đổi 500 mL = 0,5 L → C_M = n / V = 0,2 / 0,5 = 0,4 M (mol/L).' },
        { id: 60, topic_id: 'redox', time_ms: 40000, text: 'Hòa tan 8 g NaOH vào nước được 200 mL dung dịch. Nồng độ mol của dung dịch là (Na = 23, O = 16, H = 1):',
          options: ['1 M', '0,4 M', '2 M', '0,04 M'], answer: 0,
          explain: 'n = 8 / 40 = 0,2 mol; V = 0,2 L → C_M = 0,2 / 0,2 = 1 M.' },
        { id: 61, topic_id: 'redox', time_ms: 40000, text: 'Số mol HCl có trong 250 mL dung dịch hydrochloric acid 2 M là:',
          options: ['0,25 mol', '8 mol', '0,5 mol', '5 mol'], answer: 2,
          explain: 'n = C_M × V = 2 × 0,25 = 0,5 mol.' },
        { id: 62, topic_id: 'redox', time_ms: 40000, text: 'Thể tích dung dịch CuSO₄ 0,5 M có chứa 0,1 mol CuSO₄ là:',
          options: ['50 mL', '500 mL', '20 mL', '200 mL'], answer: 3,
          explain: 'V = n / C_M = 0,1 / 0,5 = 0,2 L = 200 mL.' },

        // — Nồng độ phần trăm: C% = m_chất tan / m_dung dịch × 100%
        { id: 63, topic_id: 'redox', time_ms: 40000, text: 'Hòa tan 20 g muối ăn vào 80 g nước. Nồng độ phần trăm của dung dịch là:',
          options: ['25%', '20%', '80%', '16%'], answer: 1,
          explain: 'm_dd = 20 + 80 = 100 g → C% = 20 / 100 × 100% = 20%. (Lưu ý: chia cho khối lượng DUNG DỊCH, không chia cho nước.)' },
        { id: 64, topic_id: 'redox', time_ms: 40000, text: 'Khối lượng NaCl có trong 200 g dung dịch NaCl 10% là:',
          options: ['20 g', '10 g', '2 g', '200 g'], answer: 0,
          explain: 'm_ct = C% × m_dd / 100% = 10 × 200 / 100 = 20 g.' },
        { id: 65, topic_id: 'redox', time_ms: 40000, text: 'Hòa tan 15 g đường vào 135 g nước. Nồng độ phần trăm của dung dịch đường là:',
          options: ['11,1%', '15%', '10%', '90%'], answer: 2,
          explain: 'm_dd = 15 + 135 = 150 g → C% = 15 / 150 × 100% = 10%.' },
        { id: 66, topic_id: 'redox', time_ms: 40000, text: 'Cần bao nhiêu gam nước để hòa tan 10 g KCl, thu được dung dịch KCl 20%?',
          options: ['50 g', '30 g', '200 g', '40 g'], answer: 3,
          explain: 'm_dd = 10 × 100 / 20 = 50 g → m_nước = 50 − 10 = 40 g.' },

        // — Tỉ khối chất khí: d(A/B) = M_A / M_B; d(A/kk) = M_A / 29
        { id: 67, topic_id: 'redox', time_ms: 40000, text: 'Tỉ khối của khí carbon dioxide (CO₂) so với khí hydrogen (H₂) là (C = 12, O = 16, H = 1):',
          options: ['22', '44', '11', '2'], answer: 0,
          explain: 'd = M(CO₂) / M(H₂) = 44 / 2 = 22 → CO₂ nặng gấp 22 lần H₂.' },
        { id: 68, topic_id: 'redox', time_ms: 40000, text: 'Tỉ khối của khí sulfur dioxide (SO₂) so với không khí là (S = 32, O = 16, M không khí ≈ 29):',
          options: ['0,45', '2,21', '64', '1,21'], answer: 1,
          explain: 'M(SO₂) = 32 + 2 × 16 = 64 → d = 64 / 29 ≈ 2,21 → SO₂ nặng hơn không khí khoảng 2,21 lần.' },
        { id: 69, topic_id: 'redox', time_ms: 40000, text: 'Khí X có tỉ khối so với khí hydrogen (H₂) bằng 16. Khối lượng mol của khí X là:',
          options: ['16 g/mol', '8 g/mol', '32 g/mol', '64 g/mol'], answer: 2,
          explain: 'M_X = d × M(H₂) = 16 × 2 = 32 g/mol (có thể là khí oxygen O₂).' },
        { id: 70, topic_id: 'redox', time_ms: 40000, text: 'Khí nào sau đây NHẸ hơn không khí (M không khí ≈ 29)?',
          options: ['CO₂ (M = 44)', 'Cl₂ (M = 71)', 'O₂ (M = 32)', 'NH₃ (M = 17)'], answer: 3,
          explain: 'd(NH₃/kk) = 17 / 29 ≈ 0,59 < 1 → ammonia nhẹ hơn không khí. Các khí còn lại có M > 29.' },

        /* ----- Bổ sung để cân bằng (id 71–150): mỗi chủ đề còn lại thêm 20 câu → cả 5 chủ đề đều 30 câu.
                 Câu có time_ms: 40000 là câu tính toán (40 giây ở Đấu trường). ----- */
        // — Bổ sung chủ đề "Nguyên tử" (20 câu thông hiểu & vận dụng thấp)
        { id: 71, topic_id: 'atom', time_ms: 40000, text: "Nguyên tử fluorine có 9 proton và 10 neutron. Khối lượng nguyên tử fluorine xấp xỉ:",
          options: ["19 amu", "9 amu", "10 amu", "28 amu"], answer: 0,
          explain: "Khối lượng nguyên tử ≈ số proton + số neutron = 9 + 10 = 19 amu." },
        { id: 72, topic_id: 'atom', time_ms: 40000, text: "Nguyên tử X có tổng số hạt (p, n, e) là 34, trong đó số hạt mang điện nhiều hơn số hạt không mang điện là 10. Số proton của X là:",
          options: ["10", "11", "12", "23"], answer: 1,
          explain: "Ta có 2p + n = 34 và 2p − n = 10 → 4p = 44 → p = 11 (X là sodium)." },
        { id: 73, topic_id: 'atom', time_ms: 40000, text: "Nguyên tử có 3 lớp electron, lớp ngoài cùng có 2 electron. Tổng số electron của nguyên tử là:",
          options: ["3", "10", "12", "14"], answer: 2,
          explain: "Lớp 1: 2 e, lớp 2: 8 e, lớp 3: 2 e → tổng 2 + 8 + 2 = 12 electron (magnesium)." },
        { id: 74, topic_id: 'atom', text: "Nguyên tử nitrogen có 7 electron. Các electron được sắp xếp theo lớp là:",
          options: ["5, 2", "2, 4, 1", "7", "2, 5"], answer: 3,
          explain: "Lớp thứ nhất tối đa 2 electron, 5 electron còn lại ở lớp thứ hai → 2, 5." },
        { id: 75, topic_id: 'atom', text: "Nguyên tử sulfur có 16 proton. Số electron ở lớp ngoài cùng của nguyên tử sulfur là:",
          options: ["6", "2", "8", "16"], answer: 0,
          explain: "16 electron xếp thành các lớp 2, 8, 6 → lớp ngoài cùng có 6 electron." },
        { id: 76, topic_id: 'atom', text: "Hạt electron mang điện tích:",
          options: ["+1", "−1", "0", "+2"], answer: 1,
          explain: "Electron mang điện tích âm (−1); proton mang điện tích dương (+1); neutron không mang điện." },
        { id: 77, topic_id: 'atom', text: "Theo mô hình Rutherford – Bohr, electron trong nguyên tử:",
          options: ["Nằm bên trong hạt nhân", "Đứng yên bên cạnh hạt nhân", "Chuyển động quanh hạt nhân theo các lớp (quỹ đạo) xác định", "Nằm bên trong proton"], answer: 2,
          explain: "Hạt nhân ở tâm; các electron chuyển động quanh hạt nhân theo từng lớp tạo thành lớp vỏ nguyên tử." },
        { id: 78, topic_id: 'atom', time_ms: 40000, text: "Nguyên tử potassium có 19 proton và 20 neutron. Khối lượng nguyên tử potassium xấp xỉ:",
          options: ["19 amu", "20 amu", "58 amu", "39 amu"], answer: 3,
          explain: "Khối lượng nguyên tử ≈ 19 + 20 = 39 amu." },
        { id: 79, topic_id: 'atom', text: "Nguyên tử nào sau đây có 8 electron ở lớp ngoài cùng (bền vững)?",
          options: ["Neon (Z = 10)", "Sodium (Z = 11)", "Oxygen (Z = 8)", "Chlorine (Z = 17)"], answer: 0,
          explain: "Neon: 2, 8 → lớp ngoài cùng có 8 electron, là khí hiếm rất bền." },
        { id: 80, topic_id: 'atom', text: "Nguyên tử calcium có 20 electron. Số lớp electron của nguyên tử calcium là:",
          options: ["2", "4", "3", "5"], answer: 1,
          explain: "20 electron xếp thành các lớp 2, 8, 8, 2 → có 4 lớp electron." },
        { id: 81, topic_id: 'atom', time_ms: 40000, text: "Khối lượng nguyên tử carbon là 12 amu, magnesium là 24 amu. Nguyên tử magnesium nặng gấp bao nhiêu lần nguyên tử carbon?",
          options: ["0,5 lần", "12 lần", "2 lần", "24 lần"], answer: 2,
          explain: "24 : 12 = 2 → nguyên tử magnesium nặng gấp 2 lần nguyên tử carbon." },
        { id: 82, topic_id: 'atom', time_ms: 40000, text: "Nguyên tử X có 12 proton. Nguyên tử Y có khối lượng nguyên tử 24 amu và có 12 neutron. Nhận xét đúng là:",
          options: ["X và Y là hai nguyên tố khác nhau", "Y nhẹ hơn X", "Không thể so sánh được", "X và Y thuộc cùng một nguyên tố"], answer: 3,
          explain: "Số proton của Y = 24 − 12 = 12, bằng số proton của X → cùng một nguyên tố hóa học (magnesium)." },
        { id: 83, topic_id: 'atom', time_ms: 40000, text: "Một nguyên tử có tổng số hạt là 40, trong đó có 14 hạt không mang điện. Số proton của nguyên tử là:",
          options: ["13", "14", "26", "27"], answer: 0,
          explain: "Số hạt mang điện = 40 − 14 = 26 = p + e = 2p → p = 13 (aluminium)." },
        { id: 84, topic_id: 'atom', text: "Đơn vị khối lượng nguyên tử 1 amu có giá trị xấp xỉ bằng khối lượng của:",
          options: ["1 electron", "1 proton", "1 nguyên tử oxygen", "1 phân tử nước"], answer: 1,
          explain: "Khối lượng 1 proton ≈ khối lượng 1 neutron ≈ 1 amu; electron nhẹ hơn khoảng 1840 lần." },
        { id: 85, topic_id: 'atom', text: "Số proton trong hạt nhân nguyên tử còn được gọi là:",
          options: ["Số lớp electron", "Khối lượng nguyên tử", "Số hiệu nguyên tử (Z)", "Số nhóm"], answer: 2,
          explain: "Số hiệu nguyên tử Z = số proton = số electron (trong nguyên tử) = số thứ tự ô nguyên tố." },
        { id: 86, topic_id: 'atom', text: "Nguyên tử oxygen (Z = 8) cần nhận thêm bao nhiêu electron để lớp ngoài cùng có 8 electron?",
          options: ["1", "6", "8", "2"], answer: 3,
          explain: "Oxygen: 2, 6 → lớp ngoài cùng có 6 electron, cần nhận thêm 2 electron." },
        { id: 87, topic_id: 'atom', text: "Nguyên tử sodium (các lớp electron 2, 8, 1) có xu hướng:",
          options: ["Nhường 1 electron", "Nhận 7 electron", "Nhận 1 electron", "Nhường 2 electron"], answer: 0,
          explain: "Nhường 1 electron lớp ngoài cùng → lớp ngoài mới có 8 electron bền vững, tạo ion Na⁺." },
        { id: 88, topic_id: 'atom', text: "Nguyên tử hydrogen phổ biến có 1 proton và không có neutron. Khối lượng nguyên tử hydrogen xấp xỉ:",
          options: ["0 amu", "1 amu", "2 amu", "0,5 amu"], answer: 1,
          explain: "Khối lượng nguyên tử ≈ số proton + số neutron = 1 + 0 = 1 amu." },
        { id: 89, topic_id: 'atom', text: "Nguyên tử A có 6 proton, 6 neutron; nguyên tử B có 6 proton, 8 neutron. Nhận xét đúng là:",
          options: ["A và B là hai nguyên tố khác nhau", "B nhẹ hơn A", "A và B đều thuộc nguyên tố carbon", "A có nhiều electron hơn B"], answer: 2,
          explain: "Cùng số proton (6) → cùng nguyên tố carbon; chỉ khác số neutron nên B nặng hơn A." },
        { id: 90, topic_id: 'atom', text: "Trong hạt nhân nguyên tử có những loại hạt nào?",
          options: ["Proton và electron", "Neutron và electron", "Chỉ có electron", "Proton và neutron"], answer: 3,
          explain: "Hạt nhân gồm proton và neutron; electron chuyển động ở lớp vỏ." },

        // — Bổ sung chủ đề "Nguyên tố & bảng tuần hoàn" (20 câu thông hiểu & vận dụng thấp)
        { id: 91, topic_id: 'periodic', time_ms: 40000, text: "Nguyên tố ở chu kì 2, nhóm VIA là:",
          options: ["Oxygen", "Sulfur", "Carbon", "Neon"], answer: 0,
          explain: "Chu kì 2 → 2 lớp electron; nhóm VIA → 6 electron lớp ngoài cùng → 2, 6 → Z = 8: oxygen." },
        { id: 92, topic_id: 'periodic', text: "Nguyên tố X nằm ở ô số 17 (chlorine). X là:",
          options: ["Kim loại", "Phi kim", "Khí hiếm", "Kim loại chuyển tiếp"], answer: 1,
          explain: "Chlorine (2, 8, 7) thuộc nhóm VIIA – nhóm halogen, là phi kim." },
        { id: 93, topic_id: 'periodic', time_ms: 40000, text: "Nguyên tố ở chu kì 3, nhóm IIIA có số hiệu nguyên tử là:",
          options: ["3", "11", "13", "15"], answer: 2,
          explain: "Chu kì 3, nhóm IIIA → các lớp electron 2, 8, 3 → Z = 13 (aluminium)." },
        { id: 94, topic_id: 'periodic', text: "Bảng tuần hoàn các nguyên tố hóa học hiện nay có bao nhiêu chu kì?",
          options: ["5", "8", "18", "7"], answer: 3,
          explain: "Bảng tuần hoàn có 7 chu kì (7 hàng ngang)." },
        { id: 95, topic_id: 'periodic', text: "Nhóm VIIIA trong bảng tuần hoàn gồm các nguyên tố:",
          options: ["Khí hiếm", "Kim loại kiềm", "Halogen", "Kim loại kiềm thổ"], answer: 0,
          explain: "Nhóm VIIIA gồm các khí hiếm (He, Ne, Ar…), rất khó tham gia phản ứng." },
        { id: 96, topic_id: 'periodic', text: "Nhóm VIIA (fluorine, chlorine, bromine…) còn được gọi là nhóm:",
          options: ["Khí hiếm", "Halogen", "Kim loại kiềm", "Kim loại kiềm thổ"], answer: 1,
          explain: "Các nguyên tố nhóm VIIA gọi là halogen, đều là phi kim hoạt động mạnh." },
        { id: 97, topic_id: 'periodic', text: "Nhóm IA (trừ hydrogen) gồm các nguyên tố:",
          options: ["Phi kim", "Khí hiếm", "Kim loại kiềm", "Halogen"], answer: 2,
          explain: "Lithium, sodium, potassium… thuộc nhóm IA, gọi là kim loại kiềm." },
        { id: 98, topic_id: 'periodic', text: "Ô nguyên tố trong bảng tuần hoàn KHÔNG cho biết thông tin nào sau đây?",
          options: ["Kí hiệu hóa học", "Số hiệu nguyên tử", "Khối lượng nguyên tử", "Màu sắc của đơn chất"], answer: 3,
          explain: "Ô nguyên tố cho biết số hiệu nguyên tử, kí hiệu, tên và khối lượng nguyên tử; không ghi màu sắc." },
        { id: 99, topic_id: 'periodic', text: "Kí hiệu hóa học của nguyên tố aluminium (nhôm) là:",
          options: ["Al", "Am", "Au", "An"], answer: 0,
          explain: "Aluminium có kí hiệu Al. (Au là gold – vàng.)" },
        { id: 100, topic_id: 'periodic', text: "Nguyên tố có kí hiệu Ag là:",
          options: ["Gold (vàng)", "Silver (bạc)", "Argon", "Aluminium"], answer: 1,
          explain: "Ag (Latin: Argentum) là silver – bạc. Argon là Ar, gold là Au." },
        { id: 101, topic_id: 'periodic', text: "Kí hiệu hóa học của nguyên tố nitrogen là:",
          options: ["Ni", "Ne", "N", "Na"], answer: 2,
          explain: "Nitrogen là N. Ni là nickel, Ne là neon, Na là sodium." },
        { id: 102, topic_id: 'periodic', text: "Nguyên tố có kí hiệu S là:",
          options: ["Sodium", "Silicon", "Silver", "Sulfur (lưu huỳnh)"], answer: 3,
          explain: "S là sulfur. Sodium là Na, silicon là Si, silver là Ag." },
        { id: 103, topic_id: 'periodic', text: "Nguyên tố có kí hiệu Zn là:",
          options: ["Zinc (kẽm)", "Sodium", "Silver", "Tin (thiếc)"], answer: 0,
          explain: "Zn là zinc – kẽm. Tin (thiếc) có kí hiệu Sn." },
        { id: 104, topic_id: 'periodic', time_ms: 40000, text: "Nguyên tố X có 3 lớp electron và 7 electron ở lớp ngoài cùng. X nằm ở:",
          options: ["Chu kì 7, nhóm IIIA", "Chu kì 3, nhóm VIIA", "Chu kì 3, nhóm VIIIA", "Chu kì 2, nhóm VIIA"], answer: 1,
          explain: "Số lớp electron = số chu kì (3); số electron lớp ngoài cùng = số nhóm A (VIIA)." },
        { id: 105, topic_id: 'periodic', text: "Trong một chu kì, đi từ trái sang phải, tính kim loại của các nguyên tố nhìn chung:",
          options: ["Tăng dần", "Không đổi", "Giảm dần", "Tăng rồi giảm"], answer: 2,
          explain: "Đầu chu kì là kim loại mạnh (nhóm IA), cuối chu kì là phi kim (nhóm VIIA) và khí hiếm." },
        { id: 106, topic_id: 'periodic', text: "Nguyên tố nào sau đây cùng nhóm với sodium (Na)?",
          options: ["Magnesium (Mg)", "Chlorine (Cl)", "Neon (Ne)", "Potassium (K)"], answer: 3,
          explain: "Sodium và potassium đều có 1 electron lớp ngoài cùng → cùng nhóm IA." },
        { id: 107, topic_id: 'periodic', text: "Nguyên tố nào sau đây cùng chu kì với sodium (Na, chu kì 3)?",
          options: ["Chlorine (Cl)", "Lithium (Li)", "Potassium (K)", "Fluorine (F)"], answer: 0,
          explain: "Chlorine (2, 8, 7) có 3 lớp electron như sodium → cùng chu kì 3." },
        { id: 108, topic_id: 'periodic', text: "Ô của chlorine ghi khối lượng nguyên tử 35,5. Đơn vị của con số này là:",
          options: ["gam", "amu", "mol", "lít"], answer: 1,
          explain: "Khối lượng nguyên tử tính bằng amu (đơn vị khối lượng nguyên tử)." },
        { id: 109, topic_id: 'periodic', time_ms: 40000, text: "Nguyên tố X có số hiệu nguyên tử Z = 20. X là:",
          options: ["Phi kim, chu kì 4, nhóm IIA", "Khí hiếm, chu kì 3", "Kim loại, chu kì 4, nhóm IIA", "Kim loại, chu kì 4, nhóm IA"], answer: 2,
          explain: "Z = 20: 2, 8, 8, 2 → 4 lớp (chu kì 4), 2 electron lớp ngoài cùng (nhóm IIA) → calcium, kim loại." },
        { id: 110, topic_id: 'periodic', text: "Phần lớn các nguyên tố trong bảng tuần hoàn là:",
          options: ["Phi kim", "Khí hiếm", "Halogen", "Kim loại"], answer: 3,
          explain: "Khoảng hơn 80% các nguyên tố hóa học là kim loại." },

        // — Bổ sung chủ đề "Liên kết, hóa trị & công thức" (20 câu thông hiểu & vận dụng thấp)
        { id: 111, topic_id: 'bonding', time_ms: 40000, text: "Hóa trị của N trong hợp chất N₂O₅ là:",
          options: ["V", "II", "III", "IV"], answer: 0,
          explain: "O có hóa trị II: 2 × a = 5 × II → a = V." },
        { id: 112, topic_id: 'bonding', time_ms: 40000, text: "Hóa trị của Mn trong hợp chất MnO₂ là:",
          options: ["II", "IV", "VI", "VII"], answer: 1,
          explain: "O có hóa trị II: 1 × a = 2 × II → a = IV." },
        { id: 113, topic_id: 'bonding', time_ms: 40000, text: "Hóa trị của Cr trong hợp chất Cr₂O₃ là:",
          options: ["II", "VI", "III", "I"], answer: 2,
          explain: "O có hóa trị II: 2 × a = 3 × II → a = III." },
        { id: 114, topic_id: 'bonding', time_ms: 40000, text: "Công thức hóa học của hợp chất tạo bởi K (I) và nhóm SO₄ (II) là:",
          options: ["KSO₄", "K(SO₄)₂", "K₂(SO₄)₃", "K₂SO₄"], answer: 3,
          explain: "x × I = y × II → x : y = 2 : 1 → K₂SO₄ (potassium sulfate)." },
        { id: 115, topic_id: 'bonding', time_ms: 40000, text: "Công thức hóa học của hợp chất tạo bởi Ba (II) và nhóm NO₃ (I) là:",
          options: ["Ba(NO₃)₂", "BaNO₃", "Ba₂NO₃", "Ba₂(NO₃)₃"], answer: 0,
          explain: "x × II = y × I → x : y = 1 : 2 → Ba(NO₃)₂ (barium nitrate)." },
        { id: 116, topic_id: 'bonding', time_ms: 40000, text: "Công thức hóa học của hợp chất tạo bởi Fe (III) và nhóm SO₄ (II) là:",
          options: ["FeSO₄", "Fe₂(SO₄)₃", "Fe₂SO₄", "Fe(SO₄)₃"], answer: 1,
          explain: "x × III = y × II → x : y = 2 : 3 → Fe₂(SO₄)₃ (iron(III) sulfate)." },
        { id: 117, topic_id: 'bonding', time_ms: 40000, text: "Công thức hóa học của oxide tạo bởi S (VI) và O (II) là:",
          options: ["SO₂", "S₂O₆", "SO₃", "SO₆"], answer: 2,
          explain: "x × VI = y × II → x : y = 1 : 3 → SO₃." },
        { id: 118, topic_id: 'bonding', time_ms: 40000, text: "Phần trăm khối lượng của oxygen trong CO₂ là (C = 12, O = 16):",
          options: ["27,27%", "50%", "36,36%", "72,73%"], answer: 3,
          explain: "%O = (2 × 16) / 44 × 100% ≈ 72,73%." },
        { id: 119, topic_id: 'bonding', time_ms: 40000, text: "Phần trăm khối lượng của iron trong Fe₂O₃ là (Fe = 56, O = 16):",
          options: ["70%", "30%", "56%", "35%"], answer: 0,
          explain: "%Fe = (2 × 56) / 160 × 100% = 70%." },
        { id: 120, topic_id: 'bonding', time_ms: 40000, text: "Khối lượng phân tử của H₂SO₄ là (H = 1, S = 32, O = 16):",
          options: ["49 amu", "98 amu", "96 amu", "100 amu"], answer: 1,
          explain: "2 × 1 + 32 + 4 × 16 = 98 amu." },
        { id: 121, topic_id: 'bonding', time_ms: 40000, text: "Khối lượng phân tử của Ca(OH)₂ là (Ca = 40, O = 16, H = 1):",
          options: ["57 amu", "58 amu", "74 amu", "114 amu"], answer: 2,
          explain: "40 + 2 × (16 + 1) = 74 amu. (57 amu là lỗi quên nhân 2 nhóm OH.)" },
        { id: 122, topic_id: 'bonding', text: "Chất nào sau đây được tạo thành bằng liên kết ion?",
          options: ["Cl₂", "HCl", "CH₄", "CaO"], answer: 3,
          explain: "CaO tạo bởi kim loại calcium và phi kim oxygen → liên kết ion. Các chất còn lại chỉ gồm phi kim → liên kết cộng hóa trị." },
        { id: 123, topic_id: 'bonding', text: "Trong phân tử Cl₂, hai nguyên tử chlorine liên kết với nhau bằng:",
          options: ["1 cặp electron dùng chung", "Lực hút giữa ion dương và ion âm", "2 cặp electron dùng chung", "Liên kết kim loại"], answer: 0,
          explain: "Mỗi Cl có 7 electron lớp ngoài, góp chung 1 electron tạo 1 cặp dùng chung → liên kết cộng hóa trị." },
        { id: 124, topic_id: 'bonding', text: "Khi hình thành liên kết ion trong magnesium oxide (MgO), nguyên tử Mg:",
          options: ["Nhận 2 electron", "Nhường 2 electron", "Góp chung 2 electron", "Nhường 1 electron"], answer: 1,
          explain: "Mg (2, 8, 2) nhường 2 electron lớp ngoài cùng tạo ion Mg²⁺; O nhận 2 electron tạo ion O²⁻." },
        { id: 125, topic_id: 'bonding', text: "Ion được tạo thành khi nguyên tử chlorine nhận thêm 1 electron là:",
          options: ["Cl⁺", "Cl²⁻", "Cl⁻", "Cl₂"], answer: 2,
          explain: "Nhận 1 electron (điện tích −1) → ion chloride Cl⁻." },
        { id: 126, topic_id: 'bonding', text: "Hợp chất ion (như NaCl) thường có tính chất nào?",
          options: ["Ở thể khí ở nhiệt độ thường", "Không tan trong nước", "Dung dịch không dẫn điện", "Ở thể rắn, nhiệt độ nóng chảy cao"], answer: 3,
          explain: "Hợp chất ion thường là chất rắn, khó nóng chảy; khi tan trong nước tạo dung dịch dẫn điện." },
        { id: 127, topic_id: 'bonding', text: "Công thức hóa học H₂O cho biết:",
          options: ["Phân tử gồm 2 nguyên tử H và 1 nguyên tử O", "Phân tử gồm 2 nguyên tố H và 2 nguyên tố O", "Nước có 3 nguyên tố", "Khối lượng phân tử là 3 amu"], answer: 0,
          explain: "Chỉ số dưới chân cho biết số nguyên tử của mỗi nguyên tố trong một phân tử." },
        { id: 128, topic_id: 'bonding', time_ms: 40000, text: "Hợp chất X chỉ gồm carbon và oxygen, có khối lượng phân tử 28 amu. Công thức của X là (C = 12, O = 16):",
          options: ["CO₂", "CO", "C₂O", "CO₃"], answer: 1,
          explain: "CO: 12 + 16 = 28 amu. (CO₂ = 44 amu.)" },
        { id: 129, topic_id: 'bonding', text: "Trong HNO₃, H có hóa trị I. Nhóm NO₃ có hóa trị:",
          options: ["II", "III", "I", "V"], answer: 2,
          explain: "1 × I = 1 × b → nhóm NO₃ (nitrate) có hóa trị I." },
        { id: 130, topic_id: 'bonding', time_ms: 40000, text: "Công thức hóa học của sodium carbonate (Na hóa trị I, nhóm CO₃ hóa trị II) là:",
          options: ["NaCO₃", "Na(CO₃)₂", "Na₃CO₃", "Na₂CO₃"], answer: 3,
          explain: "x × I = y × II → x : y = 2 : 1 → Na₂CO₃." },

        // — Bổ sung chủ đề "Acid – Base – Muối" (20 câu thông hiểu & vận dụng thấp)
        { id: 131, topic_id: 'solution', text: "Kim loại nào sau đây tác dụng với dung dịch hydrochloric acid giải phóng khí hydrogen?",
          options: ["Zinc (Zn)", "Copper (Cu)", "Silver (Ag)", "Gold (Au)"], answer: 0,
          explain: "Zn + 2HCl → ZnCl₂ + H₂↑. Copper, silver, gold không tác dụng với dung dịch HCl." },
        { id: 132, topic_id: 'solution', text: "Sản phẩm của phản ứng giữa NaOH và HCl là:",
          options: ["NaCl và H₂", "NaCl và H₂O", "Na₂O và HCl", "NaH và HClO"], answer: 1,
          explain: "NaOH + HCl → NaCl + H₂O (base + acid → muối + nước)." },
        { id: 133, topic_id: 'solution', text: "Phản ứng giữa acid và base tạo thành muối và nước gọi là phản ứng:",
          options: ["Phân hủy", "Đốt cháy", "Trung hòa", "Hóa hợp"], answer: 2,
          explain: "Acid + base → muối + nước là phản ứng trung hòa." },
        { id: 134, topic_id: 'solution', text: "Tên gọi theo IUPAC của H₂SO₄ là:",
          options: ["Sulfurous acid", "Hydrochloric acid", "Nitric acid", "Sulfuric acid"], answer: 3,
          explain: "H₂SO₄: sulfuric acid; H₂SO₃: sulfurous acid; HCl: hydrochloric acid; HNO₃: nitric acid." },
        { id: 135, topic_id: 'solution', text: "Tên gọi của Ca(OH)₂ là:",
          options: ["Calcium hydroxide", "Calcium oxide", "Calcium carbonate", "Calcium hydride"], answer: 0,
          explain: "Base = tên kim loại + hydroxide → calcium hydroxide (nước vôi trong)." },
        { id: 136, topic_id: 'solution', text: "Tên gọi của CuSO₄ là:",
          options: ["Copper(II) sulfide", "Copper(II) sulfate", "Copper sulfite", "Copper(II) oxide"], answer: 1,
          explain: "Cu có hóa trị II, gốc SO₄ là sulfate → copper(II) sulfate." },
        { id: 137, topic_id: 'solution', text: "Muối nào sau đây tan tốt trong nước?",
          options: ["CaCO₃", "BaSO₄", "NaCl", "AgCl"], answer: 2,
          explain: "Hầu hết muối sodium đều tan; CaCO₃, BaSO₄, AgCl là muối không tan." },
        { id: 138, topic_id: 'solution', text: "Base nào sau đây là base không tan trong nước?",
          options: ["NaOH", "KOH", "Ba(OH)₂", "Cu(OH)₂"], answer: 3,
          explain: "Cu(OH)₂ là chất rắn màu xanh, không tan. NaOH, KOH, Ba(OH)₂ là base tan (kiềm)." },
        { id: 139, topic_id: 'solution', text: "Chất lỏng nào sau đây có pH lớn hơn 7?",
          options: ["Nước xà phòng", "Nước chanh", "Giấm ăn", "Nước cất"], answer: 0,
          explain: "Nước xà phòng có môi trường base (pH > 7); nước chanh, giấm có pH < 7; nước cất pH = 7." },
        { id: 140, topic_id: 'solution', text: "Để khử chua cho đất trồng (đất có pH thấp), người nông dân thường bón:",
          options: ["Muối ăn", "Vôi", "Đường", "Giấm"], answer: 1,
          explain: "Vôi (CaO, Ca(OH)₂) có tính base, trung hòa bớt acid trong đất." },
        { id: 141, topic_id: 'solution', text: "Oxide nào sau đây tác dụng với nước tạo thành dung dịch base?",
          options: ["CO₂", "SO₂", "Na₂O", "P₂O₅"], answer: 2,
          explain: "Na₂O + H₂O → 2NaOH. CO₂, SO₂, P₂O₅ là oxide acid, tác dụng với nước tạo acid." },
        { id: 142, topic_id: 'solution', text: "Oxide nào sau đây tác dụng với nước tạo thành dung dịch acid?",
          options: ["CaO", "Na₂O", "K₂O", "SO₃"], answer: 3,
          explain: "SO₃ + H₂O → H₂SO₄. Các oxide còn lại là oxide base." },
        { id: 143, topic_id: 'solution', text: "Cho đá vôi vào dung dịch acid: CaCO₃ + 2HCl → CaCl₂ + CO₂ + H₂O. Khí thoát ra là:",
          options: ["Carbon dioxide", "Hydrogen", "Oxygen", "Chlorine"], answer: 0,
          explain: "Sản phẩm khí là CO₂ (carbon dioxide), làm vẩn đục nước vôi trong." },
        { id: 144, topic_id: 'solution', time_ms: 40000, text: "Phản ứng: NaOH + HCl → NaCl + H₂O. Để trung hòa vừa đủ 0,1 mol NaOH cần số mol HCl là:",
          options: ["0,05 mol", "0,1 mol", "0,2 mol", "1 mol"], answer: 1,
          explain: "Theo phương trình, tỉ lệ mol NaOH : HCl = 1 : 1 → n(HCl) = 0,1 mol." },
        { id: 145, topic_id: 'solution', time_ms: 40000, text: "Phản ứng: 2KOH + H₂SO₄ → K₂SO₄ + 2H₂O. Để trung hòa vừa đủ 0,2 mol KOH cần số mol H₂SO₄ là:",
          options: ["0,2 mol", "0,4 mol", "0,1 mol", "0,05 mol"], answer: 2,
          explain: "Tỉ lệ mol KOH : H₂SO₄ = 2 : 1 → n(H₂SO₄) = 0,2 / 2 = 0,1 mol." },
        { id: 146, topic_id: 'solution', time_ms: 40000, text: "Cho 6,5 g zinc (Zn = 65) tác dụng hết với dung dịch HCl: Zn + 2HCl → ZnCl₂ + H₂. Số mol khí H₂ tạo thành là:",
          options: ["0,05 mol", "0,2 mol", "6,5 mol", "0,1 mol"], answer: 3,
          explain: "n(Zn) = 6,5 / 65 = 0,1 mol; tỉ lệ Zn : H₂ = 1 : 1 → n(H₂) = 0,1 mol." },
        { id: 147, topic_id: 'solution', time_ms: 40000, text: "Cho 0,2 mol iron tác dụng hết với dung dịch HCl: Fe + 2HCl → FeCl₂ + H₂. Thể tích khí H₂ thu được ở điều kiện chuẩn là:",
          options: ["4,958 L", "2,479 L", "9,916 L", "4,48 L"], answer: 0,
          explain: "n(H₂) = n(Fe) = 0,2 mol → V = 0,2 × 24,79 = 4,958 L." },
        { id: 148, topic_id: 'solution', time_ms: 40000, text: "Trung hòa 0,1 mol NaOH bằng dung dịch HCl vừa đủ. Khối lượng muối NaCl tạo thành là (Na = 23, Cl = 35,5):",
          options: ["58,5 g", "5,85 g", "4 g", "3,65 g"], answer: 1,
          explain: "n(NaCl) = n(NaOH) = 0,1 mol; M(NaCl) = 58,5 g/mol → m = 0,1 × 58,5 = 5,85 g." },
        { id: 149, topic_id: 'solution', text: "Nhỏ vài giọt phenolphthalein vào dung dịch NaOH, dung dịch chuyển sang màu:",
          options: ["Xanh", "Không màu", "Hồng", "Vàng"], answer: 2,
          explain: "Phenolphthalein không màu, chuyển sang màu hồng trong dung dịch base." },
        { id: 150, topic_id: 'solution', text: "Muối là hợp chất được tạo thành khi:",
          options: ["Hai phi kim kết hợp với nhau", "Kim loại tác dụng với oxygen", "Hòa tan base vào nước", "Thay thế ion H⁺ của acid bằng ion kim loại hoặc ion ammonium"], answer: 3,
          explain: "Ví dụ: thay H⁺ trong HCl bằng Na⁺ → muối NaCl." }
      ],

      /* ===== Phân hệ 2: Flashcard (16 thẻ) =====
         say_front / say_back: câu ĐỌC TO khi bấm 🔊 Nghe (viết bằng lời, không dùng kí hiệu).
         Phần trong [[ ]] (tên IUPAC, thuật ngữ tiếng Anh) được đọc bằng giọng tiếng Anh.
         Thẻ không có say_* → tự đọc từ front/back (kí hiệu được chuyển sang lời đọc). */
      flashcards: [
        { id: 1,  topic_id: 'atom',     visual: 'p⁺ n⁰ e⁻',    front: 'Nguyên tử được cấu tạo từ những hạt nào?',            back: 'Proton (+) và neutron (không mang điện) ở hạt nhân; electron (−) chuyển động ở lớp vỏ.',
          say_front: "Nguyên tử được cấu tạo từ những hạt nào?",
          say_back: "Nguyên tử gồm hạt nhân và lớp vỏ. Hạt nhân có [[proton]] mang điện dương và [[neutron]] không mang điện. Lớp vỏ có các [[electron]] mang điện âm, chuyển động quanh hạt nhân." },
        { id: 2,  topic_id: 'atom',     visual: '1 amu',       front: 'Đơn vị khối lượng nguyên tử là gì?',                  back: 'amu (atomic mass unit). Khối lượng 1 proton ≈ khối lượng 1 neutron ≈ 1 amu.',
          say_front: "Đơn vị khối lượng nguyên tử là gì?",
          say_back: "Là [[A M U]], viết tắt của [[atomic mass unit]]. Khối lượng một [[proton]] xấp xỉ khối lượng một [[neutron]], và xấp xỉ một [[A M U]]." },
        { id: 3,  topic_id: 'atom',     visual: '2 · 8 · 8',   front: 'Lớp electron thứ nhất và thứ hai chứa tối đa bao nhiêu electron?', back: 'Lớp thứ nhất tối đa 2 electron; lớp thứ hai tối đa 8 electron.',
          say_front: "Lớp [[electron]] thứ nhất và thứ hai chứa tối đa bao nhiêu [[electron]]?",
          say_back: "Lớp thứ nhất chứa tối đa hai [[electron]]. Lớp thứ hai chứa tối đa tám [[electron]]." },
        { id: 4,  topic_id: 'periodic', visual: 'Z',           front: 'Số hiệu nguyên tử (Z) cho biết điều gì?',             back: 'Số proton trong hạt nhân = số thứ tự ô của nguyên tố trong bảng tuần hoàn.',
          say_front: "Số hiệu nguyên tử, kí hiệu là Z, cho biết điều gì?",
          say_back: "Số hiệu nguyên tử bằng số [[proton]] trong hạt nhân, và bằng số thứ tự ô của nguyên tố trong bảng tuần hoàn." },
        { id: 5,  topic_id: 'periodic', visual: '→ chu kì',    front: 'Số thứ tự của chu kì cho biết điều gì?',              back: 'Số lớp electron của nguyên tử các nguyên tố trong chu kì đó.',
          say_front: "Số thứ tự của chu kì cho biết điều gì?",
          say_back: "Số thứ tự chu kì bằng số lớp [[electron]] của nguyên tử các nguyên tố trong chu kì đó." },
        { id: 6,  topic_id: 'periodic', visual: '↓ nhóm A',    front: 'Số thứ tự của nhóm A cho biết điều gì?',              back: 'Số electron ở lớp ngoài cùng của nguyên tử (vd: nhóm IA có 1 electron lớp ngoài cùng).',
          say_front: "Số thứ tự của nhóm A cho biết điều gì?",
          say_back: "Số thứ tự nhóm A bằng số [[electron]] ở lớp ngoài cùng. Ví dụ, các nguyên tố nhóm một A có một [[electron]] ở lớp ngoài cùng." },
        { id: 7,  topic_id: 'bonding',  visual: 'Na⁺ Cl⁻',     front: 'Liên kết ion hình thành như thế nào?',                back: 'Nguyên tử kim loại nhường electron thành ion dương, phi kim nhận electron thành ion âm; các ion trái dấu hút nhau.',
          say_front: "Liên kết ion hình thành như thế nào? Ví dụ: ion [[sodium]] mang điện dương và ion [[chloride]] mang điện âm.",
          say_back: "Nguyên tử kim loại nhường [[electron]], trở thành ion dương. Nguyên tử phi kim nhận [[electron]], trở thành ion âm. Các ion trái dấu hút nhau, tạo thành liên kết ion." },
        { id: 8,  topic_id: 'bonding',  visual: 'H : H',       front: 'Liên kết cộng hóa trị là gì?',                        back: 'Liên kết được tạo nên bởi các cặp electron dùng chung giữa hai nguyên tử (thường là phi kim).',
          say_front: "Liên kết cộng hóa trị là gì?",
          say_back: "Là liên kết được tạo nên bởi các cặp [[electron]] dùng chung giữa hai nguyên tử, thường là giữa các nguyên tử phi kim." },
        { id: 9,  topic_id: 'bonding',  visual: 'x·a = y·b',   front: 'Quy tắc hóa trị trong hợp chất AₓBᵧ?',               back: 'Tích chỉ số và hóa trị của nguyên tố này bằng tích chỉ số và hóa trị của nguyên tố kia: x · a = y · b.',
          say_front: "Quy tắc hóa trị trong hợp chất có công thức A x B y là gì?",
          say_back: "Chỉ số x nhân với hóa trị a của nguyên tố A, bằng chỉ số y nhân với hóa trị b của nguyên tố B. Tức là: x nhân a bằng y nhân b." },
        { id: 10, topic_id: 'bonding',  visual: 'SO₄ ?',       front: 'Nhóm sulfate (SO₄) có hóa trị bao nhiêu?',            back: 'Hóa trị II (ion sulfate SO₄²⁻).',
          say_front: "Nhóm [[sulfate]], gồm một S và bốn O, có hóa trị bao nhiêu?",
          say_back: "Nhóm [[sulfate]] có hóa trị hai. Ion [[sulfate]] mang điện tích hai trừ." },
        { id: 11, topic_id: 'redox',    visual: 'm₁ + m₂ = m₃', front: 'Định luật bảo toàn khối lượng phát biểu thế nào?',    back: 'Trong một phản ứng hóa học, tổng khối lượng các chất sản phẩm bằng tổng khối lượng các chất tham gia.',
          say_front: "Định luật bảo toàn khối lượng phát biểu như thế nào?",
          say_back: "Trong một phản ứng hóa học, tổng khối lượng các chất sản phẩm bằng tổng khối lượng các chất tham gia phản ứng." },
        { id: 12, topic_id: 'redox',    visual: 'n = m / M',   front: 'Công thức tính số mol theo khối lượng?',              back: 'n = m / M (n: số mol; m: khối lượng, gam; M: khối lượng mol, g/mol).',
          say_front: "Công thức tính số mol theo khối lượng là gì?",
          say_back: "n bằng m chia cho M. Trong đó, n là số mol. m là khối lượng chất, tính bằng gam. M là khối lượng mol, tính bằng gam trên mol." },
        { id: 13, topic_id: 'redox',    visual: '6,022·10²³',  front: '1 mol chất chứa bao nhiêu hạt (nguyên tử/phân tử)?',   back: 'Khoảng 6,022 × 10²³ hạt (số Avogadro).',
          say_front: "Một mol chất chứa bao nhiêu hạt nguyên tử hoặc phân tử?",
          say_back: "Khoảng sáu phẩy không hai hai nhân mười mũ hai mươi ba hạt. Con số này gọi là số [[Avogadro]]." },
        { id: 14, topic_id: 'solution', visual: 'H⁺',          front: 'Acid là gì?',                                         back: 'Hợp chất trong phân tử có nguyên tử hydrogen liên kết với gốc acid; khi tan trong nước tạo ra ion H⁺. Vd: HCl, H₂SO₄.',
          say_front: "Thế nào là [[acid]]?",
          say_back: "[[Acid]] là hợp chất trong phân tử có nguyên tử [[hydrogen]] liên kết với gốc [[acid]]. Khi tan trong nước, [[acid]] tạo ra ion H cộng. Ví dụ: [[hydrochloric acid]] và [[sulfuric acid]]." },
        { id: 15, topic_id: 'solution', visual: 'OH⁻',         front: 'Base là gì?',                                         back: 'Hợp chất trong phân tử có nguyên tử kim loại liên kết với nhóm hydroxide; khi tan trong nước tạo ra ion OH⁻. Vd: NaOH, Ca(OH)₂.',
          say_front: "Thế nào là [[base]]?",
          say_back: "[[Base]] là hợp chất trong phân tử có nguyên tử kim loại liên kết với nhóm [[hydroxide]]. Khi tan trong nước, [[base]] tạo ra ion O H trừ. Ví dụ: [[sodium hydroxide]] và [[calcium hydroxide]]." },
        { id: 16, topic_id: 'solution', visual: 'pH 7',        front: 'Thang pH: môi trường acid, trung tính, base?',        back: 'pH < 7: acid · pH = 7: trung tính · pH > 7: base.',
          say_front: "Thang p H cho biết điều gì về môi trường của dung dịch?",
          say_back: "p H nhỏ hơn bảy là môi trường [[acid]]. p H bằng bảy là môi trường trung tính. p H lớn hơn bảy là môi trường [[base]]." }
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
