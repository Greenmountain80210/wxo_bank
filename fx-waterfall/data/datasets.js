(function (root) {
  var datasets = [
    {
      id: "usdjpy-2024h2",
      title: "2024年9月〜2025年1月 ドル円",
      pair: "USD/JPY",
      description: "2024年9月中旬の140円台前半から2025年1月上旬の158円台まで。報道で確認できたイベントのみ採用。",
      start: {
        date: "2024-09-17",
        rate: 140.61,
        source: {
          label: "VT Markets（ブローカー報道値、公式終値ではない）",
          url: "https://vtmarkets.com/?p=15031",
          quote: "closing at 140.610 after hitting an intraday low of 140.320"
        }
      },
      end: {
        date: "2025-01-10",
        rate: 158.27,
        source: {
          label: "FXStreet USD/JPY remains subdued near 158.00 after reaching multi-month high",
          url: "https://www.fxstreet.com/news/usd-jpy-remains-subdued-near-15800-after-reaching-multi-month-high-202501101506",
          quote: "the pair trades at 158.27, down 0.09%"
        }
      },
      events: [
        {
          id: "ldp-ishiba-2024",
          date: "2024-09-27",
          label: "石破氏が総裁選勝利",
          category: "日本政治",
          pre: 146.49, post: 142.94,
          window: "決選投票の結果発表直前 → 発表直後（東京時間 9/27）",
          description: "高市氏優勢との観測で円売りが先行していたが、石破氏の勝利で円が急伸した。",
          source: {
            label: "Fortune/AFP Yen surges after Defense Minister Shigeru Ishiba Japan prime minister victory",
            url: "https://fortune.com/asia/2024/09/27/yen-surges-after-defense-minister-shigeru-ishiba-japan-prime-minister-victory",
            quote: "firming to 142.94 against the dollar from 146.49 yen when the head-to-head between Ishiba and Takaichi was announced"
          },
          confidence: "reported"
        },
        {
          id: "us-nfp-sep-2024",
          date: "2024-10-04",
          label: "米9月雇用統計 上振れ",
          category: "米国指標",
          pre: 146.58, post: 148.18,
          window: "発表前（約146.58、VT Markets値） → 発表後の報道時点（148.18）",
          description: "非農業部門雇用者数が+254千人（予想+140千人）と大幅に上振れ、ドル買い・円売りが進んだ。",
          source: {
            label: "investingLive US September non-farm payrolls +254K vs +140K expected",
            url: "https://investinglive.com/news/us-september-non-farm-payrolls-254k-vs-140k-expected-20241004",
            quote: "USD/JPY up 160 pips since the report to 148.18"
          },
          confidence: "approximate"
        },
        {
          id: "japan-election-2024",
          date: "2024-10-28",
          label: "衆院選 与党過半数割れ",
          category: "日本政治",
          pre: 152.3, post: 153.0,
          window: "10/25(金)終盤 → 10/28(月)早朝の窓開け直後（投開票は10/27日曜）",
          description: "自公が過半数を割り込み、日銀の利上げ遅れ観測から円売りが出た。",
          source: {
            label: "investingLive USD/JPY is above 153 on the Japanese election result - yen plunge",
            url: "https://investinglive.com/news/usdjpy-is-above-153-on-the-japanese-election-result-yen-plunge-20241027",
            quote: "USD/JPY is just above 153.00, a 70 or so point jump from its late Friday level"
          },
          confidence: "approximate"
        },
        {
          id: "us-election-2024",
          date: "2024-11-06",
          label: "米大統領選 トランプ氏勝利",
          category: "米国政治",
          pre: 151.6, post: 154.62,
          window: "11/5頃の水準（前日比+2.0%からの逆算） → 11/6 北米時間",
          description: "トランプ氏優勢が固まりドル買いが加速、ドル円は1日で約2%上昇した。",
          source: {
            label: "MarketPulse USD/JPY surges as Trump storms to victory",
            url: "https://www.marketpulse.com/news/usdjpy-surges-as-trump-storms-to-victory/",
            quote: "USD/JPY at 154.62, up a massive 2.0% on the day"
          },
          confidence: "approximate"
        },
        {
          id: "boj-hold-2024-12",
          date: "2024-12-19",
          label: "日銀据え置き 円売り加速",
          category: "日銀",
          pre: 154.67, post: 157.43,
          window: "12/19 東京始値 → 12/19 終値（前日のFOMCタカ派利下げの影響も含む）",
          description: "日銀は据え置き、植田総裁が賃金データ待ちを示し1月利上げ観測が後退して円安が進んだ。",
          source: {
            label: "三菱UFJ銀行 FXデイリー 2024/12/19",
            url: "https://www.bk.mufg.jp/report/dmr2024/FXDaily20241219.pdf",
            quote: "ドル円は154.67で寄り付いた後、会見後に157円台に到達し、高値は157.80、終値は157.43（検索結果の要約による）"
          },
          confidence: "approximate"
        }
      ],
      notes: "各値は検索結果の本文抜粋に基づく。取得時刻（東京・NY・ブローカー値）が揃っていないため厳密な終値比較ではない。採用イベントの合計が全体変動を大きく下回り、その他要因が大きいのは、9/18 FOMC（荒い値動きで単一の前後値が取れず見送り）や10月下旬〜11月の米金利上昇などが含まれるため。"
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = datasets;
  else root.FX_DATASETS = datasets;
})(this);
