# 出典一覧（SPEC v2）

方法: WebFetch/curl が使えないため、各数値は WebSearch の結果に表示された本文抜粋・要約のみで確認した。「引用」は検索結果に現れた文言（一部は検索ツールの要約）で、元記事全文との照合はできていない。
時刻の根拠: FXStreet の URL 末尾 12 桁は YYYYMMDDHHMM（GMT）で、記事の公開（作成）時刻。価格はその時点の大まかな水準（"near 152.00" など）なので confidence は approximate。

## usdjpy-2024-us-election（2024-11-05T14:33Z 〜 2024-11-07T19:49Z、約53時間）

| 項目 | 値 | 時刻（UTC） | 時刻の根拠 | 媒体 / URL | 引用 |
|---|---|---|---|---|---|
| start / series | 152.00 | 2024-11-05 14:33 | URL末尾 202411051433 | FXStreet https://www.fxstreet.com/news/usd-jpy-trades-flattish-near-15200-on-us-presidential-election-day-202411051433 | USD/JPY trades flattish near 152.00 on US presidential election day |
| イベント1 post / series | 153.00 | 2024-11-06 01:09 | URL末尾 202411060109（本文は後に更新されている） | FXStreet https://fxstreet.com/news/japanese-yen-slumps-to-15300-against-usd-after-initial-us-election-results-202411060109 | Japanese Yen slumps to 153.00 against USD after initial US election results |
| イベント2 post / series | 154.40 | 2024-11-06 09:57 | URL末尾 202411060957 | FXStreet https://www.fxstreet.com/news/usd-jpy-surges-to-near-15440-as-us-trump-claims-victory-over-democrats-202411060957 | refreshes a four-month high near 154.40 in European trading hours on Wednesday |
| end / series | 153.20 | 2024-11-07 19:49 | URL末尾 202411071949（FOMC声明 19:00 UTC の約49分後） | FXStreet https://www.fxstreet.com/news/usd-jpy-churns-post-fed-rate-cut-fomc-delivers-25-bps-rate-trim-202411071949 | USD/JPY swirled around 153.20（検索要約） |
| FOMC 内容（参考） | 25bp 利下げ、4.50-4.75% | 2024-11-07 19:00（予定 2:00 p.m. EST） | 連邦準備制度の公式ページ | https://www.federalreserve.gov/newsevents/pressreleases/monetary20241107a.htm | For release at 2:00 p.m. EST November 7, 2024 / lower the target range ... to 4-1/2 to 4-3/4 percent |
| upcoming: ミシガン大消費者信頼感（速報） | 73.0（予想71.0、参考） | 2024-11-08 15:00 | 記事時刻 202411081505 から、米東部10:00発表と推定（発表時刻自体を明記した出典は未確認） | FXStreet https://www.fxstreet.com/news/us-uom-consumer-confidence-index-improves-to-73-in-november-vs-71-expected-202411081505 | US UoM consumer confidence index improves to 73 in November vs 71 expected |
| level 154.40 | 154.40 | 2024-11-06 | 上記イベント2と同じ | 同上 | four-month high near 154.40 |
| level 160.245 | 160.245 | 2024-04-29 | 日付のみ | Japan Times https://japantimes.co.jp/business/2024/08/07/markets/april-yen-buying-intervention | yen hit 160.245 per dollar on April 29; 5.92 trillion yen single-day intervention on April 29, 3.87 trillion yen on May 1（検索要約） |
| level 161.76 | 161.76 | 2024-07-11 以降 | 日付のみ | Investing.com https://investing.com/news/economy-news/japan-spent-368-billion-in-july-intervention-official-data-shows-3545625 | yen shot from as low as 161.76 per dollar to as high as 157.30; spent 5.53 trillion yen（検索要約） |

### 各値の弱点
- 価格の時刻は記事公開時刻（FXStreet URL 末尾）による推定。
- イベント時刻は出典で確認した実時刻に修正した（統括による検証）:
  - 2024-11-06T00:00Z 主要州（ジョージア等）の投票締切 = 米東部 19:00（11/3 に夏時間終了、EST=UTC-5）。出典: CNN https://amp.cnn.com/cnn/2024/11/05/politics/polls-close-time-election-dg
  - 2024-11-06T07:24Z トランプ氏の勝利宣言演説の登壇 = 米東部 2:24 a.m.。出典: Adweek https://www.adweek.com/tvnewser/donald-trump-declares-victory/ （他報道は「2:30 a.m. 直前」）
  - 価格点がまばらなため、pre/post はイベント時刻から数時間離れている。寄与には同じ時間帯の他の値動きも含まれる。
- イベント1の pre（152.00）は開票の約10時間前の値で、直前値ではない。
- イベント2の区間は、AP の全国確定報道（米東部 5:31〜5:35 = 10:31〜10:35 UTC、Axios 等）より前。確定報道前後の価格は取れていない。
- FXStreet 202411060109 は本文が後に更新されており（見出しは 153.00、本文は「mid-153.00s ... 欧州時間前」）、01:09Z の値が当該時刻の価格かは不確実。
- レベル 160.245 / 161.76 は検索要約による。161.95 という数字は出典が見つからず不採用（7/3 の安値は 161.96 と別の要約にあるが未採用）。

## 見送った項目と理由
- 11/7 FOMC をイベント化: 声明（19:00 UTC）直前の USD/JPY が取れなかった（検索で「152.x」を裏付ける記事なし）。B時点の値のみ採用。
- 11/6 北米時間の 154.62（MarketPulse、前日比+2.0%）/ AP の 154.02（前日夜 151.62 から）/ Reuters の 154.43: 時刻が特定できず series に入れず。参考値。
- 11/8 の値（Investing.com 152.38、日足終値 152.63 など）: B時点より後なので使わず。時刻つきの出典でもない。
- 2つ目のデータセット（作成せず）:
  - 2024-12-18 FOMC＋12/19 日銀: 声明直前/直後の時刻つき価格が取れていない（FXStreet 202412181916「rises as Fed cuts 25 bps」は価格水準の抜粋なし）。12/19 の日銀前後値も日足レベルのみ。
  - 2024-10-04 雇用統計: 事後の 148.18（"up 160 pips since the report"）はあるが、発表直前の価格に時刻つき出典がなく（146.58 はブローカー値で時刻不明）、investinglive 当日記事の再取得もできなかった。
