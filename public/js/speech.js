/* =========================================================
   ChemRescue — Đọc to (kênh nghe) cho học sinh học tốt bằng thính giác
   ---------------------------------------------------------
   • Dùng giọng đọc có sẵn của trình duyệt (Web Speech API) – miễn phí, không cần mạng riêng.
   • Đọc bằng MỘT giọng tiếng Việt duy nhất, mỗi lần đọc là một câu liền mạch (không ngắt quãng).
   • Tên IUPAC / thuật ngữ tiếng Anh được đọc theo PHIÊN ÂM VIỆT (bảng PHONETIC bên dưới),
     chữ hiển thị trên thẻ vẫn giữ nguyên tên IUPAC. Ví dụ: 'Ion [[sulfate]]…' → "Ion sun phát…".
     Muốn sửa cách đọc một từ: sửa/thêm vào bảng PHONETIC.
   • Văn bản không có câu đọc soạn sẵn → tự chuyển kí hiệu hóa học sang lời đọc
     (H₂O → "H 2 O", → → "tạo thành", ≈ → "xấp xỉ"…).
   ========================================================= */
const ChemSpeech = (() => {
  'use strict';

  const synth = window.speechSynthesis || null;
  const supported = Boolean(synth && window.SpeechSynthesisUtterance);
  const SETTINGS_KEY = 'chemrescue.speech';

  /* ---------- Cài đặt (lưu trên trình duyệt của từng em) ---------- */
  const settings = (() => {
    try { return { auto: false, rate: 0.9, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
    catch { return { auto: false, rate: 0.9 }; }
  })();
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* bỏ qua */ }
  }

  /* ---------- Chọn giọng đọc ---------- */
  let voices = [];
  const loadVoices = () => { voices = supported ? synth.getVoices() : []; };
  if (supported) {
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
  }
  // Ưu tiên giọng tự nhiên (Google / Microsoft Online), sau đó giọng bất kì đúng ngôn ngữ
  function pickVoice(lang) {
    const list = voices.filter((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(lang));
    return list.find((v) => /natural|online|google/i.test(v.name)) || list[0] || null;
  }
  const viVoice = () => pickVoice('vi');

  /* ---------- Phiên âm Việt cho tên IUPAC & thuật ngữ (chỉ dùng khi ĐỌC) ---------- */
  const PHONETIC = {
    // Hạt & đơn vị
    'proton': 'prô tôn', 'neutron': 'nơ trôn', 'electron': 'e léc trôn', 'a m u': 'a mờ u', 'amu': 'a mờ u',
    'avogadro': 'a vô ga đrô',
    // Nguyên tố
    'hydrogen': 'hi đrô', 'helium': 'hê li', 'lithium': 'li ti', 'carbon': 'các bon', 'nitrogen': 'ni tơ',
    'oxygen': 'ô xi', 'fluorine': 'flo', 'neon': 'nê ông', 'sodium': 'xô đi um', 'magnesium': 'ma giê',
    'aluminium': 'a lu mi ni um', 'silicon': 'si lic', 'phosphorus': 'phốt pho', 'sulfur': 'lưu huỳnh',
    'chlorine': 'clo', 'argon': 'ác gon', 'potassium': 'pô ta xi um', 'calcium': 'can xi',
    'iron': 'ai ơn', 'copper': 'cóp pơ', 'zinc': 'kẽm', 'silver': 'xin vơ', 'barium': 'ba ri',
    // Gốc, ion, hợp chất
    'chloride': 'clo rai', 'sulfate': 'sun phát', 'nitrate': 'ni trát', 'carbonate': 'các bô nát',
    'phosphate': 'phốt phát', 'oxide': 'ô xít', 'hydroxide': 'hi đrô xít', 'ammonium': 'a mô ni um',
    'acid': 'a xít', 'base': 'ba zơ',
    'hydrochloric acid': 'hi đrô clo ríc a xít', 'sulfuric acid': 'sun phu ríc a xít', 'nitric acid': 'ni tríc a xít'
  };
  // Từ dài trước (vd "sodium hydroxide" khớp "sodium" rồi "hydroxide"; "hydrochloric acid" trước "acid")
  const PHONETIC_RE = new RegExp(
    `(?<![\\p{L}])(${Object.keys(PHONETIC).sort((a, b) => b.length - a.length).map((k) => k.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}])`, 'giu');
  const phonetic = (text) => text.replace(PHONETIC_RE, (m) => PHONETIC[m.toLowerCase().replace(/\s+/g, ' ')] || m);

  /* ---------- Chuyển kí hiệu sang lời đọc tiếng Việt ---------- */
  const SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
  const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  const SYMBOLS = [
    [/→/g, ' tạo thành '], [/⇄/g, ' thuận nghịch '], [/≈/g, ' xấp xỉ '], [/×/g, ' nhân '], [/·/g, ', '],
    [/≥/g, ' lớn hơn hoặc bằng '], [/≤/g, ' nhỏ hơn hoặc bằng '], [/</g, ' nhỏ hơn '], [/>/g, ' lớn hơn '],
    [/=/g, ' bằng '], [/%/g, ' phần trăm'], [/°C/g, ' độ C'], [/↑/g, ''], [/↓/g, ''], [/–|—/g, ', '],
    [/\s\/\s/g, ' chia '], [/\s\+\s/g, ' cộng '], [/[“”"]/g, '']
  ];
  function toSpeakable(text) {
    let s = String(text || '');
    // Điện tích ion: ²⁻ → " hai trừ", ⁺ → " cộng"
    s = s.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]*)([⁺⁻])/g, (_, n, sign) => ` ${n ? [...n].map((c) => SUP[c]).join('') + ' ' : ''}${sign === '⁺' ? 'cộng' : 'trừ'}`);
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => ` mũ ${[...m].map((c) => SUP[c]).join('')}`);
    // Chỉ số dưới: H₂O → "H 2 O"
    s = s.replace(/[₀-₉]+/g, (m) => ` ${[...m].map((c) => SUB[c]).join('')} `);
    // Số La Mã: Iron(III) → "ba"; hóa trị II → "hai"; nhóm IIA → "hai A"
    const ROMAN = { I: 'một', II: 'hai', III: 'ba', IV: 'bốn', V: 'năm', VI: 'sáu', VII: 'bảy', VIII: 'tám' };
    s = s.replace(/\((VIII|VII|VI|IV|V|III|II|I)\)/g, (_, r) => ` ${ROMAN[r]} `);
    s = s.replace(/(hóa trị|Hóa trị)\s+(VIII|VII|VI|IV|V|III|II|I)\b/g, (_, w, r) => `${w} ${ROMAN[r]}`);
    s = s.replace(/(nhóm|Nhóm)\s+(VIII|VII|VI|IV|V|III|II|I)(A|B)\b/g, (_, w, r, ab) => `${w} ${ROMAN[r]} ${ab}`);
    SYMBOLS.forEach(([re, rep]) => { s = s.replace(re, rep); });
    return s.replace(/\s+/g, ' ').trim();
  }

  // Chuẩn bị câu đọc: bỏ dấu [[ ]] → phiên âm Việt → chuyển kí hiệu sang lời
  function prepare(text) {
    return toSpeakable(phonetic(String(text).replace(/\[\[([^\]]+)\]\]/g, '$1')));
  }

  /* ---------- Đọc ---------- */
  let current = 0;      // mã lượt đọc hiện tại (lượt cũ bị huỷ thì bỏ qua sự kiện của nó)
  let onDone = null;

  function finish(id) {
    if (id !== current) return;
    current = 0;
    const cb = onDone; onDone = null;
    cb?.();
  }

  function stop() {
    if (!supported) return;
    const id = current;
    synth.cancel();
    finish(id);
  }

  // Đọc một đoạn văn bản bằng MỘT giọng tiếng Việt; trả về Promise kết thúc khi đọc xong (hoặc bị dừng)
  function speak(text, { onend } = {}) {
    if (!supported || !text) return Promise.resolve();
    stop();
    const id = Date.now() + Math.random();
    current = id;
    onDone = onend || null;
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(prepare(text));
      const vi = viVoice();
      u.lang = 'vi-VN';
      if (vi) u.voice = vi;
      u.rate = settings.rate;
      u.onend = u.onerror = () => { finish(id); resolve(); };
      try { synth.speak(u); }
      catch (err) {                       // trình duyệt từ chối đọc → không để nút bị kẹt
        console.warn('[ChemSpeech] Không đọc được:', err);
        finish(id); resolve();
      }
    });
  }

  return {
    supported,
    get speaking() { return current !== 0; },
    hasVietnamese: () => Boolean(viVoice()),
    speak,
    stop,
    toSpeakable,
    prepare,
    get auto() { return settings.auto; },
    set auto(v) { settings.auto = Boolean(v); saveSettings(); }
  };
})();

window.ChemSpeech = ChemSpeech;
