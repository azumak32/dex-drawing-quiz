/* =========================================================
   dexsource.js — 図鑑データを「ブラウザ側で」組み立てる層

   方針（重要・変更しないこと）
   -------------------------------------------------------
   図鑑説明文の著作権は 任天堂・クリーチャーズ・ゲームフリーク・ポケモン に
   あります。したがって本アプリは **図鑑テキストを一切ホストしません**。
   リポジトリにも GitHub Pages にも1文字も置かず、閲覧者のブラウザが
   配布元から直接取得します。この構造は必ず維持してください。

   取得元は2つだけ。
     1. towakey/pokedex（GitHub / jsDelivr 経由）
          日本語の図鑑説明文・名前・分類・進化前。赤・緑〜SV の全ソフト。
          コミットを固定してあるので、先方が更新しても壊れません。
     2. PokéAPI（GraphQL）
          X・Y 以降のソフトの日本語説明文と、ポケモンごとのタイプ。
          GraphQL なので 1 リクエストで全部そろう。

   towakey は赤・緑〜SV を広くカバーするが ORAS と Let's Go がほぼ空、
   PokéAPI は X・Y 以降しか日本語を持たない。2つを重ねると全 1025 種が埋まる。

   旧版は 1問1リクエストで 898 種ぶん叩いていたが、この方式なら
   初回の 4 リクエストで全 1025 種・15 ソフトぶんがそろう。
   ========================================================= */

var TOWAKEY_BASE =
  'https://cdn.jsdelivr.net/gh/towakey/pokedex@1547d0e2f2e0fa6a55e9b928b5600c23fc3691bb/pokedex/';
var GQL_URL = 'https://graphql.pokeapi.co/v1beta2';
var ART_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';

/* PokéAPI から日本語の説明文とタイプをまとめて取るクエリ。
   language_id は 11 = 'ja'（漢字かな交じり）、1 = 'ja-Hrkt'（かな）。
   図鑑らしさと読みやすさのため 'ja' を優先し、無ければ 'ja-Hrkt' を使う。 */
var GQL_QUERY =
  'query PQ {' +
  '  flavors: pokemonspeciesflavortext(' +
  '    where:{language_id:{_in:[1,11]}, pokemon_species_id:{_lte:%MAX%}}' +
  '  ) { id: pokemon_species_id lang: language_id text: flavor_text version { name } }' +
  '  types: pokemontype(' +
  '    where:{pokemon_id:{_lte:%MAX%}}, order_by:[{pokemon_id:asc},{slot:asc}]' +
  '  ) { id: pokemon_id type { name typenames(where:{language_id:{_eq:11}}) { name } } }' +
  '  evo: pokemonspecies(where:{id:{_lte:%MAX%}}) { id evolves_from_species_id }' +
  '}';

/* GraphQL は POST なので Service Worker のキャッシュに載らない。
   取得結果は自分で Cache Storage に置いて、2回目以降は通信ゼロにする。 */
var API_CACHE_NAME = 'pq-api-v1';
var API_SNAPSHOT_URL = 'https://pokeapi.snapshot.local/ja-v1.json';

/* 出典バージョンの日本語表示名（/version/ を叩かずに済ませるための対応表） */
var VERSION_JA = {
  'red': '赤', 'green': '緑', 'blue': '青', 'yellow': 'ピカチュウ',
  'gold': '金', 'silver': '銀', 'crystal': 'クリスタル',
  'ruby': 'ルビー', 'sapphire': 'サファイア', 'emerald': 'エメラルド',
  'firered': 'ファイアレッド', 'leafgreen': 'リーフグリーン',
  'diamond': 'ダイヤモンド', 'pearl': 'パール', 'platinum': 'プラチナ',
  'heartgold': 'ハートゴールド', 'soulsilver': 'ソウルシルバー',
  'black': 'ブラック', 'white': 'ホワイト', 'black-2': 'ブラック2', 'white-2': 'ホワイト2',
  'x': 'X', 'y': 'Y', 'omega-ruby': 'オメガルビー', 'alpha-sapphire': 'アルファサファイア',
  'sun': 'サン', 'moon': 'ムーン', 'ultra-sun': 'ウルトラサン', 'ultra-moon': 'ウルトラムーン',
  'lets-go-pikachu': "Let's Go! ピカチュウ", 'lets-go-eevee': "Let's Go! イーブイ",
  'sword': 'ソード', 'shield': 'シールド',
  'legends-arceus': 'LEGENDS アルセウス', 'scarlet': 'スカーレット', 'violet': 'バイオレット'
};

