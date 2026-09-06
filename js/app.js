/* =========================================================
   app.js — 画面遷移と各画面のイベント配線（最後に読み込む）
   ========================================================= */

/* ---------------- 画面遷移 ---------------- */
var SCREENS = ['s1', 's15', 's2', 's3', 's4', 's5'];

function showScreen(id) {
  SCREENS.forEach(function (s) {
    var el = $id(s);
    if (el) el.classList.toggle('is-active', s === id);
  });
  State.screen = id;
  window.scrollTo(0, 0);
  setTopStatus();
  saveState();
}

/* 図鑑ヘッダー右上の状態表示 */
function setTopStatus(text) {
  var el = $id('dexTopStatus');
  if (!el) return;
  if (typeof text === 'string') { el.textContent = text; return; }
  if (State.order.length && State.screen !== 's1') {
    el.textContent = (State.round + 1) + ' / ' + State.order.length + ' 問目';
  } else {
    el.textContent = DEBUG ? 'DEBUG MODE' : '';
  }
}

/* ---------------- インタースティシャル ---------------- */
var _interCallback = null;
function showInterstitial(name, role, note, cb) {
  $id('interName').textContent = name;
  $id('interRole').textContent = role || 'さんの番です';
  $id('interNote').textContent = note || '';
  $id('interstitial').hidden = false;
  _interCallback = cb || null;
}
function hideInterstitial() {
  $id('interstitial').hidden = true;
  var cb = _interCallback;
  _interCallback = null;
  if (cb) cb();
}

/* =========================================================
   S1 設定画面
   ========================================================= */

/* ---------- 出題範囲（世代 × 出典ソフト） ----------
   世代は「その世代で新登場した種」だけ。どちらも複数選択できる。
   組み合わせによっては該当する種が 0 になるので、その場合は選べなくする。 */

function toggleInArray(arr, value) {
  var i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
  return arr;
}

function renderGenButtons() {
  var wrap = $id('genButtons');
  wrap.innerHTML = '';
  var mask = sourceMask();
  GEN_TABLE.forEach(function (g) {
    var n = countForGen(g.gen, mask);
    var on = State.settings.gens.indexOf(g.gen) >= 0;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-choice' + (on ? ' is-on' : '') + (n === 0 ? ' is-disabled' : '');
    b.dataset.gen = String(g.gen);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = g.label + '<small>' + g.games + '／' + n + '種</small>';
    // 選択中のものは 0 種でも押せるままにする（解除できなくなると詰むため）
    if (n === 0 && !on) {
      b.disabled = true;
      b.title = 'えらんだ出典ソフトに、この世代の図鑑説明はありません';
    } else {
      b.addEventListener('click', function () {
        toggleInArray(State.settings.gens, g.gen);
        renderRange();
        beep('tap');
      });
    }
    wrap.appendChild(b);
  });
}

function renderSourceButtons() {
  var wrap = $id('sourceButtons');
  wrap.innerHTML = '';
  FLAVOR_SOURCES.forEach(function (src) {
    var usable = sourceUsable(src.key);
    var on = State.settings.sources.indexOf(src.key) >= 0;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-choice' + (on ? ' is-on' : '') + (usable ? '' : ' is-disabled');
    b.dataset.source = src.key;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = src.label + '<small>' + src.note + '</small>';
    // 選択中のものは押せるままにする（解除できなくなると詰むため）
    if (!usable && !on) {
      b.disabled = true;
      b.title = 'えらんだ世代のポケモンに、このソフトの図鑑説明はありません';
    } else {
      b.addEventListener('click', function () {
        toggleInArray(State.settings.sources, src.key);
        renderRange();
        beep('tap');
      });
    }
    wrap.appendChild(b);
  });
  var any = State.settings.sources.length === 0;
  $id('btnSourceAny').classList.toggle('is-on', any);
}

/* 端末に残っている出題履歴の件数を出す。
   出題ずみのポケモンは抽選の優先度が下がる（js/dexdata.js の pickIds）。 */
function renderAskedNote() {
  var el = $id('askedNote');
  if (!el) return;
  var asked = loadAskedIds();
  var pool = questionPool();
  var seen = 0;
  var rank = {};
  asked.forEach(function (id) { rank[id] = true; });
  pool.forEach(function (id) { if (rank[id]) seen++; });
  if (!asked.length) {
    el.textContent = 'この端末での出題ずみ：なし';
  } else {
    el.textContent = 'この端末での出題ずみ：' + seen + ' / ' + pool.length + ' 種'
      + (seen >= pool.length && pool.length ? '（ひと巡りしました）' : '');
  }
  $id('btnClearAsked').disabled = !asked.length;
}

