/* =========================================================
   judge.js — 解答の正規化と正解判定

   方針（2026-09-08 にユーザーが決定・変更しないこと）
   -------------------------------------------------------
   **1文字ちがいは不正解にする。** 惜しい答えを正解にすると盛り上がらないため。
   旧版はレーベンシュタイン距離1を打ち間違いとして救済していたが、
   チゴラス↔ガチゴラス、ドククラゲ↔リククラゲ、ニドラン♀↔♂ のように
   1文字しかちがわない実在のポケモンが正解になってしまう副作用もあった。

   そのかわり「同じ名前の別の書き方」は正規化で吸収する。
     - ひらがな / カタカナ（ぴかちゅう＝ピカチュウ）
     - 全角 / 半角（ポリゴン２＝ポリゴン2、ポリゴンＺ＝ポリゴンZ）
     - 記号と空白（タイプ：ヌル＝タイプヌル）
     - 長音のゆれ（ピカチュー＝ピカチュウ、リザード＝リザアド）
     - **ローマ字**（pikachu＝ピカチュウ、husigidane＝fushigidane＝フシギダネ）
   ========================================================= */

/* 特例辞書：記号を含む名前の言い換えを吸収する */
var ALIAS = {
  'ニドランメス': 'ニドラン♀',
  'ニドランオス': 'ニドラン♂',
  'ポリゴンゼット': 'ポリゴンZ',
  'ポリゴンツー': 'ポリゴン2',
  'ポリゴン2ゴウ': 'ポリゴン2',
  'タイプヌル': 'タイプ:ヌル'
};

/* ひらがな → カタカナ */
function toKatakana(s) {
  return String(s).replace(/[ぁ-ゖ]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) + 0x60);
  });
}

/* ---------- カタカナ → ローマ字の対応表 ---------- */
/* 2文字（拗音・小書き母音）を先に引く。ここに無い文字はそのまま残す。 */
var ROMAJI2 = {
  'キャ':'kya','キュ':'kyu','キョ':'kyo','キェ':'kye',
  'シャ':'sha','シュ':'shu','ショ':'sho','シェ':'she',
  'チャ':'cha','チュ':'chu','チョ':'cho','チェ':'che',
  'ニャ':'nya','ニュ':'nyu','ニョ':'nyo','ニェ':'nye',
  'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ヒェ':'hye',
  'ミャ':'mya','ミュ':'myu','ミョ':'myo',
  'リャ':'rya','リュ':'ryu','リョ':'ryo','リェ':'rye',
  'ギャ':'gya','ギュ':'gyu','ギョ':'gyo','ギェ':'gye',
  'ジャ':'ja','ジュ':'ju','ジョ':'jo','ジェ':'je',
  'ヂャ':'ja','ヂュ':'ju','ヂョ':'jo',
  'ビャ':'bya','ビュ':'byu','ビョ':'byo',
  'ピャ':'pya','ピュ':'pyu','ピョ':'pyo',
  'ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo','フュ':'fyu',
  'ヴァ':'va','ヴィ':'vi','ヴェ':'ve','ヴォ':'vo','ヴュ':'vyu',
  'ティ':'ti','トゥ':'tu','テュ':'tyu',
  'ディ':'di','ドゥ':'du','デュ':'dyu',
  'ウィ':'wi','ウェ':'we','ウォ':'wo',
  'ツァ':'tsa','ツィ':'tsi','ツェ':'tse','ツォ':'tso',
  'クァ':'kwa','クィ':'kwi','クェ':'kwe','クォ':'kwo',
  'グァ':'gwa'
};

var ROMAJI1 = {
  'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o',
  'カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
  'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
  'タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
  'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
  'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
  'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
  'ヤ':'ya','ユ':'yu','ヨ':'yo',
  'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro',
  'ワ':'wa','ヰ':'i','ヱ':'e','ヲ':'o','ン':'n',
  'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go',
  'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
  'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do',
  'バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
  'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po',
  'ヴ':'vu',
  'ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o',
  'ャ':'ya','ュ':'yu','ョ':'yo','ヮ':'wa',
  /* 記号の名前はローマ字で打てないので読みに開く */
  '♀':'mesu', '♂':'osu'
};

/* 直前の音の母音（長音記号「ー」の展開に使う） */
var VOWEL_OF = (function () {
  var m = {};
  Object.keys(ROMAJI1).forEach(function (k) {
    var r = ROMAJI1[k];
    var last = r.charAt(r.length - 1);
    if ('aiueo'.indexOf(last) >= 0) m[k] = last.toUpperCase();
  });
  return m;
})();
/* 母音のカタカナ */
var KANA_OF_VOWEL = { A: 'ア', I: 'イ', U: 'ウ', E: 'エ', O: 'オ' };

/* 長音記号を直前の母音に開く（ピカチュー → ピカチュウ、リザード → リザアド）。
   これで「同じ名前の別の書き方」を、あいまい一致に頼らず吸収できる。 */
function expandChoon(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c !== 'ー') { out += c; continue; }
    var prev = out.charAt(out.length - 1);
    var v = VOWEL_OF[prev];
    out += v ? KANA_OF_VOWEL[v] : '';
  }
  return out;
}

