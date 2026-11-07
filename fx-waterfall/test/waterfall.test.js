'use strict';
// 単体テスト（仕様 v2: 短期トレード用・時刻ベース）。実装は fx-waterfall/waterfall.js。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const FW = require('../waterfall.js');
const datasets = require('../data/datasets.js');

const EPS = 1e-6;
function close(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS, (msg || '') + ' expected ' + expected + ' got ' + actual);
}

const BASE_ISO = '2024-11-06T00:00:00Z';
const BASE_MS = Date.UTC(2024, 10, 6, 0, 0, 0);
const MIN = 60000;
// BASE から m 分後の ISO 8601（UTC, Z）
function at(m) { return new Date(BASE_MS + m * MIN).toISOString().replace('.000', ''); }
function msAt(m) { return BASE_MS + m * MIN; }

// A = BASE (150.00), B = BASE + 60分 (151.20) の合成データ
function synth(events, extra) {
  return Object.assign({
    id: 'synth',
    title: 'synthetic',
    pair: 'USD/JPY',
    start: { time: at(0), rate: 150 },
    end: { time: at(60), rate: 151.2 },
    events: events || []
  }, extra || {});
}
function ev(id, min, pre, post, extra) {
  return Object.assign({
    id: id, label: id, time: at(min), pre: pre, post: post,
    category: 'その他', importance: 'medium', window: '', description: '', confidence: 'reported'
  }, extra || {});
}
// 期間 durMs の合成データ（A = BASE）
function span(durMs) {
  return {
    id: 'span', title: 'span', pair: 'USD/JPY',
    start: { time: BASE_ISO, rate: 150 },
    end: { time: new Date(BASE_MS + durMs).toISOString().replace('.000', ''), rate: 150.1 },
    events: []
  };
}

/* ------------------------------------------------------------------ */
describe('decompose: 加法性・連続性', () => {
  // A=150.00, イベント 3 本（+0.30, -0.30, +0.70）, B=151.20
  // totalYen = 1.20, Σevents = 0.70, residual = 0.50
  function threeEvents() {
    return synth([
      ev('e1', 10, 150.00, 150.30),
      ev('e2', 20, 150.40, 150.10),
      ev('e3', 30, 150.20, 150.90)
    ]);
  }

  test('加法性: Σitems.yen + residual.yen ≈ totalYen、Σpct + residual.pct ≈ totalPct、totalPips = totalYen × 100', () => {
    const r = FW.decompose(threeEvents());
    const sumYen = r.items.reduce((s, it) => s + it.yen, 0);
    const sumPct = r.items.reduce((s, it) => s + it.pct, 0);
    close(sumYen + r.residual.yen, r.totalYen, 'yen additivity');
    close(sumPct + r.residual.pct, r.totalPct, 'pct additivity');
    close(r.totalYen, 1.2, 'totalYen');
    close(r.totalPips, r.totalYen * 100, 'totalPips = totalYen*100');
    close(r.totalPips, 120, 'totalPips value');
    close(r.totalPct, (151.2 / 150 - 1) * 100, 'totalPct');
  });

  test('pips 内訳: sumEventsPips = 70、residual.pips = 50、sumWeak = +1.00 円 / sumStrong = -0.30 円', () => {
    const r = FW.decompose(threeEvents());
    close(r.sumEventsYen, 0.7, 'sumEventsYen');
    close(r.sumEventsPips, 70, 'sumEventsPips');
    close(r.residual.yen, 0.5, 'residual.yen');
    close(r.residual.pips, 50, 'residual.pips');
    close(r.sumWeakYen, 1.0, 'sumWeakYen');
    close(r.sumStrongYen, -0.3, 'sumStrongYen');
    close(r.sumWeakPips, 100, 'sumWeakPips');
    close(r.sumStrongPips, -30, 'sumStrongPips');
    assert.equal(r.durationMs, 60 * MIN);
  });

  test('連続性: 最初の from は start.rate、各 from は前の to と一致、to − from = yen', () => {
    const r = FW.decompose(threeEvents());
    close(r.items[0].from, 150, 'first from');
    for (let i = 1; i < r.items.length; i++) close(r.items[i].from, r.items[i - 1].to, 'continuity ' + i);
    for (const it of r.items) close(it.to - it.from, it.yen, 'to-from == yen (' + it.id + ')');
    close(r.items[2].to, 150.70, 'level after events');
  });

  test('residual: from は最後のイベントの to、to は end.rate と厳密に一致', () => {
    const r = FW.decompose(threeEvents());
    close(r.residual.from, r.items[r.items.length - 1].to, 'residual.from');
    assert.equal(r.residual.to, 151.2, 'residual.to === end.rate');
    assert.equal(r.end.rate, 151.2);
    close(r.residual.to - r.residual.from, r.residual.yen, 'residual to-from == yen');
  });

  test('pct = yen / start.rate × 100、eventPct = (post/pre − 1) × 100 を手計算と比較', () => {
    const r = FW.decompose(synth([ev('a', 10, 100, 102), ev('b', 20, 105, 103)], {
      start: { time: at(0), rate: 100 }, end: { time: at(60), rate: 100 }
    }));
    const a = r.items[0], b = r.items[1];
    close(a.yen, 2, 'a.yen'); close(a.pct, 2, 'a.pct'); close(a.eventPct, 2, 'a.eventPct');
    close(b.yen, -2, 'b.yen'); close(b.pct, -2, 'b.pct');
    close(b.eventPct, (103 / 105 - 1) * 100, 'b.eventPct');
    // 実数値: A = 140.61 基準
    const r2 = FW.decompose(synth([ev('x', 10, 140.11, 142.94)], {
      start: { time: at(0), rate: 140.61 }, end: { time: at(60), rate: 150 }
    }));
    close(r2.items[0].yen, 142.94 - 140.11, 'yen real');
    close(r2.items[0].pct, (142.94 - 140.11) / 140.61 * 100, 'pct real');
    close(r2.items[0].eventPct, (142.94 / 140.11 - 1) * 100, 'eventPct real');
    close(r2.totalPct, (150 / 140.61 - 1) * 100, 'totalPct real');
  });

  test('方向: yen > 0 は weak（円安）、< 0 は strong（円高）', () => {
    const r = FW.decompose(threeEvents());
    assert.equal(r.items[0].direction, 'weak');
    assert.equal(r.items[1].direction, 'strong');
    assert.equal(r.items[2].direction, 'weak');
    assert.equal(FW.directionOf(0), 'neutral');
  });

  test('order: magnitude は |yen| 降順、既定 chronological は時刻順（残差は影響しない）', () => {
    const chrono = FW.decompose(threeEvents());
    assert.deepEqual(chrono.items.map((i) => i.id), ['e1', 'e2', 'e3']);
    const mag = FW.decompose(threeEvents(), { order: 'magnitude' });
    assert.deepEqual(mag.items.map((i) => i.id), ['e3', 'e1', 'e2']);
    // 並びを変えても合計は変わらない
    close(mag.items.reduce((s, i) => s + i.yen, 0) + mag.residual.yen, mag.totalYen, 'magnitude additivity');
  });
});

