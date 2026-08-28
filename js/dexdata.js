/* =========================================================
   dexdata.js — 世代別ID範囲テーブル / 抽選 / 解説文の整形と伏字処理
   ========================================================= */

/* 日本語の図鑑解説文が存在する上限（ソード・シールドまで）。
   No.899 以降（LEGENDSアルセウス新規・第9世代SV）は英語のみのため出題しない。 */
var MAX_DEX_ID = 898;

/* ---------- ゲームタイトル別の全国図鑑範囲（累積方式） ---------- */
var ERA_TABLE = [
  { key: 'rgby', label: '赤・緑・青・ピカチュウ',                 max: 151 },
  { key: 'gsc',  label: '金・銀・クリスタル',                     max: 251 },
  { key: 'rse',  label: 'ルビー・サファイア・エメラルド・FRLG',   max: 386 },
  { key: 'dpp',  label: 'ダイヤモンド・パール・Pt・HGSS',         max: 493 },
  { key: 'bw',   label: 'ブラック・ホワイト・BW2',                max: 649 },
  { key: 'xy',   label: 'X・Y・ORAS',                             max: 721 },
  { key: 'sm',   label: 'サン・ムーン・USUM・Let\'s Go',          max: 809 },
  { key: 'swsh', label: 'ソード・シールド',                       max: 898 }
];

function eraByKey(key) {
  for (var i = 0; i < ERA_TABLE.length; i++) {
    if (ERA_TABLE[i].key === key) return ERA_TABLE[i];
  }
  return ERA_TABLE[ERA_TABLE.length - 1];
}

/* 現在の設定から出題範囲の上限 ID を返す */
function currentMaxId(settings) {
  var s = settings || State.settings;
  if (s.range === 'era') return eraByKey(s.eraKey).max;
  return MAX_DEX_ID;
}

/* 出題範囲の説明テキスト */
function rangeLabel(settings) {
  var s = settings || State.settings;
  var max = currentMaxId(s);
  if (s.range === 'era') {
    return eraByKey(s.eraKey).label + '（全国図鑑 No.1〜' + max + '／' + max + '種）';
  }
  return '全国図鑑 No.1〜' + MAX_DEX_ID + '（全' + MAX_DEX_ID + '種）';
}

/* ---------- 抽選（同一ゲーム内で重複しない） ---------- */
function pickIds(count, maxId, exclude) {
  var used = {};
  (exclude || []).forEach(function (id) { used[id] = true; });
  var picked = [];
  var guard = 0;
  while (picked.length < count && guard < count * 500) {
    guard++;
    var id = 1 + Math.floor(Math.random() * maxId);
    if (used[id]) continue;
    used[id] = true;
    picked.push(id);
  }
  return picked;
}

/* ---------- 解説文の整形 ----------
   原文には改ページ \f・改行 \n・全角スペース（ゲーム内の行送り）が混在する。
   \f と \n は改行に変換し、全角スペースはそのまま残す（図鑑らしい味になる）。 */
function normalizeFlavor(text) {
  if (!text) return '';
  return String(text)
    .replace(/­/g, '')       // ソフトハイフン
    .replace(/\f/g, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- 伏字処理 ----------
   検証で「約半数の解説文に、そのポケモン自身の名前が含まれる」ことが判明済み。
   1) 正解名を含まない解説文を優先して抽選する
   2) それでも含む場合は、同じ文字数の 〇 に置換する
   3) 進化前の名前（evolves_from_species）も同様に伏字にする */

function maskWord(text, word) {
  if (!text || !word) return text;
  var mask = new Array(word.length + 1).join('〇');
  return text.split(word).join(mask);
}

/* ひらがな/カタカナの表記ゆれにも対応して伏せる */
function maskName(text, name) {
  if (!text || !name) return text;
  var out = maskWord(text, name);
  out = maskWord(out, kataToHira(name));
  out = maskWord(out, hiraToKata(name));
  return out;
}

function kataToHira(s) {
  return String(s).replace(/[ァ-ヶ]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0x60);
  });
}
function hiraToKata(s) {
  return String(s).replace(/[ぁ-ゖ]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) + 0x60);
  });
}

/* 解説文候補から1つ選ぶ（正解名を含まないものを優先）
   entries: [{text, version}] 形式 */
function chooseFlavor(entries, names) {
  if (!entries || !entries.length) return null;
  var clean = [];
  var dirty = [];
  entries.forEach(function (e) {
    var hit = names.some(function (n) {
      return n && (e.text.indexOf(n) >= 0 ||
                   e.text.indexOf(kataToHira(n)) >= 0 ||
                   e.text.indexOf(hiraToKata(n)) >= 0);
    });
    (hit ? dirty : clean).push(e);
  });
  var pool = clean.length ? clean : dirty;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* 出題用の伏字済みテキストを作る
   species: pokeapi.js が返す整形済みオブジェクト */
function buildQuestionText(species) {
  var names = [species.nameJa, species.evolvesFromJa].filter(Boolean);
  var chosen = chooseFlavor(species.flavors, names);
  if (!chosen) return null;
  var raw = normalizeFlavor(chosen.text);
  var masked = raw;
  names.forEach(function (n) { masked = maskName(masked, n); });
  return {
    raw: raw,                      // 正解発表で使う完全版
    masked: masked,                // 出題で使う伏字版
    version: chosen.version,       // 出典バージョン（日本語名）
    wasMasked: masked !== raw
  };
}