function renderRange() {
  renderGenButtons();
  renderSourceButtons();

  var n = questionPool().length;
  var note = $id('rangeNote');
  note.textContent = '出題範囲：' + rangeLabel();
  note.classList.toggle('is-empty', n === 0);
  renderAskedNote();

  // 出題できる種が 1 つも無ければ開始させない
  var can = n > 0;
  $id('btnStartGame').disabled = !can;
  $id('btnQuickStart').disabled = !can;
  if (!can) {
    note.textContent = '出題できるポケモンがいません。世代か出典をえらび直してください。';
  }
  saveState();
}

/* ---------- プレイヤー登録 ---------- */
var MAX_PLAYERS = 10;

function renderPlayers() {
  var wrap = $id('playerList');
  wrap.innerHTML = '';
  State.players.forEach(function (p, i) {
    var row = document.createElement('div');
    row.className = 'player-row';

    var no = document.createElement('span');
    no.className = 'player-no';
    no.textContent = String(i + 1);
    row.appendChild(no);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name';
    input.value = p.name;
    input.placeholder = 'プレイヤー' + (i + 1) + ' の名前';
    input.maxLength = 12;
    input.autocomplete = 'off';
    input.enterKeyHint = 'done';
    input.addEventListener('input', function () {
      p.name = input.value;
      saveState();
    });
    row.appendChild(input);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'remote-toggle' + (p.remote ? ' is-on' : '');
    toggle.innerHTML = (p.remote ? '📡 リモート' : 'リモート');
    toggle.addEventListener('click', function () {
      p.remote = !p.remote;
      toggle.classList.toggle('is-on', p.remote);
      toggle.innerHTML = (p.remote ? '📡 リモート' : 'リモート');
      beep('tap');
      saveState();
    });
    row.appendChild(toggle);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-del';
    del.textContent = '×';
    del.setAttribute('aria-label', (i + 1) + '人目を削除');
    del.addEventListener('click', function () {
      State.players.splice(i, 1);
      if (!State.players.length) State.players.push(makePlayer(''));
      State.order = [];
      $id('orderResult').hidden = true;
      renderPlayers();
      beep('tap');
    });
    row.appendChild(del);

    wrap.appendChild(row);
  });
  $id('btnAddPlayer').disabled = State.players.length >= MAX_PLAYERS;
  saveState();
}

/* ---------- サイコロ（出題順を決める） ---------- */
var DICE_FACES = ['\u2680', '\u2681', '\u2682', '\u2683', '\u2684', '\u2685'];
var diceRolling = false;

function rollDice() {
  var ps = activePlayers();
  if (ps.length < 2) {
    toast('名前を2人以上入れてください');
    return;
  }
  if (diceRolling) return;
  diceRolling = true;

  var face = $id('diceFace');
  face.classList.add('is-rolling');
  var ticks = 0;
  var iv = setInterval(function () {
    face.textContent = DICE_FACES[Math.floor(Math.random() * 6)];
    beep('dice');
    ticks++;
    if (ticks >= 12) {
      clearInterval(iv);
      face.classList.remove('is-rolling');
      face.textContent = '\uD83C\uDFB2';
      diceRolling = false;
      State.order = shuffle(ps.map(function (p) { return p.id; }));
      showOrder();
      beep('ok');
    }
  }, 110);
}

function showOrder() {
  var el = $id('orderResult');
  if (!State.order.length) { el.hidden = true; return; }
  var list = State.order.map(function (id, i) {
    return (i + 1) + '. ' + playerName(id) + (playerById(id).remote ? '（リモート）' : '');
  }).join('　/　');
  el.innerHTML = '出題の順番<br>' + list +
    '<br>さいしょの出題者は <b>' + playerName(State.order[0]) + '</b> さん！';
  el.hidden = false;
}

/* ---------- モード・時間制限 ---------- */
function renderMode() {
  var vs = State.settings.mode === 'vs';
  $id('btnModeVs').classList.toggle('is-on', vs);
  $id('btnModeCoop').classList.toggle('is-on', !vs);
  saveState();
}

function renderTimer() {
  var on = !!State.settings.timer;
  $id('btnTimerOn').classList.toggle('is-on', on);
  $id('btnTimerOff').classList.toggle('is-on', !on);
  $id('timerSettings').hidden = !on;
  $id('drawSec').value = State.settings.drawSec;
  $id('answerSec').value = State.settings.answerSec;
  $id('drawSecLabel').textContent = State.settings.drawSec;
  $id('answerSecLabel').textContent = State.settings.answerSec;
  saveState();
}

