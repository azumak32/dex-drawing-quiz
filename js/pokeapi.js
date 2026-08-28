/* =========================================================
   pokeapi.js — PokéAPI 取得 + localStorage キャッシュ + プリフェッチ
   Fair Use 準拠：取得結果は必ずローカルにキャッシュし、再取得しない。
   1問につき /pokemon-species/{id}/ の 1 リクエストのみ。
   タイプは /type/{id}/ を 21 回だけ叩いて対応表を作る（初回のみ）。
   ========================================================= */

var API_BASE = 'https://pokeapi.co/api/v2/';
var ART_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';

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

/* タイプの色（S4 のタイプチップ用） */
var TYPE_COLOR = {
  normal: '#9099a1', fighting: '#ce4069', flying: '#8fa8dd', poison: '#ab6ac8',
  ground: '#d97746', rock: '#c7b78b', bug: '#90c12c', ghost: '#5269ac',
  steel: '#5a8ea1', fire: '#ff9d55', water: '#4d90d5', grass: '#63bb5b',
  electric: '#f4d23c', psychic: '#f97176', ice: '#74cec0', dragon: '#0b6dc3',
  dark: '#5a5465', fairy: '#ec8fe6', unknown: '#68a090', shadow: '#4b4453'
};

/* ---------------- 日本語エントリの取り出し ----------------
   PokeAPI の言語コードは小文字の 'ja'（漢字かな交じり）と 'ja-hrkt'（かな）の2種類。
   図鑑らしさと読みやすさのため 'ja'（漢字あり）を優先し、無ければ 'ja-hrkt' を使う。 */
function isJa(code) { return code === 'ja' || code === 'ja-hrkt'; }

function pickJaEntry(list) {
  list = list || [];
  var ja = null, hrkt = null;
  for (var i = 0; i < list.length; i++) {
    var code = list[i].language && list[i].language.name;
    if (code === 'ja' && !ja) ja = list[i];
    else if (code === 'ja-hrkt' && !hrkt) hrkt = list[i];
  }
  return ja || hrkt;
}

/* ---------------- localStorage キャッシュ ---------------- */
function lsGet(key) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // 一括保存中は古いデータを捨てない（全件そろっている必要があるため）
    if (window.__pqNoEvict) return false;
    // 容量オーバー：古い species キャッシュを半分捨ててから再挑戦
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('pq:species:') === 0) keys.push(k);
      }
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(function (k) {
        localStorage.removeItem(k);
      });
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e2) { return false; }
  }
}

/* ---------------- 通信 ---------------- */
function getJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; reject(new Error('timeout')); }
    }, timeoutMs || 12000);

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

/* ---------------- 公式イラスト URL（リクエスト不要・ID から組み立て） ---------------- */
function artworkUrl(id) { return ART_BASE + id + '.png'; }

/* ---------------- タイプ対応表 ---------------- */
/* 形： { ja: {slug: '日本語名'}, byId: { pokemonId: [slug, slug] } } */
var TypeMap = null;

function loadTypeMapFromCache() {
  if (TypeMap) return TypeMap;
  var cached = lsGet('pq:typemap');
  if (cached && cached.byId) TypeMap = cached;
  return TypeMap;
}

function fetchTypeMap(onStep) {
  loadTypeMapFromCache();
  if (TypeMap) return Promise.resolve(TypeMap);

  var map = { ja: {}, byId: {} };
  var ids = [];
  for (var i = 1; i <= 21; i++) ids.push(i);

  // 21件を順番に（同時に叩かない＝行儀よく）
  var chain = Promise.resolve();
  ids.forEach(function (tid) {
    chain = chain.then(function () {
      return getJsonRetry(API_BASE + 'type/' + tid + '/')
        .then(function (json) {
          var slug = json.name;
          var ja = pickJaEntry(json.names);
          map.ja[slug] = ja ? ja.name : slug;
          (json.pokemon || []).forEach(function (entry) {
            var m = /\/pokemon\/(\d+)\/?$/.exec(entry.pokemon.url);
            if (!m) return;
            var pid = parseInt(m[1], 10);
            if (pid > MAX_DEX_ID) return;        // メガシンカ等のフォルムは除外
            if (!map.byId[pid]) map.byId[pid] = [];
            map.byId[pid][entry.slot - 1] = slug;
          });
        })
        .catch(function () { /* 1タイプ失敗しても続行 */ })
        .then(function () { if (onStep) onStep(); });
    });
  });

  return chain.then(function () {
    // 隙間を詰める
    Object.keys(map.byId).forEach(function (k) {
      map.byId[k] = map.byId[k].filter(Boolean);
    });
    TypeMap = map;
    lsSet('pq:typemap', map);
    return map;
  });
}