/* 出典ソフトのグループ（S1 のボタン1つ＝1グループ）。
   bit は並び順。ここを触ったら FLAVOR_SOURCES も自動で追従する。 */
var SOURCE_GROUPS = [
  ['rgbp', '赤・緑・青・ピカチュウ',           '第1世代',         ['red', 'green', 'blue', 'yellow']],
  ['gsc',  '金・銀・クリスタル',               '第2世代',         ['gold', 'silver', 'crystal']],
  ['rse',  'ルビー・サファイア・エメラルド',     '第3世代',         ['ruby', 'sapphire', 'emerald']],
  ['frlg', 'ファイアレッド・リーフグリーン',     '初代のリメイク',   ['firered', 'leafgreen']],
  ['dppt', 'ダイヤモンド・パール・プラチナ',     '第4世代',         ['diamond', 'pearl', 'platinum']],
  ['hgss', 'ハートゴールド・ソウルシルバー',     '金銀のリメイク',   ['heartgold', 'soulsilver']],
  ['bw',   'ブラック・ホワイト（BW2 含む）',     '第5世代',         ['black', 'white', 'black-2', 'white-2']],
  ['xy',   'X・Y',                             '第6世代',         ['x', 'y']],
  ['oras', 'オメガルビー・アルファサファイア',   '第6世代',         ['omega-ruby', 'alpha-sapphire']],
  ['sm',   'サン・ムーン',                     '第7世代',         ['sun', 'moon']],
  ['usum', 'ウルトラサン・ウルトラムーン',       '第7世代',         ['ultra-sun', 'ultra-moon']],
  ['lgpe', "Let's Go! ピカチュウ・イーブイ",    '初代の文面に近い', ['lets-go-pikachu', 'lets-go-eevee']],
  ['swsh', 'ソード・シールド',                 '第8世代',         ['sword', 'shield']],
  ['la',   'Pokémon LEGENDS アルセウス',       '第8世代',         ['legends-arceus']],
  ['sv',   'スカーレット・バイオレット',         '第9世代',         ['scarlet', 'violet']]
];

/* towakey の項目名 → PokéAPI のバージョン slug。
   ここに無い項目（ピンボール・スタジアム・スナップ・漢字版）は使わない。 */
var TOWAKEY_KEY = {
  red: 'red', green: 'green', blue: 'blue', pikachu: 'yellow',
  gold: 'gold', silver: 'silver', crystal: 'crystal',
  ruby: 'ruby', sapphire: 'sapphire', emerald: 'emerald',
  firered: 'firered', leafgreen: 'leafgreen',
  diamond: 'diamond', pearl: 'pearl', platinum: 'platinum',
  heartgold: 'heartgold', soulsilver: 'soulsilver',
  black: 'black', white: 'white', black2: 'black-2', white2: 'white-2',
  x: 'x', y: 'y',
  omegaruby: 'omega-ruby', alphasapphire: 'alpha-sapphire',
  sun: 'sun', moon: 'moon', ultrasun: 'ultra-sun', ultramoon: 'ultra-moon',
  letsgopikachu: 'lets-go-pikachu', letsgoeevee: 'lets-go-eevee',
  sword: 'sword', shield: 'shield',
  legendsarceus: 'legends-arceus',
  scarlet: 'scarlet', violet: 'violet'
};

/* タイプの色（S4 のタイプチップ用） */
var TYPE_COLOR = {
  normal: '#9099a1', fighting: '#ce4069', flying: '#8fa8dd', poison: '#ab6ac8',
  ground: '#d97746', rock: '#c7b78b', bug: '#90c12c', ghost: '#5269ac',
  steel: '#5a8ea1', fire: '#ff9d55', water: '#4d90d5', grass: '#63bb5b',
  electric: '#f4d23c', psychic: '#f97176', ice: '#74cec0', dragon: '#0b6dc3',
  dark: '#5a5465', fairy: '#ec8fe6', unknown: '#68a090', shadow: '#4b4453'
};