/* ---------- ゲーム開始 ---------- */
/* quick=true なら「すぐに始める」（協力・時間制限なし・プレイヤー登録なしで1問） */
function startGame(quick) {
  if (quick) {
    State.settings.mode = 'coop';
    State.settings.timer = false;
    State.order = ['__quick__'];
    State.players = State.players; // そのまま
  } else if (State.settings.mode === 'vs') {
    var ps = activePlayers();
    if (ps.length < 2) {
      toast('対戦モードは2人以上の名前が必要です');
      return;
    }
    if (!State.order.length || State.order.length !== ps.length ||
        State.order.some(function (id) { return !playerById(id) || !playerById(id).name.trim(); })) {
      State.order = shuffle(ps.map(function (p) { return p.id; }));
      showOrder();
    }
  } else {
    // 協力モード：出題者を1人ずつ回す（名前があればその人数、無ければ1問）
    var cps = activePlayers();
    State.order = cps.length ? shuffle(cps.map(function (p) { return p.id; })) : ['__quick__'];
  }

  // 出題範囲を絞りすぎて、問題数ぶんのポケモンを用意できないことがある
  var pool = questionPool();
  if (!pool.length) {
    toast('出題できるポケモンがいません。出題範囲をえらび直してください');
    return;
  }
  if (pool.length < State.order.length) {
    toast('この出題範囲は ' + pool.length + ' 種しかありません（' +
          State.order.length + ' 問ぶん必要）。範囲を広げてください');
    return;
  }

  State.round = 0;
  State.quiz = [];
  State.usedIds = [];
  State.drawing = null;
  State.answers = [];
  State.answerIndex = 0;
  State.scores = {};
  State.coop = { total: 0, correct: 0 };
  State.finished = false;
  State.order.forEach(function (id) { ensureScore(id); });
  saveState();

  runPrefetch();
}

/* ---------- S1.5 プリフェッチ ---------- */
var prefetchAborted = false;

function runPrefetch() {
  prefetchAborted = false;
  showScreen('s15');
  var bar = $id('loadingBar');
  var cnt = $id('loadingCount');
  bar.style.width = '0%';
  cnt.textContent = '0 / ' + State.order.length;

  var count = State.order.length;
  var pool = questionPool();
  var versions = allowedVersions();
  // ?debug=1 では出題ポケモンを固定して繰り返しテストできるようにする
  window.DEBUG_FIXED_IDS = DEBUG ? [25, 4, 1, 7, 133, 143, 150, 94, 6, 9] : null;

  prefetchQuestions(count, pool, versions, function (done, total) {
    cnt.textContent = done + ' / ' + total;
    bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  }).then(function (questions) {
    if (prefetchAborted) return;
    State.quiz = questions;
    saveState();
    beep('ok');
    startRound();
  }).catch(function (err) {
    if (prefetchAborted) return;
    console.error(err);
    $id('loadingNote').textContent =
      '図鑑データを取得できませんでした。ネット接続を確認して、もう一度お試しください。';
    toast('通信に失敗しました');
  });
}

/* ---------- ラウンド開始（ステップ4以降で中身を実装） ---------- */
function startRound() {
  State.lastRoundScore = null;
  State.answers = [];
  State.answerIndex = 0;
  State.drawing = null;
  showScreen('s2');
  renderDrawScreen();
  DrawPad.reset();
  startDrawTimer();
  saveState();
}

function renderDrawScreen() {
  var q = State.quiz[State.round];
  if (!q) return;
  var drawerId = State.order[State.round];
  $id('drawerName').textContent =
    drawerId === '__quick__' ? 'あなた' : playerName(drawerId);
  $id('turnCount').textContent = (State.round + 1) + ' / ' + State.order.length + ' 問目';
  $id('flavorMeta').textContent = 'ポケットモンスター ' + q.versionJa + ' より';
  $id('flavorText').textContent = q.flavorMasked;
  setTopStatus();
}

/* お絵描き完了 → クイズ画面へ */
function finishDrawing() {
  if (DrawPad.isBlank()) {
    toast('まだ何も描かれていません');
    return;
  }
  stopDrawTimer();
  State.drawing = DrawPad.toDataURL();
  saveState();
  beep('ok');
  goToQuiz();
}

/* =========================================================
   S3 クイズ画面
   ========================================================= */

/* このラウンドの解答者一覧を決める。
   協力モード／すぐに始める → 1回だけ（playerId は null）
   対戦モード → 出題者以外の全員 */
function computeAnswerers() {
  var drawerId = State.order[State.round];
  if (State.settings.mode !== 'vs' || drawerId === '__quick__') return [null];
  return activePlayers()
    .filter(function (p) { return p.id !== drawerId; })
    .map(function (p) { return p.id; });
}

function goToQuiz() {
  $id('quizImage').src = State.drawing || '';
  $id('quizTurnCount').textContent = (State.round + 1) + ' / ' + State.order.length + ' 問目';
  State.answerers = computeAnswerers();
  State.answerIndex = 0;
  State.answers = [];
  saveState();
  nextAnswerer();
}

