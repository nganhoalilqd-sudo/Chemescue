/* =========================================================
   ChemRescue — Đọc to (kênh nghe) cho học sinh học tốt bằng thính giác
   ---------------------------------------------------------
   • Dùng giọng đọc có sẵn của trình duyệt (Web Speech API) – miễn phí, không cần mạng riêng.
   • Văn bản tiếng Việt đọc bằng giọng vi-VN; phần đặt trong [[ ]] (tên IUPAC, thuật ngữ
     tiếng Anh) đọc bằng giọng tiếng Anh cho đúng phát âm. Ví dụ:
       'Ion [[sulfate]] mang điện tích hai trừ.'
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
  const enVoice = () => pickVoice('en-us') || pickVoice('en-gb') || pickVoice('en');

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
    SYMBOLS.forEach(([re, rep]) => { s = s.replace(re, rep); });
    return s.replace(/\s+/g, ' ').trim();
  }

  // Tách đoạn tiếng Việt / tiếng Anh theo dấu [[ ]]
  function segments(text) {
    const out = [];
    String(text).split(/(\[\[[^\]]+\]\])/).forEach((part) => {
      if (!/[\p{L}\p{N}]/u.test(part)) return;   // bỏ đoạn chỉ có dấu câu (tránh ngắt quãng thừa)
      const en = part.startsWith('[[');
      out.push({ en, text: en ? part.slice(2, -2) : toSpeakable(part) });
    });
    return out;
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

  // Đọc một đoạn văn bản; trả về Promise kết thúc khi đọc xong (hoặc bị dừng)
  function speak(text, { onend } = {}) {
    if (!supported || !text) return Promise.resolve();
    stop();
    const parts = segments(text);
    const vi = viVoice(), en = enVoice();
    const id = Date.now() + Math.random();
    current = id;
    onDone = onend || null;
    return new Promise((resolve) => {
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p.text);
        const voice = p.en ? en : vi;
        u.lang = p.en ? (en?.lang || 'en-US') : 'vi-VN';
        if (voice) u.voice = voice;
        u.rate = settings.rate;
        if (i === parts.length - 1) u.onend = u.onerror = () => { finish(id); resolve(); };
        try { synth.speak(u); }
        catch (err) {                       // trình duyệt từ chối đọc → không để nút bị kẹt
          console.warn('[ChemSpeech] Không đọc được:', err);
          finish(id); resolve();
        }
      });
    });
  }

  return {
    supported,
    get speaking() { return current !== 0; },
    hasVietnamese: () => Boolean(viVoice()),
    speak,
    stop,
    toSpeakable,
    get auto() { return settings.auto; },
    set auto(v) { settings.auto = Boolean(v); saveSettings(); }
  };
})();

window.ChemSpeech = ChemSpeech;
