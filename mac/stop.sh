#!/bin/bash
# コンテナを停止して削除する（イメージは残すので次回の起動は速い）。
#   完全に消す: ./mac/stop.sh --all （イメージも削除）
set -eu
# shellcheck source=mac/_common.sh
. "$(dirname "$0")/_common.sh"

find_docker
if ! docker info >/dev/null 2>&1; then
  info "Docker エンジンが動いていないため、停止するコンテナはありません"
  exit 0
fi
find_compose

if [ "${1:-}" = "--all" ]; then
  info "コンテナとイメージを削除します"
  compose --profile test down --rmi all
else
  info "コンテナを停止します"
  compose down
fi
info "停止しました"
