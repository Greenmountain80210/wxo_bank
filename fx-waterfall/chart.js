/*
 * USD/JPY 短期要因分解 — SVG 描画（外部ライブラリなし）
 * 1) 横向きウォーターフォール：行 = 要因（上から A時点 → 各イベント → その他要因 → B時点）。値は pips 中心。
 * 2) 価格推移チャート：価格の折れ線 + イベント縦線 + 期間高値・安値 + A/B 時点 + 警戒ライン。
 * 公開: window.FxWaterfallChart.renderWaterfall(container, result, opts)
 *       window.FxWaterfallChart.renderPriceChart(container, dataset, result, analysis, opts)
 *       （グローバル関数 window.renderWaterfall / window.renderPriceChart も同じもの）
 * opts.tz: 表示タイムゾーン（"Asia/Tokyo" | "UTC" | "America/New_York"。既定 Asia/Tokyo）
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FxWaterfallChart = api;
    root.renderWaterfall = api.renderWaterfall;
    root.renderPriceChart = api.renderPriceChart;
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var FONT = 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif';
  var BAR_H = 20;           // <= 24px
  var RADIUS = 4;           // データ端の角丸
  var STACK_BREAKPOINT = 600;
  var uid = 0;

  /* ---------- 書式（waterfall.js があれば共用） ---------- */
  function W() { return (root && root.FxWaterfall) || null; }
  function fmtSigned(n, unit) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var r = Number(n.toFixed(2));
    if (r === 0) return '±0.00' + unit;
    return (r > 0 ? '+' : '-') + Math.abs(r).toFixed(2) + unit;
  }
  function fmtYen(n) { return W() ? W().formatYen(n) : fmtSigned(n, '円'); }
  function fmtPct(n) { return W() ? W().formatPct(n) : fmtSigned(n, '%'); }
  function fmtRate(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) + '円' : '—'; }
  function fmtRate3(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(3) : '—'; }
  function fmtPips(n) {
    if (W()) return W().formatPips(n);
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var r = Number(n.toFixed(1));
    return (r === 0 ? '±0.0' : (r > 0 ? '+' : '-') + Math.abs(r).toFixed(1)) + ' pips';
  }
  function fmtTime(ms, tz, o) {
    if (W()) return W().formatTime(ms, tz || 'Asia/Tokyo', o);
    return (typeof ms === 'number' && isFinite(ms)) ? new Date(ms).toISOString().slice(5, 16).replace('T', ' ') + ' UTC' : '—';
  }
  var IMP_LABEL = { high: '高', medium: '中', low: '低' };

  var DIR_LABEL = { weak: '円安', strong: '円高', neutral: '中立' };
  var KIND_NAME = { start: 'A時点', end: 'B時点', residual: 'その他要因' };

  /* ---------- スタイル（1 回だけ注入） ---------- */
  var CSS = [
    '.fxw-root{',
    '  --fxw-surface:#fcfcfb;--fxw-text:#0b0b0b;--fxw-text-2:#52514e;--fxw-muted:#7a7873;',
    '  --fxw-grid:#e1e0d9;--fxw-axis:#c3c2b7;--fxw-connector:#9a988f;',
    '  --fxw-weak:#e34948;--fxw-strong:#2a78d6;--fxw-residual:#a3a29b;--fxw-total:#52514e;',
    '  --fxw-on-weak:#ffffff;--fxw-on-strong:#ffffff;--fxw-on-residual:#0b0b0b;--fxw-on-total:#ffffff;',
    '  --fxw-hover:rgba(11,11,11,0.05);--fxw-focus:#2a78d6;--fxw-tip-bg:#ffffff;--fxw-tip-border:rgba(11,11,11,0.12);',
    '  --fxw-line:#3d3c39;--fxw-level:#7a7873;--fxw-crosshair:#9a988f;',
    '  position:relative;color:var(--fxw-text);font-family:' + FONT + ';',
    '}',
    '@media (prefers-color-scheme: dark){:root:where(:not([data-theme="light"])) .fxw-root{',
    '  --fxw-surface:#1a1a19;--fxw-text:#f0efec;--fxw-text-2:#c3c2b7;--fxw-muted:#9a988f;',
    '  --fxw-grid:#2c2c2a;--fxw-axis:#4a4a46;--fxw-connector:#6e6d68;',
    '  --fxw-weak:#e66767;--fxw-strong:#3987e5;--fxw-residual:#6e6d68;--fxw-total:#c3c2b7;',
    '  --fxw-on-weak:#0b0b0b;--fxw-on-strong:#ffffff;--fxw-on-residual:#ffffff;--fxw-on-total:#0b0b0b;',
    '  --fxw-hover:rgba(255,255,255,0.06);--fxw-focus:#3987e5;--fxw-tip-bg:#242423;--fxw-tip-border:rgba(255,255,255,0.14);',
    '  --fxw-line:#e1e0d9;--fxw-level:#9a988f;--fxw-crosshair:#6e6d68;',
    '}}',
    ':root[data-theme="dark"] .fxw-root{',
    '  --fxw-surface:#1a1a19;--fxw-text:#f0efec;--fxw-text-2:#c3c2b7;--fxw-muted:#9a988f;',
    '  --fxw-grid:#2c2c2a;--fxw-axis:#4a4a46;--fxw-connector:#6e6d68;',
    '  --fxw-weak:#e66767;--fxw-strong:#3987e5;--fxw-residual:#6e6d68;--fxw-total:#c3c2b7;',
    '  --fxw-on-weak:#0b0b0b;--fxw-on-strong:#ffffff;--fxw-on-residual:#ffffff;--fxw-on-total:#0b0b0b;',
    '  --fxw-hover:rgba(255,255,255,0.06);--fxw-focus:#3987e5;--fxw-tip-bg:#242423;--fxw-tip-border:rgba(255,255,255,0.14);',
    '  --fxw-line:#e1e0d9;--fxw-level:#9a988f;--fxw-crosshair:#6e6d68;',
    '}',
    '.fxw-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 12px;padding:0;list-style:none;font-size:13px;color:var(--fxw-text-2);}',
    '.fxw-legend li{display:flex;align-items:center;gap:6px;}',
    '.fxw-swatch{display:inline-block;width:12px;height:12px;border-radius:3px;flex:none;}',
    '.fxw-svg{display:block;width:100%;height:auto;overflow:visible;font-family:' + FONT + ';}',
    '.fxw-svg text{fill:var(--fxw-text);}',
    '.fxw-svg .fxw-t2{fill:var(--fxw-text-2);}',
    '.fxw-svg .fxw-muted{fill:var(--fxw-muted);}',
    '.fxw-svg .fxw-grid{stroke:var(--fxw-grid);stroke-width:1;shape-rendering:crispEdges;}',
    '.fxw-svg .fxw-axisline{stroke:var(--fxw-axis);stroke-width:1;shape-rendering:crispEdges;}',
    '.fxw-svg .fxw-connector{stroke:var(--fxw-connector);stroke-width:1;shape-rendering:crispEdges;}',
    '.fxw-svg .fxw-break{stroke:var(--fxw-muted);stroke-width:1.5;fill:none;}',
    '.fxw-svg .fxw-cut{fill:var(--fxw-surface);}',
    '.fxw-svg .fxw-bar{cursor:default;outline:none;}',
    '.fxw-svg .fxw-hit{fill:transparent;stroke:none;}',
    '.fxw-svg .fxw-bar:hover .fxw-hit{fill:var(--fxw-hover);}',
    '.fxw-svg .fxw-bar:focus .fxw-hit,.fxw-svg .fxw-bar.fxw-active .fxw-hit{fill:var(--fxw-hover);}',
    '.fxw-svg .fxw-bar:focus-visible .fxw-hit{stroke:var(--fxw-focus);stroke-width:2;}',
    '.fxw-svg .fxw-bar:hover .fxw-mark,.fxw-svg .fxw-bar:focus .fxw-mark{filter:brightness(1.08);}',
    '.fxw-svg .fxw-mark[data-fill="weak"]{fill:var(--fxw-weak);}',
    '.fxw-svg .fxw-mark[data-fill="strong"]{fill:var(--fxw-strong);}',
    '.fxw-svg .fxw-mark[data-fill="residual"]{fill:var(--fxw-residual);}',
    '.fxw-svg .fxw-mark[data-fill="total"]{fill:var(--fxw-total);}',
    '.fxw-svg text.fxw-in-weak{fill:var(--fxw-on-weak);}',
    '.fxw-svg text.fxw-in-strong{fill:var(--fxw-on-strong);}',
    '.fxw-svg text.fxw-in-residual{fill:var(--fxw-on-residual);}',
    '.fxw-svg text.fxw-in-total{fill:var(--fxw-on-total);}',
    '.fxw-svg .fxw-tick{font-variant-numeric:tabular-nums;}',
    '.fxw-tooltip{position:absolute;z-index:10;pointer-events:none;max-width:min(320px,calc(100% - 8px));box-sizing:border-box;',
    '  background:var(--fxw-tip-bg);color:var(--fxw-text);border:1px solid var(--fxw-tip-border);border-radius:8px;',
    '  box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:10px 12px;font-size:12px;line-height:1.5;}',
    '.fxw-tooltip[hidden]{display:none;}',
    '.fxw-tooltip .fxw-tip-value{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;}',
    '.fxw-tooltip .fxw-tip-label{font-weight:600;margin-top:2px;}',
    '.fxw-tooltip .fxw-tip-key{display:inline-block;width:12px;height:3px;border-radius:2px;vertical-align:middle;margin-right:6px;}',
    '.fxw-tooltip .fxw-tip-meta{color:var(--fxw-text-2);}',
    '.fxw-tooltip .fxw-tip-desc{margin-top:4px;}',
    '.fxw-tooltip .fxw-tip-src{margin-top:4px;color:var(--fxw-text-2);word-break:break-all;}',
    '.fxw-svg .fxw-pline{fill:none;stroke:var(--fxw-line);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;}',
    '.fxw-svg .fxw-pline[data-basis="points"]{stroke-dasharray:6 4;}',
    '.fxw-svg .fxw-pdot{fill:var(--fxw-line);stroke:var(--fxw-surface);stroke-width:2;}',
    '.fxw-svg .fxw-ev-line{stroke-width:1.5;opacity:0.7;}',
    '.fxw-svg [data-direction="weak"] .fxw-ev-line{stroke:var(--fxw-weak);}',
    '.fxw-svg [data-direction="strong"] .fxw-ev-line{stroke:var(--fxw-strong);}',
    '.fxw-svg [data-direction="neutral"] .fxw-ev-line{stroke:var(--fxw-residual);}',
    '.fxw-svg .fxw-ev-head{stroke:var(--fxw-surface);stroke-width:2;}',
    '.fxw-svg [data-direction="weak"] .fxw-ev-head{fill:var(--fxw-weak);}',
    '.fxw-svg [data-direction="strong"] .fxw-ev-head{fill:var(--fxw-strong);}',
    '.fxw-svg [data-direction="neutral"] .fxw-ev-head{fill:var(--fxw-residual);}',
    '.fxw-svg .fxw-ev{outline:none;cursor:default;}',
    '.fxw-svg .fxw-ev:hover .fxw-ev-line,.fxw-svg .fxw-ev:focus .fxw-ev-line,.fxw-svg .fxw-ev.fxw-active .fxw-ev-line{opacity:1;stroke-width:2.5;}',
    '.fxw-svg .fxw-ev:focus-visible .fxw-hit{stroke:var(--fxw-focus);stroke-width:2;}',
    '.fxw-svg .fxw-level-line{stroke:var(--fxw-level);stroke-width:1;stroke-dasharray:5 4;}',
    '.fxw-svg .fxw-crosshair{stroke:var(--fxw-crosshair);stroke-width:1;shape-rendering:crispEdges;pointer-events:none;}',
    '.fxw-svg .fxw-focusdot{fill:var(--fxw-line);stroke:var(--fxw-surface);stroke-width:2;pointer-events:none;}',
    '.fxw-svg .fxw-extreme{fill:var(--fxw-text);stroke:var(--fxw-surface);stroke-width:2;}',
    '.fxw-svg .fxw-extreme-low{fill:var(--fxw-muted);stroke:var(--fxw-surface);stroke-width:2;}',
    '.fxw-svg .fxw-ab{fill:var(--fxw-surface);stroke:var(--fxw-line);stroke-width:2;}',
    '.fxw-svg .fxw-halo{paint-order:stroke;stroke:var(--fxw-surface);stroke-width:3;stroke-linejoin:round;}',
    '.fxw-legend .fxw-key-line{display:inline-block;width:16px;height:0;border-top:2px solid var(--fxw-line);}',
    '.fxw-legend .fxw-key-dash{display:inline-block;width:16px;height:0;border-top:1px dashed var(--fxw-level);}',
    '.fxw-legend .fxw-key-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--fxw-text);}',
    '.fxw-legend .fxw-key-tri{display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;}',
    '.fxw-legend .fxw-key-tri.up{border-bottom:8px solid var(--fxw-weak);}',
    '.fxw-legend .fxw-key-tri.down{border-top:8px solid var(--fxw-strong);}',
    '@media (forced-colors: active){.fxw-svg .fxw-mark{fill:CanvasText !important;}.fxw-svg .fxw-mark[data-fill="strong"]{fill:Highlight !important;}}'
  ].join('\n');

  function injectStyle(doc) {
    if (doc.getElementById('fxw-style')) return;
    var st = doc.createElement('style');
    st.id = 'fxw-style';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* ---------- 文字幅の計測 ---------- */
  var measureCtx = null;
  function textWidth(text, size, weight) {
    text = String(text);
    if (measureCtx === null) {
      try {
        var c = root.document && root.document.createElement('canvas');
        measureCtx = (c && c.getContext && c.getContext('2d')) || false;
      } catch (e) { measureCtx = false; }
    }
    if (measureCtx) {
      measureCtx.font = (weight || 400) + ' ' + size + 'px ' + FONT;
      return measureCtx.measureText(text).width;
    }
    var w = 0;
    for (var i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0xff ? size : size * 0.6;
    return w;
  }

  // 文字単位の折り返し（日本語向け）。英単語の途中では極力切らない
  function wrapText(text, size, weight, maxW) {
    text = String(text);
    if (textWidth(text, size, weight) <= maxW) return [text];
    var lines = [], cur = '';
    var tokens = text.match(/[A-Za-z0-9.,:%+\-\/&']+\s*|\s+|./g) || [text];
    tokens.forEach(function (tok) {
      var next = cur + tok;
      if (textWidth(next, size, weight) <= maxW || cur === '') {
        if (cur === '' && textWidth(tok, size, weight) > maxW) {
          // 長すぎる単語は文字で分割
          for (var i = 0; i < tok.length; i++) {
            var n2 = cur + tok[i];
            if (textWidth(n2, size, weight) > maxW && cur !== '') { lines.push(cur); cur = tok[i]; }
            else cur = n2;
          }
        } else cur = next;
      } else {
        lines.push(cur.replace(/\s+$/, ''));
        cur = tok.replace(/^\s+/, '');
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /* ---------- 目盛り ---------- */
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * p;
  }

  function decimalsOf(step) {
    var s = String(step);
    var i = s.indexOf('.');
    return i < 0 ? 0 : Math.min(4, s.length - i - 1);
  }

  /* ---------- SVG ヘルパ ---------- */
  function el(doc, name, attrs, parent) {
    var n = doc.createElementNS(SVG_NS, name);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(doc, parent, x, y, s, attrs) {
    var t = el(doc, 'text', attrs, parent);
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.textContent = s;
    return t;
  }

  // 片側（データ端）だけ角丸の横棒
  function barPath(x0, x1, y, h, roundRight) {
    var w = Math.max(0, x1 - x0);
    var r = Math.min(RADIUS, w / 2, h / 2);
    if (w <= 0) return '';
    if (roundRight) {
      return 'M' + x0 + ',' + y + 'H' + (x1 - r) + 'Q' + x1 + ',' + y + ' ' + x1 + ',' + (y + r) +
        'V' + (y + h - r) + 'Q' + x1 + ',' + (y + h) + ' ' + (x1 - r) + ',' + (y + h) + 'H' + x0 + 'Z';
    }
    return 'M' + x1 + ',' + y + 'H' + (x0 + r) + 'Q' + x0 + ',' + y + ' ' + x0 + ',' + (y + r) +
      'V' + (y + h - r) + 'Q' + x0 + ',' + (y + h) + ' ' + (x0 + r) + ',' + (y + h) + 'H' + x1 + 'Z';
  }

  function hostOf(url) {
    var m = /^https?:\/\/([^\/?#]+)/i.exec(url || '');
    return m ? m[1] : '';
  }

  /* ---------- 行モデル ---------- */
  function buildRows(result, opts) {
    var tz = opts.tz || 'Asia/Tokyo';
    var startLabel = opts.startLabel || 'A時点';
    var endLabel = opts.endLabel || 'B時点';
    var rows = [];
    rows.push({
      kind: 'start', id: 'start', label: startLabel, meta: fmtTime(result.start.time, tz),
      level: result.start.rate, direction: 'neutral', fill: 'total',
      value: fmtRate3(result.start.rate) + '円', item: result.start
    });
    result.items.forEach(function (it) {
      rows.push({
        kind: 'event', id: it.id, label: it.label, importance: it.importance,
        meta: fmtTime(it.time, tz) + ' · 重要度 ' + (IMP_LABEL[it.importance] || '—') + (it.category ? ' · ' + it.category : ''),
        from: it.from, to: it.to, direction: it.direction,
        fill: it.direction === 'weak' ? 'weak' : it.direction === 'strong' ? 'strong' : 'residual',
        value: fmtPips(it.pips) + '（' + fmtPct(it.pct) + '）', short: fmtPips(it.pips), item: it
      });
    });
    var res = result.residual;
    rows.push({
      kind: 'residual', id: 'residual', label: 'その他要因', meta: 'イベント窓の外の値動きの合計',
      from: res.from, to: res.to, direction: res.direction, fill: 'residual',
      value: fmtPips(res.pips) + '（' + fmtPct(res.pct) + '）', short: fmtPips(res.pips), item: res
    });
    rows.push({
      kind: 'end', id: 'end', label: endLabel, meta: fmtTime(result.end.time, tz),
      level: result.end.rate, direction: result.totalYen > 0 ? 'weak' : result.totalYen < 0 ? 'strong' : 'neutral',
      fill: 'total', value: fmtRate3(result.end.rate) + '円', item: result.end
    });
    return rows;
  }

  /* ---------- ツールチップ ---------- */
  function fillTooltip(doc, tip, row, result, opts) {
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    function div(cls, text, parent) {
      var d = doc.createElement('div');
      if (cls) d.className = cls;
      if (text != null) d.textContent = text;
      (parent || tip).appendChild(d);
      return d;
    }
    var it = row.item || {};
    var val = div('fxw-tip-value');
    var key = doc.createElement('span');
    key.className = 'fxw-tip-key';
    key.style.background = 'var(--fxw-' + row.fill + ')';
    val.appendChild(key);
    val.appendChild(doc.createTextNode(row.value));
    div('fxw-tip-label', row.label);

    var tz = opts.tz || 'Asia/Tokyo';
    if (row.kind === 'start' || row.kind === 'end') {
      div('fxw-tip-meta', row.meta + ' 時点の ' + (opts.pair || 'USD/JPY') + ' レート');
      if (row.kind === 'end') {
        div('fxw-tip-meta', 'A時点からの変化 ' + fmtPips(result.totalPips) + ' / ' + fmtYen(result.totalYen) +
          '（' + fmtPct(result.totalPct) + '）');
      }
    } else if (row.kind === 'residual') {
      div('fxw-tip-meta', DIR_LABEL[row.direction] + '方向 · ' + fmtYen(it.yen) + ' · ' + fmtRate(it.from) + ' → ' + fmtRate(it.to));
      div('fxw-tip-desc', 'A→B の値動きのうち、上に並べたイベントの窓の外で生じた分の合計です。');
    } else {
      div('fxw-tip-meta', row.meta + ' · ' + DIR_LABEL[row.direction] + '要因');
      div('fxw-tip-meta', fmtPips(it.pips) + ' / ' + fmtYen(it.yen) + '（A 比 ' + fmtPct(it.pct) + '、イベント単体 ' + fmtPct(it.eventPct) + '）');
      div('fxw-tip-meta', '前 ' + fmtRate3(it.pre) + (it.preTime != null ? '（' + fmtTime(it.preTime, tz) + '）' : '') +
        ' → 後 ' + fmtRate3(it.post) + (it.postTime != null ? '（' + fmtTime(it.postTime, tz) + '）' : ''));
      if (it.window) div('fxw-tip-meta', '窓: ' + it.window);
      if (it.description) div('fxw-tip-desc', it.description);
      if (it.confidence) div('fxw-tip-meta', it.confidence === 'reported' ? '報道値' : '概算値');
    }
    var srcs = (it.sources && it.sources.length) ? it.sources : (it.source ? [it.source] : []);
    srcs.forEach(function (s) {
      if (!s) return;
      var host = hostOf(s.url);
      div('fxw-tip-src', '出典: ' + (s.label || host || s.url || '') + (host && s.label ? '（' + host + '）' : ''));
    });
  }

  function placeTooltip(container, tip, x, y) {
    tip.hidden = false;
    var cw = container.clientWidth;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = x + 14;
    if (left + tw > cw - 4) left = Math.max(4, x - tw - 14);
    if (left + tw > cw - 4) left = Math.max(4, cw - tw - 4);
    var top = y - th - 10;
    if (top < 0) top = y + 18;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  /* ---------- 本体 ---------- */
  function renderWaterfall(container, result, opts) {
    opts = opts || {};
    var doc = container.ownerDocument || root.document;
    injectStyle(doc);

    var state = container._fxw || (container._fxw = {});
    state.result = result;
    state.opts = opts;

    container.classList.add('fxw-root');
    while (container.firstChild) container.removeChild(container.firstChild);

    var width = Math.floor(opts.width || container.clientWidth || 640);
    if (width < 240) width = 240;
    state.lastWidth = width;
    var stacked = opts.layout === 'stacked' ? true : opts.layout === 'wide' ? false : width < STACK_BREAKPOINT;
    var pair = opts.pair || 'USD/JPY';
    var title = opts.title || (pair + ' 要因分解ウォーターフォール');
    var tz = opts.tz || 'Asia/Tokyo';

    // 凡例（HTML）
    var legend = doc.createElement('ul');
    legend.className = 'fxw-legend';
    legend.setAttribute('aria-label', '凡例');
    [
      ['weak', '円安要因（' + pair + ' 上昇）'],
      ['strong', '円高要因（' + pair + ' 下落）'],
      ['residual', 'その他要因'],
      ['total', 'A時点・B時点のレート']
    ].forEach(function (p) {
      var li = doc.createElement('li');
      li.setAttribute('data-legend', p[0]);
      var sw = doc.createElement('span');
      sw.className = 'fxw-swatch';
      sw.style.background = 'var(--fxw-' + p[0] + ')';
      li.appendChild(sw);
      li.appendChild(doc.createTextNode(p[1]));
      legend.appendChild(li);
    });
    container.appendChild(legend);

    var rows = buildRows(result, opts);

    // ---- 横軸のスケール ----
    var levels = [result.start.rate, result.end.rate];
    rows.forEach(function (r) { if (r.kind === 'event' || r.kind === 'residual') levels.push(r.from, r.to); });
    var lo = Math.min.apply(null, levels), hi = Math.max.apply(null, levels);
    var span = hi - lo || Math.max(1, hi * 0.02);
    var lo2 = lo - span * 0.22, hi2 = hi + span * 0.04;

    // ---- レイアウト（ラベル列） ----
    var LABEL_SIZE = 13, META_SIZE = 11, VALUE_SIZE = 12, TICK_SIZE = 11;
    var padL = stacked ? 2 : 0, padR = 6;
    var labelColW = 0;
    if (!stacked) {
      var maxLab = 0;
      rows.forEach(function (r) {
        maxLab = Math.max(maxLab, textWidth(r.label, LABEL_SIZE, r.kind === 'event' ? 400 : 600),
          textWidth(r.meta, META_SIZE, 400));
      });
      labelColW = Math.min(Math.ceil(maxLab) + 20, Math.round(width * 0.36));
    }
    var plotX0 = stacked ? padL + 1 : labelColW;
    var plotX1 = width - padR;
    var plotW = plotX1 - plotX0;

    var targetTicks = Math.max(3, Math.min(8, Math.floor(plotW / 72)));
    var step = niceStep((hi2 - lo2) / targetTicks);
    var axisMin = Math.floor(lo2 / step) * step;
    var axisMax = Math.ceil(hi2 / step) * step;
    if (axisMin < 0) axisMin = 0;
    var truncated = axisMin > 0;
    var dec = decimalsOf(step);
    function sx(v) { return plotX0 + (v - axisMin) / (axisMax - axisMin) * plotW; }

    // ---- 行の高さ ----
    var y = 4;
    rows.forEach(function (r) {
      var w = r.kind === 'event' ? 400 : 600;
      if (stacked) {
        var full = plotX1 - padL;
        r.labelLines = wrapText(r.label, LABEL_SIZE, w, full);
        var lastLine = r.labelLines[r.labelLines.length - 1];
        var metaInline = textWidth(lastLine, LABEL_SIZE, w) + 10 + textWidth(r.meta, META_SIZE, 400) <= full;
        r.metaInline = metaInline;
        var headH = r.labelLines.length * 17 + (metaInline ? 0 : 15);
        r.y = y;
        r.labelY = y + 13;
        r.barY = y + headH + 4;
        r.h = headH + 4 + BAR_H + 12;
      } else {
        r.labelLines = wrapText(r.label, LABEL_SIZE, w, labelColW - 16);
        var textH = r.labelLines.length * 16 + 14;
        r.h = Math.max(38, textH + 8);
        r.y = y;
        r.barY = y + (r.h - BAR_H) / 2;
        r.labelY = y + (r.h - textH) / 2 + 12;
      }
      y += r.h;
    });
    var plotTop = 0, plotBottom = y;
    var axisY = plotBottom + 2;
    var height = axisY + 22 + (truncated ? 18 : 0) + 4;

    // ---- SVG ----
    var id = 'fxw-' + (++uid);
    var total = fmtPips(result.totalPips) + '（' + fmtPct(result.totalPct) + '）';
    var ariaLabel = title + '。A時点 ' + fmtTime(result.start.time, tz) + ' の ' + fmtRate(result.start.rate) +
      ' から B時点 ' + fmtTime(result.end.time, tz) + ' の ' + fmtRate(result.end.rate) + ' へ ' + total + '。' +
      '円安要因の合計 ' + fmtPips(result.sumWeakPips) + '、円高要因の合計 ' + fmtPips(result.sumStrongPips) +
      '、その他要因 ' + fmtPips(result.residual.pips) + '。イベント ' + result.items.length + ' 件。詳細は表を参照。';
    var svg = el(doc, 'svg', {
      'class': 'fxw-svg', role: 'img', 'aria-label': ariaLabel,
      'aria-describedby': id + '-desc', viewBox: '0 0 ' + width + ' ' + height, width: width, height: height,
      'data-layout': stacked ? 'stacked' : 'wide'
    });
    var tEl = el(doc, 'title', { id: id + '-title' }, svg);
    tEl.textContent = title;
    var dEl = el(doc, 'desc', { id: id + '-desc' }, svg);
    dEl.textContent = ariaLabel;

    // グリッドと軸
    var gGrid = el(doc, 'g', { 'class': 'fxw-gridlayer', 'aria-hidden': 'true' }, svg);
    var ticks = [];
    for (var v = axisMin; v <= axisMax + step / 1000; v += step) ticks.push(Number(v.toFixed(6)));
    ticks.forEach(function (tv, i) {
      var x = Math.round(sx(tv)) + 0.5;
      el(doc, 'line', { 'class': 'fxw-grid', x1: x, x2: x, y1: plotTop, y2: axisY }, gGrid);
      var anchor = i === 0 ? 'start' : (i === ticks.length - 1 ? 'end' : 'middle');
      if (i === 0 && truncated) anchor = 'start';
      txt(doc, gGrid, i === 0 ? x + (truncated ? 12 : 0) : x, axisY + 15, tv.toFixed(dec),
        { 'class': 'fxw-tick fxw-muted', 'font-size': TICK_SIZE, 'text-anchor': anchor });
    });
    el(doc, 'line', { 'class': 'fxw-axisline', x1: plotX0, x2: plotX1, y1: axisY + 0.5, y2: axisY + 0.5 }, gGrid);
    if (truncated) {
      // 軸の切り詰めを示す波線（≈）
      var bx = plotX0 + 2, by = axisY + 0.5;
      el(doc, 'rect', { 'class': 'fxw-cut', x: bx - 1, y: by - 5, width: 9, height: 10 }, gGrid);
      el(doc, 'path', { 'class': 'fxw-break', d: 'M' + (bx - 1) + ',' + (by + 4) + 'L' + (bx + 3) + ',' + (by - 4) +
        'M' + (bx + 4) + ',' + (by + 4) + 'L' + (bx + 8) + ',' + (by - 4) }, gGrid);
      txt(doc, gGrid, plotX0, axisY + 33, '※ 横軸は ' + axisMin.toFixed(dec) + '円から（0円起点ではありません）',
        { 'class': 'fxw-muted', 'font-size': TICK_SIZE, 'data-role': 'axis-note' });
    }

    // コネクタ
    var gConn = el(doc, 'g', { 'class': 'fxw-connectors', 'aria-hidden': 'true' }, svg);
    for (var i = 0; i < rows.length - 1; i++) {
      var a = rows[i], b = rows[i + 1];
      var level = a.kind === 'start' ? a.level : a.to;
      var cx = Math.round(sx(level)) + 0.5;
      el(doc, 'line', { 'class': 'fxw-connector', x1: cx, x2: cx, y1: a.barY + BAR_H, y2: b.barY }, gConn);
    }

    // ツールチップ
    var tip = doc.createElement('div');
    tip.className = 'fxw-tooltip';
    tip.id = id + '-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;

    // バー
    var gBars = el(doc, 'g', { 'class': 'fxw-bars' }, svg);
    var activeBar = null;
    function show(g, row, px, py) {
      if (activeBar && activeBar !== g) activeBar.classList.remove('fxw-active');
      activeBar = g;
      g.classList.add('fxw-active');
      fillTooltip(doc, tip, row, result, opts);
      placeTooltip(container, tip, px, py);
    }
    function hide(g) {
      if (g) g.classList.remove('fxw-active');
      if (!g || g === activeBar) { tip.hidden = true; activeBar = null; }
    }

    rows.forEach(function (r, idx) {
      var isTotal = r.kind === 'start' || r.kind === 'end';
      var g = el(doc, 'g', {
        'class': 'fxw-bar', tabindex: '0', 'data-kind': r.kind, 'data-direction': r.direction,
        'data-id': r.id, 'data-index': idx, 'aria-describedby': tip.id, 'data-importance': r.importance || null,
        'aria-label': r.label + ' ' + r.meta + ' ' + r.value
      }, gBars);
      el(doc, 'rect', { 'class': 'fxw-hit', x: 0, y: r.y + 1, width: width, height: r.h - 2, rx: 6 }, g);

      // ラベル
      var lw = r.kind === 'event' ? 400 : 600;
      var lx = stacked ? padL : 8;
      r.labelLines.forEach(function (line, li) {
        txt(doc, g, lx, r.labelY + li * (stacked ? 17 : 16), line,
          { 'font-size': LABEL_SIZE, 'font-weight': lw, 'class': 'fxw-label' });
      });
      var lastLine = r.labelLines[r.labelLines.length - 1];
      if (stacked && r.metaInline) {
        txt(doc, g, lx + textWidth(lastLine, LABEL_SIZE, lw) + 8, r.labelY + (r.labelLines.length - 1) * 17, r.meta,
          { 'font-size': META_SIZE, 'class': 'fxw-muted fxw-meta' });
      } else {
        txt(doc, g, lx, r.labelY + (r.labelLines.length - 1) * (stacked ? 17 : 16) + (stacked ? 15 : 15), r.meta,
          { 'font-size': META_SIZE, 'class': 'fxw-muted fxw-meta' });
      }

      // バー本体
      var x0, x1, roundRight;
      if (isTotal) {
        x0 = plotX0; x1 = sx(r.level); roundRight = true;
      } else {
        var fa = sx(r.from), fb = sx(r.to);
        roundRight = fb >= fa;
        x0 = Math.min(fa, fb); x1 = Math.max(fa, fb);
        if (x1 - x0 < 2) { var mid = (x0 + x1) / 2; x0 = mid - 1; x1 = mid + 1; }
      }
      el(doc, 'path', { 'class': 'fxw-mark', 'data-fill': r.fill, d: barPath(x0, x1, r.barY, BAR_H, roundRight) }, g);
      if (isTotal && truncated) {
        // 切り詰めを示すバーの切れ目
        var cx0 = plotX0 + 7;
        el(doc, 'path', { 'class': 'fxw-cut', d: 'M' + cx0 + ',' + (r.barY - 1) + 'L' + (cx0 + 3) + ',' + (r.barY - 1) +
          'L' + (cx0 - 1) + ',' + (r.barY + BAR_H + 1) + 'L' + (cx0 - 4) + ',' + (r.barY + BAR_H + 1) + 'Z' }, g);
      }

      // 値ラベル：外側 → 反対側 → 内側 の順で収まる位置を選ぶ。収まらなければ pips だけの短い表記で再試行
      var gap = 6, ty = r.barY + BAR_H / 2 + 4;
      var rightRoom = plotX1 - x1 - gap, leftRoom = x0 - plotX0 - gap, inside = x1 - x0 - 2 * gap;
      var prefersLeft = !isTotal && r.direction === 'strong';
      function choose(vw) {
        if (prefersLeft && leftRoom >= vw) return 'left';
        if (!prefersLeft && rightRoom >= vw) return 'right';
        if (prefersLeft && rightRoom >= vw) return 'right';
        if (!prefersLeft && leftRoom >= vw && !isTotal) return 'left';
        if (inside >= vw) return 'inside';
        return null;
      }
      var vw = textWidth(r.value, VALUE_SIZE, 600);
      var pos = choose(vw);
      if (!pos && r.short) {
        var sw = textWidth(r.short, VALUE_SIZE, 600);
        var pos2 = choose(sw);
        if (pos2) { pos = pos2; r.value = r.short; vw = sw; }
      }
      if (!pos) pos = rightRoom >= leftRoom ? 'right-clamp' : 'left-clamp';
      var vAttrs = { 'class': 'fxw-value', 'font-size': VALUE_SIZE, 'font-weight': 600, 'data-pos': pos };
      var vx;
      if (pos === 'right') { vx = x1 + gap; vAttrs['text-anchor'] = 'start'; }
      else if (pos === 'left') { vx = x0 - gap; vAttrs['text-anchor'] = 'end'; }
      else if (pos === 'inside') {
        vAttrs['class'] += ' fxw-in-' + r.fill;
        if (roundRight) { vx = x1 - gap; vAttrs['text-anchor'] = 'end'; }
        else { vx = x0 + gap; vAttrs['text-anchor'] = 'start'; }
      } else if (pos === 'right-clamp') { vx = plotX1; vAttrs['text-anchor'] = 'end'; }
      else { vx = plotX0; vAttrs['text-anchor'] = 'start'; }
      if (pos.indexOf('clamp') > 0) {
        vAttrs['paint-order'] = 'stroke'; vAttrs.stroke = 'var(--fxw-surface)'; vAttrs['stroke-width'] = 3;
      }
      txt(doc, g, vx, ty, r.value, vAttrs);

      // インタラクション
      g.addEventListener('pointerenter', function (ev) { show(g, r, localX(ev), localY(ev)); });
      g.addEventListener('pointermove', function (ev) {
        if (activeBar === g && !tip.hidden) placeTooltip(container, tip, localX(ev), localY(ev));
        else show(g, r, localX(ev), localY(ev));
      });
      g.addEventListener('pointerleave', function () { if (doc.activeElement !== g) hide(g); });
      g.addEventListener('focus', function () {
        var scale = svg.getBoundingClientRect().width / width || 1;
        show(g, r, ((x0 + x1) / 2) * scale, r.barY * scale);
      });
      g.addEventListener('blur', function () { hide(g); });
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { hide(g); }
        else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          var bars = gBars.querySelectorAll('.fxw-bar');
          var n = bars[idx + (ev.key === 'ArrowDown' ? 1 : -1)];
          if (n) { ev.preventDefault(); n.focus(); }
        }
      });
    });

    function localX(ev) { var b = container.getBoundingClientRect(); return ev.clientX - b.left; }
    function localY(ev) { var b = container.getBoundingClientRect(); return ev.clientY - b.top; }

    container.appendChild(svg);
    container.appendChild(tip);

    // リサイズ追従
    if (opts.responsive !== false && !opts.width && typeof root.ResizeObserver === 'function' && !state.ro) {
      state.ro = new root.ResizeObserver(function () {
        var w = Math.floor(container.clientWidth);
        if (w && Math.abs(w - state.lastWidth) >= 1 && state.result) {
          renderWaterfall(container, state.result, state.opts);
        }
      });
      state.ro.observe(container);
    }

    return { svg: svg, tooltip: tip, layout: stacked ? 'stacked' : 'wide', axis: { min: axisMin, max: axisMax, step: step, truncated: truncated } };
  }

  /* ================================================================== */
  /* 価格推移チャート                                                   */
  /* ================================================================== */

  var TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map(function (m) { return m * 60000; });

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function wall(ms, tz) {
    if (W() && W().wallClock) return W().wallClock(ms, tz);
    var d = new Date(ms);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(),
      minute: d.getUTCMinutes(), second: d.getUTCSeconds(), offset: 0 };
  }

  // 表示 TZ の壁時計で揃えた時刻目盛り
  function timeTicks(t0, t1, plotW, tz) {
    var maxTicks = Math.max(2, Math.floor(plotW / 64));
    var step = TIME_STEPS[TIME_STEPS.length - 1];
    for (var i = 0; i < TIME_STEPS.length; i++) {
      if ((t1 - t0) / TIME_STEPS[i] <= maxTicks) { step = TIME_STEPS[i]; break; }
    }
    if ((t1 - t0) / step > maxTicks) step = Math.ceil((t1 - t0) / maxTicks / 86400000) * 86400000;
    var off0 = wall(t0, tz).offset;
    var local = t0 + off0;
    var L = Math.ceil(local / step) * step;
    var ticks = [];
    for (var guard = 0; guard < 400; guard++) {
      var t = L - wall(L - off0, tz).offset;
      t = L - wall(t, tz).offset;
      if (t > t1) break;
      if (t >= t0) ticks.push(t);
      L += step;
    }
    return { step: step, ticks: ticks };
  }

  function priceTooltip(doc, tip, lines) {
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    lines.forEach(function (l) {
      if (!l) return;
      var d = doc.createElement('div');
      d.className = l.cls || 'fxw-tip-meta';
      if (l.key) {
        var k = doc.createElement('span');
        k.className = 'fxw-tip-key';
        k.style.background = l.key;
        d.appendChild(k);
      }
      d.appendChild(doc.createTextNode(l.text));
      tip.appendChild(d);
    });
  }

  /**
   * renderPriceChart(container, dataset, result, analysis, opts)
   * opts: { tz, pair, title, width, height, responsive }
   * SVG 要素の data-role: line / point / event-marker / high / low / start / end / level / crosshair /
   *   hover-area / basis-note / x-axis / y-axis
   */
  function renderPriceChart(container, dataset, result, analysis, opts) {
    opts = opts || {};
    var doc = container.ownerDocument || root.document;
    injectStyle(doc);
    var state = container._fxp || (container._fxp = {});
    state.args = [dataset, result, analysis];
    state.opts = opts;
    container.classList.add('fxw-root');
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!result || !analysis) return null;

    var tz = opts.tz || 'Asia/Tokyo';
    var pair = opts.pair || 'USD/JPY';
    var width = Math.floor(opts.width || container.clientWidth || 640);
    if (width < 240) width = 240;
    state.lastWidth = width;
    var narrow = width < 600;
    var height = Math.floor(opts.height || (narrow ? 250 : 320));
    var t0 = result.start.time, t1 = result.end.time;
    var basis = analysis.basis;

    // ---- 点列 ----
    var pts;
    if (basis === 'series') {
      var norm = (W() && W().normalizeSeries) ? W().normalizeSeries(dataset && dataset.series) : [];
      pts = norm.filter(function (p) { return p.time >= t0 && p.time <= t1; });
    } else {
      pts = [{ time: t0, rate: result.start.rate }];
      result.items.slice().sort(function (a, b) { return a.time - b.time; }).forEach(function (it) {
        pts.push({ time: it.preTime != null && it.preTime >= t0 ? it.preTime : it.time - 1, rate: it.pre });
        pts.push({ time: it.postTime != null && it.postTime <= t1 ? it.postTime : it.time, rate: it.post });
      });
      pts.push({ time: t1, rate: result.end.rate });
      pts.sort(function (a, b) { return a.time - b.time; });
    }

    // ---- 凡例 ----
    var legend = doc.createElement('ul');
    legend.className = 'fxw-legend';
    legend.setAttribute('aria-label', '凡例');
    function legendItem(key, cls, text) {
      var li = doc.createElement('li');
      li.setAttribute('data-legend', key);
      var sw = doc.createElement('span');
      sw.className = cls;
      sw.setAttribute('aria-hidden', 'true');
      li.appendChild(sw);
      li.appendChild(doc.createTextNode(text));
      legend.appendChild(li);
    }
    legendItem('line', 'fxw-key-line', basis === 'series' ? pair + '（終値）' : pair + '（点を結んだ推定）');
    legendItem('weak', 'fxw-key-tri up', '円安イベント');
    legendItem('strong', 'fxw-key-tri down', '円高イベント');
    legendItem('high', 'fxw-key-dot', '期間高値');
    if (analysis.levels && analysis.levels.length) legendItem('level', 'fxw-key-dash', '警戒ライン');
    container.appendChild(legend);

    // ---- y スケール ----
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) {
      lo = Math.min(lo, p.low != null ? p.low : p.rate);
      hi = Math.max(hi, p.high != null ? p.high : p.rate);
    });
    [result.start.rate, result.end.rate, analysis.high.rate, analysis.low.rate].forEach(function (v) {
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    });
    var span0 = Math.max(hi - lo, 0.05);
    var levels = (analysis.levels || []).map(function (l) {
      var inside = l.rate >= lo - span0 * 0.6 && l.rate <= hi + span0 * 0.6;
      return { l: l, inside: inside };
    });
    levels.forEach(function (x) { if (x.inside) { lo = Math.min(lo, x.l.rate); hi = Math.max(hi, x.l.rate); } });
    var span = Math.max(hi - lo, 0.05);
    var yMin = lo - span * 0.08, yMax = hi + span * 0.12;

    var TICK = 11;
    var nOff = levels.filter(function (x) { return !x.inside; }).length;
    var padTop = 26 + (nOff + (basis === 'points' ? 1 : 0)) * 15, padBottom = 40;
    var plotY0 = padTop, plotY1 = height - padBottom;
    var yStep = niceStep((yMax - yMin) / Math.max(3, Math.floor((plotY1 - plotY0) / 44)));
    var yDec = Math.max(2, decimalsOf(yStep));
    var yA = Math.floor(yMin / yStep) * yStep, yB = Math.ceil(yMax / yStep) * yStep;
    var yTicks = [];
    for (var v = yA; v <= yB + yStep / 1000; v += yStep) yTicks.push(Number(v.toFixed(6)));
    var labW = 0;
    yTicks.forEach(function (tv) { labW = Math.max(labW, textWidth(tv.toFixed(yDec), TICK, 400)); });
    var plotX0 = Math.ceil(labW) + 10, plotX1 = width - 8;
    var plotW = plotX1 - plotX0;
    function sy(r) { return plotY1 - (r - yA) / (yB - yA) * (plotY1 - plotY0); }
    var tpad = (t1 - t0) * 0.015;
    var xA = t0 - tpad, xB = t1 + tpad;
    function sx(t) { return plotX0 + (t - xA) / (xB - xA) * plotW; }

    // ---- SVG ----
    var id = 'fxp-' + (++uid);
    var title = opts.title || (pair + ' 価格推移');
    var ariaLabel = title + '。' + fmtTime(t0, tz) + ' から ' + fmtTime(t1, tz) + '。期間高値 ' + fmtRate3(analysis.high.rate) +
      '（' + fmtTime(analysis.high.time, tz) + '）、B時点 ' + fmtRate3(result.end.rate) + '、高値との差 ' + fmtPips(analysis.fromHighPips) +
      '。イベント ' + result.items.length + ' 件。' + (basis === 'points' ? '価格系列がないため点を結んだ粗い推定です。' : '');
    var svg = el(doc, 'svg', {
      'class': 'fxw-svg fxw-price', role: 'img', 'aria-label': ariaLabel, viewBox: '0 0 ' + width + ' ' + height,
      width: width, height: height, 'data-basis': basis
    });
    el(doc, 'title', {}, svg).textContent = title;

    // グリッド・y 軸
    var gY = el(doc, 'g', { 'class': 'fxw-gridlayer', 'data-role': 'y-axis', 'aria-hidden': 'true' }, svg);
    yTicks.forEach(function (tv) {
      var y = Math.round(sy(tv)) + 0.5;
      el(doc, 'line', { 'class': 'fxw-grid', x1: plotX0, x2: plotX1, y1: y, y2: y }, gY);
      txt(doc, gY, plotX0 - 6, y + 4, tv.toFixed(yDec), { 'class': 'fxw-tick fxw-muted', 'font-size': TICK, 'text-anchor': 'end' });
    });
    // x 軸
    var gX = el(doc, 'g', { 'class': 'fxw-gridlayer', 'data-role': 'x-axis', 'aria-hidden': 'true' }, svg);
    el(doc, 'line', { 'class': 'fxw-axisline', x1: plotX0, x2: plotX1, y1: plotY1 + 0.5, y2: plotY1 + 0.5 }, gX);
    var tt = timeTicks(t0, t1, plotW, tz);
    var prevDay = null;
    tt.ticks.forEach(function (t, i) {
      var x = Math.round(sx(t)) + 0.5;
      var w = wall(t, tz);
      var dayKey = w.month + '/' + w.day;
      var anchor = x < plotX0 + 20 ? 'start' : x > plotX1 - 20 ? 'end' : 'middle';
      el(doc, 'line', { 'class': 'fxw-axisline', x1: x, x2: x, y1: plotY1, y2: plotY1 + 4 }, gX);
      if (tt.step >= 86400000) {
        txt(doc, gX, x, plotY1 + 16, pad2(w.month) + '/' + pad2(w.day), { 'class': 'fxw-tick fxw-muted', 'font-size': TICK, 'text-anchor': anchor });
      } else {
        txt(doc, gX, x, plotY1 + 16, pad2(w.hour) + ':' + pad2(w.minute), { 'class': 'fxw-tick fxw-muted', 'font-size': TICK, 'text-anchor': anchor });
        if (dayKey !== prevDay) {
          txt(doc, gX, x, plotY1 + 30, pad2(w.month) + '/' + pad2(w.day), { 'class': 'fxw-tick fxw-muted', 'font-size': TICK, 'text-anchor': anchor });
        }
      }
      prevDay = dayKey;
    });
    var tzName = W() && W().tzLabel ? W().tzLabel(tz, t1) : tz;
    txt(doc, gX, plotX1, height - 2, '時刻: ' + tzName, { 'class': 'fxw-muted', 'font-size': TICK, 'text-anchor': 'end' });

    // 警戒ライン
    var gLv = el(doc, 'g', { 'class': 'fxw-levels' }, svg);
    var offRow = 0;
    if (basis === 'points') {
      // 価格系列がないことを先頭行に明示
      var note = '価格系列なし：点を結んだ粗い推定（実際の高値・安値は外側にある可能性）';
      if (textWidth(note, TICK, 400) > plotX1 - plotX0) note = '価格系列なし：点を結んだ粗い推定';
      txt(doc, svg, plotX1, 12 + 15 * offRow++, note, { 'class': 'fxw-t2', 'font-size': TICK, 'text-anchor': 'end', 'data-role': 'basis-note' });
    }
    levels.forEach(function (x) {
      var l = x.l;
      var lab = (l.label ? l.label + ' ' : '警戒 ') + l.rate.toFixed(2) + '（' + fmtPips(l.distancePips) + '）';
      if (x.inside) {
        var y = Math.round(sy(l.rate)) + 0.5;
        var g = el(doc, 'g', { 'data-role': 'level', 'data-rate': l.rate, 'data-offscale': 'none' }, gLv);
        el(doc, 'line', { 'class': 'fxw-level-line', x1: plotX0, x2: plotX1, y1: y, y2: y }, g);
        txt(doc, g, plotX0 + 4, y - 4, lab, { 'class': 'fxw-t2 fxw-halo', 'font-size': TICK, 'text-anchor': 'start' });
      } else {
        // 表示範囲外の水準は、プロットの上に 1 行ずつ並べる（線と重ならないように）
        var above = l.rate > hi;
        var g2 = el(doc, 'g', { 'data-role': 'level', 'data-rate': l.rate, 'data-offscale': above ? 'above' : 'below' }, gLv);
        var offText = (above ? '↑ ' : '↓ ') + lab + '（表示範囲外）';
        if (textWidth(offText, TICK, 400) > plotX1 - 4) offText = (above ? '↑ ' : '↓ ') + l.rate.toFixed(2) + '（' + fmtPips(l.distancePips) + '）範囲外';
        txt(doc, g2, plotX1, 12 + 15 * offRow++, offText,
          { 'class': 'fxw-muted', 'font-size': TICK, 'text-anchor': 'end' });
      }
    });

    // 価格線（大きな空白で途切れさせる）
    var gLine = el(doc, 'g', { 'class': 'fxw-linelayer' }, svg);
    var gapLimit = Infinity;
    if (basis === 'series' && pts.length > 2) {
      var diffs = [];
      for (var di = 1; di < pts.length; di++) diffs.push(pts[di].time - pts[di - 1].time);
      diffs.sort(function (a, b) { return a - b; });
      gapLimit = Math.max(diffs[Math.floor(diffs.length / 2)] * 10, 30 * 60000);
    }
    var d = '', prevT = null, lastPx = null, bucket = null;
    function flush() {
      if (!bucket) return;
      var arr = [bucket.first, bucket.min, bucket.max, bucket.last].filter(function (p, i, a) { return a.indexOf(p) === i; });
      arr.sort(function (a, b) { return a.time - b.time; });
      arr.forEach(function (p) {
        d += (bucket.move ? 'M' : 'L') + sx(p.time).toFixed(1) + ',' + sy(p.rate).toFixed(1);
        bucket.move = false;
      });
      bucket = null;
    }
    pts.forEach(function (p) {
      var px = Math.round(sx(p.time));
      var brk = prevT != null && p.time - prevT > gapLimit;
      if (bucket && (px !== lastPx || brk)) flush();
      if (!bucket) bucket = { first: p, min: p, max: p, last: p, move: d === '' || brk };
      else {
        if (p.rate < bucket.min.rate) bucket.min = p;
        if (p.rate > bucket.max.rate) bucket.max = p;
        bucket.last = p;
      }
      lastPx = px; prevT = p.time;
    });
    flush();
    el(doc, 'path', { 'class': 'fxw-pline', 'data-role': 'line', 'data-basis': basis, 'data-points': pts.length, d: d }, gLine);
    if (basis === 'points') {
      pts.forEach(function (p) {
        el(doc, 'circle', { 'class': 'fxw-pdot', 'data-role': 'point', cx: sx(p.time).toFixed(1), cy: sy(p.rate).toFixed(1), r: 3.5 }, gLine);
      });
    }

    // ツールチップ
    var tip = doc.createElement('div');
    tip.className = 'fxw-tooltip';
    tip.id = id + '-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;

    // ホバー層（クロスヘア）— イベントマーカーより下に置く
    var gHover = el(doc, 'g', {}, svg);
    var hoverRect = el(doc, 'rect', { 'data-role': 'hover-area', x: plotX0, y: plotY0, width: plotW, height: plotY1 - plotY0, fill: 'transparent' }, gHover);
    var cross = el(doc, 'line', { 'class': 'fxw-crosshair', 'data-role': 'crosshair', x1: 0, x2: 0, y1: plotY0, y2: plotY1, visibility: 'hidden' }, gHover);
    var fdot = el(doc, 'circle', { 'class': 'fxw-focusdot', r: 4, cx: 0, cy: 0, visibility: 'hidden' }, gHover);
    function nearest(t) {
      var a = 0, b = pts.length - 1;
      while (b - a > 1) { var m = (a + b) >> 1; if (pts[m].time < t) a = m; else b = m; }
      return Math.abs(pts[a].time - t) <= Math.abs(pts[b].time - t) ? pts[a] : pts[b];
    }
    function localXY(ev) { var r = container.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    function svgScale() { return svg.getBoundingClientRect().width / width || 1; }
    hoverRect.addEventListener('pointermove', function (ev) {
      if (!pts.length) return;
      var xy = localXY(ev), sc = svgScale();
      var svgLeft = svg.getBoundingClientRect().left - container.getBoundingClientRect().left;
      var t = xA + ((xy[0] - svgLeft) / sc - plotX0) / plotW * (xB - xA);
      var p = nearest(t);
      var x = sx(p.time), y = sy(p.rate);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      fdot.setAttribute('cx', x); fdot.setAttribute('cy', y); fdot.setAttribute('visibility', 'visible');
      priceTooltip(doc, tip, [
        { cls: 'fxw-tip-value', text: fmtRate3(p.rate) },
        { text: fmtTime(p.time, tz) + (basis === 'series' ? '（足の終値時刻）' : '') },
        p.high != null ? { text: '高値 ' + fmtRate3(p.high) + ' / 安値 ' + fmtRate3(p.low) } : null,
        { text: 'B時点との差 ' + fmtPips((result.end.rate - p.rate) * 100) }
      ]);
      placeTooltip(container, tip, svgLeft + x * sc, xy[1]);
    });
    hoverRect.addEventListener('pointerleave', function () {
      cross.setAttribute('visibility', 'hidden'); fdot.setAttribute('visibility', 'hidden'); tip.hidden = true;
    });

    // イベントマーカー
    var gEv = el(doc, 'g', { 'class': 'fxw-events' }, svg);
    var evs = result.items.slice().sort(function (a, b) { return a.time - b.time; });
    var reactions = {};
    (analysis.reactions || []).forEach(function (r) { reactions[r.id] = r; });
    evs.forEach(function (it, idx) {
      var x = Math.round(sx(it.time)) + 0.5;
      var g = el(doc, 'g', {
        'class': 'fxw-ev', 'data-role': 'event-marker', 'data-id': it.id, 'data-direction': it.direction,
        'data-importance': it.importance, tabindex: '0', 'data-index': idx, 'aria-describedby': tip.id,
        'aria-label': it.label + ' ' + fmtTime(it.time, tz) + ' ' + fmtPips(it.pips)
      }, gEv);
      el(doc, 'rect', { 'class': 'fxw-hit', x: x - 7, y: plotY0 - 14, width: 14, height: plotY1 - plotY0 + 14, rx: 3 }, g);
      el(doc, 'line', { 'class': 'fxw-ev-line', x1: x, x2: x, y1: plotY0 - 4, y2: plotY1 }, g);
      var hy = plotY0 - 9, s2 = it.importance === 'high' ? 6 : 5;
      var tri = it.direction === 'strong'
        ? 'M' + (x - s2) + ',' + (hy - s2 * 0.8) + 'L' + (x + s2) + ',' + (hy - s2 * 0.8) + 'L' + x + ',' + (hy + s2 * 0.8) + 'Z'
        : 'M' + (x - s2) + ',' + (hy + s2 * 0.8) + 'L' + (x + s2) + ',' + (hy + s2 * 0.8) + 'L' + x + ',' + (hy - s2 * 0.8) + 'Z';
      el(doc, 'path', { 'class': 'fxw-ev-head', d: tri }, g);
      var rx = reactions[it.id];
      function show() {
        g.classList.add('fxw-active');
        priceTooltip(doc, tip, [
          { cls: 'fxw-tip-value', text: fmtPips(it.pips) + '（' + fmtPct(it.pct) + '）',
            key: 'var(--fxw-' + (it.direction === 'weak' ? 'weak' : it.direction === 'strong' ? 'strong' : 'residual') + ')' },
          { cls: 'fxw-tip-label', text: it.label },
          { text: fmtTime(it.time, tz) + ' · 重要度 ' + (IMP_LABEL[it.importance] || '—') + ' · ' + DIR_LABEL[it.direction] + '要因' },
          { text: '前 ' + fmtRate3(it.pre) + ' → 後 ' + fmtRate3(it.post) },
          rx && rx.extreme ? { text: '発表後の極値 ' + fmtRate3(rx.extreme.rate) + '（' + fmtTime(rx.extreme.time, tz) + '）· 伸び ' +
            fmtPips(rx.extensionPips) + (rx.retracePct != null ? ' · 戻り ' + rx.retracePct.toFixed(0) + '%' : '') } : null
        ]);
        var sc = svgScale();
        var svgLeft = svg.getBoundingClientRect().left - container.getBoundingClientRect().left;
        var svgTop = svg.getBoundingClientRect().top - container.getBoundingClientRect().top;
        placeTooltip(container, tip, svgLeft + x * sc, svgTop + (plotY0 + 10) * sc);
      }
      function hide() { g.classList.remove('fxw-active'); tip.hidden = true; }
      g.addEventListener('pointerenter', show);
      g.addEventListener('pointerleave', function () { if (doc.activeElement !== g) hide(); });
      g.addEventListener('focus', show);
      g.addEventListener('blur', hide);
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') hide();
        else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
          var all = gEv.querySelectorAll('.fxw-ev');
          var n = all[idx + (ev.key === 'ArrowRight' ? 1 : -1)];
          if (n) { ev.preventDefault(); n.focus(); }
        }
      });
    });

    // 期間高値・安値
    function extremeMark(role, p, labelText, below) {
      var g = el(doc, 'g', { 'data-role': role, 'data-rate': p.rate, 'data-time': p.time }, svg);
      var x = sx(p.time), y = sy(p.rate);
      el(doc, 'circle', { 'class': role === 'high' ? 'fxw-extreme' : 'fxw-extreme-low', cx: x.toFixed(1), cy: y.toFixed(1), r: role === 'high' ? 4.5 : 4 }, g);
      var tw = textWidth(labelText, TICK, role === 'high' ? 600 : 400);
      var anchor = 'middle', lx = x;
      if (x - tw / 2 < plotX0 + 2) { anchor = 'start'; lx = Math.max(plotX0 + 2, x - 6); }
      else if (x + tw / 2 > plotX1 - 2) { anchor = 'end'; lx = Math.min(plotX1 - 2, x + 6); }
      var ly = below ? Math.min(plotY1 - 4, y + 16) : Math.max(plotY0 + 10, y - 9);
      txt(doc, g, lx, ly, labelText, { 'class': 'fxw-halo' + (role === 'high' ? '' : ' fxw-t2'), 'font-size': TICK,
        'font-weight': role === 'high' ? 600 : 400, 'text-anchor': anchor });
      return g;
    }
    extremeMark('high', analysis.high, '高値 ' + fmtRate3(analysis.high.rate) + '（' + fmtTime(analysis.high.time, tz, { tzLabel: false }) + '）', false);
    if (analysis.low.time !== analysis.high.time) {
      extremeMark('low', analysis.low, '安値 ' + fmtRate3(analysis.low.rate), true);
    }

    // A / B 時点
    [['start', 'A', result.start], ['end', 'B', result.end]].forEach(function (a) {
      var x = sx(a[2].time), y = sy(a[2].rate);
      var g = el(doc, 'g', { 'data-role': a[0], 'data-time': a[2].time, 'data-rate': a[2].rate }, svg);
      el(doc, 'circle', { 'class': 'fxw-ab', cx: x.toFixed(1), cy: y.toFixed(1), r: 4.5 }, g);
      var lab = a[0] === 'end' ? 'B ' + fmtRate3(a[2].rate) : 'A';
      var isEnd = a[0] === 'end';
      var below = isEnd ? y < plotY0 + 30 : y < plotY0 + 30;
      txt(doc, g, isEnd ? x - 8 : x + 8, below ? y + 18 : y - 9, lab,
        { 'class': 'fxw-halo', 'font-size': 12, 'font-weight': 700, 'text-anchor': isEnd ? 'end' : 'start' });
    });

    container.appendChild(svg);
    container.appendChild(tip);

    if (opts.responsive !== false && !opts.width && typeof root.ResizeObserver === 'function' && !state.ro) {
      state.ro = new root.ResizeObserver(function () {
        var w = Math.floor(container.clientWidth);
        if (w && Math.abs(w - state.lastWidth) >= 1 && state.args && state.args[1]) {
          renderPriceChart(container, state.args[0], state.args[1], state.args[2], state.opts);
        }
      });
      state.ro.observe(container);
    }
    return { svg: svg, tooltip: tip, basis: basis, points: pts.length };
  }

  return { renderWaterfall: renderWaterfall, renderPriceChart: renderPriceChart, wrapText: wrapText };
});
