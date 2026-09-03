#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_flavor_index.py — 「どのポケモンが、どのソフトの日本語図鑑説明を持つか」の
                        可否表だけを js/flavor_index.js に書き出す

  python3 tools/build_flavor_index.py

なぜ必要か:
  S1 で「第1世代のポケモンを Let's Go の説明文で出題する」のような組み合わせを
  選べるようにしたい。だが組み合わせによっては該当するポケモンが 1 匹もいない。
  実行時に PokeAPI を叩いて確かめるわけにはいかないので、可否だけを先に表にしておく。

重要:
  出力に図鑑の説明文そのものは一切含めない。含めるのは「持っているかどうか」の
  6 ビットだけ。したがって「図鑑テキストをリポジトリに含めない」方針と矛盾しない。

前提:
  cache/species/{1..898}.json が揃っていること（build_offline.py が作る）。
  揃っていなければ足りない ID を表示して終了する（このスクリプトは通信しない）。

出力形式:
  898 文字の文字列 1 本。i 文字目が全国図鑑 No.i+1 のビットを表す。
  1 文字 = 0〜63 を base64 風の 1 文字に符号化したもの。
  ビットの並びは FLAVOR_SOURCES（js/dexdata.js）と同じ順。
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache", "species")
OUT = os.path.join(ROOT, "js", "flavor_index.js")

MAX_DEX_ID = 898

# ビット順。js/dexdata.js の FLAVOR_SOURCES と必ず同じ順に保つこと。
SOURCE_GROUPS = [
    ("xy",   ["x", "y"]),
    ("oras", ["omega-ruby", "alpha-sapphire"]),
    ("sm",   ["sun", "moon"]),
    ("usum", ["ultra-sun", "ultra-moon"]),
    ("lgpe", ["lets-go-pikachu", "lets-go-eevee"]),
    ("swsh", ["sword", "shield"]),
]

# 0〜63 を 1 文字にする表（URL やソースに素直に置ける文字だけ）
CHARS = ("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
         "abcdefghijklmnopqrstuvwxyz+/")


def main():
    if not os.path.isdir(CACHE):
        sys.exit("cache/species/ がありません。先に build_offline.py を実行してください。")

    bits = {}
    missing = []
    for pid in range(1, MAX_DEX_ID + 1):
        path = os.path.join(CACHE, "%d.json" % pid)
        if not os.path.exists(path):
            missing.append(pid)
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        versions = set()
        for entry in data.get("flavor_text_entries", []):
            lang = (entry.get("language") or {}).get("name")
            if lang not in ("ja", "ja-hrkt"):
                continue
            if not (entry.get("flavor_text") or "").strip():
                continue
            versions.add((entry.get("version") or {}).get("name"))
        value = 0
        for i, (_key, names) in enumerate(SOURCE_GROUPS):
            if versions & set(names):
                value |= 1 << i
        bits[pid] = value

    if missing:
        head = ", ".join(str(x) for x in missing[:20])
        sys.exit("cache に %d 件足りません（例: %s）。build_offline.py を実行してください。"
                 % (len(missing), head))

    encoded = "".join(CHARS[bits[pid]] for pid in range(1, MAX_DEX_ID + 1))

    # 240 文字ごとに折り返して読みやすくする（連結して 1 本の文字列にする）
    width = 240
    lines = [encoded[i:i + width] for i in range(0, len(encoded), width)]
    body = " +\n  ".join("'%s'" % line for line in lines)

    order = " / ".join("%d:%s" % (i, key) for i, (key, _) in enumerate(SOURCE_GROUPS))
    js = """/* =========================================================
   flavor_index.js — 日本語図鑑説明の「出典ソフト可否表」（自動生成・手で編集しない）

   tools/build_flavor_index.py が cache/ から生成する。
   説明文そのものは含まない。含むのは「そのソフトの説明文を持つか」の可否だけ。

   FLAVOR_INDEX は %d 文字の文字列。i 文字目が全国図鑑 No.i+1 に対応する。
   1 文字を 0〜63 に復号し、ビット位置が出典グループを表す。
   ビット順: %s
   ========================================================= */

var FLAVOR_INDEX_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';

var FLAVOR_INDEX =
  %s;

/* 全国図鑑 No.id が持つ出典グループのビットを返す（0 なら日本語説明なし） */
function flavorBitsOf(id) {
  if (id < 1 || id > FLAVOR_INDEX.length) return 0;
  var i = FLAVOR_INDEX_CHARS.indexOf(FLAVOR_INDEX.charAt(id - 1));
  return i < 0 ? 0 : i;
}
""" % (MAX_DEX_ID, order, body)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)

    print("js/flavor_index.js を書き出しました（%d 種）" % MAX_DEX_ID)
    for i, (key, _names) in enumerate(SOURCE_GROUPS):
        n = sum(1 for pid in range(1, MAX_DEX_ID + 1) if bits[pid] >> i & 1)
        print("  %-5s %3d 種" % (key, n))
    none = [pid for pid in range(1, MAX_DEX_ID + 1) if bits[pid] == 0]
    print("  日本語説明なし: %d 種 %s" % (len(none), none[:10] if none else ""))


if __name__ == "__main__":
    main()