function typesOf(id) {
  var map = TypeMap || loadTypeMapFromCache();
  if (!map || !map.byId[id]) return [];
  return map.byId[id].map(function (slug) {
    return { slug: slug, ja: (map.ja && map.ja[slug]) || slug, color: TYPE_COLOR[slug] || '#888' };
  });
}

/* ---------------- 種族データ ---------------- */
/* 返り値： {id, nameJa, genusJa, evolvesFromJa, flavors:[{text,version}]} */
function trimSpecies(json) {
  function pickJa(list, field) {
    var hit = pickJaEntry(list);
    return hit ? hit[field] : '';
  }
  var flavors = [];
  var seen = {};
  var hasJa = (json.flavor_text_entries || []).some(function (e) {
    return e.language && e.language.name === 'ja';
  });
  (json.flavor_text_entries || []).forEach(function (e) {
    if (!e.language || !isJa(e.language.name)) return;
    if (hasJa && e.language.name !== 'ja') return;   // 漢字かな交じりを優先
    var text = e.flavor_text || '';
    if (!text.trim()) return;
    var key = text.replace(/\s/g, '');
    if (seen[key]) return;
    seen[key] = true;
    flavors.push({ text: text, version: (e.version && e.version.name) || '' });
  });

  return {
    id: json.id,
    nameJa: pickJa(json.names, 'name') || json.name,
    genusJa: pickJa(json.genera, 'genus') || '',
    evolvesFromJa: '',   // 下で補完（species レスポンスには英語名しか入らないため）
    evolvesFromSlug: json.evolves_from_species ? json.evolves_from_species.name : '',
    evolvesFromId: json.evolves_from_species
      ? (function () {
          var m = /\/pokemon-species\/(\d+)\/?$/.exec(json.evolves_from_species.url);
          return m ? parseInt(m[1], 10) : 0;
        })()
      : 0,
    flavors: flavors
  };
}

function getSpecies(id) {
  var key = 'pq:species:' + id;
  var cached = lsGet(key);
  if (cached && cached.flavors) return Promise.resolve(cached);

  return getJsonRetry(API_BASE + 'pokemon-species/' + id + '/')
    .then(function (json) {
      var s = trimSpecies(json);
      lsSet(key, s);
      return s;
    });
}

/* 進化前の日本語名を補う（伏字に使う）。
   キャッシュにあれば通信ゼロ、無ければ 1 リクエストだけ追加する。 */
function fillEvolvesFrom(species) {
  if (!species.evolvesFromId) return Promise.resolve(species);
  if (species.evolvesFromJa) return Promise.resolve(species);
  return getSpecies(species.evolvesFromId)
    .then(function (prev) {
      species.evolvesFromJa = prev.nameJa;
      lsSet('pq:species:' + species.id, species);
      return species;
    })
    .catch(function () { return species; });
}

/* ---------------- 1問分のデータを用意する ---------------- */
/* 日本語解説文が無い／少ない個体を引いたときは、別の ID を引き直す */
function loadQuestion(maxId, usedIds) {
  var tries = 0;
  function attempt() {
    tries++;
    var id;
    // ?debug=1 のときは固定の ID を順に使う（繰り返しテスト用）
    if (window.DEBUG_FIXED_IDS && window.DEBUG_FIXED_IDS.length) {
      var fixed = window.DEBUG_FIXED_IDS.filter(function (x) {
        return usedIds.indexOf(x) < 0 && x <= maxId;
      });
      id = fixed.length ? fixed[0] : pickIds(1, maxId, usedIds)[0];
    } else {
      id = pickIds(1, maxId, usedIds)[0];
    }
    if (!id) return Promise.reject(new Error('抽選できませんでした'));
    return getSpecies(id).then(function (sp) {
      if (!sp.flavors.length) {
        usedIds.push(id);
        if (tries >= 8) throw new Error('日本語の解説文が見つかりませんでした');
        return attempt();
      }
      usedIds.push(id);
      return fillEvolvesFrom(sp).then(function (full) {
        var q = buildQuestionText(full);
        return {
          id: full.id,
          nameJa: full.nameJa,
          genusJa: full.genusJa,
          flavorMasked: q.masked,
          flavorRaw: q.raw,
          version: q.version,
          versionJa: VERSION_JA[q.version] || q.version
        };
      });
    }).catch(function (err) {
      if (tries >= 8) throw err;
      return attempt();
    });
  }
  return attempt();
}