/* ------------------------------------------------------------------ */
describe('期間制約: 5 分 〜 5 日', () => {
  test('定数: MIN_DURATION_MS = 5 分、MAX_DURATION_MS = 5 日 (432,000,000 ms)', () => {
    assert.equal(FW.MIN_DURATION_MS, 5 * 60 * 1000);
    assert.equal(FW.MAX_DURATION_MS, 432000000);
  });

  test('ちょうど 5 分は OK', () => {
    const ds = span(5 * MIN);
    assert.equal(FW.validateDataset(ds).ok, true, JSON.stringify(FW.validateDataset(ds).errors));
    assert.equal(FW.decompose(ds).durationMs, 5 * MIN);
  });

  test('4 分 59 秒は RangeError、validateDataset もエラー', () => {
    const ds = span(5 * MIN - 1000);
    assert.throws(() => FW.decompose(ds), RangeError);
    const v = FW.validateDataset(ds);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((m) => m.includes('短すぎ')), v.errors.join(' | '));
  });

  test('ちょうど 5 日は OK', () => {
    const ds = span(5 * 24 * 60 * MIN);
    assert.equal(FW.validateDataset(ds).ok, true, JSON.stringify(FW.validateDataset(ds).errors));
    assert.equal(FW.decompose(ds).durationMs, 432000000);
  });

  test('5 日 + 1 分は RangeError、validateDataset もエラー', () => {
    const ds = span(5 * 24 * 60 * MIN + MIN);
    assert.throws(() => FW.decompose(ds), RangeError);
    const v = FW.validateDataset(ds);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((m) => m.includes('長すぎ')), v.errors.join(' | '));
  });

  test('B が A と同時刻・A より前は RangeError、validateDataset もエラー', () => {
    assert.throws(() => FW.decompose(span(0)), RangeError);
    assert.throws(() => FW.decompose(span(-MIN)), RangeError);
    assert.equal(FW.validateDataset(span(-MIN)).ok, false);
  });
});

