'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FW = require('../waterfall.js');
const datasets = require('../data/datasets.js');

const EPS = 1e-6;
function close(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS, (msg || '') + ' expected ' + expected + ' got ' + actual);
}

// 合成データ生成: A=100, B=110 の区間に任意のイベントを置く
function synth(events, extra) {
  return Object.assign({
    id: 'synth',
    title: 'synthetic',
    pair: 'USD/JPY',
    start: { date: '2024-01-01', rate: 100 },
    end: { date: '2024-01-31', rate: 110 },
    events: events
  }, extra || {});
}
function ev(id, date, pre, post, extra) {
  return Object.assign({ id: id, label: id, date: date, pre: pre, post: post, category: 'その他', window: '', description: '', confidence: 'reported' }, extra || {});
}

/* ------------------------------------------------------------------ */
describe('decompose', () => {
  test('加法性: Σyen + residual = total、Σpct + residual.pct = totalPct', () => {
    const ds = synth([
      ev('a', '2024-01-10', 100, 102),
      ev('b', '2024-01-15', 104, 101),
      ev('c', '2024-01-20', 101, 103.5)
    ]);
    const r = FW.decompose(ds);
    const sumYen = r.items.reduce((s, it) => s + it.yen, 0);
    const sumPct = r.items.reduce((s, it) => s + it.pct, 0);
    close(sumYen + r.residual.yen, r.totalYen, 'yen additivity');
    close(sumPct + r.residual.pct, r.totalPct, 'pct additivity');
    close(r.totalPct, (110 / 100 - 1) * 100, 'totalPct');
  });

  test('連続性: items の from/to が連続し、最初の from は start.rate、residual.to は end.rate', () => {
    const ds = synth([ev('a', '2024-01-10', 100, 102), ev('b', '2024-01-15', 104, 101), ev('c', '2024-01-20', 101, 103.5)]);
    const r = FW.decompose(ds);
    close(r.items[0].from, 100, 'first from');
    for (let i = 1; i < r.items.length; i++) close(r.items[i].from, r.items[i - 1].to, 'continuity ' + i);
    for (const it of r.items) close(it.to - it.from, it.yen, 'to-from == yen');
    close(r.residual.from, r.items[r.items.length - 1].to, 'residual from');
    assert.equal(r.residual.to, 110);
    assert.equal(r.end.rate, 110);
  });

  test('pct = yen / start.rate * 100、eventPct = (post/pre-1)*100 を手計算と比較', () => {
    const ds = synth([ev('a', '2024-01-10', 100, 102), ev('b', '2024-01-20', 105, 103)]);
    const r = FW.decompose(ds);
    const a = r.items[0], b = r.items[1];
    close(a.yen, 2, 'a.yen'); close(a.pct, 2, 'a.pct'); close(a.eventPct, 2, 'a.eventPct');
    close(b.yen, -2, 'b.yen'); close(b.pct, -2, 'b.pct');
    close(b.eventPct, (103 / 105 - 1) * 100, 'b.eventPct'); // -1.9047619...
    // 実数値での確認: 140.61 基準
    const ds2 = synth([ev('x', '2024-01-10', 140.61 - 0.5, 142.94)], { start: { date: '2024-01-01', rate: 140.61 }, end: { date: '2024-01-31', rate: 150 } });
    const r2 = FW.decompose(ds2);
    close(r2.items[0].yen, 142.94 - 140.11, 'yen real');
    close(r2.items[0].pct, (142.94 - 140.11) / 140.61 * 100, 'pct real');
    close(r2.items[0].eventPct, (142.94 / 140.11 - 1) * 100, 'eventPct real');
    close(r2.totalPct, (150 / 140.61 - 1) * 100, 'totalPct real');
  });

  test('期間外イベントは除外され warnings に入る。date===end.date は採用、date===start.date は除外', () => {
    const ds = synth([
      ev('before', '2023-12-31', 100, 101),
      ev('startday', '2024-01-01', 100, 101),   // start.date と同日 → 除外
      ev('mid', '2024-01-15', 100, 102),
      ev('endday', '2024-01-31', 105, 106),     // end.date と同日 → 採用
      ev('after', '2024-02-01', 106, 107)       // end 後 → 除外
    ]);
    const r = FW.decompose(ds);
    assert.deepEqual(r.items.map(i => i.id), ['mid', 'endday']);
    assert.equal(r.warnings.length, 3);
    assert.ok(r.warnings.some(w => w.includes('before')));
    assert.ok(r.warnings.some(w => w.includes('startday')));
    assert.ok(r.warnings.some(w => w.includes('after')));
  });

  test('同日・同 pre/post のイベントは 1 本に統合され二重計上しない（label "A / B"、merged true）', () => {
    const ds = synth([
      ev('a', '2024-01-10', 100, 102, { label: 'A', category: '米国指標', source: { label: 's1', url: 'https://x.example/1' } }),
      ev('b', '2024-01-10', 100, 102, { label: 'B', category: '米金融政策', source: { label: 's2', url: 'https://x.example/2' } })
    ]);
    const r = FW.decompose(ds);
    assert.equal(r.items.length, 1);
    const it = r.items[0];
    assert.equal(it.label, 'A / B');
    assert.equal(it.merged, true);
    close(it.yen, 2, 'merged yen counted once');
    close(r.sumWeakYen, 2, 'sumWeak counted once');
    close(r.residual.yen, 8, 'residual excludes double count');
    assert.equal(r.warnings.length, 0);
    assert.equal(it.sources.length, 2);
  });

  test('同日で pre/post が異なる場合は別々に残し、warning を出す', () => {
    const ds = synth([
      ev('a', '2024-01-10', 100, 102),
      ev('c', '2024-01-10', 101, 103)
    ]);
    const r = FW.decompose(ds);
    assert.equal(r.items.length, 2);
    assert.equal(r.items.every(i => i.merged === false), true);
    assert.ok(r.warnings.some(w => w.includes('2024-01-10') && w.includes('二重計上')));
    close(r.residual.yen, 6, 'residual with both kept');
  });

  test('既定は日付順（同日は入力順）、order "magnitude" は |yen| 降順', () => {
    const ds = synth([
      ev('e1', '2024-01-10', 100, 101),   // +1
      ev('e2', '2024-01-15', 104, 101),   // -3
      ev('e3', '2024-01-20', 101, 103)    // +2
    ]);
    const chrono = FW.decompose(ds);
    assert.deepEqual(chrono.items.map(i => i.id), ['e1', 'e2', 'e3']);
    assert.equal(chrono.order, 'chronological');
    const mag = FW.decompose(ds, { order: 'magnitude' });
    assert.deepEqual(mag.items.map(i => i.id), ['e2', 'e3', 'e1']);
    assert.equal(mag.order, 'magnitude');
    // 累積は並びが変わっても total は同じ
    close(mag.items[mag.items.length - 1].to + mag.residual.yen, 110, 'magnitude total');
  });

  test('start.date >= end.date で例外', () => {
    assert.throws(() => FW.decompose(synth([], { start: { date: '2024-02-01', rate: 100 }, end: { date: '2024-01-31', rate: 110 } })));
    assert.throws(() => FW.decompose(synth([], { start: { date: '2024-01-31', rate: 100 }, end: { date: '2024-01-31', rate: 110 } })));
  });

  test('sumWeakYen / sumStrongYen の値（+1, -3, +2 → weak 3, strong -3）', () => {
    const ds = synth([ev('e1', '2024-01-10', 100, 101), ev('e2', '2024-01-15', 104, 101), ev('e3', '2024-01-20', 101, 103)]);
    const r = FW.decompose(ds);
    close(r.sumWeakYen, 3, 'sumWeak');
    close(r.sumStrongYen, -3, 'sumStrong');
    close(r.sumEventsYen, 0, 'sumEvents');
    close(r.residual.yen, 10, 'residual');
  });

  test('方向: yen>0 → weak（円安）、yen<0 → strong（円高）、0 → neutral', () => {
    const ds = synth([ev('up', '2024-01-10', 100, 101), ev('down', '2024-01-15', 104, 101), ev('flat', '2024-01-20', 103, 103)]);
    const r = FW.decompose(ds);
    const dir = Object.fromEntries(r.items.map(i => [i.id, i.direction]));
    assert.equal(dir.up, 'weak');
    assert.equal(dir.down, 'strong');
    assert.equal(dir.flat, 'neutral');
    assert.equal(FW.directionOf(0), 'neutral');
    assert.equal(FW.directionOf(0.5), 'weak');
    assert.equal(FW.directionOf(-0.5), 'strong');
    assert.equal(FW.DIRECTION_LABELS.weak, '円安');
    assert.equal(FW.DIRECTION_LABELS.strong, '円高');
    assert.equal(FW.DIRECTION_LABELS.neutral, '中立');
  });

  test('isValidDate: 閏年・存在しない日付', () => {
    assert.equal(FW.isValidDate('2024-02-29'), true);
    assert.equal(FW.isValidDate('2023-02-29'), false);
    assert.equal(FW.isValidDate('2024-02-30'), false);
    assert.equal(FW.isValidDate('2024-13-01'), false);
    assert.equal(FW.isValidDate('2024/01/01'), false);
    assert.equal(FW.isValidDate(20240101), false);
  });
});