function nextAnswerer() {
  var list = State.answerers || [];
  if (State.answerIndex >= list.length) {
    showReveal();
    return;
  }
  var pid = list[State.answerIndex];
  var isLast = State.answerIndex === list.length - 1;

  $id('answerInput').value = '';
  $id('btnAnswerNext').textContent = isLast ? 'こたえあわせ！' : '次の人へ';

  if (pid) {
    var p = playerById(pid);
    var proxy = p && p.remote ? '<span class="proxy">（代理入力）</span>' : '';
    $id('answererLabel').innerHTML = playerName(pid) + ' さんのこたえ' + proxy;
  } else {
    $id('answererLabel').textContent = 'みんなのこたえ';
  }

  showScreen('s3');

  // 対戦モードは、前の人の答えが見えないようにインタースティシャルを挟む
  if (pid && list.length > 1) {
    var pl = playerById(pid);
    showInterstitial(
      playerName(pid),
      'さんの番です',
      pl && pl.remote
        ? 'ビデオ通話の参加者です。口頭の解答をホストが代理入力してください。'
        : 'ほかの人は画面を見ないでください。',
      function () {
        startAnswerTimer();
        focusAnswerInput();
      }
    );
  } else {
    startAnswerTimer();
    focusAnswerInput();
  }
  saveState();
}

function focusAnswerInput() {
  // iPad で日本語キーボードが自然に出るよう、画面表示後に少し遅らせる
  setTimeout(function () {
    var el = $id('answerInput');
    if (el && $id('s3').classList.contains('is-active')) el.focus();
  }, 120);
}

/* 解答を確定して次へ */
function submitAnswer(text) {
  stopAnswerTimer();
  var q = State.quiz[State.round];
  var list = State.answerers || [];
  var pid = list[State.answerIndex] || null;
  var value = (text === undefined ? $id('answerInput').value : text) || '';
  var ok = q ? judgeAnswer(value, q.nameJa) : false;

  State.answers.push({
    playerId: pid,
    text: value.trim(),
    correct: ok,
    manual: false
  });
  State.answerIndex++;
  saveState();
  beep('tap');
  nextAnswerer();
}

/* =========================================================
   S4 正解発表画面
   ========================================================= */

function showReveal() {
  stopAnswerTimer();
  var q = State.quiz[State.round];
  if (!q) return;
  var drawerId = State.order[State.round];

  /* --- 図鑑カード --- */
  $id('revealNo').textContent = 'No.' + ('000' + q.id).slice(-3);
  $id('revealName').textContent = q.nameJa;
  $id('revealGenus').textContent = q.genusJa || '';

  var typeWrap = $id('revealTypes');
  typeWrap.innerHTML = '';
  var types = typesOf(q.id);
  if (types.length) {
    types.forEach(function (t) {
      var chip = document.createElement('span');
      chip.className = 'type-chip';
      chip.style.background = t.color;
      chip.textContent = t.ja;
      typeWrap.appendChild(chip);
    });
  }

  /* --- 公式イラスト（ネット接続時のみ。失敗したら「？」にフォールバック） --- */
  var wrap = $id('revealImgWrap');
  var img = $id('revealImg');
  wrap.classList.remove('has-img');
  img.removeAttribute('src');
  img.alt = q.nameJa + ' の公式イラスト';
  var url = artworkUrl(q.id);
  var probe = new Image();
  probe.onload = function () {
    img.src = url;
    wrap.classList.add('has-img');
  };
  probe.onerror = function () {
    wrap.classList.remove('has-img');
    $id('revealImgFallback').textContent = '？';
  };
  probe.src = url;

  /* --- 解説文（伏字を解除した完全版） --- */
  $id('revealMeta').textContent = 'ポケットモンスター ' + q.versionJa + ' より';
  $id('revealFlavor').textContent = q.flavorRaw;

  /* --- 出題者のイラスト --- */
  $id('revealDrawer').textContent =
    drawerId === '__quick__' ? 'あなた' : playerName(drawerId);
  $id('revealDrawing').src = State.drawing || '';

  /* --- 解答一覧（ホストが○×を手で上書きできる） --- */
  renderRevealResults();

  /* --- 協力モードのチーム記録 --- */
  var isCoop = State.settings.mode !== 'vs' || drawerId === '__quick__';
  var isLastRound = State.round >= State.order.length - 1;
  var rec = $id('coopRecord');
  if (isCoop) {
    rec.hidden = false;
    rec.textContent = (isLastRound ? 'これで最後の問題！ ' : '') +
      '全 ' + State.order.length + ' 問中 ' + State.coop.correct + ' 問正解！';
  } else {
    rec.hidden = true;
  }

  /* --- 次へボタンの文言 ---
     協力モードの最終問題では設定画面（S1）に戻る。押した先が分かるよう
     「もう一度あそぶ」ではなく行き先そのものを書く。 */
  var btn = $id('btnRevealNext');
  if (!isLastRound) {
    btn.textContent = '次の出題へ';
  } else if (State.settings.mode === 'vs' && drawerId !== '__quick__') {
    btn.textContent = '結果発表へ';
  } else {
    btn.textContent = '最初に戻る';
  }

  showScreen('s4');
  beep(hasAnyCorrect() ? 'correct' : 'wrong');
}

function hasAnyCorrect() {
  return State.answers.some(function (a) { return a.correct; });
}