/* ------------------------------------------------------------------ */
describe('イベント採用境界: start < time <= end', () => {
  // A = 0 分, B = 60 分
  const events = [
    ev('at-start', 0, 150, 150.5),   // time === start → 除外
    ev('before', -1, 150, 150.5),    // A より前 → 除外
    ev('mid', 30, 150, 150.5),       // 採用
    ev('at-end', 60, 151, 151.2),    // time === end → 採用
    ev('after', 61, 151.2, 151.4)    // B より後 → 除外
  ];

  test('time === start は除外、time === end は採用、範囲外は除外', () => {
    const r = FW.decompose(synth(events, { end: { time: at(60), rate: 151.2 } }));
    assert.deepEqual(r.items.map((i) => i.id), ['mid', 'at-end']);
    assert.equal(r.items.length, 2);
  });

  test('除外したイベントは warnings に「ラベル」付きで記録される（3 件）', () => {
    const r = FW.decompose(synth(events));
    assert.equal(r.warnings.length, 3, r.warnings.join(' | '));
    for (const id of ['at-start', 'before', 'after']) {
      assert.ok(r.warnings.some((w) => w.includes('「' + id + '」')), 'warning for ' + id);
    }
    assert.ok(!r.warnings.some((w) => w.includes('「mid」') || w.includes('「at-end」')), '採用されたものは警告しない');
  });

  test('採用されたイベントは残差計算に含まれ、加法性が保たれる', () => {
    const r = FW.decompose(synth(events));
    // mid +0.5, at-end +0.2, totalYen 1.2 → residual 0.5
    close(r.sumEventsYen, 0.7, 'sumEventsYen');
    close(r.residual.yen, 0.5, 'residual.yen');
    close(r.items.reduce((s, i) => s + i.yen, 0) + r.residual.yen, r.totalYen, 'additivity');
  });
});

/* ------------------------------------------------------------------ */
describe('同時刻のイベント', () => {
  test('同時刻かつ pre/post が同一のイベントは 1 本に統合（二重計上しない）', () => {
    const r = FW.decompose(synth([
      ev('m1', 15, 150.0, 150.5),
      ev('m2', 15, 150.0, 150.5)
    ]));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].merged, true);
    assert.deepEqual(r.items[0].mergedIds, ['m1', 'm2']);
    close(r.items[0].yen, 0.5, 'merged yen counted once');
    close(r.residual.yen, 0.7, 'residual = 1.2 − 0.5');
    assert.ok(!r.warnings.some((w) => w.includes('pre/post')), 'no conflict warning: ' + r.warnings.join(' | '));
  });

  test('同時刻で pre/post が異なる場合は両方残し、二重計上の warning を出す', () => {
    const r = FW.decompose(synth([
      ev('x1', 15, 150.0, 150.4),
      ev('x2', 15, 150.4, 150.9)
    ]));
    assert.equal(r.items.length, 2);
    assert.ok(r.warnings.some((w) => w.includes('pre/post の異なるイベント') && w.includes('二重計上')),
      r.warnings.join(' | '));
    // 連続性は崩れない
    close(r.items[1].from, r.items[0].to, 'continuity across same-time items');
    close(r.residual.to, 151.2, 'residual.to');
  });
});

/* ------------------------------------------------------------------ */
describe('parseTime', () => {
  test('Z と +09:00 の同じ瞬間は同じ ms になる', () => {
    const expected = Date.UTC(2024, 10, 6, 0, 0, 0);
    assert.equal(FW.parseTime('2024-11-06T00:00:00Z'), expected);
    assert.equal(FW.parseTime('2024-11-06T09:00:00+09:00'), expected);
    assert.equal(FW.parseTime('2024-11-06T09:00:00+0900'), expected);
    assert.equal(FW.parseTime('2024-11-05T19:00:00-05:00'), expected);
  });

  test('オフセットなし・不正な形式・非文字列は null', () => {
    assert.equal(FW.parseTime('2024-11-06T00:00:00'), null);
    assert.equal(FW.parseTime('2024-11-06 00:00'), null);
    assert.equal(FW.parseTime('2024-11-06'), null);
    assert.equal(FW.parseTime('2024-13-06T00:00:00Z'), null);
    assert.equal(FW.parseTime('not a time'), null);
    assert.equal(FW.parseTime(1730851200000), null);
    assert.equal(FW.parseTime(null), null);
    assert.equal(FW.parseTime(undefined), null);
  });
});

