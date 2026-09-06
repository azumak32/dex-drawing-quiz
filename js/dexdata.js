/* =========================================================
   dexdata.js — 世代テーブル / 出典ソフト / 出題プールの計算 /
                解説文の整形と伏字処理
   ========================================================= */

/* 全国図鑑の上限。data/dex.json 読み込み時に localdex.js が上書きする。
   コンプリート版は No.1〜1025 の全種に日本語の図鑑解説文がある。 */
var MAX_DEX_ID = 1025;

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
  { gen: 8, label: '第8世代', games: 'ソード・シールド・LEGENDSアルセウス', min: 810, max: 905 },
  { gen: 9, label: '第9世代', games: 'スカーレット・バイオレット',     min: 906, max: 1025 }
];

/* ---------- 図鑑説明の出典ソフト ----------
   実体は dexsource.js の SOURCE_GROUPS。起動時に loadDex() が差し替える（同ファイルの
   loadDex）。ここで二重管理はしない。
   形： { key, bit, label, note, versions:[slug,…] } */
var FLAVOR_SOURCES = [];

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
  var gens = s.gens && s.gens.length ? s.gens : GEN_TABLE.map(function (g) { return g.gen; });
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

/* ---------- 抽選 ----------
   pool:  出題候補の ID 配列
   exclude: 同一ゲーム内ですでに出した ID（必ず除外する）
   asked: 端末に残っている出題履歴（古い順）。渡すと、
          まだ出していないポケモンを優先し、足りなければ古く出したものから使う。
          未指定なら従来どおり pool から一様ランダム。 */
function pickIds(count, pool, exclude, asked) {
  var used = {};
  (exclude || []).forEach(function (id) { used[id] = true; });
  var rest = (pool || []).filter(function (id) { return !used[id]; });

  if (!asked || !asked.length) return drawRandom(count, rest);

  var rank = {};                       // 小さいほど昔に出した
  asked.forEach(function (id, i) { rank[id] = i; });

  var fresh = [];
  var stale = [];
  rest.forEach(function (id) { (rank[id] === undefined ? fresh : stale).push(id); });
  stale.sort(function (a, b) { return rank[a] - rank[b]; });   // 古い順

  var picked = drawRandom(count, fresh);
  // まだ出していないものだけで足りなければ、出したのが古い順に補う
  for (var i = 0; picked.length < count && i < stale.length; i++) picked.push(stale[i]);
  return picked;
}

/* 配列から重複なくランダムに count 個 */
function drawRandom(count, list) {
  var rest = (list || []).slice();
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
   species: dexsource.js が返す整形済みオブジェクト
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
