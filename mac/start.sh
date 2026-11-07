#!/bin/bash
# デモ銀行ページと USD/JPY 短期要因分解ツールを Docker コンテナで起動し、ブラウザで開く。
#   使い方: ./mac/start.sh            （ポート 8080）
#           PORT=8081 ./mac/start.sh  （ポートを変える）
#           NO_OPEN=1 ./mac/start.sh  （ブラウザを開かない）
set -eu
# shellcheck source=mac/_common.sh
. "$(dirname "$0")/_common.sh"

prepare

# ポートが他のアプリに使われていないか（自分のコンテナが既に動いている場合は除く）
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if [ -z "$(compose ps -q web 2>/dev/null)" ]; then
    fail "ポート $PORT は他のアプリが使用中です。例: PORT=8081 ./mac/start.sh"
  fi
fi

info "イメージを作成してコンテナを起動します（初回は数分かかります）"
if ! compose up -d --build web; then
  warn "Docker Hub から nginx イメージを取得できなかったため、公式イメージのミラー（$MIRROR_NGINX_IMAGE）で再試行します"
  NGINX_IMAGE="$MIRROR_NGINX_IMAGE" compose up -d --build web || fail "コンテナを起動できませんでした。上のメッセージを確認してください。"
fi

info "起動を待っています: $APP_URL"
i=0
until curl -fsS -o /dev/null "$APP_URL" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then fail "30 秒以内に応答がありません。ログ: docker logs wxo-bank-web"; fi
  sleep 1
done

info "起動しました"
echo "  要因分解ツール:   $APP_URL"
echo "  デモ銀行ページ:   http://localhost:${PORT}/"
echo "  停止:             ./mac/stop.sh"
if [ -z "${NO_OPEN:-}" ] && command -v open >/dev/null 2>&1; then
  open "$APP_URL"
fi
