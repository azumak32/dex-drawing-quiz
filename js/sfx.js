/* =========================================================
   sfx.js — Web Audio API による効果音の合成（音声ファイル不要）
   iOS/iPadOS は最初のタップまで音が鳴らないため、
   最初のユーザー操作で AudioContext を起こす。
   ========================================================= */

var SFX = (function () {
  var ctx = null;
  var enabled = true;

  function ac() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }

  /* iOS 対策：最初のタップで再開させる */
  function unlock() {
    var c = ac();
    if (c && c.state === 'suspended') c.resume();
  }

  /* 単音 */
  function tone(freq, start, dur, type, gain) {
    var c = ac();
    if (!c || !enabled) return;
    var t0 = c.currentTime + start;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* 短いノイズ（サイコロ用） */
  function noise(dur, gain) {
    var c = ac();
    if (!c || !enabled) return;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    var src = c.createBufferSource();
    var g = c.createGain();
    g.gain.value = gain || 0.08;
    src.buffer = buf;
    src.connect(g);
    g.connect(c.destination);
    src.start();
  }

  var PATTERNS = {
    tap:     function () { tone(880, 0, 0.05, 'square', 0.05); },
    ok:      function () { tone(784, 0, 0.08, 'square', 0.09); tone(1047, 0.07, 0.12, 'square', 0.09); },
    dice:    function () { noise(0.06, 0.06); },
    correct: function () {
      tone(784, 0.00, 0.09, 'square', 0.10);
      tone(988, 0.09, 0.09, 'square', 0.10);
      tone(1319, 0.18, 0.22, 'square', 0.11);
    },
    wrong:   function () {
      tone(196, 0.00, 0.16, 'sawtooth', 0.08);
      tone(147, 0.14, 0.28, 'sawtooth', 0.08);
    },
    tick:    function () { tone(1200, 0, 0.03, 'square', 0.04); },
    timeup:  function () {
      tone(660, 0.00, 0.12, 'square', 0.10);
      tone(660, 0.16, 0.12, 'square', 0.10);
      tone(440, 0.32, 0.30, 'square', 0.10);
    },
    fanfare: function () {
      var notes = [523, 659, 784, 1047, 784, 1047, 1319];
      notes.forEach(function (f, i) {
        tone(f, i * 0.12, i === notes.length - 1 ? 0.5 : 0.12, 'square', 0.10);
      });
    }
  };

  function play(kind) {
    var fn = PATTERNS[kind];
    if (!fn) return;
    unlock();
    try { fn(); } catch (e) { /* 音が出せなくてもゲームは続行 */ }
  }

  function setEnabled(v) { enabled = !!v; }

  return { play: play, unlock: unlock, setEnabled: setEnabled };
})();

/* 呼び出し口 */
function beep(kind) { SFX.play(kind || 'tap'); }

/* 最初のタップで AudioContext を起こす（iPadOS 対策） */
document.addEventListener('pointerdown', function once() {
  SFX.unlock();
  document.removeEventListener('pointerdown', once);
}, { passive: true });
