/**
 * public/js/quiz.js
 * Trò chơi "Thử thách Hóa trị":
 *  - Lấy ngẫu nhiên 10 câu từ server, mỗi câu có 4 phương án.
 *  - Đúng: +10 điểm, cộng thêm thưởng chuỗi (combo) tối đa +10.
 *  - Sai: mất 1 mạng (❤️). Hết 3 mạng → kết thúc.
 *  - Kết thúc: cộng XP và lưu điểm vào Bảng vàng.
 */
import { ChemAPI } from './api.js';
import { Player } from './player.js';
import { toast, escapeHtml } from './ui.js';
import { Leaderboard } from './leaderboard.js';

const TOTAL_QUESTIONS = 10;
const MAX_HEARTS = 3;
const BASE_POINTS = 10;
const MAX_COMBO_BONUS = 10;

const $ = (id) => document.getElementById(id);
let game = null; // Trạng thái lượt chơi hiện tại

function resetState(questions) {
  game = { questions, index: 0, hearts: MAX_HEARTS, combo: 0, score: 0, correct: 0, answered: false };
}

function renderHud() {
  const { index, questions, hearts, combo, score } = game;
  $('hudHearts').textContent = '❤️'.repeat(hearts) + '🤍'.repeat(MAX_HEARTS - hearts);
  $('hudProgress').textContent = `Câu ${Math.min(index + 1, questions.length)}/${questions.length}`;
  $('hudCombo').textContent = `🔥 x${combo}`;
  $('hudScore').textContent = `⭐ ${score}`;
  $('hudBar').style.width = `${(index / questions.length) * 100}%`;
}

function renderQuestion() {
  const q = game.questions[game.index];
  game.answered = false;
  $('qTopic').textContent = q.topic_name;
  $('qContent').textContent = q.content;
  $('qOptions').innerHTML = q.options
    .map((opt, i) => `<button class="option" data-choice="${i}"><b>${'ABCD'[i]}</b>${escapeHtml(opt)}</button>`)
    .join('');
  $('qFeedback').hidden = true;
  $('nextBtn').hidden = true;
  renderHud();
}

async function answer(choice) {
  if (game.answered) return;
  game.answered = true;
  const buttons = [...$('qOptions').querySelectorAll('.option')];
  buttons.forEach((b) => { b.disabled = true; });

  try {
    const q = game.questions[game.index];
    const result = await ChemAPI.checkAnswer(q.id, choice);
    buttons[result.answerIndex].classList.add('correct');

    if (result.correct) {
      game.correct += 1;
      game.combo += 1;
      game.score += BASE_POINTS + Math.min((game.combo - 1) * 2, MAX_COMBO_BONUS);
      $('hudCombo').classList.remove('hot'); void $('hudCombo').offsetWidth; $('hudCombo').classList.add('hot');
    } else {
      buttons[choice].classList.add('wrong');
      game.combo = 0;
      game.hearts -= 1;
    }

    const fb = $('qFeedback');
    fb.className = `feedback ${result.correct ? 'ok' : 'bad'}`;
    fb.innerHTML = `<strong>${result.correct ? '✅ Chính xác!' : '❌ Chưa đúng rồi.'}</strong> ${escapeHtml(result.explanation || '')}`;
    fb.hidden = false;

    const isLast = game.index === game.questions.length - 1 || game.hearts === 0;
    $('nextBtn').textContent = isLast ? 'Xem kết quả 🏁' : 'Câu tiếp theo →';
    $('nextBtn').hidden = false;
    renderHud();
  } catch (err) {
    toast(`⚠️ ${err.message}`);
    game.answered = false;
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function next() {
  if (game.hearts === 0 || game.index >= game.questions.length - 1) return finish();
  game.index += 1;
  renderQuestion();
}

async function finish() {
  // Chỉ tính những câu đã thực sự trả lời (có thể dừng sớm khi hết mạng)
  const total = game.index + 1;
  game.index = game.questions.length;
  renderHud();
  $('hudProgress').textContent = game.hearts === 0 ? `Dừng ở câu ${total}` : 'Hoàn thành 🏁';
  const rate = game.correct / total;

  $('questionView').hidden = true;
  $('resultView').hidden = false;
  $('resultEmoji').textContent = game.hearts === 0 ? '💥' : rate >= 0.8 ? '🏆' : rate >= 0.5 ? '🎉' : '💪';
  $('resultTitle').textContent = game.hearts === 0 ? 'Ống nghiệm vỡ mất rồi!' : 'Giải cứu thành công!';
  $('resultText').textContent = rate >= 0.8
    ? 'Em nắm rất chắc kiến thức. Hãy thử phá kỷ lục của chính mình!'
    : 'Đọc lại phần giải thích và thử lại nhé – mỗi lần chơi em sẽ tiến bộ hơn.';
  $('resultScore').textContent = game.score;
  $('resultCorrect').textContent = `${game.correct}/${total}`;
  $('resultXp').textContent = `+${game.score}`;

  Player.addXp(game.score);

  try {
    await ChemAPI.saveScore({ playerName: Player.name, score: game.score, correctCount: game.correct, total });
    toast('🏆 Đã lưu điểm vào Bảng vàng!');
    Leaderboard.load();
  } catch (err) {
    toast(`⚠️ Chưa lưu được điểm: ${err.message}`);
  }
}

export const Quiz = {
  async start() {
    if (!Player.name) {
      toast('✍️ Hãy nhập tên của em trước khi chơi nhé!');
      $('nameInput').focus();
      return;
    }
    const section = $('game');
    section.hidden = false;
    $('questionView').hidden = false;
    $('resultView').hidden = true;
    $('qContent').textContent = 'Đang tải câu hỏi...';
    $('qOptions').innerHTML = '';
    section.scrollIntoView({ behavior: 'smooth' });

    try {
      const { data } = await ChemAPI.getQuestions(TOTAL_QUESTIONS);
      if (!data.length) throw new Error('Ngân hàng câu hỏi đang trống');
      resetState(data);
      renderQuestion();
    } catch (err) {
      $('qContent').textContent = `⚠️ ${err.message}`;
    }
  },

  close() {
    $('game').hidden = true;
    document.getElementById('missions').scrollIntoView({ behavior: 'smooth' });
  },

  // Gắn sự kiện cho các nút trong màn chơi (gọi một lần khi trang tải)
  bind() {
    $('qOptions').addEventListener('click', (e) => {
      const btn = e.target.closest('.option');
      if (btn) answer(Number(btn.dataset.choice));
    });
    $('nextBtn').addEventListener('click', next);
    $('quitBtn').addEventListener('click', () => this.close());
    $('closeResultBtn').addEventListener('click', () => this.close());
    $('replayBtn').addEventListener('click', () => this.start());
  },
};
