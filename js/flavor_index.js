/* =========================================================
   flavor_index.js — 日本語図鑑説明の「出典ソフト可否表」（自動生成・手で編集しない）

   tools/build_flavor_index.py が cache/ から生成する。
   説明文そのものは含まない。含むのは「そのソフトの説明文を持つか」の可否だけ。

   FLAVOR_INDEX は 898 文字の文字列。i 文字目が全国図鑑 No.i+1 に対応する。
   1 文字を 0〜63 に復号し、ビット位置が出典グループを表す。
   ビット順: 0:xy / 1:oras / 2:sm / 3:usum / 4:lgpe / 5:swsh
   ========================================================= */

var FLAVOR_INDEX_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';

var FLAVOR_INDEX =
  'ppppppppp///JJJJJJVVVVRR////pppppp////////pppVVJJ//////VV///////////JJJ//VVVpp////pJJRRVV/////pVVppJJ////ppxpppp/p/pp////x/x/////////////xxxx//ppp///JJ33333333333hhFFFFllllllZZhhBBBZZZll333B333ZZllFlF3Z3BBh3ZFFZlZhl3333ZZlhhlhlBBZ33l3FZZhll' +
  'll333hhh33Z33333333333ZZ33333ZZZZZZ33llZZZFF33333ZZZZZZFFZF33lhZZZ33hh3333Z33llll33l33Flll33ZZ33ZZllhhhhhhhhllFBBBZZB3lZllZZZBBBlFllllllZZZ33333Z33333333333333333ZZZZZFFFF333ZZ333ZZllBllhhFF333ZZZZlhl3ZllllllZZZZZZ3FFhZZllhZZllZ3ll3ZlZFZlZ3' +
  '33333Z3333333333333333333lllZZ333333ZZZZZ33lllZZZZZZZZZZZZZ333ZZZllllhlllZZZZZhhZZZllllllhhhhZZZZZZ33lll33lZZZZhhFZZZZZZZ333hhZZZZZZZZZZZZhhhhhhhZllllZZZZZhhZZZ33ZZ3ZZ33333333333ZZlll333BBBBB33llBZZZZZZZZZhhZZhhhhZZhhhhlhhlllllllZZZZhh33F33' +
  '3iiiiiiiiiCCCCCiiiCCCiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiCCiiiCiiiiiCCCCiiiiCCCCCCCiCi8888emmWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';

/* 全国図鑑 No.id が持つ出典グループのビットを返す（0 なら日本語説明なし） */
function flavorBitsOf(id) {
  if (id < 1 || id > FLAVOR_INDEX.length) return 0;
  var i = FLAVOR_INDEX_CHARS.indexOf(FLAVOR_INDEX.charAt(id - 1));
  return i < 0 ? 0 : i;
}