function renderRevealResults() {
  var wrap = $id('revealResults');
  wrap.innerHTML = '';
  State.answers.forEach(function (a, i) {
    var row = document.createElement('div');
    row.className = 'result-row ' + (a.correct ? 'is-ok' : 'is-ng');

    var mark = document.createElement('span');
    mark.className = 'result-mark';
    mark.textContent = a.correct ? '\u25cb' : '\u00d7';
    row.appendChild(mark);

    var who = document.createElement('span');
    who.className = 'result-who';
    who.textContent = a.playerId ? playerName(a.playerId) : 'みんな';
    row.appendChild(who);

    var ans = document.createElement('span');
    ans.className = 'result-ans';
    if (a.text) { ans.textContent = a.text; }
    else { ans.innerHTML = '<span class="empty">（無回答）</span>'; }
    row.appendChild(ans);

    var flip = document.createElement('button');
    flip.type = 'button';
    flip.className = 'btn btn-flip';
    flip.textContent = a.correct ? '\u00d7 にする' : '\u25cb にする';
    flip.addEventListener('click', function () {
      a.correct = !a.correct;
      a.manual = true;
      saveState();
      renderRevealResults();
      recalcRoundScore();
      beep('tap');
    });
    row.appendChild(flip);

    wrap.appendChild(row);
  });
  recalcRoundScore();
}

/* ---------- 得点計算 ----------
   解答力＝自分の正解数 ／ 伝達力＝自分の絵で正解させた人数
   ○× を手で直しても正しく再計算できるよう、ラウンド単位で入れ直す。 */
function recalcRoundScore() {
  var drawerId = State.order[State.round];
  var isCoop = State.settings.mode !== 'vs' || drawerId === '__quick__';

  // 前回このラウンドで加算した分を取り消す
  if (State.lastRoundScore) {
    Object.keys(State.lastRoundScore.answer).forEach(function (id) {
      ensureScore(id).answer -= State.lastRoundScore.answer[id];
    });
    Object.keys(State.lastRoundScore.draw).forEach(function (id) {
      ensureScore(id).draw -= State.lastRoundScore.draw[id];
    });
    if (isCoop) State.coop.correct -= State.lastRoundScore.coop;
  }

  var add = { answer: {}, draw: {}, coop: 0 };
  var correctCount = 0;
  State.answers.forEach(function (a) {
    if (!a.correct) return;
    correctCount++;
    if (a.playerId) add.answer[a.playerId] = (add.answer[a.playerId] || 0) + 1;
  });
  if (!isCoop && drawerId && correctCount) add.draw[drawerId] = correctCount;
  if (isCoop && correctCount) add.coop = 1;

  Object.keys(add.answer).forEach(function (id) { ensureScore(id).answer += add.answer[id]; });
  Object.keys(add.draw).forEach(function (id) { ensureScore(id).draw += add.draw[id]; });
  if (isCoop) State.coop.correct += add.coop;

  State.lastRoundScore = add;

  var rec = $id('coopRecord');
  if (isCoop && !rec.hidden) {
    rec.textContent = '全 ' + State.order.length + ' 問中 ' + State.coop.correct + ' 問正解！';
  }
  saveState();
}

/* ---------- 次のラウンドへ ---------- */
function nextRound() {
  State.lastRoundScore = null;   // 確定
  var drawerId = State.order[State.round];
  var isCoop = State.settings.mode !== 'vs' || drawerId === '__quick__';

  if (State.round < State.order.length - 1) {
    State.round++;
    saveState();
    var nextDrawer = State.order[State.round];
    if (nextDrawer && nextDrawer !== '__quick__') {
      showInterstitial(playerName(nextDrawer), 'さんの番です',
        'ほかの人は解説文を見ないでください。', function () { startRound(); });
      showScreen('s2');
    } else {
      startRound();
    }
    return;
  }

  // 最終ラウンド終了
  State.finished = true;
  saveState();
  if (isCoop) {
    toast('全 ' + State.order.length + ' 問中 ' + State.coop.correct + ' 問正解！');
    showScreen('s1');
  } else {
    showResult();
  }
}

/* =========================================================
   S5 結果発表画面（対戦モードのみ）
   ========================================================= */

/* 称号：総合点と内訳の傾向で決める。
   全員が同点の項目では称号を出さない（意味がなくなるため）。 */
function titleFor(entry, max, tie, n) {
  if (max.total > 0 && entry.total === max.total) return 'ポケモンマスター';
  if (max.answer > 0 && entry.answer === max.answer && tie.answer < n) return 'ポケモン博士';
  if (max.draw > 0 && entry.draw === max.draw && tie.draw < n) return '画伯';
  if (entry.total === 0) return 'これからのトレーナー';
  if (entry.draw > entry.answer) return '伝説の絵描き';
  if (entry.answer > entry.draw) return 'かんのいいトレーナー';
  return 'バランス型トレーナー';
}