/* ---------------- 通信 ---------------- */
function getJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; reject(new Error('timeout')); }
    }, timeoutMs || 30000);

    fetch(url, { cache: 'force-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(json);
      })
      .catch(function (err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
  });
}

/* 失敗時は少し待ってリトライ（最大2回） */
function getJsonRetry(url, tries) {
  tries = tries || 2;
  return getJson(url).catch(function (err) {
    if (tries <= 1) throw err;
    return new Promise(function (r) { setTimeout(r, 600); })
      .then(function () { return getJsonRetry(url, tries - 1); });
  });
}

/* ---------------- PokéAPI（GraphQL 1 リクエスト） ---------------- */
/* 返り値： { flavors: {id: {slug: 本文}}, types: {id:[slug]}, typeJa: {slug: 日本語名} } */
function fetchPokeApi(maxId) {
  return loadApiSnapshot().then(function (snap) {
    if (snap && snap.types) return snap;
    return postGql(GQL_QUERY.split('%MAX%').join(String(maxId)))
      .then(function (data) {
        var out = { flavors: {}, types: {}, typeJa: {}, prev: {} };
        var kana = {};   // 'ja' が無いソフトのぶんだけ後で使う
        (data.flavors || []).forEach(function (r) {
          var slug = r.version && r.version.name;
          var text = normalizeFlavor(r.text);
          if (!slug || !text) return;
          var bag = (r.lang === 11) ? out.flavors : kana;
          if (!bag[r.id]) bag[r.id] = {};
          if (!bag[r.id][slug]) bag[r.id][slug] = text;
        });
        Object.keys(kana).forEach(function (id) {
          if (!out.flavors[id]) out.flavors[id] = {};
          Object.keys(kana[id]).forEach(function (slug) {
            if (!out.flavors[id][slug]) out.flavors[id][slug] = kana[id][slug];
          });
        });
        (data.types || []).forEach(function (r) {
          var t = r.type || {};
          if (!t.name) return;
          if (!out.types[r.id]) out.types[r.id] = [];
          out.types[r.id].push(t.name);
          var ja = t.typenames && t.typenames[0];
          if (ja && ja.name) out.typeJa[t.name] = ja.name;
        });
        (data.evo || []).forEach(function (r) {
          if (r.evolves_from_species_id) out.prev[r.id] = r.evolves_from_species_id;
        });
        saveApiSnapshot(out);
        return out;
      });
  });
}

function postGql(query) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; reject(new Error('timeout')); }
    }, 30000);
    fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (json.errors) reject(new Error(json.errors[0] && json.errors[0].message));
        else resolve(json.data || {});
      })
      .catch(function (err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
  });
}

/* Cache Storage は HTTPS / localhost でのみ使える。
   使えない環境（開発用の http://192.168.x.x など）では毎回取り直すだけ。 */
function loadApiSnapshot() {
  if (typeof caches === 'undefined') return Promise.resolve(null);
  return caches.open(API_CACHE_NAME)
    .then(function (c) { return c.match(API_SNAPSHOT_URL); })
    .then(function (res) { return res ? res.json() : null; })
    .catch(function () { return null; });
}

function saveApiSnapshot(obj) {
  if (typeof caches === 'undefined') return Promise.resolve();
  return caches.open(API_CACHE_NAME)
    .then(function (c) {
      return c.put(API_SNAPSHOT_URL, new Response(JSON.stringify(obj), {
        headers: { 'Content-Type': 'application/json' }
      }));
    })
    .catch(function () { /* 保存できなくても動作には影響しない */ });
}

/* ---------------- 図鑑データの組み立て ---------------- */
var Dex = null;          /* {maxId, species, types, typeJa} */
var FLAVOR_BITS = null;  /* 図鑑 No. → 出典グループのビット */

/* towakey のキーは "0025_00000000_0_000_0" の形。
   フォーム違いが並ぶので、基本フォーム（form/region/メガ/キョダイが空）を優先して1つ選ぶ。 */
function pickBaseForm(forms) {
  var keys = Object.keys(forms || {});
  for (var i = 0; i < keys.length; i++) {
    var v = forms[keys[i]];
    if (!v.form && !v.region && !v.mega_evolution && !v.gigantamax) return v;
  }
  return keys.length ? forms[keys[0]] : null;
}

