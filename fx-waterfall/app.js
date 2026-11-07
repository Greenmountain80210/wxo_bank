/*
 * USD/JPY 短期要因分解 — UI 結線
 * 依存: window.FX_DATASETS（任意）, window.FxWaterfall, window.FxWaterfallChart
 * 表示は事実の集計のみ。売買推奨・将来予測の表現は使わない。
 */
(function () {
  'use strict';

  var FW = window.FxWaterfall;
  var CH = window.FxWaterfallChart;
  var CATEGORIES = ['米国政治', '米国指標', '米金融政策', '日本政治', '日銀', '介入・要人発言', '地政学', 'その他'];
  var IMPORTANCE = [['high', '高'], ['medium', '中'], ['low', '低']];
  var IMP_LABEL = { high: '高', medium: '中', low: '低' };
  var DIR_LABEL = { weak: '円安', strong: '円高', neutral: '中立' };
  var TZS = ['Asia/Tokyo', 'UTC', 'America/New_York'];

  var state = {
    datasets: [],   // 元データ（ディープコピー）
    index: -1,
    working: null,  // 編集中のデータセット
    order: 'chronological',
    tz: 'Asia/Tokyo',
    lastResult: null,
    lastAnalysis: null
  };
  var idCounter = 0;

  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function setText(id, s) { var n = $(id); if (n) n.textContent = s == null ? '' : s; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] == null) return;
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'className') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function safeUrl(u) { return typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null; }
  function num(v) {
    if (v === '' || v == null) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function rate3(n) { return typeof n === 'number' && isFinite(n) ? n.toFixed(3) : '—'; }
  function ft(ms, o) { return FW.formatTime(ms, state.tz, o); }
  function status(msg) { setText('file-status', msg || ''); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } }
  function load(k) { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } }

  // 入力欄（datetime-local, 表示 TZ）⇔ データの ISO 文字列
  function isoToInput(iso) {
    var t = FW.parseTime(iso);
    return t == null ? '' : FW.toLocalInput(t, state.tz);
  }
  function inputToIso(value) {
    var t = FW.fromLocalInput(value, state.tz);
    return t == null ? '' : FW.toIso(t, state.tz);
  }

  /* ---------------- 初期化 ---------------- */

  function init() {
    if (!FW || !CH) {
      document.body.insertBefore(h('div', { className: 'alert alert-error', role: 'alert',
        text: 'スクリプト（waterfall.js / chart.js）の読み込みに失敗しました。' }), document.body.firstChild);
      return;
    }
    var src = window.FX_DATASETS;
    if (Array.isArray(src)) {
      src.forEach(function (d) { if (d && typeof d === 'object' && !Array.isArray(d)) state.datasets.push(clone(d)); });
    }
    var so = load('fxw-order');
    if (so === 'magnitude' || so === 'chronological') state.order = so;
    var st = load('fxw-tz');
    if (TZS.indexOf(st) >= 0) state.tz = st;
    var radio = $('order-' + state.order);
    if (radio) radio.checked = true;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="tz"]'), function (r) { r.checked = r.value === state.tz; });
    var ct = load('fxw-csv-tz');
    if (ct && Array.prototype.some.call($('csv-tz').options, function (o) { return o.value === ct; })) $('csv-tz').value = ct;

    bindToolbar();
    bindEditor();
    populateSelect();
    if (state.datasets.length) selectDataset(0);
    else showEmpty();
  }

  function populateSelect() {
    var sel = $('dataset-select');
    clear(sel);
    if (!state.datasets.length) {
      sel.appendChild(h('option', { value: '', text: '（データがありません）' }));
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    state.datasets.forEach(function (d, i) {
      sel.appendChild(h('option', { value: String(i), text: d.title || d.id || ('データセット ' + (i + 1)) }));
    });
    if (state.index >= 0) sel.value = String(state.index);
  }

  function showEmpty() {
    $('empty-state').hidden = false;
    $('workspace').hidden = true;
    $('json-export').disabled = true;
    $('csv-load').disabled = true;
  }

  function normalizeWorking(ds) {
    if (!Array.isArray(ds.events)) ds.events = [];
    if (ds.upcoming != null && !Array.isArray(ds.upcoming)) ds.upcoming = [];
    if (ds.levels != null && !Array.isArray(ds.levels)) ds.levels = [];
    if (!ds.start || typeof ds.start !== 'object') ds.start = {};
    if (!ds.end || typeof ds.end !== 'object') ds.end = {};
    return ds;
  }

  function selectDataset(i) {
    state.index = i;
    state.working = normalizeWorking(clone(state.datasets[i]));
    $('empty-state').hidden = true;
    $('workspace').hidden = false;
    $('json-export').disabled = false;
    $('csv-load').disabled = false;
    $('dataset-select').value = String(i);
    setText('csv-format', seriesInfo());
    $('csv-format').removeAttribute('data-format');
    renderEditor();
    recompute();
  }

  function seriesInfo() {
    var s = FW.normalizeSeries(state.working && state.working.series);
    if (!s.length) return '価格系列: なし（CSV を読み込むと高値・直近変化・イベント後の反応を計算できます）';
    return '価格系列: ' + s.length.toLocaleString('ja-JP') + ' 点（' + ft(s[0].time) + ' 〜 ' + ft(s[s.length - 1].time) + '）';
  }

  /* ---------------- 再計算と描画 ---------------- */

  function recompute() {
    var ds = state.working;
    if (!ds) return;
    setText('dataset-desc', ds.description || '');
    setText('dataset-notes', ds.notes ? 'データについて: ' + ds.notes : '');
    setText('input-tz-label', FW.tzLabel(state.tz));

    var v = FW.validateDataset(ds);
    var result = null, analysis = null, fatal = null;
    try {
      result = FW.decompose(ds, { order: state.order, tz: state.tz });
    } catch (e) {
      fatal = e && e.message ? e.message : String(e);
    }
    if (result) {
      try { analysis = FW.analyze(ds, result); }
      catch (e2) { fatal = '集計に失敗しました: ' + (e2 && e2.message ? e2.message : e2); }
    }
    renderPeriod(ds);
    renderErrors(v.errors, fatal);
    state.lastResult = result;
    state.lastAnalysis = analysis;
    $('end-latest').disabled = !FW.normalizeSeries(ds.series).length;

    var chart = $('chart'), price = $('price-chart');
    if (!result || !analysis) {
      if (chart._fxw) chart._fxw.result = null;
      if (price._fxp) price._fxp.args = null;
      [chart, price].forEach(function (c) {
        clear(c);
        c.appendChild(h('p', { className: 'chart-empty', text: 'A 時点・B 時点の日時（期間 5分〜5日）とレートを正しく入力すると、チャートが表示されます。' }));
      });
      renderSummary(null);
      renderSellPanel(null, null);
      renderTable(null);
      renderWarnings([]);
      updateEventPips(null);
      return;
    }
    var pair = ds.pair || 'USD/JPY';
    renderSummary(result);
    renderSellPanel(result, analysis);
    CH.renderPriceChart(price, ds, result, analysis, { tz: state.tz, pair: pair, title: pair + ' 価格推移（' + (ds.title || '') + '）' });
    CH.renderWaterfall(chart, result, { tz: state.tz, pair: pair, title: pair + ' 要因分解ウォーターフォール（' + (ds.title || '') + '）' });
    renderTable(result);
    renderWarnings(result.warnings);
    updateEventPips(result);
  }

  function renderPeriod(ds) {
    var p = $('period-duration');
    var a = FW.parseTime(ds.start && ds.start.time), b = FW.parseTime(ds.end && ds.end.time);
    if (a == null || b == null) {
      p.textContent = '期間: —（A・B の日時が未入力または不正です）';
      p.setAttribute('data-state', 'error');
      return;
    }
    var d = b - a;
    var ok = d >= FW.MIN_DURATION_MS && d <= FW.MAX_DURATION_MS;
    p.textContent = '期間: ' + FW.formatDuration(d) + (ok ? '' : d <= 0 ? '（B が A 以前です）' : d < FW.MIN_DURATION_MS ? '（5分未満のため計算できません）' : '（5日を超えるため計算できません）');
    p.setAttribute('data-state', ok ? 'ok' : 'error');
    p.setAttribute('data-duration-ms', String(d));
  }

  function renderErrors(errors, fatal) {
    var box = $('errors');
    clear(box);
    var list = (fatal ? [fatal] : []).concat((errors || []).filter(function (m) { return m !== fatal; }));
    if (!list.length) { box.hidden = true; return; }
    box.appendChild(h('strong', { text: '入力エラー' }));
    var ul = h('ul');
    list.slice(0, 20).forEach(function (m) { ul.appendChild(h('li', { text: m })); });
    if (list.length > 20) ul.appendChild(h('li', { text: '…ほか ' + (list.length - 20) + ' 件' }));
    box.appendChild(ul);
    box.hidden = false;
  }

  function renderWarnings(warnings) {
    var box = $('warnings');
    clear(box);
    if (!warnings || !warnings.length) { box.hidden = true; return; }
    box.appendChild(h('strong', { text: '注意' }));
    var ul = h('ul');
    warnings.forEach(function (m) { ul.appendChild(h('li', { text: m })); });
    box.appendChild(ul);
    box.hidden = false;
  }

  function renderSummary(r) {
    var head = $('summary-headline');
    clear(head);
    if (!r) {
      head.textContent = '—';
      setText('summary-dates', '');
      ['sum-weak', 'sum-strong', 'sum-residual', 'sum-weak-sub', 'sum-strong-sub', 'sum-residual-sub'].forEach(function (id) { setText(id, '—'); });
      return;
    }
    head.appendChild(h('span', { 'data-part': 'start', text: 'A ' + rate3(r.start.rate) }));
    head.appendChild(h('span', { className: 'arrow', text: ' → ' }));
    head.appendChild(h('span', { 'data-part': 'end', text: 'B ' + rate3(r.end.rate) }));
    head.appendChild(h('span', { className: 'delta', 'data-part': 'delta',
      text: '（' + FW.formatPips(r.totalPips) + ', ' + FW.formatPct(r.totalPct) + '）' }));
    setText('summary-dates', 'A ' + ft(r.start.time) + ' ／ B ' + ft(r.end.time) + ' ・ 差し引き ' +
      (r.totalYen > 0 ? '円安' : r.totalYen < 0 ? '円高' : '変化なし') + '（' + FW.formatYen(r.totalYen) + '）');

    var nWeak = r.items.filter(function (i) { return i.direction === 'weak'; }).length;
    var nStrong = r.items.filter(function (i) { return i.direction === 'strong'; }).length;
    setText('sum-weak', FW.formatPips(r.sumWeakPips));
    setText('sum-weak-sub', FW.formatYen(r.sumWeakYen) + ' ・ ' + nWeak + ' 件');
    setText('sum-strong', FW.formatPips(r.sumStrongPips));
    setText('sum-strong-sub', FW.formatYen(r.sumStrongYen) + ' ・ ' + nStrong + ' 件');
    setText('sum-residual', FW.formatPips(r.residual.pips));
    setText('sum-residual-sub', FW.formatYen(r.residual.yen) + ' ・ イベント外');
  }

  /* ---------------- 売りエントリーの判断材料 ---------------- */

  function impTag(imp) {
    return h('span', { className: 'imp-tag', 'data-importance': imp, text: '重要度 ' + (IMP_LABEL[imp] || '—') });
  }

  function renderSellPanel(r, a) {
    var body = $('sp-body'), empty = $('sp-empty'), alertBox = $('sp-next-alert'), badge = $('sp-basis');
    if (!r || !a) {
      body.hidden = true;
      empty.hidden = false;
      alertBox.hidden = true;
      badge.textContent = '';
      badge.setAttribute('data-basis', '');
      return;
    }
    body.hidden = false;
    empty.hidden = true;
    badge.setAttribute('data-basis', a.basis);
    badge.textContent = a.basis === 'series' ? '価格系列から計算（' + a.pointCount.toLocaleString('ja-JP') + ' 点）' : '価格系列なし：粗い推定';

    setText('sp-end', rate3(a.end.rate));
    setText('sp-end-sub', ft(a.end.time) + ' ・ A から ' + FW.formatPips(a.totalPips));
    setText('sp-high', rate3(a.high.rate));
    setText('sp-high-sub', ft(a.high.time) + ' ・ B の ' + FW.formatDuration(a.end.time - a.high.time) + '前');
    setText('sp-from-high', FW.formatPips(a.fromHighPips));
    setText('sp-from-high-sub', '高値 ' + rate3(a.high.rate) + ' → B ' + rate3(a.end.rate));
    setText('sp-range-pos', a.rangePositionPct.toFixed(1) + '%');
    $('sp-range-mark').style.left = Math.max(0, Math.min(100, a.rangePositionPct)) + '%';
    setText('sp-range-low', '安値 ' + rate3(a.low.rate));
    setText('sp-range-high', '高値 ' + rate3(a.high.rate));
    setText('sp-range-sub', 'レンジ幅 ' + a.rangePips.toFixed(1) + ' pips ・ 安値から ' + FW.formatPips(a.fromLowPips));
    setText('sp-event-pips', FW.formatPips(a.eventDrivenPips));
    setText('sp-event-sub', 'イベント ' + r.items.length + ' 件の窓内の合計');
    setText('sp-nonevent-pips', FW.formatPips(a.nonEventPips));

    a.momentum.forEach(function (m) {
      var n = $('sp-mom-' + m.minutes);
      if (!n) return;
      n.textContent = m.pips != null ? FW.formatPips(m.pips) : (a.basis === 'series' ? '—（データ不足）' : '—（系列なし）');
      n.setAttribute('data-value', m.pips != null ? String(m.pips) : '');
    });

    var next = $('sp-next'), nextSub = $('sp-next-sub');
    clear(next); clear(nextSub);
    if (a.nextEvent) {
      next.appendChild(document.createTextNode(a.nextEvent.label + ' '));
      next.appendChild(impTag(a.nextEvent.importance));
      nextSub.textContent = ft(a.nextEvent.time) + ' ・ B から ' + FW.formatDuration(a.nextEvent.time - a.end.time) + '後';
      if (a.nextHighEvent && a.nextHighEvent !== a.nextEvent) {
        nextSub.appendChild(h('br'));
        nextSub.appendChild(document.createTextNode('次の重要度「高」: ' + a.nextHighEvent.label + '（B から ' +
          FW.formatDuration(a.nextHighEvent.time - a.end.time) + '後）'));
      }
    } else {
      next.textContent = '登録なし';
      nextSub.textContent = '予定イベントは下の編集欄で追加できます';
    }
    if (a.nextEventWarning) {
      clear(alertBox);
      alertBox.appendChild(h('strong', { text: '注意: 重要度「高」の予定イベントが 60 分以内' }));
      alertBox.appendChild(document.createTextNode('「' + a.nextHighEvent.label + '」まで ' +
        FW.formatDuration(a.nextHighEvent.time - a.end.time) + '（' + ft(a.nextHighEvent.time) + '）。発表前後は値動きが大きくなることがあります。'));
      alertBox.hidden = false;
      alertBox.setAttribute('data-minutes', String(a.nextHighEvent.minutesUntil));
    } else {
      alertBox.hidden = true;
    }

    var lv = $('sp-levels');
    clear(lv);
    if (!a.levels.length) lv.appendChild(h('li', { 'data-empty': 'true', text: '警戒ラインは登録されていません' }));
    a.levels.forEach(function (l) {
      var where = l.position === 'above' ? 'B より上' : l.position === 'below' ? 'B より下' : 'B と同水準';
      lv.appendChild(h('li', { 'data-rate': String(l.rate), 'data-position': l.position }, [
        h('span', { text: l.rate.toFixed(3) + (l.label ? ' ' + l.label : '') }),
        h('span', { className: 'num', text: FW.formatPips(l.distancePips) + '（' + where + '）' })
      ]));
    });

    var tb = $('sp-reactions-tbody');
    clear(tb);
    if (a.basis !== 'series') {
      tb.appendChild(h('tr', { 'data-empty': 'true' }, [h('td', { colspan: '6', className: 'cell-label', text: '価格系列がないため計算できません（価格 CSV を読み込むと計算します）' })]));
    } else if (!a.reactions.length) {
      tb.appendChild(h('tr', { 'data-empty': 'true' }, [h('td', { colspan: '6', className: 'cell-label', text: '期間内のイベントがありません' })]));
    }
    if (a.basis === 'series') a.reactions.forEach(function (x) {
      var dirFill = x.direction === 'weak' ? 'weak' : x.direction === 'strong' ? 'strong' : 'residual';
      tb.appendChild(h('tr', { 'data-id': x.id, 'data-direction': x.direction }, [
        h('td', { className: 'cell-label', 'data-label': 'イベント' }, [
          h('span', { className: 'dir-tag' }, [h('span', { className: 'swatch sw-' + dirFill, 'aria-hidden': 'true' }), x.label])
        ]),
        h('td', { 'data-label': '時刻', className: 'cell-date', text: ft(x.time) }),
        h('td', { 'data-label': '初動', className: 'num', text: FW.formatPips(x.initialPips) }),
        h('td', { 'data-label': '極値', className: 'num', text: x.extreme ? rate3(x.extreme.rate) + '（' + ft(x.extreme.time, { tzLabel: false }) + '）' : '—' }),
        h('td', { 'data-label': '発表後の伸び', className: 'num', text: x.extensionPips != null ? FW.formatPips(x.extensionPips) : '—' }),
        h('td', { 'data-label': '極値からの戻り', className: 'num', 'data-field': 'retrace',
          text: x.retracePct != null ? x.retracePct.toFixed(0) + '%（' + FW.formatPips(x.retracePips) + '）' : '—' })
      ]));
    });

    var notes = $('sp-notes');
    clear(notes);
    a.warnings.forEach(function (m) {
      if (a.nextEventWarning && /予定イベント/.test(m)) return; // 上の注意枠で表示済み
      notes.appendChild(h('li', { 'data-kind': 'warning', text: '注意: ' + m }));
    });
    a.notes.forEach(function (m) { notes.appendChild(h('li', { 'data-kind': 'note', text: m })); });
  }

  /* ---------------- 数値表 ---------------- */

  function sourceCell(src) {
    var td = h('td', { 'data-label': '出典' });
    var list = (Array.isArray(src) ? src : (src ? [src] : [])).filter(function (s) { return s && (s.label || s.url); });
    if (!list.length) { td.textContent = '—'; td.setAttribute('data-empty', ''); return td; }
    list.forEach(function (s, i) {
      if (i > 0) td.appendChild(h('br'));
      var url = safeUrl(s.url);
      var label = s.label || url || '出典';
      if (url) td.appendChild(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: label }));
      else td.appendChild(document.createTextNode(label));
    });
    return td;
  }

  function dirTag(direction, fill) {
    return h('span', { className: 'dir-tag' }, [
      h('span', { className: 'swatch sw-' + fill, 'aria-hidden': 'true' }),
      DIR_LABEL[direction] || '—'
    ]);
  }

  function renderTable(r) {
    var tb = $('result-tbody');
    clear(tb);
    if (!r) return;
    function row(kind, cells, id) {
      var tr = h('tr', { 'data-row-kind': kind, 'data-id': id || null });
      cells.forEach(function (c) { tr.appendChild(c); });
      tb.appendChild(tr);
    }
    function td(label, text, cls) {
      return h('td', { 'data-label': label, className: cls || (label === '時刻' ? 'cell-date' : null), text: text,
        'data-empty': text === '—' ? '' : null });
    }
    row('start', [
      td('要因', 'A 時点', 'cell-label'), td('時刻', ft(r.start.time)), td('重要度', '—'), td('方向', '—'),
      td('前 → 後', '—', 'num'), td('寄与（pips）', '—', 'num'), td('寄与（円）', '—', 'num'), td('寄与（%）', '—', 'num'),
      td('累積', rate3(r.start.rate), 'num'), sourceCell(r.start.source)
    ]);
    r.items.forEach(function (it) {
      var fill = it.direction === 'weak' ? 'weak' : it.direction === 'strong' ? 'strong' : 'residual';
      var label = h('td', { 'data-label': '要因', className: 'cell-label' }, [
        it.label + (it.merged ? '（統合）' : ''),
        it.category ? h('span', { className: 'tile-sub', text: ' · ' + it.category }) : null
      ]);
      row('event', [
        label, td('時刻', ft(it.time)), td('重要度', IMP_LABEL[it.importance] || '—'),
        h('td', { 'data-label': '方向' }, [dirTag(it.direction, fill)]),
        td('前 → 後', rate3(it.pre) + ' → ' + rate3(it.post), 'num'),
        td('寄与（pips）', FW.formatPips(it.pips), 'num'), td('寄与（円）', FW.formatYen(it.yen), 'num'),
        td('寄与（%）', FW.formatPct(it.pct), 'num'), td('累積', rate3(it.to), 'num'),
        sourceCell(it.sources && it.sources.length ? it.sources : it.source)
      ], it.id);
    });
    row('residual', [
      td('要因', 'その他要因', 'cell-label'), td('時刻', '—'), td('重要度', '—'),
      h('td', { 'data-label': '方向' }, [dirTag(r.residual.direction, 'residual')]),
      td('前 → 後', rate3(r.residual.from) + ' → ' + rate3(r.residual.to), 'num'),
      td('寄与（pips）', FW.formatPips(r.residual.pips), 'num'), td('寄与（円）', FW.formatYen(r.residual.yen), 'num'),
      td('寄与（%）', FW.formatPct(r.residual.pct), 'num'), td('累積', rate3(r.residual.to), 'num'), td('出典', '—')
    ]);
    row('end', [
      td('要因', 'B 時点', 'cell-label'), td('時刻', ft(r.end.time)), td('重要度', '—'),
      h('td', { 'data-label': '方向' }, [dirTag(r.totalYen > 0 ? 'weak' : r.totalYen < 0 ? 'strong' : 'neutral', 'total')]),
      td('前 → 後', rate3(r.start.rate) + ' → ' + rate3(r.end.rate), 'num'),
      td('寄与（pips）', FW.formatPips(r.totalPips), 'num'), td('寄与（円）', FW.formatYen(r.totalYen), 'num'),
      td('寄与（%）', FW.formatPct(r.totalPct), 'num'), td('累積', rate3(r.end.rate), 'num'), sourceCell(r.end.source)
    ]);
  }

  /* ---------------- エディタ ---------------- */

  function field(cls, label, input) {
    return h('label', { className: 'field ' + cls }, [h('span', { text: label }), input]);
  }
  function importanceSelect(value, aria) {
    var sel = h('select', { 'data-field': 'importance', 'aria-label': aria });
    IMPORTANCE.forEach(function (p) {
      var o = h('option', { value: p[0], text: p[1] });
      if ((value || 'medium') === p[0]) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }

  function renderEditor() {
    var ds = state.working;
    $('start-time').value = isoToInput(ds.start && ds.start.time);
    $('start-rate').value = ds.start && ds.start.rate != null ? ds.start.rate : '';
    $('end-time').value = isoToInput(ds.end && ds.end.time);
    $('end-rate').value = ds.end && ds.end.rate != null ? ds.end.rate : '';

    var list = $('events-editor');
    clear(list);
    if (!ds.events.length) list.appendChild(h('p', { className: 'notes', 'data-empty': 'true', text: 'イベントがありません。「イベントを追加」で追加できます。' }));
    ds.events.forEach(function (ev, i) { list.appendChild(eventRow(ev, i)); });

    var up = $('upcoming-editor');
    clear(up);
    var ups = ds.upcoming || [];
    if (!ups.length) up.appendChild(h('p', { className: 'notes', 'data-empty': 'true', text: '予定イベントはありません。' }));
    ups.forEach(function (u, i) { up.appendChild(upcomingRow(u, i)); });

    var lv = $('levels-editor');
    clear(lv);
    var lvs = ds.levels || [];
    if (!lvs.length) lv.appendChild(h('p', { className: 'notes', 'data-empty': 'true', text: '警戒ラインはありません。' }));
    lvs.forEach(function (l, i) { lv.appendChild(levelRow(l, i)); });
  }

  function eventRow(ev, i) {
    var n = i + 1;
    var row = h('div', { className: 'event-row', 'data-index': String(i), role: 'group', 'aria-label': 'イベント ' + n });
    var cat = h('select', { 'data-field': 'category', 'aria-label': 'イベント ' + n + ' の区分' });
    var cats = CATEGORIES.slice();
    if (ev.category && cats.indexOf(ev.category) < 0) cats.push(ev.category);
    cats.forEach(function (c) {
      var o = h('option', { value: c, text: c });
      if ((ev.category || 'その他') === c) o.selected = true;
      cat.appendChild(o);
    });
    row.appendChild(field('f-label', 'ラベル', h('input', { type: 'text', 'data-field': 'label', value: ev.label || '', maxlength: '80' })));
    row.appendChild(field('f-time', '日時', h('input', { type: 'datetime-local', step: '60', 'data-field': 'time', value: isoToInput(ev.time) })));
    row.appendChild(field('f-imp', '重要度', importanceSelect(ev.importance, 'イベント ' + n + ' の重要度')));
    row.appendChild(field('f-cat', '区分', cat));
    row.appendChild(field('f-pre', '前（円）', h('input', { type: 'number', step: '0.001', inputmode: 'decimal', 'data-field': 'pre', value: ev.pre != null ? ev.pre : '' })));
    row.appendChild(field('f-post', '後（円）', h('input', { type: 'number', step: '0.001', inputmode: 'decimal', 'data-field': 'post', value: ev.post != null ? ev.post : '' })));
    row.appendChild(field('f-url', '出典 URL', h('input', { type: 'url', 'data-field': 'url', placeholder: 'https://…', value: (ev.source && ev.source.url) || '' })));
    row.appendChild(h('div', { className: 'row-foot' }, [
      h('span', { className: 'event-yen', 'aria-live': 'off' }),
      h('button', { type: 'button', className: 'btn btn-danger event-delete', 'data-index': String(i),
        'aria-label': 'イベント ' + n + '（' + (ev.label || '無題') + '）を削除', text: '削除' })
    ]));
    return row;
  }

  function upcomingRow(u, i) {
    var n = i + 1;
    var row = h('div', { className: 'mini-row upcoming-row', 'data-index': String(i), role: 'group', 'aria-label': '予定イベント ' + n });
    row.appendChild(field('f-time', '日時', h('input', { type: 'datetime-local', step: '60', 'data-field': 'time', value: isoToInput(u.time) })));
    row.appendChild(field('f-label', 'ラベル', h('input', { type: 'text', 'data-field': 'label', value: u.label || '', maxlength: '80' })));
    row.appendChild(field('f-imp', '重要度', importanceSelect(u.importance, '予定イベント ' + n + ' の重要度')));
    row.appendChild(h('button', { type: 'button', className: 'btn btn-danger upcoming-delete', 'data-index': String(i),
      'aria-label': '予定イベント ' + n + '（' + (u.label || '無題') + '）を削除', text: '削除' }));
    return row;
  }

  function levelRow(l, i) {
    var n = i + 1;
    var row = h('div', { className: 'mini-row level-row', 'data-index': String(i), role: 'group', 'aria-label': '警戒ライン ' + n });
    row.appendChild(field('f-rate', '水準（円）', h('input', { type: 'number', step: '0.001', inputmode: 'decimal', 'data-field': 'rate', value: l.rate != null ? l.rate : '' })));
    row.appendChild(field('f-label', 'ラベル', h('input', { type: 'text', 'data-field': 'label', value: l.label || '', maxlength: '80' })));
    row.appendChild(h('button', { type: 'button', className: 'btn btn-danger level-delete', 'data-index': String(i),
      'aria-label': '警戒ライン ' + n + '（' + (l.label || l.rate || '無題') + '）を削除', text: '削除' }));
    return row;
  }

  function updateEventPips(r) {
    var rows = document.querySelectorAll('#events-editor .event-row');
    Array.prototype.forEach.call(rows, function (row) {
      var ev = state.working.events[Number(row.getAttribute('data-index'))];
      var out = row.querySelector('.event-yen');
      clear(out);
      if (!ev || typeof ev.pre !== 'number' || typeof ev.post !== 'number') { out.textContent = '寄与 —'; return; }
      var yen = ev.post - ev.pre;
      var dir = FW.directionOf(yen);
      var fill = dir === 'weak' ? 'weak' : dir === 'strong' ? 'strong' : 'residual';
      var t = FW.parseTime(ev.time);
      var inRange = r && t != null && t > r.start.time && t <= r.end.time;
      out.appendChild(h('span', { className: 'swatch sw-' + fill, 'aria-hidden': 'true' }));
      out.appendChild(document.createTextNode(DIR_LABEL[dir] + ' ' + FW.formatPips(yen * 100) + (r && !inRange ? '（期間外）' : '')));
    });
  }

  function bindList(listId, rowSel, arrName, onField) {
    var list = $(listId);
    function handler(e) {
      var t = e.target;
      var f = t.getAttribute && t.getAttribute('data-field');
      if (!f) return;
      var row = t.closest(rowSel);
      var arr = state.working[arrName] || [];
      var obj = arr[Number(row.getAttribute('data-index'))];
      if (!obj) return;
      onField(obj, f, t);
      recompute();
    }
    list.addEventListener('input', handler);
    list.addEventListener('change', handler);
  }

  function bindDelete(listId, btnSel, arrName, noun, addBtnId) {
    var list = $(listId);
    list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest(btnSel);
      if (!b) return;
      var i = Number(b.getAttribute('data-index'));
      var removed = (state.working[arrName] || []).splice(i, 1)[0];
      renderEditor();
      recompute();
      status(noun + '「' + ((removed && (removed.label || removed.rate)) || '無題') + '」を削除しました');
      var rows = list.querySelectorAll(btnSel);
      var next = rows[Math.min(i, rows.length - 1)];
      (next || $(addBtnId)).focus();
    });
  }

  function bindEditor() {
    // 編集した欄だけを書き戻す（秒を含む元データの時刻を不用意に丸めない）
    function bindAB(id, point, key, parse) {
      function on() {
        var ds = state.working;
        if (!ds) return;
        ds[point][key] = parse($(id).value);
        recompute();
      }
      $(id).addEventListener('input', on);
      $(id).addEventListener('change', on);
    }
    bindAB('start-time', 'start', 'time', inputToIso);
    bindAB('end-time', 'end', 'time', inputToIso);
    bindAB('start-rate', 'start', 'rate', num);
    bindAB('end-rate', 'end', 'rate', num);

    $('end-latest').addEventListener('click', function () {
      var ds = state.working;
      var s = FW.normalizeSeries(ds && ds.series);
      if (!s.length) { status('価格系列がないため、B 時点を最新に合わせられません'); return; }
      var last = s[s.length - 1];
      ds.end.time = FW.toIso(last.time, state.tz);
      ds.end.rate = last.rate;
      renderEditor();
      recompute();
      status('B 時点を価格系列の最後の点（' + ft(last.time) + ' ' + rate3(last.rate) + '）に設定しました');
    });

    bindList('events-editor', '.event-row', 'events', function (ev, f, t) {
      if (f === 'pre' || f === 'post') {
        ev[f] = num(t.value);
        delete ev[f + 'Time']; // 手入力した値は系列の観測時刻と対応しない
      } else if (f === 'time') ev.time = inputToIso(t.value);
      else if (f === 'url') {
        ev.source = ev.source && typeof ev.source === 'object' ? ev.source : {};
        ev.source.url = t.value.trim();
      } else ev[f] = t.value;
    });
    bindList('upcoming-editor', '.upcoming-row', 'upcoming', function (u, f, t) {
      if (f === 'time') u.time = inputToIso(t.value);
      else u[f] = t.value;
    });
    bindList('levels-editor', '.level-row', 'levels', function (l, f, t) {
      if (f === 'rate') l.rate = num(t.value);
      else l[f] = t.value;
    });
    bindDelete('events-editor', '.event-delete', 'events', 'イベント', 'add-event');
    bindDelete('upcoming-editor', '.upcoming-delete', 'upcoming', '予定イベント', 'add-upcoming');
    bindDelete('levels-editor', '.level-delete', 'levels', '警戒ライン', 'add-level');

    function focusLast(listId, sel) {
      var inputs = $(listId).querySelectorAll(sel);
      var n = inputs[inputs.length - 1];
      if (n) { n.focus(); if (n.select) n.select(); }
    }

    $('add-event').addEventListener('click', function () {
      var ds = state.working;
      var rate = typeof ds.end.rate === 'number' ? ds.end.rate : null;
      ds.events.push({
        id: 'event-' + Date.now().toString(36) + '-' + (++idCounter),
        time: ds.end.time || '',
        label: '新しいイベント',
        category: 'その他',
        importance: 'medium',
        pre: rate, post: rate,
        window: '', description: '',
        source: { label: '', url: '' },
        confidence: 'approximate'
      });
      renderEditor();
      recompute();
      focusLast('events-editor', 'input[data-field="label"]');
    });
    $('add-upcoming').addEventListener('click', function () {
      var ds = state.working;
      var t = FW.parseTime(ds.end.time);
      ds.upcoming = ds.upcoming || [];
      ds.upcoming.push({ time: t != null ? FW.toIso(t + 3600000, state.tz) : '', label: '新しい予定イベント', importance: 'high' });
      renderEditor();
      recompute();
      focusLast('upcoming-editor', 'input[data-field="label"]');
    });
    $('add-level').addEventListener('click', function () {
      var ds = state.working;
      ds.levels = ds.levels || [];
      var base = typeof ds.end.rate === 'number' ? Math.ceil(ds.end.rate * 2) / 2 : null;
      ds.levels.push({ rate: base, label: '警戒ライン' });
      renderEditor();
      recompute();
      focusLast('levels-editor', 'input[data-field="rate"]');
    });

    $('reset-dataset').addEventListener('click', function () {
      if (state.index >= 0) { selectDataset(state.index); status('編集内容を元に戻しました'); }
    });
  }

  /* ---------------- ツールバー / ファイル ---------------- */

  function bindToolbar() {
    $('dataset-select').addEventListener('change', function (e) {
      var i = Number(e.target.value);
      if (state.datasets[i]) { selectDataset(i); status(''); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="order"]'), function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        state.order = r.value;
        store('fxw-order', state.order);
        recompute();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="tz"]'), function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        state.tz = r.value;
        store('fxw-tz', state.tz);
        if (!state.working) return;
        renderEditor();
        if (!$('csv-format').getAttribute('data-format')) setText('csv-format', seriesInfo());
        recompute();
      });
    });
    $('csv-tz').addEventListener('change', function () { store('fxw-csv-tz', $('csv-tz').value); });
    $('csv-window').addEventListener('change', function () {
      var ds = state.working;
      if (!ds || !FW.normalizeSeries(ds.series).length) return;
      var w = Number($('csv-window').value);
      var n = reapplySeries(w);
      renderEditor();
      recompute();
      status('イベント後の窓を ' + w + ' 分にして、' + n + ' 件のイベントの前後レートを価格系列から補完し直しました');
    });

    $('json-load').addEventListener('click', function () { $('json-file').click(); });
    $('empty-json-load').addEventListener('click', function () { $('json-file').click(); });
    $('csv-load').addEventListener('click', function () { $('csv-file').click(); });
    $('json-file').addEventListener('change', function (e) { readFile(e.target, loadJsonText); });
    $('csv-file').addEventListener('change', function (e) { readFile(e.target, loadCsvText); });
    $('json-export').addEventListener('click', exportJson);
    $('empty-new').addEventListener('click', function () {
      var end = Math.floor(Date.now() / 60000) * 60000;
      addDatasets([{
        id: 'custom-' + Date.now().toString(36),
        title: '新しいデータセット',
        pair: 'USD/JPY',
        description: '',
        start: { time: FW.toIso(end - 86400000, state.tz), rate: 150.0, source: { label: '', url: '' } },
        end: { time: FW.toIso(end, state.tz), rate: 150.0, source: { label: '', url: '' } },
        events: [],
        upcoming: [],
        levels: [],
        notes: ''
      }]);
    });
  }

  function readFile(input, handler) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try { handler(String(reader.result), file.name); }
      catch (err) { status('読み込みに失敗しました: ' + (err && err.message ? err.message : err)); }
      input.value = '';
    };
    reader.onerror = function () { status('ファイルを読み込めませんでした: ' + file.name); input.value = ''; };
    reader.readAsText(file, 'utf-8');
  }

  function loadJsonText(text, name) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { status('JSON の形式が正しくありません（' + name + '）: ' + e.message); return; }
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.datasets) ? data.datasets : [data]);
    list = list.filter(function (d) { return d && typeof d === 'object' && !Array.isArray(d); });
    if (!list.length) { status('データセットが見つかりませんでした（' + name + '）'); return; }
    var n = addDatasets(list);
    status(name + ' から ' + n + ' 件のデータセットを読み込みました');
  }

  function addDatasets(list) {
    var first = -1;
    list.forEach(function (d) {
      var ds = normalizeWorking(clone(d));
      if (!ds.id) ds.id = 'imported-' + Date.now().toString(36);
      var base = ds.id, k = 2;
      while (state.datasets.some(function (x) { return x.id === ds.id; })) ds.id = base + '-' + (k++);
      if (!ds.title) ds.title = ds.id;
      state.datasets.push(ds);
      if (first < 0) first = state.datasets.length - 1;
    });
    populateSelect();
    if (first >= 0) selectDataset(first);
    return list.length;
  }

  function exportJson() {
    if (!state.working) return;
    var json = JSON.stringify(state.working, null, 2);
    var blob = new Blob([json + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: (state.working.id || 'dataset') + '.json' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    status((state.working.id || 'dataset') + '.json を書き出しました');
  }

  function reapplySeries(windowMinutes) {
    var before = state.working.events;
    var after = FW.applySeries(before, state.working.series, { windowMinutes: windowMinutes });
    var changed = 0;
    after.forEach(function (ev, i) {
      var b = before[i] || {};
      if (ev.pre !== b.pre || ev.post !== b.post || ev.preTime !== b.preTime || ev.postTime !== b.postTime) changed++;
    });
    state.working.events = after;
    return changed;
  }

  function loadCsvText(text, name) {
    if (!state.working) return;
    var tz = $('csv-tz').value;
    var d;
    try { d = FW.parseSeriesCsvDetailed(text, { tz: tz }); }
    catch (e) { status(name + ': ' + (e && e.message ? e.message : e)); return; }
    var fmt = $('csv-format');
    if (!d.series.length) {
      fmt.textContent = '形式: ' + d.formatLabel + ' ・ 有効な観測値がありません';
      fmt.setAttribute('data-format', d.format);
      status(name + ' に有効な観測値がありませんでした。' + d.notes.join(' '));
      return;
    }
    state.working.series = d.series.map(function (p) {
      var o = { time: FW.toIso(p.time, 'UTC'), rate: p.rate };
      if (p.high != null) o.high = p.high;
      if (p.low != null) o.low = p.low;
      return o;
    });
    var w = Number($('csv-window').value) || 5;
    var changed = reapplySeries(w);
    var s = d.series;
    fmt.setAttribute('data-format', d.format);
    fmt.textContent = '形式: ' + d.formatLabel +
      (d.ohlc && d.intervalMs ? ' ・ ' + FW.formatDuration(d.intervalMs) + '足（終値時刻 = 始値時刻 + ' + FW.formatDuration(d.intervalMs) + '）' : '') +
      ' ・ 時刻の解釈: ' + (d.unixTime ? 'UNIX 時刻（UTC）' : $('csv-tz').selectedOptions[0].textContent) +
      ' ・ ' + s.length.toLocaleString('ja-JP') + ' 点（' + ft(s[0].time) + ' 〜 ' + ft(s[s.length - 1].time) + '）' +
      (d.skipped ? ' ・ ' + d.skipped + ' 行スキップ' : '');
    renderEditor();
    recompute();
    status(name + ' を読み込み、価格系列を置き換えました。' + changed + ' 件のイベントの前後レートを補完しました（窓 ' + w +
      ' 分）。A・B 時点は変更していません（「B 時点を最新に追従」で系列の最後に合わせられます）。');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