/* ------------------------------------------------------------------ */
describe('parseSeriesCsv / parseSeriesCsvDetailed', () => {
  const MT4 = [
    '2024.11.06,13:05,151.60,151.80,151.50,151.70,1234',
    '2024.11.06,13:06,151.70,151.90,151.65,151.85,1100',
    '2024.11.06,13:07,151.85,152.00,151.80,151.95,980'
  ].join('\n');

  test('MT4 形式: ヘッダなし、tz "+02:00" → 1 分足の終値時刻 = 始値時刻 + 1 分 = 11:06Z', () => {
    const s = FW.parseSeriesCsv(MT4, { tz: '+02:00' });
    assert.equal(s.format, 'mt4');
    assert.equal(s.ohlc, true);
    assert.equal(s.intervalMs, MIN);
    assert.equal(s.length, 3);
    // 1 行目 13:05 の足 → 終値時刻 13:06 JST(+02:00) = 11:06Z
    assert.equal(s[0].time, Date.UTC(2024, 10, 6, 11, 6), 'close time 11:06Z');
    assert.equal(s[2].time, Date.UTC(2024, 10, 6, 11, 8));
    assert.equal(s[0].rate, 151.70, 'rate = 1 行目の終値（列 5）');
    assert.equal(s[0].high, 151.80, 'high = 列 3');
    assert.equal(s[0].low, 151.50, 'low = 列 4');
    assert.equal(s[1].rate, 151.85, '2 行目の終値');
  });

  test('MT4 形式: tz 省略時は UTC 扱い（終値時刻 13:06Z）', () => {
    const s = FW.parseSeriesCsv(MT4);
    assert.equal(s[0].time, Date.UTC(2024, 10, 6, 13, 6));
  });

  test('MT5 形式: タブ区切り・<HEADER>・tz "+02:00" → 終値時刻 11:06Z', () => {
    const text = [
      '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>',
      '2024.11.06\t13:05:00\t151.60\t151.80\t151.50\t151.70\t120\t0\t20',
      '2024.11.06\t13:06:00\t151.70\t151.90\t151.65\t151.85\t110\t0\t20'
    ].join('\n');
    const s = FW.parseSeriesCsv(text, { tz: '+02:00' });
    assert.equal(s.format, 'mt5');
    assert.equal(s.intervalMs, MIN);
    assert.equal(s[0].time, Date.UTC(2024, 10, 6, 11, 6));
    assert.equal(s[0].rate, 151.70);
  });

  test('TradingView 形式: time が UNIX 秒、終値時刻 = 始値時刻 + 足の間隔', () => {
    const u0 = Date.UTC(2024, 10, 6, 11, 5) / 1000;
    const text = [
      'time,open,high,low,close,Volume',
      u0 + ',151.6,151.8,151.5,151.7,1234',
      (u0 + 60) + ',151.7,151.9,151.65,151.85,1100'
    ].join('\n');
    const s = FW.parseSeriesCsvDetailed(text);
    assert.equal(s.format, 'tradingview');
    assert.equal(s.unixTime, true);
    assert.equal(s.ohlc, true);
    assert.equal(s.series[0].time, Date.UTC(2024, 10, 6, 11, 6));
    assert.equal(s.series[1].time, Date.UTC(2024, 10, 6, 11, 7));
    assert.equal(s.series[0].rate, 151.7);
  });

  test('汎用 ISO（OHLC ヘッダ付き）: datetime,open,high,low,close', () => {
    const text = [
      'datetime,open,high,low,close',
      '2024-11-06T11:05:00Z,151.6,151.8,151.5,151.7',
      '2024-11-06T11:06:00Z,151.7,151.9,151.65,151.85'
    ].join('\n');
    const s = FW.parseSeriesCsvDetailed(text);
    assert.equal(s.format, 'generic');
    assert.equal(s.series[0].time, Date.UTC(2024, 10, 6, 11, 6));
    assert.equal(s.series[0].high, 151.8);
  });

  test('汎用 ヘッダなし 2 列（close のみ）は足の補正をせず、時刻をそのまま使う', () => {
    const s = FW.parseSeriesCsvDetailed('2024-11-06T11:05:00Z,151.70\n2024-11-06T11:10:00Z,151.90');
    assert.equal(s.format, 'generic');
    assert.equal(s.ohlc, false);
    assert.equal(s.intervalMs, null);
    assert.equal(s.series[0].time, Date.UTC(2024, 10, 6, 11, 5));
    assert.equal(s.series[1].rate, 151.90);
  });

  test('形式判別: 判別できない内容は unknown、系列は空', () => {
    const s = FW.parseSeriesCsvDetailed('foo,bar\nbaz,qux');
    assert.equal(s.format, 'unknown');
    assert.equal(s.series.length, 0);
    assert.ok(s.notes.length > 0);
  });

  test('"." と空値・0 以下・不正な時刻の行はスキップされ、件数が記録される', () => {
    const text = [
      '2024.11.06,13:05,151.60,151.80,151.50,151.70,1234',
      '2024.11.06,13:06,151.70,151.90,151.65,.,1100',      // close が "."
      '2024.11.06,13:07,151.85,152.00,151.80,,980',        // close が空
      '2024.11.06,13:08,151.85,152.00,151.80,0,980',       // close が 0
      '2024.11.06,zz:08,151.85,152.00,151.80,151.9,980',   // 時刻が不正
      '2024.11.06,13:09,151.9,152.1,151.8,151.95,1000'
    ].join('\n');
    const d = FW.parseSeriesCsvDetailed(text);
    assert.equal(d.rows, 6);
    assert.equal(d.skipped, 4);
    assert.equal(d.series.length, 2);
    assert.equal(d.series[0].rate, 151.70);
    assert.equal(d.series[1].rate, 151.95);
  });

  test('同時刻の行は後勝ち、出力は時刻昇順', () => {
    const text = [
      '2024-11-06T11:10:00Z,150.00',
      '2024-11-06T11:05:00Z,151.00',
      '2024-11-06T11:05:00Z,152.00'
    ].join('\n');
    const s = FW.parseSeriesCsv(text);
    assert.equal(s.length, 2);
    assert.equal(s[0].time, Date.UTC(2024, 10, 6, 11, 5));
    assert.equal(s[0].rate, 152.00, '同時刻は後勝ち');
    assert.equal(s[1].rate, 150.00);
  });

  test('tz "America/New_York" の夏時間・冬時間: 2024-07-01 09:30 → 13:30Z、2024-12-02 09:30 → 14:30Z', () => {
    const text = 'datetime,close\n2024-07-01 09:30,151.00\n2024-12-02 09:30,150.00';
    const s = FW.parseSeriesCsv(text, { tz: 'America/New_York' });
    assert.equal(s[0].time, Date.UTC(2024, 6, 1, 13, 30), '夏時間 EDT (UTC-4)');
    assert.equal(s[1].time, Date.UTC(2024, 11, 2, 14, 30), '冬時間 EST (UTC-5)');
    assert.equal(s.tz, 'America/New_York');
  });

  test('未知のタイムゾーンは RangeError', () => {
    assert.throws(() => FW.parseSeriesCsv('2024-11-06 00:00,1', { tz: 'Mars/Olympus_Mons' }), RangeError);
  });

  test('追加プロパティ（format 等）は列挙されず、配列の要素だけが JSON に出る', () => {
    const s = FW.parseSeriesCsv(MT4, { tz: '+02:00' });
    assert.equal(s.format, 'mt4');
    assert.deepEqual(Object.keys(s), ['0', '1', '2']);
    assert.ok(!JSON.stringify(s).includes('mt4'));
  });
});