function loadDex(onProgress) {
  var total = 3;
  var done = 0;
  function step() { done++; if (onProgress) onProgress(done, total); }
  if (onProgress) onProgress(0, total);

  return Promise.all([
    getJsonRetry(TOWAKEY_BASE + 'description.json').then(function (j) { step(); return j; }),
    getJsonRetry(TOWAKEY_BASE + 'pokedex.json').then(function (j) { step(); return j; }),
    fetchPokeApi(MAX_DEX_ID).then(function (j) { step(); return j; })
  ]).then(function (r) {
    Dex = buildDex(r[0], r[1], r[2]);
    MAX_DEX_ID = Dex.maxId;

    FLAVOR_SOURCES = SOURCE_GROUPS.map(function (g, i) {
      return { key: g[0], label: g[1], note: g[2], versions: g[3], bit: i };
    });
    ALL_SOURCE_MASK = (1 << FLAVOR_SOURCES.length) - 1;

    buildFlavorBits();
    return Dex;
  });
}

function buildDex(descJson, pkJson, api) {
  var desc = descJson.description || {};
  var pk = pkJson.pokedex || {};

  /* 使う slug の集合（本編以外の項目を落とすため） */
  var known = {};
  SOURCE_GROUPS.forEach(function (g) {
    g[3].forEach(function (slug) { known[slug] = true; });
  });

  /* --- 名前・分類（pokedex.json） --- */
  var maxId = 0;
  var names = {};
  var genera = {};
  Object.keys(pk).forEach(function (no) {
    var v = pickBaseForm(pk[no]);
    if (!v) return;
    var id = parseInt(no, 10);
    if (!id) return;
    if (id > maxId) maxId = id;
    names[id] = (v.name && v.name.jpn) || '';
    genera[id] = (v.classification && v.classification.jpn) || '';
  });

  /* --- 進化前（PokéAPI） ---
     towakey にも進化データはあるが、ニドラン♂系とケムッソ系に誤りがあったため使わない。
     伏字で進化前の名前も伏せるので、ここが狂うと出題が壊れる。 */
  var prevOf = (api && api.prev) || {};

  /* --- 説明文（description.json）。基本フォームを優先し、無ければ最初のフォームで代用 --- */
  var picked = {};
  Object.keys(desc).sort().forEach(function (key) {
    var v = desc[key];
    var id = parseInt(v.globalNo, 10);
    if (!id) return;
    var isBase = !(v.form || v.region || v.mega_evolution || v.gigantamax);
    if (!picked[id] || (isBase && !picked[id].isBase)) picked[id] = { v: v, isBase: isBase };
  });

  var species = {};
  for (var id = 1; id <= maxId; id++) {
    /* towakey に説明文が無い種でも、PokéAPI 側にあれば出題できる */
    var hit = picked[id] || { v: {} };

    /* towakey を土台にし、PokéAPI が持つソフト（X・Y 以降）はそちらで上書きする。
       X・Y と ORAS と Let's Go は PokéAPI のほうが収録数が多い。 */
    var texts = {};
    Object.keys(TOWAKEY_KEY).forEach(function (tk) {
      var slug = TOWAKEY_KEY[tk];
      if (!known[slug]) return;
      var text = normalizeFlavor(hit.v[tk]);
      if (text) texts[slug] = text;
    });
    var fromApi = (api && api.flavors && api.flavors[id]) || {};
    Object.keys(fromApi).forEach(function (slug) {
      if (known[slug]) texts[slug] = fromApi[slug];
    });

    /* 同じ本文を1本にまとめる（赤・緑・ファイアレッドが同文、などが非常に多い） */
    var merged = {};
    Object.keys(texts).forEach(function (slug) {
      var text = texts[slug];
      if (!merged[text]) merged[text] = [];
      merged[text].push(slug);
    });

    var flavors = Object.keys(merged).map(function (t) {
      return { t: t, v: merged[t].sort() };
    });
    if (!flavors.length) continue;

    species[id] = {
      n: names[id] || '',
      g: genera[id] || '',
      e: (prevOf[id] && names[prevOf[id]]) || '',
      f: flavors
    };
  }

  return {
    maxId: maxId,
    species: species,
    types: (api && api.types) || {},
    typeJa: (api && api.typeJa) || {}
  };
}

