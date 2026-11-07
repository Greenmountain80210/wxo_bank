#!/bin/bash
# Claude Code 入りの開発用コンテナを起動し、その中で claude を実行する。
# リポジトリは /workspace に共有されるので、Claude の変更は Mac 側のファイルにそのまま残る。
#   使い方: ./mac/claude.sh                 （対話モードで起動）
#           ./mac/claude.sh -p "質問"       （claude の引数をそのまま渡せる）
#           ./mac/claude.sh --shell         （コンテナのシェルに入る）
#           ./mac/claude.sh --rebuild       （Claude Code のバージョン等を変えた後に作り直す）
set -eu
# shellcheck source=mac/_common.sh
. "$(dirname "$0")/_common.sh"

prepare

if [ "${1:-}" = "--rebuild" ]; then
  shift
  info "開発用イメージを作り直します"
  compose --profile claude build --no-cache claude
fi

# 画面の確認用に配信コンテナも起動しておく（既に動いていれば何もしない）
if [ -z "$(compose ps -q web 2>/dev/null)" ]; then
  info "配信コンテナも起動します（$APP_URL）"
  NO_OPEN=1 "$REPO_DIR/mac/start.sh"
fi

info "Claude Code の開発用コンテナを起動します（初回は数分かかります）"
compose --profile claude up -d --build claude

if [ "${1:-}" = "--shell" ]; then
  compose --profile claude exec claude bash
  exit $?
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  info "初回はログインが必要です。表示される URL を Mac のブラウザで開き、表示されたコードを貼り付けてください（ログイン情報はボリュームに保存され、次回からは不要）"
fi
info "Claude Code を起動します（終了は /exit または Ctrl+D）"
compose --profile claude exec claude claude ${1+"$@"}