/* ------------------------------------------------------------------ */
describe('applySeries', () => {
  // 系列: 0分=150.00, 3分=150.20, 6分=150.50, 10分=150.90, 20分=151.40, 30分=151.00
  const series = [
    { time: at(0), rate: 150.00 }, { time: at(3), rate: 150.20 }, { time: at(6), rate: 150.50 },
    { time: at(10), rate: 150.90 }, { time: at(20), rate: 151.40 }, { time: at(30), rate: 151.00 }
  ];

  test('pre = イベント時刻より厳密に前の直近、post = イベント時刻 + windowMinutes 以降の最初', () => {
    const [out] = FW.applySeries([ev('e', 5, 149.00, 149.50)], series, { windowMinutes: 5 });
    assert.equal(out.pre, 150.20, 'pre: 3分の値');
    assert.equal(out.post, 150.90, 'post: 10分の値（5分後以降の最初）');
    assert.equal(out.preTime, '2024-11-06T00:03:00Z');
    assert.equal(out.postTime, '2024-11-06T00:10:00Z');
  });

  test('windowMinutes 5 と 15 で post が変わる（15 分 → 20 分の 151.40）、1 分 → 6 分の 150.50', () => {
    const e = [ev('e', 5, 149.00, 149.50)];
    assert.equal(FW.applySeries(e, series, { windowMinutes: 5 })[0].post, 150.90);
    assert.equal(FW.applySeries(e, series, { windowMinutes: 15 })[0].post, 151.40);
    assert.equal(FW.applySeries(e, series, { windowMinutes: 15 })[0].postTime, '2024-11-06T00:20:00Z');
    assert.equal(FW.applySeries(e, series, { windowMinutes: 1 })[0].post, 150.50);
  });

  test('windowMinutes 省略時は 5 分', () => {
    const e = [ev('e', 5, 149.00, 149.50)];
    assert.equal(FW.applySeries(e, series)[0].post, 150.90);
  });

  test('片側が取れない場合は元の pre/post を両方そのまま残す', () => {
    // 0 分のイベント: A より前の観測がないため pre が取れない → 上書きしない
    const [a] = FW.applySeries([ev('pre-missing', 0, 149.00, 149.50)], series, { windowMinutes: 5 });
    assert.equal(a.pre, 149.00);
    assert.equal(a.post, 149.50, 'post が取れても pre が無いなら上書きしない');
    assert.equal(a.preTime, undefined);
    // 35 分のイベント: 窓の後の観測がない → post が取れないので上書きしない
    const [b] = FW.applySeries([ev('post-missing', 35, 150.00, 151.00)], series, { windowMinutes: 5 });
    assert.equal(b.pre, 150.00, 'pre は取れるが post が無いので上書きしない');
    assert.equal(b.post, 151.00);
  });

  test('非破壊: 元の events と各オブジェクトは変更されず、新しいオブジェクトを返す', () => {
    const events = [ev('e', 5, 149.00, 149.50)];
    const snapshot = JSON.stringify(events);
    const out = FW.applySeries(events, series, { windowMinutes: 5 });
    assert.equal(JSON.stringify(events), snapshot, 'input unchanged');
    assert.notEqual(out, events);
    assert.notEqual(out[0], events[0]);
    assert.equal(events[0].pre, 149.00);
  });

  test('系列の入力順に依存しない（逆順で渡しても同じ結果）', () => {
    const e = [ev('e', 5, 149.00, 149.50)];
    const a = FW.applySeries(e, series, { windowMinutes: 5 })[0];
    const b = FW.applySeries(e, series.slice().reverse(), { windowMinutes: 5 })[0];
    assert.equal(a.pre, b.pre);
    assert.equal(a.post, b.post);
  });
});

