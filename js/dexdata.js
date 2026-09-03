/* =========================================================
   dexdata.js — 世代テーブル / 出典ソフト / 出題プールの計算 /
                解説文の整形と伏字処理
   ========================================================= */

/* 日本語の図鑑解説文が存在する上限（ソード・シールドまで）。
   No.899 以降（LEGENDSアルセウス新規・第9世代SV）は英語のみのため出題しない。 */
var MAX_DEX_ID = 898;

/* ---------- 世代テーブル（その世代で「新登場」した範囲） ----------
   累積ではない。第2世代を選んだら No.152〜251 だけが出る。 */
var GEN_TABLE = [
  { gen: 1, label: '第1世代', games: '赤・緑・青・ピカチュウ',       min:   1, max: 151 },
  { gen: 2, label: '第2世代', games: '金・銀・クリスタル',           min: 152, max: 251 },
  { gen: 3, label: '第3世代', games: 'ルビー・サファイア・エメラルド', min: 252, max: 386 },
  { gen: 4, label: '第4世代', games: 'ダイヤモンド・パール・Pt',     min: 387, max: 493 },
  { gen: 5, label: '第5世代', games: 'ブラック・ホワイト・BW2',      min: 494, max: 649 },
  { gen: 6, label: '第6世代', games: 'X・Y・ORAS',                   min: 650, max: 721 },
  { gen: 7, label: '第7世代', games: 'サン・ムーン・USUM',           min: 722, max: 809 },
  { gen: 8, label: '第8世代', games: 'ソード・シールド',             min: 810, max: 898 }
];

/* ---------- 図鑑説明の出典ソフト ----------
   PokeAPI に日本語の図鑑説明文が存在するのは、この6グループのソフトだけ。
   赤緑・金銀・RSE・DPP・BW の日本語テキストは API に一切入っていない（実測で確認済み）。
   bit は js/flavor_index.js のビット位置と対応する。順番を変えたら
   tools/build_flavor_index.py の SOURCE_GROUPS も同じ順に直すこと。 */
var FLAVOR_SOURCES = [
  { key: 'xy',   bit: 0, label: 'X・Y',                     note: '第6世代',
    versions: ['x', 'y'] },
  { key: 'oras', bit: 1, label: 'オメガルビー・アルファサファイア', note: '第6世代',
    versions: ['omega-ruby', 'alpha-sapphire'] },
  { key: 'sm',   bit: 2, label: 'サン・ムーン',             note: '第7世代',
    versions: ['sun', 'moon'] },
  { key: 'usum', bit: 3, label: 'ウルトラサン・ウルトラムーン', note: '第7世代',
    versions: ['ultra-sun', 'ultra-moon'] },
  { key: 'lgpe', bit: 4, label: "Let's Go! ピカチュウ・イーブイ", note: '初代の文面に近い',
    versions: ['lets-go-pikachu', 'lets-go-eevee'] },
  { key: 'swsh', bit: 5, label: 'ソード・シールド',         note: '第8世代',
    versions: ['sword', 'shield'] }
];

var ALL_SOURCE_MASK = (1 << FLAVOR_SOURCES.length) - 1;

function sourceByKey(key) {
  for (var i = 0; i < FLAVOR_SOURCES.length; i++) {
    if (FLAVOR_SOURCES[i].key === key) return FLAVOR_SOURCES[i];
  }
  return null;
}

/* 選択中の出典キー配列 → ビットマスク。未選択（おまかせ）は全ビット。 */
function sourceMask(settings) {
  var s = settings || State.settings;
  var keys = s.sources || [];
  if (!keys.length) return ALL_SOURCE_MASK;
  var mask = 0;
  keys.forEach(function (k) {
    var src = sourceByKey(k);
    if (src) mask |= (1 << src.bit);
  });
  return mask || ALL_SOURCE_MASK;
}

/* 選択中の出典に含まれるバージョン slug の一覧。
   おまかせ（未選択）のときは null を返し、フィルタしないことを示す。 */
function allowedVersions(settings) {
  var s = settings || State.settings;
  var keys = s.sources || [];
  if (!keys.length) return null;
  var out = [];
  keys.forEach(function (k) {
    var src = sourceByKey(k);
    if (src) out = out.concat(src.versions);
  });
  return out.length ? out : null;
}

