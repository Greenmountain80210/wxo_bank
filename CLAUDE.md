# CLAUDE.md — wxo_bank

watsonx Orchestrate デモ銀行の静的ページと、USD/JPY 短期要因分解ツール（`fx-waterfall/`）のリポジトリ。

## 構成
- `README.md` — デモ銀行ページ（中身は HTML。配信時に `index.html` になる）
- `fx-waterfall/SPEC.md` — ツールの仕様（計算式・データ形式・CSV 形式）。**変更前に必ず読む**
- `fx-waterfall/waterfall.js` — 計算ロジック（UMD、DOM 非依存）
- `fx-waterfall/chart.js` — 滝チャートと価格推移チャート（SVG、外部ライブラリなし）
- `fx-waterfall/app.js`, `index.html` — 日本語 UI
- `fx-waterfall/data/datasets.js`, `SOURCES.md` — 出典付きサンプルデータ
- `fx-waterfall/test/` — 単体テスト（node:test）と画面テスト（Playwright）
- `Dockerfile`, `compose.yaml`, `docker/`, `mac/` — Mac 用コンテナ構成

## コマンド
- テスト: `npm test`（単体 + Playwright。開発コンテナ内ではそのまま動く）
- 画面確認: Mac のブラウザで http://localhost:8080/fx-waterfall/ 。開発コンテナ内からは `$PREVIEW_URL`（http://web/fx-waterfall/）か `file:///workspace/fx-waterfall/index.html` を Playwright で開く
- `fx-waterfall/` の変更は配信コンテナに即時反映（ブラウザ再読み込みのみ）

## 守ること
- **数値・時刻・出来事は出典で確認できるものだけ**。サンプルデータには出典 URL と引用を付け、推測で埋めない。根拠が弱い値は `confidence: "approximate"`
- ツールは事実の集計・可視化に徹する。「売り時」「推奨」など売買を勧める表現を UI に入れない。免責文を消さない
- A→B の期間は 5 分〜5 日（SPEC の制約）。USD/JPY は 1 pip = 0.01 円
- 外部 CDN・fetch を使わない（file:// でも動くこと）
- 変更したら `npm test` を通す。仕様を変える場合は SPEC.md とテストも合わせて更新
- コミットはしてよいが、push は Mac 側で行う（コンテナには GitHub の認証情報がない）