/* ------------------------------------------------------------------ */
describe('validateDataset', () => {
  test('実データ（datasets.js）の各データセットは ok', () => {
    assert.ok(datasets.length > 0);
    for (const ds of datasets) {
      const v = FW.validateDataset(ds);
      assert.equal(v.ok, true, ds.id + ': ' + v.errors.join(' | '));
      assert.deepEqual(v.errors, []);
    }
  });

  test('日付不正（2024-02-30）は errors', () => {
    const ds = synth([ev('bad', '2024-02-30', 100, 101)]);
    const v = FW.validateDataset(ds);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some(e => e.includes('2024-02-30')));
  });

  test('レートが負・0 は errors', () => {
    const v = FW.validateDataset(synth([], { start: { date: '2024-01-01', rate: -1 } }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some(e => e.includes('start.rate')));
    const v2 = FW.validateDataset(synth([ev('z', '2024-01-10', 0, 101)]));
    assert.equal(v2.ok, false);
  });

  test('id 重複は errors', () => {
    const v = FW.validateDataset(synth([ev('dup', '2024-01-10', 100, 101), ev('dup', '2024-01-11', 101, 102)]));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some(e => e.includes('重複')));
  });

  test('start.date >= end.date / events 非配列 / 空 id は errors', () => {
    assert.equal(FW.validateDataset(synth([], { start: { date: '2024-02-01', rate: 100 } })).ok, false);
    assert.equal(FW.validateDataset(synth(null)).ok, false);
    assert.equal(FW.validateDataset(synth([], { id: '' })).ok, false);
  });
});

