#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_offline.py — 「ポケモン図鑑クイズ」オフライン版（HTML 1枚）を作る

  python3 tools/build_offline.py                # 文字のみ版（軽量・推奨）
  python3 tools/build_offline.py --with-sprites # ドット絵入り版（約6MB）

やること:
  1. PokeAPI から /pokemon-species/{1..898}/ と /type/{1..21}/ を取得（合計 919 リクエスト）
  2. 日本語名・分類・タイプ・日本語解説文だけを抜き出して JSON 化
  3. index.html / CSS / JS / JSON をすべてインライン化した 1 枚の HTML を
     dist-offline/pokemon-quiz-offline.html に出力

PokeAPI Fair Use を守るための実装:
  - 同時接続は最大 3、リクエスト間に 150ms のウェイト
  - cache/ にディスク保存し、2 回目以降は再取得しない（中断しても続きから再開できる）
  - User-Agent を明示（urllib は UA 未設定だと 403 になるため必須でもある）
  - 失敗時は指数バックオフで最大 3 回リトライ。連続失敗したら中断して報告する
  - 進捗を 123/919 の形で表示する
"""

import argparse
import base64
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------- 設定
API = "https://pokeapi.co/api/v2/"
SPRITE_URL = ("https://raw.githubusercontent.com/PokeAPI/sprites/master/"
              "sprites/pokemon/{id}.png")
UA = "pokemon-dex-quiz/1.0 (personal fan project)"

MAX_DEX_ID = 898        # 日本語の図鑑解説文が存在する上限（ソード・シールドまで）
TYPE_COUNT = 21
MAX_WORKERS = 3         # 同時接続は最大 3
REQUEST_WAIT = 0.150    # リクエスト間 150ms
MAX_RETRY = 3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, "cache")
DIST_DIR = os.path.join(ROOT, "dist-offline")

# 出典バージョンの日本語表示名（/version/ を叩かずに済ませるための対応表）
VERSION_JA = {
    "red": "赤", "green": "緑", "blue": "青", "yellow": "ピカチュウ",
    "gold": "金", "silver": "銀", "crystal": "クリスタル",
    "ruby": "ルビー", "sapphire": "サファイア", "emerald": "エメラルド",
    "firered": "ファイアレッド", "leafgreen": "リーフグリーン",
    "diamond": "ダイヤモンド", "pearl": "パール", "platinum": "プラチナ",
    "heartgold": "ハートゴールド", "soulsilver": "ソウルシルバー",
    "black": "ブラック", "white": "ホワイト",
    "black-2": "ブラック2", "white-2": "ホワイト2",
    "x": "X", "y": "Y",
    "omega-ruby": "オメガルビー", "alpha-sapphire": "アルファサファイア",
    "sun": "サン", "moon": "ムーン",
    "ultra-sun": "ウルトラサン", "ultra-moon": "ウルトラムーン",
    "lets-go-pikachu": "Let's Go! ピカチュウ", "lets-go-eevee": "Let's Go! イーブイ",
    "sword": "ソード", "shield": "シールド",
}

# ---------------------------------------------------------------- 通信
_rate_lock = threading.Lock()
_last_request = [0.0]


def _wait_turn():
    """全スレッド合わせて 150ms 間隔になるように待つ（行儀よく叩くため）"""
    with _rate_lock:
        now = time.time()
        delta = now - _last_request[0]
        if delta < REQUEST_WAIT:
            time.sleep(REQUEST_WAIT - delta)
        _last_request[0] = time.time()


def fetch_json(url):
    """指数バックオフ付きで JSON を取得する"""
    last_err = None
    for attempt in range(MAX_RETRY):
        _wait_turn()
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            # 404 は「存在しない ID」なので、リトライせず即あきらめる
            if err.code == 404:
                raise RuntimeError("存在しません: %s" % url)
            last_err = err
            if attempt < MAX_RETRY - 1:
                time.sleep(1.5 * (2 ** attempt))   # 1.5s → 3s
        except Exception as err:     # noqa: BLE001
            last_err = err
            if attempt < MAX_RETRY - 1:
                time.sleep(1.5 * (2 ** attempt))   # 1.5s → 3s
    raise RuntimeError("取得に失敗しました: %s (%s)" % (url, last_err))


def fetch_bytes(url):
    last_err = None
    for attempt in range(MAX_RETRY):
        _wait_turn()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.read()
        except Exception as err:     # noqa: BLE001
            last_err = err
            if attempt < MAX_RETRY - 1:
                time.sleep(1.5 * (2 ** attempt))
    raise RuntimeError("取得に失敗しました: %s (%s)" % (url, last_err))


# ---------------------------------------------------------------- キャッシュ
def cache_path(kind, key):
    d = os.path.join(CACHE_DIR, kind)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "%s.json" % key)


def cached_json(kind, key, url):
    """cache/ にあればそれを使う。無ければ取得して保存する。"""
    path = cache_path(kind, key)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f), True      # (data, from_cache)
        except (OSError, ValueError):
            pass
    data = fetch_json(url)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data, False


def cached_sprite(pid):
    d = os.path.join(CACHE_DIR, "sprite")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "%d.png" % pid)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    try:
        data = fetch_bytes(SPRITE_URL.format(id=pid))
    except RuntimeError:
        return None
    with open(path, "wb") as f:
        f.write(data)
    return data


# ---------------------------------------------------------------- 抽出
def pick_ja(entries, field):
    """'ja'（漢字かな交じり）を優先し、無ければ 'ja-hrkt'（かな）を使う"""
    ja = hrkt = None
    for e in entries or []:
        code = (e.get("language") or {}).get("name")
        if code == "ja" and ja is None:
            ja = e
        elif code == "ja-hrkt" and hrkt is None:
            hrkt = e
    hit = ja or hrkt
    return hit.get(field, "") if hit else ""


def trim_species(data):
    has_ja = any((e.get("language") or {}).get("name") == "ja"
                 for e in data.get("flavor_text_entries", []))
    flavors, seen = [], set()
    for e in data.get("flavor_text_entries", []):
        code = (e.get("language") or {}).get("name")
        if code not in ("ja", "ja-hrkt"):
            continue
        if has_ja and code != "ja":
            continue
        text = e.get("flavor_text") or ""
        if not text.strip():
            continue
        key = re.sub(r"\s", "", text)
        if key in seen:
            continue
        seen.add(key)
        flavors.append({"t": text, "v": (e.get("version") or {}).get("name", "")})

    evo = data.get("evolves_from_species")
    evo_id = 0
    if evo:
        m = re.search(r"/pokemon-species/(\d+)/?$", evo["url"])
        evo_id = int(m.group(1)) if m else 0

    return {
        "id": data["id"],
        "n": pick_ja(data.get("names"), "name") or data.get("name", ""),
        "g": pick_ja(data.get("genera"), "genus"),
        "e": evo_id,
        "f": flavors,
    }


# ---------------------------------------------------------------- 取得本体
def build_dataset(progress_total):
    done = [0]
    lock = threading.Lock()
    errors = []

    def tick(label):
        with lock:
            done[0] += 1
            sys.stdout.write("\r  %d/%d  %s          " % (done[0], progress_total, label))
            sys.stdout.flush()

    # ---- タイプ対応表 ----
    type_ja = {}
    types_by_id = {}
    for tid in range(1, TYPE_COUNT + 1):
        try:
            data, _ = cached_json("type", str(tid), "%stype/%d/" % (API, tid))
        except RuntimeError as err:
            errors.append(str(err))
            tick("type %d 失敗" % tid)
            continue
        slug = data["name"]
        type_ja[slug] = pick_ja(data.get("names"), "name") or slug
        for entry in data.get("pokemon", []):
            m = re.search(r"/pokemon/(\d+)/?$", entry["pokemon"]["url"])
            if not m:
                continue
            pid = int(m.group(1))
            if pid > MAX_DEX_ID:
                continue          # メガシンカ等のフォルムは除外
            types_by_id.setdefault(pid, {})[entry["slot"]] = slug
        tick("タイプ %s" % type_ja.get(slug, slug))

    # ---- 種族データ（同時接続 3） ----
    species = {}
    ids = list(range(1, MAX_DEX_ID + 1))
    queue_lock = threading.Lock()
    cursor = [0]

    def worker():
        while True:
            with queue_lock:
                if cursor[0] >= len(ids):
                    return
                i = ids[cursor[0]]
                cursor[0] += 1
            try:
                data, _ = cached_json("species", str(i),
                                      "%spokemon-species/%d/" % (API, i))
                trimmed = trim_species(data)
                with lock:
                    species[i] = trimmed
                tick("No.%d %s" % (i, trimmed["n"]))
            except RuntimeError as err:
                with lock:
                    errors.append(str(err))
                tick("No.%d 失敗" % i)

    threads = [threading.Thread(target=worker) for _ in range(MAX_WORKERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    print()

    if errors:
        print("  ⚠ %d 件の取得に失敗しました（最初の3件）:" % len(errors))
        for e in errors[:3]:
            print("    " + e)
        if len(errors) > len(ids) * 0.1:
            raise SystemExit("失敗が多すぎます。時間をおいて再実行してください（cache/ があるので続きから再開できます）。")

    # 進化前の日本語名を埋める（伏字に使う）
    for sp in species.values():
        prev = species.get(sp["e"])
        sp["e"] = prev["n"] if prev else ""

    # タイプをスロット順の配列に
    tmap = {}
    for pid, slots in types_by_id.items():
        tmap[pid] = [slots[k] for k in sorted(slots)]

    return {
        "maxId": MAX_DEX_ID,
        "typeJa": type_ja,
        "types": tmap,
        "versionJa": VERSION_JA,
        "species": species,
    }


# ---------------------------------------------------------------- HTML 生成
def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as f:
        return f.read()


def build_html(dataset, with_sprites):
    html = read("index.html")

    # CSS をインライン化
    css = "\n".join([read("css/dex.css"), read("css/screens.css")])
    html = re.sub(r'\s*<link rel="stylesheet" href="css/[^"]+">', "", html)
    html = html.replace("</head>", "<style>\n%s\n</style>\n</head>" % css)

    # JS をインライン化
    js_files = ["js/state.js", "js/dexdata.js", "js/pokeapi.js", "js/judge.js",
                "js/canvas.js", "js/sfx.js", "js/app.js"]
    js = "\n;\n".join(read(p) for p in js_files)
    html = re.sub(r'\s*<script src="js/[^"]+"></script>', "", html)

    sprites = {}
    if with_sprites:
        print("  ドット絵を取得中…")
        for i in range(1, MAX_DEX_ID + 1):
            data = cached_sprite(i)
            if data:
                sprites[i] = "data:image/png;base64," + base64.b64encode(data).decode("ascii")
            if i % 50 == 0:
                sys.stdout.write("\r    %d/%d" % (i, MAX_DEX_ID))
                sys.stdout.flush()
        print()

    payload = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    sprite_payload = json.dumps(sprites, ensure_ascii=False, separators=(",", ":"))

    # </script> がデータ内に現れても壊れないようにエスケープ
    payload = payload.replace("</", "<\\/")
    sprite_payload = sprite_payload.replace("</", "<\\/")

    offline_shim = OFFLINE_SHIM
    bundle = (
        "<script>\nwindow.OFFLINE_DATA = %s;\nwindow.OFFLINE_SPRITES = %s;\n</script>\n"
        "<script>\n%s\n</script>\n"
        "<script>\n%s\n</script>\n"
    ) % (payload, sprite_payload, js, offline_shim)

    html = html.replace("</body>", bundle + "</body>")
    return html


# オフライン版で PokeAPI 層を丸ごと差し替えるスクリプト
OFFLINE_SHIM = r"""
/* ===== オフライン版：通信をせず、埋め込み JSON だけで動かす ===== */
(function () {
  var D = window.OFFLINE_DATA;
  var S = window.OFFLINE_SPRITES || {};
  if (!D) return;

  MAX_DEX_ID = D.maxId;

  window.typesOf = function (id) {
    var slugs = D.types[id] || D.types[String(id)] || [];
    return slugs.map(function (slug) {
      return {
        slug: slug,
        ja: D.typeJa[slug] || slug,
        color: (typeof TYPE_COLOR !== 'undefined' && TYPE_COLOR[slug]) || '#888'
      };
    });
  };

  window.artworkUrl = function (id) { return S[id] || S[String(id)] || ''; };

  function speciesOf(id) {
    var raw = D.species[id] || D.species[String(id)];
    if (!raw) return null;
    return {
      id: raw.id,
      nameJa: raw.n,
      genusJa: raw.g,
      evolvesFromJa: raw.e || '',
      flavors: (raw.f || []).map(function (x) { return { text: x.t, version: x.v }; })
    };
  }

  window.prefetchQuestions = function (count, maxId, onProgress) {
    var used = [], out = [];
    var guard = 0;
    while (out.length < count && guard < count * 500) {
      guard++;
      var id = pickIds(1, maxId, used)[0];
      if (!id) break;
      used.push(id);
      var sp = speciesOf(id);
      if (!sp || !sp.flavors.length) continue;
      var q = buildQuestionText(sp);
      if (!q) continue;
      out.push({
        id: sp.id, nameJa: sp.nameJa, genusJa: sp.genusJa,
        flavorMasked: q.masked, flavorRaw: q.raw,
        version: q.version, versionJa: D.versionJa[q.version] || q.version
      });
      if (onProgress) onProgress(out.length, count);
    }
    if (onProgress) onProgress(count, count);
    return Promise.resolve(out);
  };

  // 画面に「オフライン版」と表示し、不要なオフライン対策パネルは隠す
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('dexTopTitle');
    if (el) el.textContent = 'ポケモン図鑑クイズ（オフライン版）';
    var note = document.getElementById('loadingNote');
    if (note) note.textContent = 'オフライン版です。通信は行いません。';
    var panel = document.getElementById('offlinePanel');
    if (panel) panel.hidden = true;   // データは埋め込み済みなので不要
  });
})();
"""


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="ポケモン図鑑クイズ オフライン版ビルダー")
    ap.add_argument("--with-sprites", action="store_true",
                    help="ドット絵を埋め込む（約6MB）")
    args = ap.parse_args()

    total = TYPE_COUNT + MAX_DEX_ID
    print("ポケモン図鑑クイズ — オフライン版をつくります")
    print("  取得対象: /pokemon-species/1〜%d/ と /type/1〜%d/ = 合計 %d リクエスト"
          % (MAX_DEX_ID, TYPE_COUNT, total))
    print("  同時接続 %d / リクエスト間 %dms / キャッシュ: %s"
          % (MAX_WORKERS, int(REQUEST_WAIT * 1000), CACHE_DIR))
    print("  User-Agent: %s" % UA)
    print()

    started = time.time()
    dataset = build_dataset(total)
    print("  取得完了（%.1f 分）" % ((time.time() - started) / 60))

    ok = sum(1 for sp in dataset["species"].values() if sp["f"])
    print("  日本語解説文あり: %d / %d 種" % (ok, MAX_DEX_ID))

    html = build_html(dataset, args.with_sprites)
    os.makedirs(DIST_DIR, exist_ok=True)
    out = os.path.join(DIST_DIR, "pokemon-quiz-offline.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    size = os.path.getsize(out) / 1024 / 1024
    print()
    print("  出力: %s（%.1f MB）" % (out, size))
    print("  このファイルを iPad の「ファイル」アプリに入れれば、機内モードでも遊べます。")


if __name__ == "__main__":
    main()
