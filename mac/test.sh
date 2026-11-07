#!/bin/bash
# テスト（単体 + ブラウザ画面テスト）を Playwright 公式イメージのコンテナで実行する。
set -eu
# shellcheck source=mac/_common.sh
. "$(dirname "$0")/_common.sh"

prepare
info "テスト用イメージを作成します（初回は Playwright イメージの取得に数分かかります）"
compose --profile test build test
info "テストを実行します"
compose --profile test run --rm test