/* ---------- 出題プール ----------
   選んだ世代に属し、かつ選んだ出典の説明文を持つポケモンの ID 一覧。 */
function questionPool(settings) {
  var s = settings || State.settings;
  var gens = s.gens || [];      // 空なら 0 種（開始できない）
  var mask = sourceMask(s);
  var pool = [];
  GEN_TABLE.forEach(function (g) {
    if (gens.indexOf(g.gen) < 0) return;
    for (var id = g.min; id <= g.max; id++) {
      if (flavorBitsOf(id) & mask) pool.push(id);
    }
  });
  return pool;
}

/* 世代 1つ × 出典マスク で何種出せるか（S1 のグレーアウト判定に使う） */
function countForGen(gen, mask) {
  var g = null;
  for (var i = 0; i < GEN_TABLE.length; i++) {
    if (GEN_TABLE[i].gen === gen) { g = GEN_TABLE[i]; break; }
  }
  if (!g) return 0;
  var n = 0;
  for (var id = g.min; id <= g.max; id++) {
    if (flavorBitsOf(id) & mask) n++;
  }
  return n;
}

/* 選択中の世代に対して、その出典が1種でも使えるか */
function sourceUsable(srcKey, settings) {
  var s = settings || State.settings;
  var src = sourceByKey(srcKey);
  if (!src) return false;
  // 世代が未選択のときは全世代で判定する（ボタンが全部無効になって詰むのを防ぐ）
  var gens = s.gens && s.gens.length ? s.gens : [1, 2, 3, 4, 5, 6, 7, 8];
  for (var i = 0; i < gens.length; i++) {
    if (countForGen(gens[i], 1 << src.bit) > 0) return true;
  }
  return false;
}

/* ---------- 表示用ラベル ---------- */
function genLabelList(settings) {
  var s = settings || State.settings;
  var gens = s.gens || [];
  if (gens.length === GEN_TABLE.length) return '全世代';
  var names = [];
  GEN_TABLE.forEach(function (g) {
    if (gens.indexOf(g.gen) >= 0) names.push(g.label);
  });
  return names.length ? names.join('・') : '未選択';
}

function sourceLabelList(settings) {
  var s = settings || State.settings;
  var keys = s.sources || [];
  if (!keys.length) return 'おまかせ（すべてのソフト）';
  var names = [];
  FLAVOR_SOURCES.forEach(function (src) {
    if (keys.indexOf(src.key) >= 0) names.push(src.label);
  });
  return names.length ? names.join('・') : 'おまかせ（すべてのソフト）';
}

/* 出題範囲の説明テキスト */
function rangeLabel(settings) {
  var s = settings || State.settings;
  var n = questionPool(s).length;
  return genLabelList(s) + ' × ' + sourceLabelList(s) + ' ＝ ' + n + ' 種';
}

/* ---------- 抽選（同一ゲーム内で重複しない） ----------
   pool: 出題候補の ID 配列 */
function pickIds(count, pool, exclude) {
  var used = {};
  (exclude || []).forEach(function (id) { used[id] = true; });
  var rest = (pool || []).filter(function (id) { return !used[id]; });
  var picked = [];
  while (picked.length < count && rest.length) {
    var i = Math.floor(Math.random() * rest.length);
    picked.push(rest[i]);
    rest.splice(i, 1);
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

/* 選択中の出典ソフトの説明文だけに絞る。
   versions が null（おまかせ）のとき、および絞った結果が空のときは元のまま返す。 */
function filterByVersions(entries, versions) {
  if (!versions || !versions.length) return entries || [];
  var hit = (entries || []).filter(function (e) {
    return versions.indexOf(e.version) >= 0;
  });
  return hit.length ? hit : (entries || []);
}

/* 解説文候補から1つ選ぶ（正解名を含まないものを優先）
   entries: [{text, version}] 形式 */
function chooseFlavor(entries, names, versions) {
  entries = filterByVersions(entries, versions);
  if (!entries.length) return null;
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
   species: pokeapi.js が返す整形済みオブジェクト
   versions: 出典で絞るバージョン slug 配列（null ならおまかせ） */
function buildQuestionText(species, versions) {
  var names = [species.nameJa, species.evolvesFromJa].filter(Boolean);
  var chosen = chooseFlavor(species.flavors, names, versions);
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