function buildRanking() {
  var list = State.order.map(function (id) {
    var sc = ensureScore(id);
    var p = playerById(id);
    return {
      id: id,
      name: playerName(id),
      remote: !!(p && p.remote),
      answer: sc.answer,
      draw: sc.draw,
      total: sc.answer + sc.draw
    };
  });
  var max = { total: 0, answer: 0, draw: 0 };
  list.forEach(function (e) {
    if (e.total > max.total) max.total = e.total;
    if (e.answer > max.answer) max.answer = e.answer;
    if (e.draw > max.draw) max.draw = e.draw;
  });
  var tie = { answer: 0, draw: 0 };
  list.forEach(function (e) {
    if (e.answer === max.answer) tie.answer++;
    if (e.draw === max.draw) tie.draw++;
  });
  list.forEach(function (e) { e.title = titleFor(e, max, tie, list.length); });
  return list;
}

/* 同点は同順位（1,1,3 …）にする */
function sortAndRank(list, key) {
  var sorted = list.slice().sort(function (a, b) {
    if (b[key] !== a[key]) return b[key] - a[key];
    return a.name.localeCompare(b.name, 'ja');
  });
  var pos = 0, prev = null;
  sorted.forEach(function (e, i) {
    if (prev === null || e[key] !== prev) { pos = i + 1; prev = e[key]; }
    e['pos_' + key] = pos;
  });
  return sorted;
}

function renderRankList(elId, list, key, unit) {
  var wrap = $id(elId);
  wrap.innerHTML = '';
  sortAndRank(list, key).forEach(function (e) {
    var row = document.createElement('div');
    row.className = 'rank-row' + (e['pos_' + key] === 1 ? ' top' : '');

    var pos = document.createElement('span');
    pos.className = 'rank-pos';
    pos.textContent = e['pos_' + key] + '位';
    row.appendChild(pos);

    var name = document.createElement('span');
    name.className = 'rank-name';
    name.textContent = e.name;
    row.appendChild(name);

    if (e.remote) {
      var badge = document.createElement('span');
      badge.className = 'rank-badge';
      badge.textContent = '\uD83D\uDCE1';
      row.appendChild(badge);
    }

    if (key === 'total') {
      var t = document.createElement('span');
      t.className = 'rank-badge';
      t.textContent = e.title;
      row.appendChild(t);
    }

    var score = document.createElement('span');
    score.className = 'rank-score';
    score.textContent = e[key] + (unit || '点');
    row.appendChild(score);

    wrap.appendChild(row);
  });
}

function renderPodium(list) {
  var wrap = $id('podium');
  wrap.innerHTML = '';
  var sorted = sortAndRank(list, 'total');
  var top = sorted.slice(0, 3);
  // 表彰台の並び：2位・1位・3位
  var layout = [
    { e: top[1], rank: 2 },
    { e: top[0], rank: 1 },
    { e: top[2], rank: 3 }
  ];
  layout.forEach(function (item) {
    if (!item.e) return;
    var col = document.createElement('div');
    col.className = 'podium-col podium-' + item.rank;
    col.innerHTML =
      '<div class="podium-crown">' + (item.rank === 1 ? '\uD83D\uDC51' : (item.rank === 2 ? '\uD83E\uDD48' : '\uD83E\uDD49')) + '</div>' +
      '<div class="podium-name"></div>' +
      '<div class="podium-title"></div>' +
      '<div class="podium-bar">' + item.e.total + '</div>';
    col.querySelector('.podium-name').textContent = item.e.name;
    col.querySelector('.podium-title').textContent = item.e.title;
    wrap.appendChild(col);
  });
}

function showResult() {
  var list = buildRanking();
  renderPodium(list);
  renderRankList('rankTotal', list, 'total', '点');
  renderRankList('rankAnswer', list, 'answer', '問');
  renderRankList('rankDraw', list, 'draw', '人');
  showScreen('s5');
  beep('fanfare');
}

/* ---------- もう一度あそぶ ---------- */
function playAgain() {
  // 同じメンバー・同じ設定で再戦（出題順は引き直す）
  State.order = shuffle(State.order.slice());
  State.round = 0;
  State.quiz = [];
  State.usedIds = [];
  State.drawing = null;
  State.answers = [];
  State.answerers = [];
  State.answerIndex = 0;
  State.scores = {};
  State.coop = { total: 0, correct: 0 };
  State.finished = false;
  State.lastRoundScore = null;
  State.order.forEach(function (id) { ensureScore(id); });
  saveState();
  runPrefetch();
}

/* =========================================================
   タイマー（お絵描き・解答）
   ========================================================= */

/* ?debug=1 のときは 5 秒に短縮してテストしやすくする */
function timerSec(kind) {
  if (DEBUG) return 5;
  return kind === 'draw' ? State.settings.drawSec : State.settings.answerSec;
}

