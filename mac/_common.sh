# shellcheck shell=bash
# mac/*.sh から読み込む共通処理。macOS 標準の bash 3.2 でも動くように書いている。

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8080}"
export PORT
# shellcheck disable=SC2034  # start.sh で使用
APP_URL="http://localhost:${PORT}/fx-waterfall/"
# shellcheck disable=SC2034  # start.sh で使用
MIRROR_NGINX_IMAGE="mirror.gcr.io/library/nginx:1.27-alpine"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m注意:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mエラー:\033[0m %s\n' "$*" >&2; exit 1; }

# docker コマンドを探す（Docker Desktop / OrbStack / Homebrew の場所が PATH に無い場合も拾う）
find_docker() {
  if command -v docker >/dev/null 2>&1; then return 0; fi
  for d in /Applications/Docker.app/Contents/Resources/bin "$HOME/.orbstack/bin" /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$d/docker" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  fail "docker コマンドが見つかりません。次のどれか 1 つを入れてから再実行してください:
  - Docker Desktop: https://www.docker.com/products/docker-desktop/
  - OrbStack:       https://orbstack.dev/
  - colima:         brew install colima docker docker-compose && colima start"
}

# Docker エンジンが止まっていれば起動して待つ
ensure_engine() {
  if docker info >/dev/null 2>&1; then return 0; fi
  if [ -d /Applications/OrbStack.app ]; then
    info "OrbStack を起動します"; open -a OrbStack
  elif [ -d /Applications/Docker.app ]; then
    info "Docker Desktop を起動します（初回は 1〜2 分かかります）"; open -a Docker
  elif command -v colima >/dev/null 2>&1; then
    info "colima を起動します"; colima start
  else
    fail "Docker エンジンが起動していません。Docker Desktop / OrbStack / colima のいずれかを起動してください。"
  fi
  i=0
  until docker info >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then fail "Docker エンジンが 3 分以内に起動しませんでした。アプリの画面を確認してください。"; fi
    sleep 2
  done
  info "Docker エンジンが起動しました"
}

# docker compose（v2）または docker-compose（v1）を選ぶ
find_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  else
    fail "docker compose が見つかりません。colima の場合は brew install docker-compose を実行してください。"
  fi
}

compose() {
  # shellcheck disable=SC2086
  (cd "$REPO_DIR" && $COMPOSE "$@")
}

prepare() {
  find_docker
  ensure_engine
  find_compose
}