/* ------------------------------------------------------------------ */
describe('analyze', () => {
  // A = 0分 150.00, B = 60分 151.00
  // 系列: 0=150.00, 10=150.50, 20=151.20(高値), 30=150.80, 40=150.70, 50=150.90, 55=150.95, 60=151.00
  const series = [
    { time: at(0), rate: 150.00 }, { time: at(10), rate: 150.50 }, { time: at(20), rate: 151.20 },
    { time: at(30), rate: 150.80 }, { time: at(40), rate: 150.70 }, { time: at(50), rate: 150.90 },
    { time: at(55), rate: 150.95 }, { time: at(60), rate: 151.00 }
  ];
  // 5 分で 150.00 → 150.50（weak）。post は 10 分（系列由来の値を想定）
  const upEvent = ev('up', 5, 150.00, 150.50, { postTime: at(10), importance: 'high' });

  function base(extra) {
    return Object.assign({
      id: 'an', title: 'analyze', pair: 'USD/JPY',
      start: { time: at(0), rate: 150.00 }, end: { time: at(60), rate: 151.00 },
      events: [upEvent], series: series
    }, extra || {});
  }

  test('basis "series"、pointCount は期間内の観測点数（8 点）', () => {
    const ds = base();
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.equal(a.basis, 'series');
    assert.equal(a.pointCount, 8);
  });

  test('期間高値・安値（series 由来）と fromHighPips = −20、rangePips = 120', () => {
    const ds = base();
    const a = FW.analyze(ds, FW.decompose(ds));
    close(a.high.rate, 151.20, 'high');
    assert.equal(a.high.time, Date.parse(at(20)));
    close(a.low.rate, 150.00, 'low');
    close(a.fromHighPips, -20, 'fromHighPips');
    close(a.fromLowPips, 100, 'fromLowPips');
    close(a.rangePips, 120, 'rangePips');
  });

  test('rangePositionPct = (B − 安値) / (高値 − 安値) × 100 = 83.33…%', () => {
    const ds = base();
    const a = FW.analyze(ds, FW.decompose(ds));
    close(a.rangePositionPct, (151.00 - 150.00) / (151.20 - 150.00) * 100, 'rangePositionPct');
  });

  test('rangePositionPct: 高値 = 安値 のときは 100', () => {
    const flat = { id: 'flat', title: 'f', pair: 'USD/JPY', start: { time: at(0), rate: 150 }, end: { time: at(60), rate: 150 },
      events: [], series: [{ time: at(0), rate: 150 }, { time: at(30), rate: 150 }, { time: at(60), rate: 150 }] };
    const a = FW.analyze(flat, FW.decompose(flat));
    assert.equal(a.rangePositionPct, 100);
  });

  test('eventDrivenPips + nonEventPips = totalPips（50 + 50 = 100）', () => {
    const ds = base();
    const r = FW.decompose(ds);
    const a = FW.analyze(ds, r);
    close(a.eventDrivenPips, 50, 'eventDrivenPips');
    close(a.nonEventPips, 50, 'nonEventPips');
    close(a.eventDrivenPips + a.nonEventPips, a.totalPips, 'sum = totalPips');
    close(a.totalPips, 100, 'totalPips');
  });

  test('momentum: 直前 5 / 15 / 60 分の変化 = 5 / 30 / 100 pips', () => {
    const ds = base();
    const a = FW.analyze(ds, FW.decompose(ds));
    const m = Object.fromEntries(a.momentum.map((x) => [x.minutes, x.pips]));
    close(m[5], 5, '5分 (150.95 → 151.00)');
    close(m[15], 30, '15分 (150.70 → 151.00)');
    close(m[60], 100, '60分 (150.00 → 151.00)');
    assert.deepEqual(a.momentum.map((x) => x.minutes), [5, 15, 60]);
  });

  test('momentum: 直前の観測が窓の 2 倍より古いときは null（データ不足）', () => {
    // 系列の最後が 30 分前までしかない → 5 分窓（10 分以内の観測が必要）は null
    const ds = base({ series: series.filter((p) => Date.parse(p.time) <= msAt(30)) });
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.equal(a.momentum.find((m) => m.minutes === 5).pips, null);
    assert.ok(a.warnings.some((w) => w.includes('直近変化')), a.warnings.join(' | '));
  });

  test('reactions: 上昇イベントの極値 = 発表後〜B の最高値、手計算と一致', () => {
    const ds = base();
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.equal(a.reactions.length, 1);
    const r = a.reactions[0];
    assert.equal(r.id, 'up');
    assert.equal(r.direction, 'weak');
    close(r.initialPips, 50, 'initialPips');
    close(r.extreme.rate, 151.20, 'extreme');
    close(r.movePips, (151.20 - 150.00) * 100, 'movePips = 極値 − pre');
    close(r.extensionPips, (151.20 - 150.50) * 100, 'extensionPips = 極値 − post');
    close(r.retracePct, (151.20 - 151.00) / (151.20 - 150.00) * 100, 'retracePct（手計算 16.67%）');
    close(r.retracePips, (151.00 - 151.20) * 100, 'retracePips');
  });

  test('reactions: 円高イベントは発表後の最安値を極値とする', () => {
    const down = ev('down', 5, 151.00, 150.40, { postTime: at(10) });
    const ds = base({ events: [down] });
    const a = FW.analyze(ds, FW.decompose(ds));
    const r = a.reactions[0];
    assert.equal(r.direction, 'strong');
    // 極値は「発表直後の値(post) + 発表後の系列 + B」の最安値。post 150.40 は系列(10分以降の最安 150.50)より低いので極値は 150.40。
    // （post を除くと、円高イベントなのに「発表後の伸び」が +10 pips になり初動と矛盾する）
    close(r.extreme.rate, 150.40, 'extreme = post 150.40（系列の 150.50 より低い）');
    close(r.movePips, (150.40 - 151.00) * 100, 'movePips = 極値 − pre（負）');
    close(r.extensionPips, 0, '発表後に post より安くなっていないので伸びは 0');
  });

  test('reactions: 極値は B 時点の値も含む（B が極値のときは retracePct = 0）', () => {
    // 系列は 20 分で終わり、B（151.00 @60分）は系列に無い。B は発表後の最高値なので極値は B、戻りは 0 %
    const ev2 = ev('up2', 5, 150.00, 150.50, { postTime: at(10) });
    const s2 = [{ time: at(0), rate: 150.00 }, { time: at(10), rate: 150.50 }, { time: at(20), rate: 150.60 }];
    const ds = base({ events: [ev2], series: s2 });
    const a = FW.analyze(ds, FW.decompose(ds));
    const r = a.reactions[0];
    assert.ok(r.extreme.rate >= 151.00 - EPS, 'extreme must include B (151.00), got ' + r.extreme.rate);
    assert.ok(r.retracePips <= EPS, 'retracePips must be <= 0 for a weak event, got ' + r.retracePips);
    assert.ok(r.retracePct >= -EPS, 'retracePct must be >= 0, got ' + r.retracePct);
  });

  test('upcoming: B より後の予定のみ・時刻順。minutesUntil は分単位', () => {
    const ds = base({ upcoming: [
      { time: at(80), label: 'FOMC', importance: 'high' },
      { time: at(70), label: '指標', importance: 'medium' },
      { time: at(-30), label: '過去', importance: 'high' }
    ] });
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.deepEqual(a.upcoming.map((u) => u.label), ['指標', 'FOMC']);
    close(a.upcoming[0].minutesUntil, 10, 'minutesUntil 指標');
    close(a.upcoming[1].minutesUntil, 20, 'minutesUntil FOMC');
    assert.equal(a.nextEvent.label, '指標');
    assert.equal(a.nextHighEvent.label, 'FOMC');
  });

  test('nextEventWarning: 重要度「高」が B から 60 分以内なら true（ちょうど 60 分も含む）と警告', () => {
    const ds = base({ upcoming: [{ time: at(120), label: 'FOMC', importance: 'high' }] });
    const a = FW.analyze(ds, FW.decompose(ds));
    close(a.nextHighEvent.minutesUntil, 60, 'minutesUntil');
    assert.equal(a.nextEventWarning, true);
    assert.ok(a.warnings.some((w) => w.includes('「FOMC」')), a.warnings.join(' | '));
  });

  test('nextEventWarning: 重要度「高」が 60 分より後なら false、警告なし', () => {
    const ds = base({ upcoming: [{ time: at(150), label: 'FOMC', importance: 'high' }] });
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.equal(a.nextEventWarning, false);
    assert.ok(!a.warnings.some((w) => w.includes('重要度')), a.warnings.join(' | '));
  });

  test('nextEventWarning: 重要度「中」だけでは警告しない', () => {
    const ds = base({ upcoming: [{ time: at(70), label: '指標', importance: 'medium' }] });
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.equal(a.nextEventWarning, false);
    assert.equal(a.nextHighEvent, null);
  });

  test('levels: 距離 = (水準 − B) × 100 pips、高い順、position を付与', () => {
    const ds = base({ levels: [{ rate: 150.00, label: '下段' }, { rate: 151.50, label: '上段' }, { rate: 151.00, label: 'B と同じ' }] });
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.deepEqual(a.levels.map((l) => l.label), ['上段', 'B と同じ', '下段']);
    close(a.levels[0].distancePips, 50, '上段');
    assert.equal(a.levels[0].position, 'above');
    close(a.levels[2].distancePips, -100, '下段');
    assert.equal(a.levels[2].position, 'below');
    assert.equal(a.levels[1].distancePips, 0);
    assert.equal(a.levels[1].position, 'at');
  });

  test('series なしは basis "points"（粗い推定）、反応・モメンタムは空または null、注記あり', () => {
    const ds = base({ series: undefined });
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.equal(a.basis, 'points');
    assert.deepEqual(a.reactions, []);
    assert.ok(a.momentum.every((m) => m.pips === null));
    assert.ok(a.notes.some((n) => n.includes('価格系列がない')), a.notes.join(' | '));
    // 高値は A/B と各イベント前後の点から計算される（系列より狭い可能性）
    assert.ok(a.high.rate >= 151.00 - EPS);
  });

  test('警告・注記に「天井は事後にしか確定しない」が常に含まれる', () => {
    const ds = base();
    const a = FW.analyze(ds, FW.decompose(ds));
    assert.ok(a.notes.some((n) => n.includes('天井') && n.includes('事後')), a.notes.join(' | '));
  });
});