function makeTimer(wrapId, fillId, numId, seconds, onEnd) {
  var wrap = $id(wrapId), fill = $id(fillId), num = $id(numId);
  var endAt = Date.now() + seconds * 1000;
  var lastTick = seconds;
  wrap.hidden = false;
  wrap.classList.remove('is-warn');

  function frame() {
    var left = Math.max(0, endAt - Date.now());
    var sec = Math.ceil(left / 1000);
    fill.style.width = (left / (seconds * 1000) * 100) + '%';
    num.textContent = '残り ' + sec + ' 秒';
    if (sec <= 5) wrap.classList.add('is-warn');
    if (sec !== lastTick && sec <= 5 && sec > 0) { beep('tick'); }
    lastTick = sec;
    if (left <= 0) {
      stop();
      beep('timeup');
      if (onEnd) onEnd();
      return;
    }
    handle = requestAnimationFrame(frame);
  }

  var handle = requestAnimationFrame(frame);

  function stop() {
    if (handle) cancelAnimationFrame(handle);
    handle = null;
    wrap.hidden = true;
    wrap.classList.remove('is-warn');
  }

  return { stop: stop };
}

var drawTimer = null;
var answerTimer = null;

function startDrawTimer() {
  stopDrawTimer();
  if (!State.settings.timer) { $id('drawTimerWrap').hidden = true; return; }
  drawTimer = makeTimer('drawTimerWrap', 'drawTimerFill', 'drawTimerNum',
    timerSec('draw'), function () {
      drawTimer = null;
      // 時間切れ：描けていなくてもそのままクイズへ
      State.drawing = DrawPad.toDataURL();
      saveState();
      goToQuiz();
    });
}
function stopDrawTimer() {
  if (drawTimer) { drawTimer.stop(); drawTimer = null; }
  $id('drawTimerWrap').hidden = true;
}

function startAnswerTimer() {
  stopAnswerTimer();
  if (!State.settings.timer) { $id('answerTimerWrap').hidden = true; return; }
  answerTimer = makeTimer('answerTimerWrap', 'answerTimerFill', 'answerTimerNum',
    timerSec('answer'), function () {
      answerTimer = null;
      // 時間切れ：空欄なら不正解あつかいで自動送り
      submitAnswer($id('answerInput').value || '');
    });
}
function stopAnswerTimer() {
  if (answerTimer) { answerTimer.stop(); answerTimer = null; }
  $id('answerTimerWrap').hidden = true;
}

/* =========================================================
   リロード復帰（sessionStorage）
   ========================================================= */

function screenLabel(id) {
  return { s15: 'データ読み込み', s2: 'お絵描き', s3: 'クイズ', s4: '正解発表', s5: '結果発表' }[id] || '';
}

function tryResume() {
  var saved = loadSavedState();
  if (!saved) return false;
  // 設定画面のままだった／ゲームが始まっていないなら復帰不要（設定だけ引き継ぐ）
  if (!saved.quiz || !saved.quiz.length || saved.screen === 's1') {
    if (saved.settings) State.settings = saved.settings;
    if (saved.players && saved.players.length) State.players = saved.players;
    return false;
  }
  $id('resumeNote').textContent =
    screenLabel(saved.screen) + '画面 / ' + (saved.round + 1) + '問目（全' + saved.order.length + '問）から再開できます。';
  $id('resumeDialog').hidden = false;

  $id('btnResumeYes').onclick = function () {
    $id('resumeDialog').hidden = true;
    State = saved;
    restoreScreen();
    beep('ok');
  };
  $id('btnResumeNo').onclick = function () {
    $id('resumeDialog').hidden = true;
    var keepSettings = saved.settings, keepPlayers = saved.players;
    State = newState();
    if (keepSettings) State.settings = keepSettings;
    if (keepPlayers && keepPlayers.length) State.players = keepPlayers;
    clearSavedState();
    renderRange(); renderPlayers(); renderMode(); renderTimer();
    showScreen('s1');
    beep('tap');
  };
  return true;
}

function restoreScreen() {
  renderRange(); renderPlayers(); renderMode(); renderTimer(); showOrder();

  switch (State.screen) {
    case 's2':
      showScreen('s2');
      renderDrawScreen();
      DrawPad.reset();
      startDrawTimer();
      break;
    case 's3':
      $id('quizImage').src = State.drawing || '';
      $id('quizTurnCount').textContent = (State.round + 1) + ' / ' + State.order.length + ' 問目';
      // 保存済みの解答者リストの続きから
      if (!State.answerers || !State.answerers.length) State.answerers = computeAnswerers();
      nextAnswerer();
      break;
    case 's4':
      showReveal();
      break;
    case 's5':
      showResult();
      break;
    default:
      showScreen('s1');
  }
}

/* =========================================================
   オフライン対策（図鑑データの端末保存 / Service Worker）
   ========================================================= */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Service Worker は HTTPS（または localhost）でのみ動作する
  var secure = location.protocol === 'https:' ||
               location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure) return;
  navigator.serviceWorker.register('sw.js').catch(function (err) {
    console.warn('Service Worker を登録できませんでした', err);
  });
}

