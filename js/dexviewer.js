/* =========================================================
   dexviewer.js — 図鑑ビューア（クイズと関係なく検索して読む画面）

   方針
   -------------------------------------------------------
   このファイルは図鑑データの「表示」だけを担当し、取得はしない。
   speciesOf() / typesOf() / artworkUrl() / FLAVOR_SOURCES を使うので、
   公開版（dexsource.js）でもコンプリート版（localdex.js）でも
   まったく同じコードが動く。

   公開版は図鑑テキストを一切ホストしない構造を保つ（進捗メモの決着事項）。
   ここで表示する文面も、閲覧者のブラウザが配布元から直接取得したもの。

   公式サイト（zukan.pokemon.co.jp）へはリンクするだけで、
   データの取得・参照は一切しない。
   ========================================================= */

var ZUKAN_TOP = 'https://zukan.pokemon.co.jp/';
/* 個別ページは4桁ゼロ埋め（https://zukan.pokemon.co.jp/detail/0025 で 200 を確認ずみ） */
function zukanDetailUrl(id) { return ZUKAN_TOP + 'detail/' + ('000' + id).slice(-4); }

/* 一覧は一度にこの件数だけ描く（公開版はアートワークを1枚ずつ取りに行くため） */
var DEX_PAGE = 60;

/* タイプチップの並び順（TYPE_COLOR は unknown / shadow を含むので、本編の18種だけ使う） */
var DEX_TYPE_ORDER = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'
];

var dexIndex = null;               /* [{id, name, norm, genus, gen, types:[slug]}] */
var dexById = {};                  /* id → 上の要素（一覧の描画で毎回さがさないため） */
var dexFilter = { q: '', gens: [], types: [] };
var dexResult = [];                /* 現在の絞り込み結果（ID の配列） */
var dexShown = 0;                  /* そのうち何件を描画ずみか */
var dexReturn = 's1';              /* 「もどる」の行き先 */
var dexCurrentId = 0;              /* 詳細で表示中のポケモン */

/* ---------------- 索引 ----------------
   起動時ではなく、はじめてビューアを開いたときに1回だけ作る。 */
function buildDexIndex() {
  if (dexIndex) return dexIndex;
  dexIndex = [];
  dexById = {};
  for (var id = 1; id <= MAX_DEX_ID; id++) {
    var sp = speciesOf(id);
    if (!sp) continue;
    var name = sp.nameJa || '';
    var entry = {
      id: id,
      name: name,
      norm: normalizeAnswer(name),          // judge.js の正規化（ひら/カタ/長音を吸収）
      genus: sp.genusJa || '',
      gen: genOfId(id),
      types: (Dex.types[id] || Dex.types[String(id)] || []).slice()
    };
    dexIndex.push(entry);
    dexById[id] = entry;
  }
  return dexIndex;
}

function genOfId(id) {
  for (var i = 0; i < GEN_TABLE.length; i++) {
    if (id >= GEN_TABLE[i].min && id <= GEN_TABLE[i].max) return GEN_TABLE[i].gen;
  }
  return 0;
}

/* ---------------- 検索・絞り込み ---------------- */
function dexSearch() {
  var list = buildDexIndex();
  var gens = dexFilter.gens;
  var types = dexFilter.types;

  var base = list.filter(function (e) {
    if (gens.length && gens.indexOf(e.gen) < 0) return false;
    if (types.length) {
      var hit = types.some(function (t) { return e.types.indexOf(t) >= 0; });
      if (!hit) return false;
    }
    return true;
  });

  var q = (dexFilter.q || '').trim();
  if (!q) return base.map(function (e) { return e.id; });

  // 数字だけなら図鑑 No. 検索（0025 のようなゼロ埋めも受ける）
  if (/^[0-9０-９]+$/.test(q)) {
    var digits = q.normalize ? q.normalize('NFKC') : q;
    var exact = parseInt(digits, 10);
    var head = String(exact);
    var hitExact = [];
    var hitHead = [];
    base.forEach(function (e) {
      if (e.id === exact) hitExact.push(e.id);
      else if (String(e.id).indexOf(head) === 0) hitHead.push(e.id);
    });
    return hitExact.concat(hitHead);
  }

  // 名前検索：前方一致を先、部分一致を後（分類にも当てる）
  var nq = normalizeAnswer(q);
  if (!nq) return base.map(function (e) { return e.id; });
  var pre = [], mid = [], gen = [];
  base.forEach(function (e) {
    var at = e.norm.indexOf(nq);
    if (at === 0) pre.push(e.id);
    else if (at > 0) mid.push(e.id);
    else if (e.genus && e.genus.indexOf(q) >= 0) gen.push(e.id);
  });
  var hits = pre.concat(mid, gen);
  if (hits.length) return hits;

  /* 1件も無いときだけ、クイズの判定（judge.js）にかける。
     「ピカチュー」のような長音ゆれや1文字ちがいをここで救う。 */
  base.forEach(function (e) {
    if (e.name && judgeAnswer(q, e.name)) hits.push(e.id);
  });
  return hits;
}