/* 各ポケモンが「どの出典グループの説明文を持つか」をビットで持つ。
   旧版は 898 文字の可否表を事前生成していたが、全データが手元にそろうので
   起動時にその場で数えたほうが速くて確実。 */
function buildFlavorBits() {
  var slugBit = {};
  FLAVOR_SOURCES.forEach(function (src) {
    src.versions.forEach(function (slug) { slugBit[slug] = 1 << src.bit; });
  });
  FLAVOR_BITS = new Array(MAX_DEX_ID + 1);
  for (var id = 1; id <= MAX_DEX_ID; id++) {
    var sp = Dex.species[id];
    var bits = 0;
    if (sp) {
      sp.f.forEach(function (entry) {
        entry.v.forEach(function (slug) { bits |= (slugBit[slug] || 0); });
      });
    }
    FLAVOR_BITS[id] = bits;
  }
}

/* dexdata.js から呼ばれる */
function flavorBitsOf(id) {
  if (!FLAVOR_BITS || id < 1 || id > MAX_DEX_ID) return 0;
  return FLAVOR_BITS[id] || 0;
}

/* ---------------- 公式イラスト（ID から組み立て・リクエスト不要） ---------------- */
function artworkUrl(id) { return ART_BASE + id + '.png'; }

/* ---------------- タイプ ---------------- */
function typesOf(id) {
  if (!Dex) return [];
  var slugs = Dex.types[id] || Dex.types[String(id)] || [];
  return slugs.map(function (slug) {
    return {
      slug: slug,
      ja: (Dex.typeJa && Dex.typeJa[slug]) || slug,
      color: TYPE_COLOR[slug] || '#888'
    };
  });
}

/* ---------------- 種族データ ---------------- */
/* dexdata.js の chooseFlavor / buildQuestionText が期待する形に展開する */
function speciesOf(id) {
  if (!Dex) return null;
  var raw = Dex.species[id] || Dex.species[String(id)];
  if (!raw) return null;
  var flavors = [];
  raw.f.forEach(function (entry) {
    entry.v.forEach(function (slug) { flavors.push({ text: entry.t, version: slug }); });
  });
  return {
    id: parseInt(id, 10),
    nameJa: raw.n,
    genusJa: raw.g || '',
    evolvesFromJa: raw.e || '',
    flavors: flavors
  };
}

/* ---------------- 出題データを用意する ---------------- */
/* 全データが手元にあるので通信しないが、app.js 側の呼び出しを変えずに済むよう Promise で返す。 */
function prefetchQuestions(count, pool, versions, onProgress) {
  var used = [];
  var out = [];
  var guard = 0;
  // 端末に残っている出題履歴。まだ出していないポケモンが優先される。
  var asked = loadAskedIds();
  if (onProgress) onProgress(0, count);

  while (out.length < count && guard < count * 500) {
    guard++;
    var id = pickIds(1, pool, used, asked)[0];
    if (!id) break;
    used.push(id);
    var sp = speciesOf(id);
    if (!sp || !sp.flavors.length) continue;
    var q = buildQuestionText(sp, versions);
    if (!q) continue;
    out.push({
      id: sp.id,
      nameJa: sp.nameJa,
      genusJa: sp.genusJa,
      flavorMasked: q.masked,
      flavorRaw: q.raw,
      version: q.version,
      versionJa: VERSION_JA[q.version] || q.version
    });
    if (onProgress) onProgress(out.length, count);
  }
  if (onProgress) onProgress(count, count);
  recordAskedIds(out.map(function (q) { return q.id; }));
  return Promise.resolve(out);
}

/* ---------------- デバッグ用 ---------------- */
/* コンソールで pqTest(25) と打つと、伏字済みの解説文が確認できる */
function pqTest(id) {
  var sp = speciesOf(id);
  if (!sp) { console.log('No.' + id + ' は見つかりません'); return null; }
  var q = buildQuestionText(sp, null);
  console.log('No.' + sp.id + ' ' + sp.nameJa + '（' + sp.genusJa + '）');
  console.log('出典: ポケットモンスター ' + (VERSION_JA[q.version] || q.version));
  console.log('--- 出題用（伏字' + (q.wasMasked ? 'あり' : 'なし') + '） ---');
  console.log(q.masked);
  console.log('--- 正解発表用（完全版） ---');
  console.log(q.raw);
  return q;
}