/* ---------------- 初期化 ---------------- */
function initApp() {
  // デバッグナビ
  if (DEBUG) {
    var nav = $id('debugNav');
    nav.hidden = false;
    $$('#debugNav button').forEach(function (b) {
      b.addEventListener('click', function () { showScreen(b.dataset.goto); });
    });
  }

  $id('btnInterOk').addEventListener('click', hideInterstitial);

  /* ---- S1 の配線 ---- */
  $id('btnGenAll').addEventListener('click', function () {
    State.settings.gens = GEN_TABLE.map(function (g) { return g.gen; })
      .filter(function (gen) { return countForGen(gen, sourceMask()) > 0; });
    renderRange();
    beep('tap');
  });
  $id('btnGenNone').addEventListener('click', function () {
    State.settings.gens = [];
    renderRange();
    beep('tap');
  });
  $id('btnSourceAny').addEventListener('click', function () {
    State.settings.sources = [];        // 空＝おまかせ
    renderRange();
    beep('tap');
  });

  $id('btnAddPlayer').addEventListener('click', function () {
    if (State.players.length >= MAX_PLAYERS) return;
    State.players.push(makePlayer(''));
    State.order = [];
    $id('orderResult').hidden = true;
    renderPlayers();
    beep('tap');
  });

  $id('btnDice').addEventListener('click', rollDice);

  $id('btnModeVs').addEventListener('click', function () {
    State.settings.mode = 'vs'; renderMode(); beep('tap');
  });
  $id('btnModeCoop').addEventListener('click', function () {
    State.settings.mode = 'coop'; renderMode(); beep('tap');
  });

  $id('btnTimerOff').addEventListener('click', function () {
    State.settings.timer = false; renderTimer(); beep('tap');
  });
  $id('btnTimerOn').addEventListener('click', function () {
    State.settings.timer = true; renderTimer(); beep('tap');
  });
  $id('drawSec').addEventListener('input', function () {
    State.settings.drawSec = parseInt(this.value, 10);
    $id('drawSecLabel').textContent = State.settings.drawSec;
    saveState();
  });
  $id('answerSec').addEventListener('input', function () {
    State.settings.answerSec = parseInt(this.value, 10);
    $id('answerSecLabel').textContent = State.settings.answerSec;
    saveState();
  });

  $id('btnClearAsked').addEventListener('click', function () {
    var n = clearAskedIds();
    renderAskedNote();
    beep('tap');
    toast(n + ' 種の出題履歴を消しました');
  });

  $id('btnQuickStart').addEventListener('click', function () { beep('ok'); startGame(true); });
  $id('btnStartGame').addEventListener('click', function () { beep('ok'); startGame(false); });

  $id('btnDrawDone').addEventListener('click', finishDrawing);

  $id('btnRevealNext').addEventListener('click', nextRound);

  $id('btnPlayAgain').addEventListener('click', function () { beep('ok'); playAgain(); });
  $id('btnBackToSetup').addEventListener('click', function () {
    showScreen('s1');
    showOrder();
    beep('tap');
  });

  $id('btnAnswerNext').addEventListener('click', function () { submitAnswer(); });
  $id('btnAnswerSkip').addEventListener('click', function () { submitAnswer(''); });
  $id('answerInput').addEventListener('keydown', function (e) {
    // 日本語入力の変換確定 Enter で誤送信しないようにする
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submitAnswer();
  });

  if (DEBUG) judgeSelfTest();

  $id('btnLoadingCancel').addEventListener('click', function () {
    prefetchAborted = true;
    showScreen('s1');
  });

  renderRange();
  renderPlayers();
  renderMode();
  renderTimer();

  DrawPad.init();
  registerServiceWorker();

  // リロード復帰（続きがあれば確認ダイアログを出す）
  if (!tryResume()) {
    renderRange(); renderPlayers(); renderMode(); renderTimer();
    showScreen('s1');
  }
  setTopStatus();
}

/* 図鑑データ（説明文・名前・分類・タイプ）を読んでから起動する。
   出題プールの計算が図鑑データに依存するため、読み込み前に initApp を
   走らせると 0 種になってしまう。2回目以降はブラウザ／Service Worker の
   キャッシュから返るので、体感はほぼ待たない。 */
function bootFail(err) {
  console.error(err);
  var note = $id('bootNote');
  var title = $id('bootOverlay').querySelector('.boot-title');
  title.textContent = '図鑑データを読み込めませんでした';
  note.innerHTML = 'ネット接続を確認して、ページを再読み込みしてください。<br>' +
                   '<span style="opacity:.6">' + String((err && err.message) || err) + '</span>';
}

document.addEventListener('DOMContentLoaded', function () {
  var bar = $id('bootBar');
  loadDex(function (done, total) {
    bar.style.width = Math.round(done / total * 100) + '%';
  }).then(function () {
    $id('bootOverlay').classList.add('is-done');
    initApp();
  }).catch(bootFail);
});