/* 解答・正解の両方に同じ正規化をかける */
function normalizeAnswer(s) {
  if (s === null || s === undefined) return '';
  var t = String(s);

  // 1) 前後の空白を除去し、内部の空白もすべて削除
  t = t.trim().replace(/[\s　]/g, '');

  // 2) NFKC 正規化（全角英数・全角記号を半角へ：ポリゴン２→ポリゴン2、ポリゴンＺ→ポリゴンZ）
  if (typeof t.normalize === 'function') t = t.normalize('NFKC');

  // 3) ひらがな → カタカナ
  t = toKatakana(t);

  // 4) 長音・ダッシュ類の統一（すべて 'ー' に寄せる）
  t = t.replace(/[‐-―−－ーｰ~〜～-]/g, 'ー');

  // 5) 記号の除去（: ： ・ . 。 、 空白など）
  t = t.replace(/[:：・.。、,，'"’”`^*!！?？_]/g, '');

  // 6) 長音記号を直前の母音に開く（ピカチュー → ピカチュウ）
  t = expandChoon(t);

  // 7) 大文字に寄せる（Z / z の揺れを吸収）
  return t.toUpperCase();
}

/* 特例辞書を正規化済みキーで引けるようにする */
var ALIAS_NORM = (function () {
  var m = {};
  Object.keys(ALIAS).forEach(function (k) {
    m[normalizeAnswer(k)] = normalizeAnswer(ALIAS[k]);
  });
  return m;
})();

function applyAlias(norm) {
  return ALIAS_NORM[norm] || norm;
}

/* ---------- ローマ字 ---------- */

/* カタカナ列をローマ字に変換する（正規化ずみの文字列を渡すこと）。
   英数字はそのまま通す（ポリゴン2 → porigon2）。 */
function kanaToRomaji(s) {
  var out = '';
  var i = 0;
  while (i < s.length) {
    var two = s.substr(i, 2);
    if (ROMAJI2[two]) { out += ROMAJI2[two]; i += 2; continue; }
    var one = s.charAt(i);
    if (one === 'ッ') {
      // 促音：次の音の頭の子音を重ねる（ゲッコウガ → gekkouga）
      var rest = kanaToRomaji(s.substr(i + 1));
      var head = rest.charAt(0);
      out += (head && 'aiueo'.indexOf(head) < 0 ? head : '') + rest;
      return out;
    }
    if (ROMAJI1[one]) { out += ROMAJI1[one]; i += 1; continue; }
    out += one.toLowerCase();   // 数字・アルファベットなど
    i += 1;
  }
  return out;
}

/* ローマ字の書き方のゆれをならす（ヘボン式と訓令式のどちらで打っても同じ形にする）。
   長音はここでは触らない。 */
function romajiStrict(s) {
  var t = String(s).toLowerCase();

  // マクロン（ā ū など）は母音を重ねた形に直す
  t = t.replace(/[āâ]/g, 'aa').replace(/[īî]/g, 'ii').replace(/[ūû]/g, 'uu')
       .replace(/[ēê]/g, 'ee').replace(/[ōô]/g, 'oo');
  // 英数字以外（' - など）は落とす
  t = t.replace(/[^a-z0-9]/g, '');

  // ヘボン式 → 訓令式へ寄せる（shi=si, chi=ti, tsu=tu, ji=zi, fu=hu …）
  t = t.replace(/jy/g, 'j').replace(/cy/g, 'ty').replace(/sy/g, 'sh');
  t = t.replace(/shi/g, 'si').replace(/sh/g, 'sy');
  t = t.replace(/chi/g, 'ti').replace(/ch/g, 'ty');
  t = t.replace(/tsu/g, 'tu');
  t = t.replace(/ji/g, 'zi').replace(/j/g, 'zy');
  t = t.replace(/dzu/g, 'zu').replace(/du/g, 'zu').replace(/di/g, 'zi');
  t = t.replace(/fu/g, 'hu');

  return t;
}

/* さらに長音をまとめた形（pikachuu → pikachu、gekkouga → gekkoga）。
   「ピカチュウ を pikachu と打つ」を拾うために使うが、
   **これだけでは オタチ と オオタチ、パモット と パーモット が同じになってしまう。**
   そのため下の judgeAnswer では「他に同じ形の種がいないとき」しか採用しない。 */
function romajiLoose(s) {
  var t = romajiStrict(s);
  var before;
  do {
    before = t;
    t = t.replace(/ou/g, 'o')
         .replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/uu/g, 'u')
         .replace(/ee/g, 'e').replace(/oo/g, 'o');
  } while (t !== before);
  return t;
}

/* 正規化ずみの文字列（カタカナまたは英数字）→ 比較用のローマ字 */
function romajiKey(norm) { return romajiStrict(kanaToRomaji(norm)); }
function romajiKeyLoose(norm) { return romajiLoose(kanaToRomaji(norm)); }

/* 長音をまとめた形が、図鑑のなかで何種と一致するかの表。
   1種しかいなければ「長音の省略」を認めてよい。2種以上なら認めない。
   図鑑データを読み終えてから一度だけ作る。Dex が無い間は null（＝制限しない）。 */
var LOOSE_COUNT = null;

function looseCount() {
  if (LOOSE_COUNT) return LOOSE_COUNT;
  if (typeof Dex === 'undefined' || !Dex || !Dex.species) return null;
  var map = {};
  var n = 0;
  Object.keys(Dex.species).forEach(function (id) {
    var name = Dex.species[id] && Dex.species[id].n;
    if (!name) return;
    var k = romajiKeyLoose(applyAlias(normalizeAnswer(name)));
    map[k] = (map[k] || 0) + 1;
    n++;
  });
  if (!n) return null;
  LOOSE_COUNT = map;
  return LOOSE_COUNT;
}

/* 入力が英数字だけか（＝ローマ字入力とみなすか） */
function isRomajiInput(norm) {
  return /^[A-Z0-9]+$/.test(norm);
}

/* ---------- 判定本体 ---------- */
/* correctName は日本語名（例: 'ヒトカゲ'）。
   正規化して完全に一致したときだけ正解。**1文字でもちがえば不正解。** */
function judgeAnswer(input, correctName) {
  var a = applyAlias(normalizeAnswer(input));
  var b = applyAlias(normalizeAnswer(correctName));
  if (!a) return false;
  if (a === b) return true;

  /* ローマ字で打たれたときだけ、両方をローマ字にそろえて比べる。
     カタカナ入力にはこの経路を使わないので、カタカナの判定はゆるくならない。 */
  if (isRomajiInput(a) && !isRomajiInput(b)) {
    // まずは長音まで忠実に書いた形（ootachi / paamotto / pikachuu）
    if (romajiKey(a) === romajiKey(b)) return true;

    /* 次に長音を省いた形（pikachu）。ただし、省いた形が図鑑のなかで
       2種以上に当たる場合は認めない。オタチ／オオタチ、パモット／パーモット を
       取りちがえないため。 */
    var loose = romajiKeyLoose(b);
    if (romajiKeyLoose(a) !== loose) return false;
    var counts = looseCount();
    if (counts && counts[loose] > 1) return false;
    return true;
  }
  return false;
}

/* ---------- 自己テスト（?debug=1 のときコンソールに出す） ---------- */
function judgeSelfTest() {
  var cases = [
    /* 表記ゆれは正解にする */
    ['ぴかちゅう', 'ピカチュウ', true],
    ['ピカチュー', 'ピカチュウ', true],     // 長音のゆれ
    ['ピカチュウ ', 'ピカチュウ', true],
    ['ポリゴン２', 'ポリゴン2', true],
    ['ポリゴンＺ', 'ポリゴンZ', true],
    ['タイプヌル', 'タイプ：ヌル', true],
    ['たいぷ ぬる', 'タイプ：ヌル', true],
    ['ニドランメス', 'ニドラン♀', true],
    ['にどらんおす', 'ニドラン♂', true],
    ['リザード', 'リザアド', true],

    /* ローマ字も正解にする */
    ['pikachu', 'ピカチュウ', true],
    ['pikachuu', 'ピカチュウ', true],
    ['PIKACHU', 'ピカチュウ', true],
    ['fushigidane', 'フシギダネ', true],
    ['husigidane', 'フシギダネ', true],     // 訓令式
    ['gekkouga', 'ゲッコウガ', true],
    ['gekkoga', 'ゲッコウガ', true],
    ['rizaadon', 'リザードン', true],
    ['rizadon', 'リザードン', true],
    ['nyaasu', 'ニャース', true],
    ['nyasu', 'ニャース', true],
    ['kairyu', 'カイリュー', true],
    ['porigonz', 'ポリゴンZ', true],
    ['taipunuru', 'タイプ:ヌル', true],
    ['nidoranmesu', 'ニドラン♀', true],
    ['ootachi', 'オオタチ', true],
    ['paamotto', 'パーモット', true],
    ['pamotto', 'パモット', true],

    /* 1文字ちがいは不正解にする（ここが 2026-09-08 の仕様変更） */
    ['フシギダナ', 'フシギダネ', false],
    ['ゴンガー', 'ゲンガー', false],
    ['ガチゴラス', 'チゴラス', false],
    ['チゴラス', 'ガチゴラス', false],
    ['リククラゲ', 'ドククラゲ', false],
    ['ニドラン♂', 'ニドラン♀', false],
    ['ニドリーノ', 'ニドリーナ', false],
    /* 長音を省いたローマ字が2種に当たるときは、どちらも不正解にする
       （要 Dex。?debug=1 の起動時は図鑑データを読み終えている） */
    ['otachi', 'オオタチ', false],
    ['pamotto', 'パーモット', false],
    ['paamotto', 'パモット', false],

    /* まったくの別物・空欄 */
    ['フシギバナ', 'フシギダネ', false],
    ['ヒトカゲ', 'リザード', false],
    ['カビゴン', 'カイリュー', false],
    ['pikachu', 'ライチュウ', false],
    ['', 'ピカチュウ', false]
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
