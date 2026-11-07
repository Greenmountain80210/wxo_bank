# USD/JPY 要因分解ウォーターフォール — 仕様

## 目的
USD/JPY の A 時点 → B 時点の値動きを「円安要因」「円高要因」に分解し、B 時点の価格が
どの出来事で説明されるかを滝チャート（ウォーターフォール）で一目で示す。

## 分解手法（イベント・スタディ / 加法分解）
- 各イベント i の寄与（円）: `yen_i = post_i - pre_i`
  - `pre_i` = イベント直前のレート、`post_i` = イベント直後のレート（報道値や日次終値）
- その他要因（円）: `residual = (end.rate - start.rate) - Σ yen_i`
- 寄与率（%、A時点比・加法的）: `pct_i = yen_i / start.rate * 100`
  - Σ pct_i + residual_pct = (end.rate / start.rate - 1) * 100 が厳密に成立
- イベント単体の変化率: `eventPct_i = (post_i / pre_i - 1) * 100`
- 方向: USD/JPY 上昇 (yen_i > 0) = 「円安」、下落 (yen_i < 0) = 「円高」、0 = 「中立」
- イベントは `start.date < date <= end.date` のみ採用。範囲外は除外して warning。
- 同日に複数イベントがあり pre/post が同一なら 1 本に統合（ラベルを「A / B」で結合、二重計上しない）。
  同日で pre/post が異なる場合は残すが warning（区間重複による二重計上の可能性）。
- 限界（UI に明記）: イベント窓の値動きには同時刻の他ニュースも含まれる。因果の厳密な特定ではない。

## データ形式（`fx-waterfall/data/datasets.js`）
ブラウザで file:// でも動くよう JS で定義（fetch を使わない）。Node からも require 可能にする。
```js
(function (root) {
  var datasets = [ /* Dataset */ ];
  if (typeof module !== 'undefined' && module.exports) module.exports = datasets;
  else root.FX_DATASETS = datasets;
})(this);
```
Dataset:
```js
{
  id: "usdjpy-2024q4",                 // 一意
  title: "2024年9月〜2025年1月 ドル円",
  pair: "USD/JPY",
  description: "…",
  start: { date: "YYYY-MM-DD", rate: 140.0, source: { label: "…", url: "https://…" } },
  end:   { date: "YYYY-MM-DD", rate: 158.0, source: { label: "…", url: "https://…" } },
  events: [
    {
      id: "us-election-2024",
      date: "YYYY-MM-DD",
      label: "米大統領選 トランプ氏勝利",   // 短いラベル（チャート用、全角15文字程度まで）
      category: "米国政治",               // 米国政治 | 米国指標 | 米金融政策 | 日本政治 | 日銀 | 介入 | 地政学 | その他
      pre: 151.6, post: 154.6,
      window: "11/5 NY引け → 11/6 NY引け", // pre/post の取得タイミング
      description: "…",                   // 1〜2文の解説
      source: { label: "媒体名 記事タイトル", url: "https://…", quote: "根拠となる原文の短い引用" },
      confidence: "reported"              // reported(報道値) | approximate(概算)
    }
  ],
  notes: "データの性質・注意点"
}
```

## 価格系列 CSV（任意）
FRED DEXJPUS 形式 `observation_date,DEXJPUS`（または `DATE,VALUE`）を読み込み、
イベントの `pre` = イベント日より前の直近観測値、`post` = イベント日の観測値（イベント日に観測がなければ次の観測値）
で自動補完する。値が "." や空の行はスキップ。`event.offset`（整数, 既定 0）が 1 の場合 post を 1 観測後にずらす
（NY正午レートより後に起きたイベント用）。

## ファイル構成
- `fx-waterfall/index.html` — 画面（日本語 UI）
- `fx-waterfall/waterfall.js` — 計算ロジック（UMD: `window.FxWaterfall` / `module.exports`）。DOM 非依存。
- `fx-waterfall/chart.js` — SVG 描画（外部ライブラリなし）
- `fx-waterfall/app.js` — UI 結線
- `fx-waterfall/data/datasets.js` — サンプルデータ（調査エージェント担当）
- `fx-waterfall/data/SOURCES.md` — 出典一覧（調査エージェント担当）
- `fx-waterfall/test/*.test.js` — `node --test` 用テスト（テストエージェント担当）
- `package.json`（ルート）— `"test": "node --test fx-waterfall/test/"`、依存なし