/* ---------------- 画面を開く ---------------- */
function openDexViewer(from) {
  dexReturn = from || 's1';
  if (!$id('dexTypeChips').childNodes.length) renderDexFilters();
  applyDexSearch();
  showScreen('s6');
  beep('tap');
}

function renderDexFilters() {
  var genWrap = $id('dexGenChips');
  genWrap.innerHTML = '';
  GEN_TABLE.forEach(function (g) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'dexchip';
    b.textContent = g.label;
    b.title = g.games;
    b.addEventListener('click', function () {
      toggleInArray(dexFilter.gens, g.gen);
      b.classList.toggle('is-on', dexFilter.gens.indexOf(g.gen) >= 0);
      applyDexSearch();
      beep('tap');
    });
    genWrap.appendChild(b);
  });

  var typeWrap = $id('dexTypeChips');
  typeWrap.innerHTML = '';
  DEX_TYPE_ORDER.forEach(function (slug) {
    var ja = (Dex.typeJa && Dex.typeJa[slug]) || slug;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'dexchip dexchip-type';
    b.textContent = ja;
    b.style.setProperty('--chip', TYPE_COLOR[slug] || '#888');
    b.addEventListener('click', function () {
      toggleInArray(dexFilter.types, slug);
      b.classList.toggle('is-on', dexFilter.types.indexOf(slug) >= 0);
      applyDexSearch();
      beep('tap');
    });
    typeWrap.appendChild(b);
  });
}

function applyDexSearch() {
  dexResult = dexSearch();
  dexShown = 0;
  $id('dexList').innerHTML = '';
  $id('dexCount').textContent = dexResult.length + ' 件';
  $id('dexEmpty').hidden = dexResult.length > 0;
  renderDexPage();
}

/* 60件ずつ描き足す。公開版はアートワークを1枚ずつ取りに行くので、
   1025件を一度に並べると重い。 */
function renderDexPage() {
  var wrap = $id('dexList');
  var end = Math.min(dexShown + DEX_PAGE, dexResult.length);
  for (var i = dexShown; i < end; i++) {
    wrap.appendChild(dexCard(dexResult[i]));
  }
  dexShown = end;
  var more = $id('btnDexMore');
  more.hidden = dexShown >= dexResult.length;
  more.textContent = 'もっと見る（あと ' + (dexResult.length - dexShown) + ' 件）';
}

function dexCard(id) {
  var e = dexById[id] || { id: id, name: '', types: [] };

  var card = document.createElement('button');
  card.type = 'button';
  card.className = 'dexcell';

  var thumb = document.createElement('span');
  thumb.className = 'dexcell-img';
  var img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = artworkUrl(id);
  img.addEventListener('error', function () { thumb.classList.add('is-broken'); });
  thumb.appendChild(img);
  card.appendChild(thumb);

  var no = document.createElement('span');
  no.className = 'dexcell-no';
  no.textContent = 'No.' + ('000' + id).slice(-4);
  card.appendChild(no);

  var name = document.createElement('span');
  name.className = 'dexcell-name';
  name.textContent = e.name || '？';
  card.appendChild(name);

  card.addEventListener('click', function () { openDexDetail(id); });
  return card;
}