/* ------------------------------------------------------------------ */
describe('実データ datasets.js', () => {
  test('データセットが存在し、各データセットが validateDataset を通る', () => {
    assert.ok(Array.isArray(datasets) && datasets.length >= 1);
    for (const ds of datasets) {
      const v = FW.validateDataset(ds);
      assert.equal(v.ok, true, ds.id + ': ' + v.errors.join(' | '));
    }
  });

  test('期間が 5 分〜5 日に収まる', () => {
    for (const ds of datasets) {
      const d = Date.parse(ds.end.time) - Date.parse(ds.start.time);
      assert.ok(d >= FW.MIN_DURATION_MS && d <= FW.MAX_DURATION_MS, ds.id + ' duration ' + d);
    }
  });

  test('全 source.url / timeSource.url が https:// で始まる（出典に非 https を含まない）', () => {
    const urls = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      if (typeof node.url === 'string') urls.push(node.url);
      Object.keys(node).forEach((k) => walk(node[k]));
    })(datasets);
    assert.ok(urls.length >= 5, 'expected several source urls, got ' + urls.length);
    for (const u of urls) assert.ok(/^https:\/\//.test(u), 'not https: ' + u);
  });

  test('applySeries(events, series, {windowMinutes:5}) の pre/post がデータの pre/post と一致する', () => {
    for (const ds of datasets) {
      if (!ds.series || !ds.series.length) continue;
      const before = JSON.stringify(ds.events);
      const out = FW.applySeries(ds.events, ds.series, { windowMinutes: 5 });
      assert.equal(JSON.stringify(ds.events), before, 'データは変更されない');
      ds.events.forEach((e, i) => {
        assert.equal(out[i].pre, e.pre, ds.id + ' ' + e.id + ' pre');
        assert.equal(out[i].post, e.post, ds.id + ' ' + e.id + ' post');
        if (e.preTime) assert.equal(out[i].preTime, e.preTime, e.id + ' preTime');
        if (e.postTime) assert.equal(out[i].postTime, e.postTime, e.id + ' postTime');
      });
    }
  });

  test('実データの分解は加法性を満たし、期間外イベントの警告が出ない', () => {
    for (const ds of datasets) {
      const r = FW.decompose(ds, { tz: 'Asia/Tokyo' });
      close(r.items.reduce((s, i) => s + i.yen, 0) + r.residual.yen, r.totalYen, ds.id + ' additivity');
      assert.equal(r.residual.to, ds.end.rate);
      assert.equal(r.items.length, ds.events.length, ds.id + ' item count');
      assert.deepEqual(r.warnings, [], ds.id + ' warnings: ' + r.warnings.join(' | '));
    }
  });
});