/* ------------------------------------------------------------------ */
describe('parseSeriesCsv', () => {
  test('FRED 形式 DEXJPUS: "." と空値はスキップ、BOM/CRLF 対応、昇順ソート', () => {
    const text = '﻿observation_date,DEXJPUS\r\n2024-01-05,140.2\r\n2024-01-03,139.9\r\n2024-01-04,.\r\n2024-01-06,\r\n2024-01-08,140.8\r\n';
    assert.deepEqual(FW.parseSeriesCsv(text), [
      { date: '2024-01-03', rate: 139.9 },
      { date: '2024-01-05', rate: 140.2 },
      { date: '2024-01-08', rate: 140.8 }
    ]);
  });

  test('DATE,VALUE 形式も読める（LF 改行）', () => {
    const text = 'DATE,VALUE\n2024-01-02,141.1\n2024-01-03,.\n';
    assert.deepEqual(FW.parseSeriesCsv(text), [{ date: '2024-01-02', rate: 141.1 }]);
  });

  test('空・非文字列は空配列', () => {
    assert.deepEqual(FW.parseSeriesCsv(''), []);
    assert.deepEqual(FW.parseSeriesCsv(null), []);
  });
});

/* ------------------------------------------------------------------ */
describe('applySeries', () => {
  const series = [
    { date: '2024-01-02', rate: 100 },
    { date: '2024-01-03', rate: 101 },
    { date: '2024-01-05', rate: 103 },
    { date: '2024-01-08', rate: 104 }
  ];

  test('pre = イベント日前の直近値、post = 当日の値', () => {
    const out = FW.applySeries([{ id: 'x', date: '2024-01-05', pre: 0, post: 0 }], series);
    assert.equal(out[0].pre, 101);
    assert.equal(out[0].post, 103);
  });

  test('イベント日に観測がなければ post は次の観測値', () => {
    const out = FW.applySeries([{ id: 'x', date: '2024-01-04', pre: 0, post: 0 }], series);
    assert.equal(out[0].pre, 101);
    assert.equal(out[0].post, 103);
  });

  test('offset:1 は post を 1 観測後にずらす', () => {
    const out = FW.applySeries([{ id: 'x', date: '2024-01-05', offset: 1, pre: 0, post: 0 }], series);
    assert.equal(out[0].pre, 101);
    assert.equal(out[0].post, 104);
  });

  test('元の配列・オブジェクトを破壊しない', () => {
    const events = [{ id: 'x', date: '2024-01-05', pre: 1, post: 2, source: { label: 's', url: 'https://a.example' } }];
    const snapshot = JSON.stringify(events);
    const out = FW.applySeries(events, series);
    assert.equal(JSON.stringify(events), snapshot);
    assert.notEqual(out[0], events[0]);
    out[0].source.url = 'https://changed.example';
    assert.equal(events[0].source.url, 'https://a.example');
  });

  test('pre か post のどちらか取れないときは pre/post とも元の値のまま', () => {
    const before = FW.applySeries([{ id: 'a', date: '2024-01-01', pre: 7, post: 8 }], series); // 先行観測なし
    assert.equal(before[0].pre, 7); assert.equal(before[0].post, 8);
    const after = FW.applySeries([{ id: 'b', date: '2024-01-09', pre: 7, post: 8 }], series); // 後続観測なし
    assert.equal(after[0].pre, 7); assert.equal(after[0].post, 8);
    const off = FW.applySeries([{ id: 'c', date: '2024-01-08', offset: 1, pre: 7, post: 8 }], series); // offset で後続なし
    assert.equal(off[0].pre, 7); assert.equal(off[0].post, 8);
  });

  test('系列が空なら値は変わらない', () => {
    const out = FW.applySeries([{ id: 'x', date: '2024-01-05', pre: 1, post: 2 }], []);
    assert.equal(out[0].pre, 1); assert.equal(out[0].post, 2);
  });
});