/* ---------------- プリフェッチ ---------------- */
/* 全問分をまとめて取得してキャッシュ。以後ネットが切れても最後まで遊べる。 */
function prefetchQuestions(count, maxId, onProgress) {
  var needTypeMap = !loadTypeMapFromCache();
  var totalSteps = count + (needTypeMap ? 21 : 0);
  var doneSteps = 0;
  function step() {
    doneSteps++;
    if (onProgress) onProgress(doneSteps, totalSteps);
  }
  if (onProgress) onProgress(0, totalSteps);

  var used = [];
  var questions = [];
  var chain = Promise.resolve();

  for (var i = 0; i < count; i++) {
    chain = chain.then(function () {
      return loadQuestion(maxId, used).then(function (q) {
        questions.push(q);
        step();
      });
    });
  }

  // タイプ対応表は最後に（正解発表で使う）
  chain = chain.then(function () {
    if (!needTypeMap) return null;
    return fetchTypeMap(step);
  });

  return chain.then(function () { return questions; });
}

/* ---------------- 全種データの端末保存（オフライン対策） ----------------
   自宅のネット環境で一度だけ実行し、898種を localStorage に保存する。
   PokeAPI の Fair Use を守るため、1件ずつ順番に・150ms のウェイトを入れて取得する。
   すでに保存済みの ID は再取得しない（中断しても続きから再開できる）。 */

function countCachedSpecies() {
  var n = 0;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('pq:species:') === 0) n++;
    }
  } catch (e) { return 0; }
  return n;
}

var saveAllAborted = false;

function abortSaveAll() { saveAllAborted = true; }

function saveAllSpecies(onProgress) {
  saveAllAborted = false;
  var ids = [];
  for (var i = 1; i <= MAX_DEX_ID; i++) ids.push(i);

  var done = 0;
  var failed = 0;
  var quotaFull = false;

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function step(index) {
    if (saveAllAborted) return Promise.resolve({ done: done, failed: failed, aborted: true });
    if (quotaFull) return Promise.resolve({ done: done, failed: failed, aborted: true, quota: true });
    if (index >= ids.length) return Promise.resolve({ done: done, failed: failed, aborted: false });

    var id = ids[index];
    var cached = lsGet('pq:species:' + id);
    if (cached && cached.flavors) {
      done++;
      if (onProgress) onProgress(done + failed, ids.length);
      // キャッシュ済みは通信しないので待たずに次へ
      return (index % 40 === 0 ? wait(0) : Promise.resolve()).then(function () {
        return step(index + 1);
      });
    }

    return getSpecies(id)
      .then(function (sp) { return fillEvolvesFrom(sp); })
      .then(function () {
        // 端末の保存容量が尽きていないか確認する
        if (!lsGet('pq:species:' + id)) { quotaFull = true; return; }
        done++;
      })
      .catch(function () { failed++; })
      .then(function () {
        if (onProgress) onProgress(done + failed, ids.length);
        return wait(150);          // リクエスト間 150ms（行儀よく）
      })
      .then(function () { return step(index + 1); });
  }

  // タイプ対応表も一緒に保存しておく
  window.__pqNoEvict = true;
  return fetchTypeMap().catch(function () { return null; }).then(function () {
    return step(0);
  }).then(function (res) {
    window.__pqNoEvict = false;
    return res;
  }, function (err) {
    window.__pqNoEvict = false;
    throw err;
  });
}

function clearSpeciesCache() {
  var keys = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && (k.indexOf('pq:species:') === 0 || k === 'pq:typemap')) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) { /* 無視 */ }
  TypeMap = null;
  return keys.length;
}

/* ---------------- デバッグ用 ---------------- */
/* コンソールで pqTest(25) と打つと、伏字済みの解説文が確認できる */
function pqTest(id) {
  return getSpecies(id).then(fillEvolvesFrom).then(function (sp) {
    var q = buildQuestionText(sp);
    console.log('No.' + sp.id + ' ' + sp.nameJa + '（' + sp.genusJa + '）');
    console.log('出典: ポケットモンスター ' + (VERSION_JA[q.version] || q.version));
    console.log('--- 出題用（伏字' + (q.wasMasked ? 'あり' : 'なし') + '） ---');
    console.log(q.masked);
    console.log('--- 正解発表用（完全版） ---');
    console.log(q.raw);
    return q;
  });
}
