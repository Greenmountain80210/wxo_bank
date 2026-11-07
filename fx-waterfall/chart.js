/*
 * USD/JPY 要因分解ウォーターフォール — SVG 描画（外部ライブラリなし）
 * 横向きウォーターフォール：行 = 要因（上から A時点 → 各イベント → その他要因 → B時点）
 * 公開: window.FxWaterfallChart.renderWaterfall(container, result, opts)
 *       （グローバル関数 window.renderWaterfall も同じもの）
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FxWaterfallChart = api;
    root.renderWaterfall = api.renderWaterfall;
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
    '  position:relative;color:var(--fxw-text);font-family:' + FONT + ';',
    '}',
    '@media (prefers-color-scheme: dark){:root:where(:not([data-theme="light"])) .fxw-root{',
    '  --fxw-surface:#1a1a19;--fxw-text:#f0efec;--fxw-text-2:#c3c2b7;--fxw-muted:#9a988f;',
    '  --fxw-grid:#2c2c2a;--fxw-axis:#4a4a46;--fxw-connector:#6e6d68;',
    '  --fxw-weak:#e66767;--fxw-strong:#3987e5;--fxw-residual:#6e6d68;--fxw-total:#c3c2b7;',
    '  --fxw-on-weak:#0b0b0b;--fxw-on-strong:#ffffff;--fxw-on-residual:#ffffff;--fxw-on-total:#0b0b0b;',
    '  --fxw-hover:rgba(255,255,255,0.06);--fxw-focus:#3987e5;--fxw-tip-bg:#242423;--fxw-tip-border:rgba(255,255,255,0.14);',
    '}}',
    ':root[data-theme="dark"] .fxw-root{',
    '  --fxw-surface:#1a1a19;--fxw-text:#f0efec;--fxw-text-2:#c3c2b7;--fxw-muted:#9a988f;',
    '  --fxw-grid:#2c2c2a;--fxw-axis:#4a4a46;--fxw-connector:#6e6d68;',
    '  --fxw-weak:#e66767;--fxw-strong:#3987e5;--fxw-residual:#6e6d68;--fxw-total:#c3c2b7;',
    '  --fxw-on-weak:#0b0b0b;--fxw-on-strong:#ffffff;--fxw-on-residual:#ffffff;--fxw-on-total:#0b0b0b;',
    '  --fxw-hover:rgba(255,255,255,0.06);--fxw-focus:#3987e5;--fxw-tip-bg:#242423;--fxw-tip-border:rgba(255,255,255,0.14);',
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
    var startLabel = opts.startLabel || 'A時点';
    var endLabel = opts.endLabel || 'B時点';
    var rows = [];
    rows.push({
      kind: 'start', id: 'start', label: startLabel, meta: result.start.date,
      level: result.start.rate, direction: 'neutral', fill: 'total',
      value: fmtRate(result.start.rate), item: result.start
    });
    result.items.forEach(function (it) {
      rows.push({
        kind: 'event', id: it.id, label: it.label,
        meta: it.date + (it.category ? ' · ' + it.category : ''),
        from: it.from, to: it.to, direction: it.direction,
        fill: it.direction === 'weak' ? 'weak' : it.direction === 'strong' ? 'strong' : 'residual',
        value: fmtYen(it.yen) + '（' + fmtPct(it.pct) + '）', item: it
      });
    });
    var res = result.residual;
    rows.push({
      kind: 'residual', id: 'residual', label: 'その他要因', meta: 'イベント外の値動きの合計',
      from: res.from, to: res.to, direction: res.direction, fill: 'residual',
      value: fmtYen(res.yen) + '（' + fmtPct(res.pct) + '）', item: res
    });
    rows.push({
      kind: 'end', id: 'end', label: endLabel, meta: result.end.date,
      level: result.end.rate, direction: result.totalYen > 0 ? 'weak' : result.totalYen < 0 ? 'strong' : 'neutral',
      fill: 'total', value: fmtRate(result.end.rate), item: result.end
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

    if (row.kind === 'start' || row.kind === 'end') {
      div('fxw-tip-meta', row.meta + ' 時点の ' + (opts.pair || 'USD/JPY') + ' レート');
      if (row.kind === 'end') {
        div('fxw-tip-meta', 'A時点からの変化 ' + fmtYen(result.totalYen) + '（' + fmtPct(result.totalPct) + '）');
      }
    } else if (row.kind === 'residual') {
      div('fxw-tip-meta', DIR_LABEL[row.direction] + '方向 · ' + fmtRate(it.from) + ' → ' + fmtRate(it.to));
      div('fxw-tip-desc', 'A→B の値動きのうち、上に並べたイベントの窓の外で生じた分の合計です。');
    } else {
      div('fxw-tip-meta', row.meta + ' · ' + DIR_LABEL[row.direction] + '要因');
      div('fxw-tip-meta', '前 ' + fmtRate(it.pre) + ' → 後 ' + fmtRate(it.post) +
        '（イベント単体 ' + fmtPct(it.eventPct) + '）');
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
    var total = fmtYen(result.totalYen) + '（' + fmtPct(result.totalPct) + '）';
    var ariaLabel = title + '。A時点 ' + result.start.date + ' の ' + fmtRate(result.start.rate) +
      ' から B時点 ' + result.end.date + ' の ' + fmtRate(result.end.rate) + ' へ ' + total + '。' +
      '円安要因の合計 ' + fmtYen(result.sumWeakYen) + '、円高要因の合計 ' + fmtYen(result.sumStrongYen) +
      '、その他要因 ' + fmtYen(result.residual.yen) + '。イベント ' + result.items.length + ' 件。詳細はチャート下の表を参照。';
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
        'data-id': r.id, 'data-index': idx, 'aria-describedby': tip.id,
        'aria-label': r.label + ' ' + (r.kind === 'event' ? r.meta + ' ' : '') + r.value
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

      // 値ラベル：外側 → 反対側 → 内側 の順で収まる位置を選ぶ
      var vw = textWidth(r.value, VALUE_SIZE, 600);
      var gap = 6, ty = r.barY + BAR_H / 2 + 4;
      var rightRoom = plotX1 - x1 - gap, leftRoom = x0 - plotX0 - gap, inside = x1 - x0 - 2 * gap;
      var pos;
      var prefersLeft = !isTotal && r.direction === 'strong';
      if (prefersLeft && leftRoom >= vw) pos = 'left';
      else if (!prefersLeft && rightRoom >= vw) pos = 'right';
      else if (prefersLeft && rightRoom >= vw) pos = 'right';
      else if (!prefersLeft && leftRoom >= vw && !isTotal) pos = 'left';
      else if (inside >= vw) pos = 'inside';
      else pos = rightRoom >= leftRoom ? 'right-clamp' : 'left-clamp';
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

  return { renderWaterfall: renderWaterfall, wrapText: wrapText };
});
