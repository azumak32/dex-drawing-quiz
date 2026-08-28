/* =========================================================
   state.js — 状態オブジェクト / 小さな共通ユーティリティ /
              sessionStorage への自動保存と復帰
   （ES modules は使わない。すべて window 直下のグローバル）
   ========================================================= */

/* ---------- 共通ユーティリティ ---------- */
var $ = function (sel, root) { return (root || document).querySelector(sel); };
var $$ = function (sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
};
var $id = function (id) { return document.getElementById(id); };

/* URL クエリ（?debug=1 など） */
var QUERY = (function () {
  var q = {};
  var s = location.search.replace(/^\?/, '');
  if (!s) return q;
  s.split('&').forEach(function (pair) {
    var kv = pair.split('=');
    q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  });
  return q;
})();
var DEBUG = QUERY.debug === '1';

/* トースト表示 */
var toastTimer = null;
function toast(msg, ms) {
  var el = $id('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
}

/* 配列シャッフル（Fisher-Yates） */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ---------- 既定値 ---------- */
var DEFAULT_SETTINGS = {
  range: 'master',   // 'master' | 'era'
  eraKey: 'swsh',    // range==='era' のときのゲームタイトルキー
  mode: 'vs',        // 'vs' 対戦 | 'coop' 協力
  timer: false,      // 時間制限あり/なし
  drawSec: 90,
  answerSec: 30
};

function makePlayer(name, remote) {
  return {
    id: 'p' + Math.random().toString(36).slice(2, 9),
    name: name || '',
    remote: !!remote
  };
}

function newState() {
  return {
    version: 1,
    screen: 's1',
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    players: [makePlayer(''), makePlayer('')],
    order: [],          // 出題者の順番（player id の配列）
    round: 0,           // 何問目（0 始まり）
    quiz: [],           // プリフェッチ済みのポケモン（1問1件）
    usedIds: [],        // 抽選済み ID（重複防止）
    drawing: null,      // 現在ラウンドの絵（dataURL）
    answerers: [],      // 現ラウンドの解答者 id 一覧（協力モードは [null]）
    answerIndex: 0,     // 対戦モードで今なんばんめの解答者か
    answers: [],        // 現ラウンドの解答 [{playerId,text,correct,manual}]
    scores: {},         // { playerId: {answer:n, draw:n} }
    coop: { total: 0, correct: 0 },
    lastRoundScore: null,   // 現ラウンドで加算した分（○×の手動修正・リロード復帰用）
    finished: false
  };
}

var State = newState();

/* ---------- sessionStorage 保存・復帰 ---------- */
var SS_KEY = 'pq:session';

function saveState() {
  try {
    // キャンバス画像は容量が大きいので「直近1件（現在ラウンド分）」だけ保持する
    sessionStorage.setItem(SS_KEY, JSON.stringify(State));
  } catch (e) {
    // 容量オーバー時は絵を捨ててリトライ
    try {
      var copy = JSON.parse(JSON.stringify(State));
      copy.drawing = null;
      if (copy.quiz) copy.quiz.forEach(function (q) { if (q) q.drawing = null; });
      sessionStorage.setItem(SS_KEY, JSON.stringify(copy));
    } catch (e2) { /* あきらめる（ゲームは続行できる） */ }
  }
}

function loadSavedState() {
  try {
    var raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    if (!obj || obj.version !== 1) return null;
    return obj;
  } catch (e) { return null; }
}

function clearSavedState() {
  try { sessionStorage.removeItem(SS_KEY); } catch (e) {}
}

/* ---------- 便利アクセサ ---------- */
function playerById(id) {
  for (var i = 0; i < State.players.length; i++) {
    if (State.players[i].id === id) return State.players[i];
  }
  return null;
}
function playerName(id) {
  var p = playerById(id);
  return p ? (p.name || '名無し') : '—';
}
function activePlayers() {
  return State.players.filter(function (p) { return (p.name || '').trim() !== ''; });
}
function ensureScore(id) {
  if (!State.scores[id]) State.scores[id] = { answer: 0, draw: 0 };
  return State.scores[id];
}
