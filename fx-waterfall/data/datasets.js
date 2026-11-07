(function (root) {
  var datasets = [
    {
      id: "usdjpy-2024-us-election",
      title: "2024年11月5〜7日 米大統領選とドル円",
      pair: "USD/JPY",
      description: "米大統領選当日(11/5 NY午前)の152円台から、11/6 開票でトランプ氏優勢→勝利宣言へ向かう過程で154円台前半まで上昇し、11/7 FOMC(利下げ)後に153円台前半で落ち着くまでの約53時間。時刻はすべて報道時刻(記事の公開時刻)から読み取った近似値を含む。",
      start: {
        time: "2024-11-05T14:33:00Z",
        rate: 152.00,
        source: {
          label: "FXStreet USD/JPY trades flattish near 152.00 on US presidential election day（時刻はURL末尾 202411051433 = 2024-11-05 14:33 GMT から推定）",
          url: "https://www.fxstreet.com/news/usd-jpy-trades-flattish-near-15200-on-us-presidential-election-day-202411051433",
          quote: "USD/JPY trades flattish near 152.00 on US presidential election day"
        }
      },
      end: {
        time: "2024-11-07T19:49:00Z",
        rate: 153.20,
        source: {
          label: "FXStreet USD/JPY churns post-Fed rate cut, FOMC delivers 25 bps rate trim（時刻はURL末尾 202411071949 = 2024-11-07 19:49 GMT から推定）",
          url: "https://www.fxstreet.com/news/usd-jpy-churns-post-fed-rate-cut-fomc-delivers-25-bps-rate-trim-202411071949",
          quote: "USD/JPY swirled around 153.20 (検索結果の要約による。FOMC声明 19:00 UTC の約49分後)"
        }
      },
      events: [
        {
          id: "us-election-early-returns",
          time: "2024-11-06T00:00:00Z",
          label: "米大統領選 主要州の投票締切・開票序盤",
          timeSource: { label: "CNN: Here's when polls close（ジョージア州等は米東部 7 p.m. 締切 = 11/6 00:00 UTC、11/3 に夏時間終了のため EST=UTC-5）", url: "https://amp.cnn.com/cnn/2024/11/05/politics/polls-close-time-election-dg" },
          category: "米国政治",
          importance: "high",
          pre: 152.00, post: 153.00,
          preTime: "2024-11-05T14:33:00Z",
          postTime: "2024-11-06T01:09:00Z",
          window: "pre = 11/5 14:33 GMT の記事値（選挙日の水準、開票前）、post = 11/6 01:09 GMT の記事値。イベント時刻 00:00Z はジョージア州など主要州の投票締切（米東部 19:00）。pre は約9.5時間前の値のため、窓には開票前の値動きも含まれる。",
          description: "開票の初期結果を受け、ドル円は153円付近まで上昇した（記事見出しは「initial US election results」後に円が153.00へ下落）。",
          source: {
            label: "FXStreet Japanese Yen slumps to 153.00 against USD after initial US election results（時刻はURL末尾 202411060109 から推定。本文は後に更新されている）",
            url: "https://fxstreet.com/news/japanese-yen-slumps-to-15300-against-usd-after-initial-us-election-results-202411060109",
            quote: "Japanese Yen slumps to 153.00 against USD after initial US election results"
          },
          confidence: "approximate"
        },
        {
          id: "trump-claims-victory",
          time: "2024-11-06T07:24:00Z",
          label: "トランプ氏が勝利宣言演説",
          timeSource: { label: "Adweek: Donald Trump declares victory（米東部 2:24 a.m. に登壇 = 11/6 07:24 UTC）", url: "https://www.adweek.com/tvnewser/donald-trump-declares-victory/" },
          category: "米国政治",
          importance: "high",
          pre: 153.00, post: 154.40,
          preTime: "2024-11-06T01:09:00Z",
          postTime: "2024-11-06T09:57:00Z",
          window: "pre = 11/6 01:09 GMT の記事値(153.00)、post = 11/6 09:57 GMT の記事値(154.40付近、欧州時間序盤)。イベント時刻 07:24Z はトランプ氏が勝利宣言演説に登壇した時刻（米東部 2:24 a.m.）。pre は約6時間前、post は約2.5時間後の値のため、窓には演説以外の値動きも含まれる。AP の全国報道の確定は米東部 5:31〜5:35 (= 10:31〜10:35 UTC)と報じられ、post 記事より後のため、この区間は「勝利が見通された段階」の反応であり単一の発表直前直後ではない。",
          description: "トランプ氏の勝利が見通される中、ドル円は約4か月ぶり高値の154.40付近へ上昇した。",
          source: {
            label: "FXStreet USD/JPY surges to near 154.40 as US Trump claims victory over Democrats（時刻はURL末尾 202411060957 から推定）",
            url: "https://www.fxstreet.com/news/usd-jpy-surges-to-near-15440-as-us-trump-claims-victory-over-democrats-202411060957",
            quote: "The USD/JPY pair refreshes a four-month high near 154.40 in European trading hours on Wednesday."
          },
          confidence: "approximate"
        }
      ],
      series: [
        {
          time: "2024-11-05T14:33:00Z", rate: 152.00,
          source: {
            label: "FXStreet（時刻はURL末尾から推定）",
            url: "https://www.fxstreet.com/news/usd-jpy-trades-flattish-near-15200-on-us-presidential-election-day-202411051433",
            quote: "USD/JPY trades flattish near 152.00 on US presidential election day"
          }
        },
        {
          time: "2024-11-06T01:09:00Z", rate: 153.00,
          source: {
            label: "FXStreet（時刻はURL末尾から推定）",
            url: "https://fxstreet.com/news/japanese-yen-slumps-to-15300-against-usd-after-initial-us-election-results-202411060109",
            quote: "Japanese Yen slumps to 153.00 against USD after initial US election results"
          }
        },
        {
          time: "2024-11-06T09:57:00Z", rate: 154.40,
          source: {
            label: "FXStreet（時刻はURL末尾から推定）",
            url: "https://www.fxstreet.com/news/usd-jpy-surges-to-near-15440-as-us-trump-claims-victory-over-democrats-202411060957",
            quote: "refreshes a four-month high near 154.40 in European trading hours on Wednesday"
          }
        },
        {
          time: "2024-11-07T19:49:00Z", rate: 153.20,
          source: {
            label: "FXStreet（時刻はURL末尾から推定）",
            url: "https://www.fxstreet.com/news/usd-jpy-churns-post-fed-rate-cut-fomc-delivers-25-bps-rate-trim-202411071949",
            quote: "USD/JPY swirled around 153.20（検索結果の要約）"
          }
        }
      ],
      upcoming: [
        {
          time: "2024-11-08T15:00:00Z",
          label: "米ミシガン大消費者信頼感指数(11月速報)",
          importance: "medium",
          source: {
            label: "FXStreet US UoM consumer confidence index improves to 73 in November vs 71 expected（記事時刻 202411081505 = 15:05 GMT。発表は米東部 10:00 = 15:00 UTC と推定）",
            url: "https://www.fxstreet.com/news/us-uom-consumer-confidence-index-improves-to-73-in-november-vs-71-expected-202411081505",
            quote: "US UoM consumer confidence index improves to 73 in November vs 71 expected"
          }
        }
      ],
      levels: [
        {
          rate: 154.40,
          label: "11/6 の約4か月ぶり高値(報道値)",
          source: {
            label: "FXStreet",
            url: "https://www.fxstreet.com/news/usd-jpy-surges-to-near-15440-as-us-trump-claims-victory-over-democrats-202411060957",
            quote: "refreshes a four-month high near 154.40"
          }
        },
        {
          rate: 160.245,
          label: "2024/4/29 円安値。政府・日銀が円買い介入(4/29 に5.92兆円、5/1 に3.87兆円)",
          source: {
            label: "Japan Times / 検索結果の要約",
            url: "https://japantimes.co.jp/business/2024/08/07/markets/april-yen-buying-intervention",
            quote: "the yen hit 160.245 per dollar on April 29 ... Japan spent a record 5.92 trillion yen on a single-day yen-buying intervention on April 29 and a further 3.87 trillion yen on May 1"
          }
        },
        {
          rate: 161.76,
          label: "2024/7/11 以降の介入前の円安水準(7月の介入額5.53兆円)",
          source: {
            label: "Investing.com / 検索結果の要約",
            url: "https://investing.com/news/economy-news/japan-spent-368-billion-in-july-intervention-official-data-shows-3545625",
            quote: "the yen shot from as low as 161.76 per dollar to as high as 157.30 ... Japanese authorities spent 5.53 trillion yen"
          }
        }
      ],
      notes: "各値は WebSearch の本文抜粋のみで確認。FXStreet の時刻は URL 末尾の YYYYMMDDHHMM(GMT) からの推定で、価格は記事公開時の大まかな水準(約)。FOMC(11/7 19:00 UTC、4.50-4.75%への25bp利下げ)は、声明直前の価格が取れなかったためイベントにせず、B時点(声明の約49分後)の値のみ使用。ゆえにその他要因(約-1.2円)には 11/6 北米時間〜11/7 の押し戻しと FOMC の影響が含まれる。個別イベントの寄与は粗く、天井・底は事後にしか確定しない。"
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = datasets;
  else root.FX_DATASETS = datasets;
})(this);
