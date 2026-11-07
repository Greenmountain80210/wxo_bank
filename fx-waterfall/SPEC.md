# USD/JPY 短期要因分解ウォーターフォール — 仕様 v2（短期トレード用）

## 目的と範囲
- USD/JPY の A 時点 → B 時点（**最短 5 分、最長 5 日**）の値動きを、円安要因・円高要因・その他要因に分解し、
  B 時点の価格を説明する滝チャートを表示する。
- 用途: ユーザーが「円安のピーク付近で USD/JPY の売りポジションを入れるか」を判断するための**材料**を示す。
- 本ツールは過去データの集計・可視化であり、将来予測や売買推奨はしない（UI に常時明記）。

## 時刻
- すべての時刻は ISO 8601・オフセット明示（`2024-11-06T00:30:00Z` / `2024-11-06T09:30:00+09:00`）。内部は epoch ms。
- 表示は既定で日本時間（Asia/Tokyo）。表示タイムゾーンは JST / UTC / ニューヨーク から選択可。
- 期間制約: `5分 <= end.time - start.time <= 5日 (432,000,000 ms)`。外れたら validateDataset がエラー、decompose は RangeError。

## 分解（加法分解・単位は円と pips。USD/JPY は 1 pip = 0.01 円）
- イベント寄与: `yen_i = post_i - pre_i`、`pips_i = yen_i * 100`
- その他要因: `residual = (end.rate - start.rate) - Σ yen_i`
- 寄与率: `pct_i = yen_i / start.rate * 100`（加法的）、イベント単体変化率 `eventPct_i = (post_i/pre_i - 1)*100`
- 方向: yen>0 → "weak"（円安）、<0 → "strong"（円高）、0 → "neutral"
- 採用条件: `start.time < event.time <= end.time`。範囲外は除外し warning。
- 同時刻かつ pre/post 同一のイベントは 1 本に統合（二重計上しない）。同時刻で pre/post が異なれば残して warning。

## 価格系列（任意だが短期分析の要）
- `series: [{ time, rate, high?, low? }]`（rate = その時点の価格／足の終値）
- CSV 取り込み `parseSeriesCsv(text, { tz })` が対応する形式:
  1. MT4 履歴: ヘッダなし `2024.11.06,13:05,151.60,151.80,151.50,151.70,1234`（日付,時刻,O,H,L,C,Vol）
  2. MT5 書き出し: タブ区切り、ヘッダ `<DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> ...`
  3. TradingView 書き出し: `time,open,high,low,close,...`（time は UNIX 秒 または ISO）
  4. 汎用: `datetime,close` / `datetime,open,high,low,close`（ISO またはオフセットなし日時）
  - オフセットなしの日時は `tz` で解釈: "UTC" | "Asia/Tokyo" | "America/New_York" | "+02:00" のような固定オフセット（MT4/MT5 のサーバー時間用）。Intl API で DST を扱う。
  - OHLC 足の時刻は**足の始値時刻**とみなし、終値の時刻 = 時刻 + 足の間隔（連続差分の最頻値）として rate に割り当てる。high/low は保持。
  - 空値・"."・0 以下・不正行はスキップ、時刻昇順、同時刻は後勝ち。
- `applySeries(events, series, { windowMinutes = 5 })`: pre = イベント時刻より厳密に前の直近観測、post = イベント時刻 + windowMinutes 以降の最初の観測。両方取れたときだけ上書き（非破壊）。`preTime`/`postTime` も記録。

## 売りエントリー判断材料 `analyze(dataset, result)`（事実の集計のみ）
- `basis`: series があれば "series"、なければ start/end/各イベントの pre/post 点から計算して "points"（粗いことを UI 表示）
- 期間高値/安値 `{rate, time}`（series の high/low があれば使う）
- `fromHighPips = (end.rate - high.rate)*100`（≤0）、`rangePositionPct = (end - low)/(high - low)*100`（high==low なら 100）
- `eventDrivenPips = Σ pips_i`、`nonEventPips = residual*100`
- 各イベント反応（series 時のみ）: 発表後〜B時点の極値（上昇イベントは最高値、下落イベントは最安値）と時刻、
  `extensionPips`（極値 - post）、`retracePct` = 極値から B 時点までに初動（極値 - pre）の何%戻したか
- モメンタム（series 時のみ）: B 時点の直前 5 / 15 / 60 分の変化 pips（データが足りなければ null）
- 次の予定イベント: `upcoming` のうち time > end.time の最初のもの、`minutesUntil`。重要度 high が 60 分以内なら警告
- 警戒ライン: `levels` の各水準と B 時点の距離 pips
- warnings / notes に「天井は事後にしか確定しない」等の限界を含める

## データ形式（`fx-waterfall/data/datasets.js`、UMD。fetch 不使用）
```js
{
  id, title, pair: "USD/JPY", description,
  start: { time, rate, source: { label, url, quote } },
  end:   { time, rate, source },
  events: [{ id, time, label, category, importance: "high"|"medium"|"low",
             pre, post, preTime?, postTime?, window, description,
             source: { label, url, quote }, confidence: "reported"|"approximate" }],
  series:   [{ time, rate, high?, low?, source? }],     // 任意
  upcoming: [{ time, label, importance, source? }],      // 任意（B 時点より後の予定）
  levels:   [{ rate, label, source? }],                  // 任意（警戒ライン）
  notes
}
```
category: 米国政治 | 米国指標 | 米金融政策 | 日本政治 | 日銀 | 介入・要人発言 | 地政学 | その他

## ファイル構成
- `fx-waterfall/index.html` / `app.js` — 日本語 UI
- `fx-waterfall/waterfall.js` — 計算（UMD, DOM 非依存）
- `fx-waterfall/chart.js` — 滝チャート + 価格推移チャート（SVG, 外部ライブラリなし）
- `fx-waterfall/data/datasets.js`, `data/SOURCES.md` — 出典付きサンプル
- `fx-waterfall/test/*.test.js` — node:test