/* ------------------------------------------------------------------ */
describe('formatYen / formatPct / formatRate', () => {
  test('formatYen: "+3.02円", "-1.25円", ゼロ "±0.00円"', () => {
    assert.equal(FW.formatYen(3.02), '+3.02円');
    assert.equal(FW.formatYen(3.0249), '+3.02円');
    assert.equal(FW.formatYen(-1.25), '-1.25円');
    assert.equal(FW.formatYen(0), '±0.00円');
    assert.equal(FW.formatYen(-0.001), '±0.00円');
  });

  test('formatPct: "+3.02%", "-1.25%", ゼロ "±0.00%"', () => {
    assert.equal(FW.formatPct(3.02), '+3.02%');
    assert.equal(FW.formatPct(-1.25), '-1.25%');
    assert.equal(FW.formatPct(0), '±0.00%');
  });

  test('formatRate: "140.61円"、非数は "—"', () => {
    assert.equal(FW.formatRate(140.61), '140.61円');
    assert.equal(FW.formatRate(NaN), '—');
  });
});

/* ------------------------------------------------------------------ */
describe('実データ（data/datasets.js）', () => {
  for (const ds of datasets) {
    test('decompose: ' + ds.id + ' は warnings なし、residual.to === end.rate、加法性が成立', () => {
      const r = FW.decompose(ds);
      assert.deepEqual(r.warnings, []);
      assert.equal(r.residual.to, ds.end.rate);
      const sumYen = r.items.reduce((s, it) => s + it.yen, 0);
      close(sumYen + r.residual.yen, r.totalYen, 'yen additivity');
      const sumPct = r.items.reduce((s, it) => s + it.pct, 0);
      close(sumPct + r.residual.pct, r.totalPct, 'pct additivity');
      close(r.totalPct, (ds.end.rate / ds.start.rate - 1) * 100, 'totalPct');
    });

    test('全イベントの source.url が https:// で始まる: ' + ds.id, () => {
      for (const e of ds.events) {
        assert.ok(e.source && typeof e.source.url === 'string', e.id + ' has source.url');
        assert.ok(e.source.url.startsWith('https://'), e.id + ' url: ' + e.source.url);
      }
    });
  }
});