/* ---------------- 詳細 ---------------- */
function openDexDetail(id) {
  var sp = speciesOf(id);
  if (!sp) { toast('このポケモンのデータがありません'); return; }
  dexCurrentId = id;

  $id('dexDetailNo').textContent = 'No.' + ('000' + id).slice(-4);
  $id('dexDetailName').textContent = sp.nameJa || '？';
  $id('dexDetailGenus').textContent = sp.genusJa || '';

  var typeWrap = $id('dexDetailTypes');
  typeWrap.innerHTML = '';
  typesOf(id).forEach(function (t) {
    var chip = document.createElement('span');
    chip.className = 'type-chip';
    chip.style.background = t.color;
    chip.textContent = t.ja;
    typeWrap.appendChild(chip);
  });

  /* 公式イラスト（S4 と同じく、読めたときだけ差し込む） */
  var wrap = $id('dexDetailImgWrap');
  var img = $id('dexDetailImg');
  wrap.classList.remove('has-img');
  img.removeAttribute('src');
  img.alt = (sp.nameJa || '') + ' の公式イラスト';
  var url = artworkUrl(id);
  var probe = new Image();
  probe.onload = function () { img.src = url; wrap.classList.add('has-img'); };
  probe.onerror = function () { wrap.classList.remove('has-img'); };
  probe.src = url;

  /* 進化前 */
  var evo = $id('dexDetailEvo');
  if (sp.evolvesFromJa) {
    evo.hidden = false;
    evo.textContent = '進化前： ' + sp.evolvesFromJa;
  } else {
    evo.hidden = true;
  }

  renderDexFlavors(id);

  /* 公式ページへのリンク（リンクするだけ。中身は一切参照しない） */
  var link = $id('dexOfficialLink');
  link.href = zukanDetailUrl(id);
  link.textContent = (sp.nameJa || 'このポケモン') + ' を公式ずかんで見る';

  /* 前後のポケモンへ */
  $id('btnDexPrev').disabled = id <= 1;
  $id('btnDexNext').disabled = id >= MAX_DEX_ID;

  showScreen('s7');
  beep('tap');
}

/* 図鑑説明を全ソフトぶん並べる。
   Dex.species[id].f は同一本文を {t:本文, v:[slug,…]} にまとめてあるので、
   本文は重複させず、出典ソフト名だけを列挙する。 */
function renderDexFlavors(id) {
  var wrap = $id('dexFlavors');
  wrap.innerHTML = '';

  var raw = Dex.species[id] || Dex.species[String(id)];
  var entries = (raw && raw.f) || [];
  if (!entries.length) {
    var p = document.createElement('p');
    p.className = 'dex-note';
    p.textContent = 'このポケモンの図鑑説明は見つかりませんでした。';
    wrap.appendChild(p);
    return;
  }

  /* slug の並び順（出典グループの順 → グループ内の順） */
  var order = {};
  FLAVOR_SOURCES.forEach(function (src) {
    src.versions.forEach(function (slug, i) { order[slug] = src.bit * 100 + i; });
  });

  var rows = entries.map(function (e) {
    var slugs = e.v.filter(function (s) { return order[s] !== undefined; })
                   .sort(function (a, b) { return order[a] - order[b]; });
    return { text: e.t, slugs: slugs, rank: slugs.length ? order[slugs[0]] : 9999 };
  }).filter(function (r) { return r.slugs.length; });

  rows.sort(function (a, b) { return a.rank - b.rank; });

  rows.forEach(function (r) {
    var box = document.createElement('div');
    box.className = 'lcd lcd-flavor dexflavor';

    var meta = document.createElement('p');
    meta.className = 'flavor-meta';
    meta.textContent = 'ポケットモンスター ' + r.slugs.map(function (s) {
      return VERSION_JA[s] || s;
    }).join('・');
    box.appendChild(meta);

    var text = document.createElement('p');
    text.className = 'flavor-text';
    text.textContent = r.text;
    box.appendChild(text);

    wrap.appendChild(box);
  });
}

/* ---------------- 配線（app.js の initApp から呼ぶ） ---------------- */
function initDexViewer() {
  var input = $id('dexSearch');
  var timer = null;
  input.addEventListener('input', function () {
    dexFilter.q = input.value;
    clearTimeout(timer);
    timer = setTimeout(applyDexSearch, 160);   // 1文字ごとに1025件を走査しないように少し待つ
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });

  $id('btnDexClear').addEventListener('click', function () {
    input.value = '';
    dexFilter = { q: '', gens: [], types: [] };
    $$('#dexGenChips .dexchip, #dexTypeChips .dexchip').forEach(function (b) {
      b.classList.remove('is-on');
    });
    applyDexSearch();
    beep('tap');
  });

  $id('btnDexMore').addEventListener('click', function () { renderDexPage(); beep('tap'); });

  function leaveViewer() {
    showScreen(dexReturn === 's5' ? 's5' : 's1');
    beep('tap');
  }
  $id('btnDexBack').addEventListener('click', leaveViewer);
  $id('btnDexBackTop').addEventListener('click', leaveViewer);
  $id('btnDexDetailBack').addEventListener('click', function () { showScreen('s6'); beep('tap'); });

  $id('btnDexPrev').addEventListener('click', function () {
    if (dexCurrentId > 1) openDexDetail(dexCurrentId - 1);
  });
  $id('btnDexNext').addEventListener('click', function () {
    if (dexCurrentId < MAX_DEX_ID) openDexDetail(dexCurrentId + 1);
  });
}
