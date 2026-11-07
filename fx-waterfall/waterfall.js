/*
 * USD/JPY 要因分解ウォーターフォール — 計算ロジック
 * UMD: ブラウザでは window.FxWaterfall、Node では module.exports。DOM 非依存。
 * 計算式は fx-waterfall/SPEC.md に従う。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FxWaterfall = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  var DIRECTION_LABELS = { weak: '円安', strong: '円高', neutral: '中立' };

  function isFiniteNumber(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function isValidDate(s) {
    if (typeof s !== 'string') return false;
    var m = DATE_RE.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  function toNumber(v) {
    if (isFiniteNumber(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v.trim());
      if (isFinite(n)) return n;
    }
    return NaN;
  }

  function clean(x) {
    return Math.abs(x) < EPS ? 0 : x;
  }

  // 円の差分を 1e-10 円に丸め、浮動小数誤差（1.9000000000000057 など）を除く
  function roundYen(x) {
    return clean(Math.round(x * 1e10) / 1e10);
  }

  function directionOf(yen) {
    if (yen > EPS) return 'weak';
    if (yen < -EPS) return 'strong';
    return 'neutral';
  }

  function sameRate(a, b) {
    return Math.abs(a - b) < EPS;
  }

  function uniqueJoin(values, sep) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v == null || v === '') continue;
      if (out.indexOf(v) === -1) out.push(v);
    }
    return out.join(sep);
  }

  /* ------------------------------------------------------------------ */
  /* validateDataset                                                     */
  /* ------------------------------------------------------------------ */

  function validatePoint(p, name, errors) {
    if (!p || typeof p !== 'object') {
      errors.push(name + ' がありません');
      return;
    }
    if (!isValidDate(p.date)) errors.push(name + '.date が YYYY-MM-DD 形式の日付ではありません: ' + String(p.date));
    if (!isFiniteNumber(p.rate)) errors.push(name + '.rate が数値ではありません: ' + String(p.rate));
    else if (p.rate <= 0) errors.push(name + '.rate は正の数である必要があります: ' + p.rate);
  }

  function validateDataset(dataset) {
    var errors = [];
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
      return { ok: false, errors: ['データセットがオブジェクトではありません'] };
    }
    if (typeof dataset.id !== 'string' || dataset.id.trim() === '') errors.push('id がありません');
    if (typeof dataset.title !== 'string' || dataset.title.trim() === '') errors.push('title がありません');
    validatePoint(dataset.start, 'start', errors);
    validatePoint(dataset.end, 'end', errors);
    if (dataset.start && dataset.end && isValidDate(dataset.start.date) && isValidDate(dataset.end.date) &&
        !(dataset.start.date < dataset.end.date)) {
      errors.push('start.date (' + dataset.start.date + ') は end.date (' + dataset.end.date + ') より前である必要があります');
    }
    if (!Array.isArray(dataset.events)) {
      errors.push('events が配列ではありません');
    } else {
      var seen = {};
      dataset.events.forEach(function (ev, i) {
        var name = 'events[' + i + ']';
        if (!ev || typeof ev !== 'object') {
          errors.push(name + ' がオブジェクトではありません');
          return;
        }
        if (ev.id != null && ev.id !== '') {
          name += '（' + ev.id + '）';
          if (seen[ev.id]) errors.push(name + ': id が重複しています');
          seen[ev.id] = true;
        }
        if (typeof ev.label !== 'string' || ev.label.trim() === '') errors.push(name + ': label がありません');
        if (!isValidDate(ev.date)) errors.push(name + ': date が YYYY-MM-DD 形式の日付ではありません: ' + String(ev.date));
        ['pre', 'post'].forEach(function (k) {
          if (!isFiniteNumber(ev[k])) errors.push(name + ': ' + k + ' が数値ではありません: ' + String(ev[k]));
          else if (ev[k] <= 0) errors.push(name + ': ' + k + ' は正の数である必要があります: ' + ev[k]);
        });
        if (ev.offset != null && !(Number.isInteger(ev.offset) && ev.offset >= 0)) {
          errors.push(name + ': offset は 0 以上の整数である必要があります: ' + String(ev.offset));
        }
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* ------------------------------------------------------------------ */
  /* decompose                                                           */
  /* ------------------------------------------------------------------ */

  function decompose(dataset, options) {
    options = options || {};
    var order = options.order === 'magnitude' ? 'magnitude' : 'chronological';
    var warnings = [];

    if (!dataset || typeof dataset !== 'object') throw new Error('データセットがありません');
    var s = dataset.start || {}, e = dataset.end || {};
    var startRate = toNumber(s.rate), endRate = toNumber(e.rate);
    if (!isValidDate(s.date) || !isValidDate(e.date)) throw new Error('A 時点・B 時点の日付が不正です（YYYY-MM-DD）');
    if (!(startRate > 0) || !(endRate > 0)) throw new Error('A 時点・B 時点のレートが不正です');
    if (!(s.date < e.date)) throw new Error('A 時点の日付は B 時点より前である必要があります');

    var start = { date: s.date, rate: startRate, source: s.source || null };
    var end = { date: e.date, rate: endRate, source: e.source || null };

    // 1) 採用するイベントを選ぶ
    var accepted = [];
    var events = Array.isArray(dataset.events) ? dataset.events : [];
    events.forEach(function (ev, idx) {
      if (!ev || typeof ev !== 'object') return;
      var name = ev.label || ev.id || ('#' + (idx + 1));
      if (!isValidDate(ev.date)) {
        warnings.push('「' + name + '」は日付が不正なため除外しました');
        return;
      }
      var pre = toNumber(ev.pre), post = toNumber(ev.post);
      if (!(pre > 0) || !(post > 0)) {
        warnings.push('「' + name + '」は pre/post が数値でないため除外しました');
        return;
      }
      if (!(ev.date > start.date && ev.date <= end.date)) {
        warnings.push('「' + name + '」（' + ev.date + '）は期間 ' + start.date + ' 〜 ' + end.date + ' の範囲外のため除外しました');
        return;
      }
      accepted.push({ ev: ev, idx: idx, pre: pre, post: post });
    });

    // 2) 同日イベントの統合（pre/post が同一なら 1 本に）
    var groups = [];
    accepted.forEach(function (a) {
      for (var g = 0; g < groups.length; g++) {
        var head = groups[g][0];
        if (head.ev.date === a.ev.date && sameRate(head.pre, a.pre) && sameRate(head.post, a.post)) {
          groups[g].push(a);
          return;
        }
      }
      groups.push([a]);
    });

    // 同日で pre/post が異なるもの
    var byDate = {};
    groups.forEach(function (g) {
      var d = g[0].ev.date;
      (byDate[d] = byDate[d] || []).push(g);
    });
    Object.keys(byDate).sort().forEach(function (d) {
      if (byDate[d].length > 1) {
        var names = byDate[d].map(function (g) {
          return g.map(function (a) { return a.ev.label || a.ev.id; }).join(' / ');
        });
        warnings.push(d + ' に pre/post の異なるイベントが複数あります（' + names.join('、') +
          '）。値動きの区間が重なっていると二重計上の可能性があります');
      }
    });

    var items = groups.map(function (g) {
      var first = g[0];
      var pre = first.pre, post = first.post;
      var yen = roundYen(post - pre);
      var merged = g.length > 1;
      var evs = g.map(function (a) { return a.ev; });
      var sources = evs.map(function (x) { return x.source || null; }).filter(Boolean);
      return {
        id: evs.map(function (x, i) { return x.id || ('event-' + g[i].idx); }).join('+'),
        label: evs.map(function (x) { return x.label || x.id || ''; }).join(' / '),
        date: first.ev.date,
        category: uniqueJoin(evs.map(function (x) { return x.category; }), ' / ') || 'その他',
        pre: pre,
        post: post,
        yen: yen,
        pct: clean(yen / start.rate * 100),
        eventPct: clean((post / pre - 1) * 100),
        direction: directionOf(yen),
        from: 0,
        to: 0,
        merged: merged,
        mergedIds: merged ? evs.map(function (x) { return x.id; }) : undefined,
        source: sources[0] || null,
        sources: sources,
        window: uniqueJoin(evs.map(function (x) { return x.window; }), ' / ') || '',
        confidence: evs.every(function (x) { return x.confidence === 'reported'; }) ? 'reported'
          : (uniqueJoin(evs.map(function (x) { return x.confidence; }), ' / ') || 'approximate'),
        description: uniqueJoin(evs.map(function (x) { return x.description; }), ' ／ '),
        _idx: first.idx
      };
    });

    // 3) 並び順
    items.sort(function (a, b) {
      if (order === 'magnitude') {
        var d = Math.abs(b.yen) - Math.abs(a.yen);
        if (Math.abs(d) > EPS) return d;
      }
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a._idx - b._idx;
    });

    // 4) 累積レベル
    var level = start.rate;
    var sumEvents = 0, sumWeak = 0, sumStrong = 0;
    items.forEach(function (it) {
      it.from = level;
      level = level + it.yen;
      it.to = level;
      sumEvents += it.yen;
      if (it.yen > 0) sumWeak += it.yen;
      else if (it.yen < 0) sumStrong += it.yen;
      delete it._idx;
    });

    var totalYen = roundYen(end.rate - start.rate);
    sumEvents = roundYen(sumEvents);
    var residualYen = roundYen(totalYen - sumEvents);
    var residual = {
      id: 'residual',
      label: 'その他要因',
      yen: residualYen,
      pct: clean(residualYen / start.rate * 100),
      direction: directionOf(residualYen),
      from: level,
      to: end.rate // 浮動小数誤差で end とずれないよう end.rate をそのまま使う
    };

    return {
      start: start,
      end: end,
      order: order,
      totalYen: totalYen,
      totalPct: clean((end.rate / start.rate - 1) * 100),
      items: items,
      residual: residual,
      sumWeakYen: roundYen(sumWeak),
      sumStrongYen: roundYen(sumStrong),
      sumEventsYen: sumEvents,
      warnings: warnings
    };
  }

  /* ------------------------------------------------------------------ */
  /* CSV（FRED DEXJPUS 形式）                                            */
  /* ------------------------------------------------------------------ */

  function splitCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }

  function parseSeriesCsv(text) {
    if (typeof text !== 'string') return [];
    var lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
    var headerIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') { headerIdx = i; break; }
    }
    if (headerIdx < 0) return [];
    var header = splitCsvLine(lines[headerIdx]).map(function (h) { return h.toLowerCase(); });
    var dateCol = -1, valCol = -1;
    header.forEach(function (h, j) {
      if (dateCol < 0 && (h === 'observation_date' || h === 'date')) dateCol = j;
      if (valCol < 0 && (h === 'dexjpus' || h === 'value')) valCol = j;
    });
    if (dateCol < 0) dateCol = 0;
    if (valCol < 0) valCol = dateCol === 0 ? 1 : 0;

    var map = {};
    for (var k = headerIdx + 1; k < lines.length; k++) {
      var line = lines[k];
      if (line.trim() === '') continue;
      var cols = splitCsvLine(line);
      var d = cols[dateCol], v = cols[valCol];
      if (!isValidDate(d)) continue;
      if (v == null || v === '' || v === '.') continue;
      var n = Number(v);
      if (!isFinite(n) || n <= 0) continue;
      map[d] = n; // 同日重複は後勝ち
    }
    return Object.keys(map).sort().map(function (d) { return { date: d, rate: map[d] }; });
  }

  function normalizeSeries(series) {
    if (!Array.isArray(series)) return [];
    return series
      .filter(function (p) { return p && isValidDate(p.date) && isFiniteNumber(p.rate); })
      .map(function (p) { return { date: p.date, rate: p.rate }; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /*
   * pre  = イベント日より前の直近観測値
   * post = イベント日の観測値（なければ次の観測値）。event.offset (整数, 既定 0) だけ後ろの観測にずらす
   * pre・post のどちらかが系列から取れないイベントは pre/post とも元のまま。元の配列・オブジェクトは破壊しない。
   */
  function applySeries(events, series) {
    var s = normalizeSeries(series);
    if (!Array.isArray(events)) return [];
    return events.map(function (ev) {
      if (!ev || typeof ev !== 'object') return ev;
      var copy = {};
      for (var key in ev) if (Object.prototype.hasOwnProperty.call(ev, key)) copy[key] = ev[key];
      if (ev.source && typeof ev.source === 'object') copy.source = Object.assign({}, ev.source);
      if (!isValidDate(ev.date) || s.length === 0) return copy;

      var preIdx = -1, postIdx = -1;
      for (var i = 0; i < s.length; i++) {
        if (s[i].date < ev.date) preIdx = i;
        else { postIdx = i; break; }
      }
      var offset = Number.isInteger(ev.offset) && ev.offset > 0 ? ev.offset : 0;
      if (postIdx >= 0) postIdx += offset;
      // pre と post の両方が系列から取れるときだけ更新する（片方だけ置き換えると窓が壊れるため）
      if (preIdx >= 0 && postIdx >= 0 && postIdx < s.length) {
        copy.pre = s[preIdx].rate;
        copy.post = s[postIdx].rate;
      }
      return copy;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 書式                                                                */
  /* ------------------------------------------------------------------ */

  function signed(n, digits, unit) {
    if (!isFiniteNumber(n)) return '—';
    var d = digits == null ? 2 : digits;
    var r = Number(n.toFixed(d));
    if (r === 0) return '±' + (0).toFixed(d) + unit;
    return (r > 0 ? '+' : '-') + Math.abs(r).toFixed(d) + unit;
  }

  function formatYen(n, digits) { return signed(n, digits, '円'); }
  function formatPct(n, digits) { return signed(n, digits, '%'); }
  function formatRate(n, digits) {
    if (!isFiniteNumber(n)) return '—';
    return n.toFixed(digits == null ? 2 : digits) + '円';
  }

  return {
    decompose: decompose,
    validateDataset: validateDataset,
    parseSeriesCsv: parseSeriesCsv,
    applySeries: applySeries,
    formatYen: formatYen,
    formatPct: formatPct,
    formatRate: formatRate,
    isValidDate: isValidDate,
    directionOf: directionOf,
    DIRECTION_LABELS: DIRECTION_LABELS
  };
});
