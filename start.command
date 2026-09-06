#!/bin/bash
# =========================================================
#  ポケモン図鑑クイズ ローカル確認用サーバー
#  このファイルをダブルクリックすると、サーバーが起動して
#  ブラウザが開きます。終わるときはこのウィンドウを閉じるか
#  Control + C を押してください。
# =========================================================

cd "$(dirname "$0")" || exit 1
PORT=8000

# ポートが埋まっていたら空いているところまでずらす
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT"

echo ""
echo "  ポケモン図鑑クイズ をローカルで開きます"
echo "  $URL"
echo ""
echo "  終わるときは Control + C を押すか、このウィンドウを閉じてください。"
echo ""

# サーバーが立ち上がってからブラウザを開く
( sleep 1; open "$URL" ) &

python3 -m http.server "$PORT" --bind 127.0.0.1
