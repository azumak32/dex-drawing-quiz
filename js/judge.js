/* =========================================================
   judge.js — 解答の正規化とあいまい一致判定
   正規化 → 完全一致 → レーベンシュタイン距離 ≤1 の順で判定する。
   ========================================================= */

/* 特例辞書：記号を含む名前の言い換えを吸収する */
var ALIAS = {
  'ニドランメス': 'ニドラン♀',
  'ニドランオス': 'ニドラン♂',
  'ニドランmesu': 'ニドラン♀',
  'ニドランosu': 'ニドラン♂',
  'ポリゴンゼット': 'ポリゴンZ',
  'ポリゴンツー': 'ポリゴン2',
  'ポリゴン2ゴウ': 'ポリゴン2',
  'タイプヌル': 'タイプ:ヌル',
  'ジガルデ': 'ジガルデ',
  'ジュナイパー': 'ジュナイパー'
};

/* ひらがな → カタカナ */
function toKatakana(s) {
  return String(s).replace(/[ぁ-ゖ]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) + 0x60);
  });
}

/* 解答・正解の両方に同じ正規化をかける */
function normalizeAnswer(s) {
  if (s === null || s === undefined) return '';
  var t = String(s);

  // 1) 前後の空白を除去し、内部の空白もすべて削除
  t = t.trim().replace(/[\s　]/g, '');

  // 3) NFKC 正規化（全角英数・全角記号を半角へ：ポリゴン２→ポリゴン2、ポリゴンＺ→ポリゴンZ）
  if (typeof t.normalize === 'function') t = t.normalize('NFKC');

  // 2) ひらがな → カタカナ
  t = toKatakana(t);

  // 4) 長音・ダッシュ類の統一（すべて 'ー' に寄せる）
  t = t.replace(/[‐-―−－ーｰ~〜～-]/g, 'ー');

  // 5) 記号の除去（: ： ・ . 。 、 空白など）
  t = t.replace(/[:：・.。、,，'"’”`^*!！?？_]/g, '');

  // 大文字に寄せる（Z / z の揺れを吸収）
  t = t.toUpperCase();

  return t;
}

/* 特例辞書を正規化済みキーで引けるようにする */
var ALIAS_NORM = (function () {
  var m = {};
  Object.keys(ALIAS).forEach(function (k) {
    m[normalizeAnswer(k)] = normalizeAnswer(ALIAS[k]);
  });
  // 記号なしの ニドラン♀/♂ も吸収する（正規化で ♀♂ は残る）
  m[normalizeAnswer('ニドランメス')] = normalizeAnswer('ニドラン♀');
  m[normalizeAnswer('ニドランオス')] = normalizeAnswer('ニドラン♂');
  return m;
})();

function applyAlias(norm) {
  return ALIAS_NORM[norm] || norm;
}

/* レーベンシュタイン距離（1文字の打ち間違いを救済するため） */
function levenshtein(a, b) {
  if (a === b) return 0;
  var al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  if (Math.abs(al - bl) > 1) return 2;   // 2 以上なら早期終了（判定は ≤1 のみ使う）

  var prev = new Array(bl + 1);
  for (var j = 0; j <= bl; j++) prev[j] = j;
  for (var i = 1; i <= al; i++) {
    var cur = [i];
    for (var k = 1; k <= bl; k++) {
      var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

/* 実在するポケモンの名前（正規化ずみ）の集合。
   1文字ちがいの救済が「別の実在するポケモン」に当たるのを防ぐために使う。
   図鑑データを読み終えてから初めて作り、以後は使い回す。
   Dex がまだ無い場合（自己テストなど）は null を返し、救済は従来どおり働く。 */
var REAL_NAME_SET = null;

function realNameSet() {
  if (REAL_NAME_SET) return REAL_NAME_SET;
  if (typeof Dex === 'undefined' || !Dex || !Dex.species) return null;
  var set = {};
  var n = 0;
  Object.keys(Dex.species).forEach(function (id) {
    var name = Dex.species[id] && Dex.species[id].n;
    if (!name) return;
    set[applyAlias(normalizeAnswer(name))] = true;
    n++;
  });
  if (!n) return null;
  REAL_NAME_SET = set;
  return REAL_NAME_SET;
}

/* 判定本体。correctName は日本語名（例: 'ヒトカゲ'） */
function judgeAnswer(input, correctName) {
  var a = applyAlias(normalizeAnswer(input));
  var b = applyAlias(normalizeAnswer(correctName));
  if (!a) return false;
  if (a === b) return true;

  // 4文字以上のときだけ、1文字ちがいを正解とみなす（打ち間違いの救済）
  if (b.length >= 4 && Math.abs(a.length - b.length) <= 1) {
    /* ただし、入力そのものが「別の実在するポケモンの名前」なら不正解にする。
       打ち間違いではなく、はっきり別のポケモンを答えているため。
       例: チゴラス に ガチゴラス、ドククラゲ に リククラゲ、ニドラン♀ に ニドラン♂。
       いずれも1文字ちがいなので、この判定が無いと正解になってしまう。 */
    var real = realNameSet();
    if (real && real[a]) return false;
    if (levenshtein(a, b) <= 1) return true;
  }
  return false;
}

/* ---------- 自己テスト（?debug=1 のときコンソールに出す） ---------- */
function judgeSelfTest() {
  var cases = [
    ['ぴかちゅう', 'ピカチュウ', true],
    ['ピカチュー', 'ピカチュウ', true],
    ['ピカチュウ ', 'ピカチュウ', true],
    ['ポリゴン２', 'ポリゴン2', true],
    ['ポリゴンＺ', 'ポリゴンZ', true],
    ['タイプヌル', 'タイプ：ヌル', true],
    ['たいぷ ぬる', 'タイプ：ヌル', true],
    ['ニドランメス', 'ニドラン♀', true],
    ['にどらんおす', 'ニドラン♂', true],
    ['フシギバナ', 'フシギダネ', false],
    ['フシギダナ', 'フシギダネ', true],
    ['ヒトカゲ', 'リザード', false],
    ['', 'ピカチュウ', false],
    ['ゴンガー', 'ゲンガー', true],   // 実在しない打ち間違い → 救済する
    ['カビゴン', 'カイリュー', false],
    // 1文字ちがいでも、入力が別の実在ポケモンなら不正解にする（要 Dex）
    ['ガチゴラス', 'チゴラス', false],
    ['チゴラス', 'ガチゴラス', false],
    ['リククラゲ', 'ドククラゲ', false],
    ['ドククラゲ', 'リククラゲ', false],
    ['ニドラン♂', 'ニドラン♀', false],
    // 実在しない打ち間違いは今までどおり救済する
    ['フシギダナ', 'フシギダネ', true],
    ['ガチゴラズ', 'ガチゴラス', true],
    ['ドククラゴ', 'ドククラゲ', true]
  ];
  var ng = 0;
  cases.forEach(function (c) {
    var got = judgeAnswer(c[0], c[1]);
    if (got !== c[2]) {
      ng++;
      console.warn('判定テスト NG:', c[0], 'vs', c[1], '→', got, '（期待:', c[2], '）');
    }
  });
  console.log('judge 自己テスト: ' + (cases.length - ng) + '/' + cases.length + ' 通過');
  return ng === 0;
}
