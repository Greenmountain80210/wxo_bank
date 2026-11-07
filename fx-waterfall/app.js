/*
 * USD/JPY 要因分解ウォーターフォール — UI 結線
 * 依存: window.FX_DATASETS（任意）, window.FxWaterfall, window.FxWaterfallChart
 */
(function () {
  'use strict';

  var FW = window.FxWaterfall;
  var CH = window.FxWaterfallChart;
  var CATEGORIES = ['米国政治', '米国指標', '米金融政策', '日本政治', '日銀', '介入', '地政学', 'その他'];
  var DIR_LABEL = { weak: '円安', strong: '円高', neutral: '中立' };

  var state = {
    datasets: [],   // 元データ（ディープコピー）
    index: -1,
    working: null,  // 編集中のデータセット
    order: 'chronological',
    lastResult: null
  };
  var idCounter = 0;

  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function setText(id, s) { var n = $(id); if (n) n.textContent = s; }
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
  function safeUrl(u) {
    return typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
  }
  function num(v) {
    if (v === '' || v == null) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function status(msg) { setText('file-status', msg || ''); }

  /* ---------------- 初期化 ---------------- */

  function init() {
    if (!FW || !CH) {
      document.body.insertBefore(h('div', { className: 'alert alert-error', role: 'alert',
        text: 'スクリプト（waterfall.js / chart.js）の読み込みに失敗しました。' }), document.body.firstChild);
      return;
    }
    var src = window.FX_DATASETS;
    if (Array.isArray(src)) {
      src.forEach(function (d) { if (d && typeof d === 'object') state.datasets.push(clone(d)); });
    }

    try {
      var saved = window.localStorage && localStorage.getItem('fxw-order');
      if (saved === 'magnitude' || saved === 'chronological') state.order = saved;
    } catch (e) { /* ストレージ不可でも動作 */ }
    var radio = $('order-' + state.order);
    if (radio) radio.checked = true;

    bindToolbar();
    bindEditor();
    populateSelect();
    if (state.datasets.length) selectDataset(0);
    else showEmpty();
  }

  function populateSelect() {
    var sel = $('dataset-select');
    while (sel.firstChild) sel.removeChild(sel.firstChild);
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

  function selectDataset(i) {
    state.index = i;
    state.working = clone(state.datasets[i]);
    if (!Array.isArray(state.working.events)) state.working.events = [];
    $('empty-state').hidden = true;
    $('workspace').hidden = false;
    $('json-export').disabled = false;
    $('csv-load').disabled = false;
    $('dataset-select').value = String(i);
    renderEditor();
    recompute();
  }

  /* ---------------- 再計算と描画 ---------------- */

  function recompute() {
    var ds = state.working;
    if (!ds) return;
    setText('dataset-desc', ds.description || '');
    setText('dataset-notes', ds.notes ? 'データについて: ' + ds.notes : '');

    var v = FW.validateDataset(ds);
    var result = null, fatal = null;
    try {
      result = FW.decompose(ds, { order: state.order });
    } catch (e) {
      fatal = e && e.message ? e.message : String(e);
    }
    renderErrors(v.errors, fatal);
    state.lastResult = result;

    var chart = $('chart');
    if (!result) {
      if (chart._fxw) chart._fxw.result = null;
      while (chart.firstChild) chart.removeChild(chart.firstChild);
      chart.appendChild(h('p', { className: 'chart-empty', text: 'A 時点・B 時点の日付とレートを正しく入力すると、チャートが表示されます。' }));
      renderSummary(null);
      renderTable(null);
      renderWarnings([]);
      updateEventYen(null);
      return;
    }
    renderSummary(result);
    CH.renderWaterfall(chart, result, {
      pair: ds.pair || 'USD/JPY',
      title: (ds.pair || 'USD/JPY') + ' 要因分解ウォーターフォール（' + (ds.title || '') + '）'
    });
    renderTable(result);
    renderWarnings(result.warnings);
    updateEventYen(result);
  }

  function renderErrors(errors, fatal) {
    var box = $('errors');
    while (box.firstChild) box.removeChild(box.firstChild);
    var list = (fatal ? [fatal] : []).concat(errors || []);
    if (!list.length) { box.hidden = true; return; }
    box.appendChild(h('strong', { text: '入力エラー' }));
    var ul = h('ul');
    list.forEach(function (m) { ul.appendChild(h('li', { text: m })); });
    box.appendChild(ul);
    box.hidden = false;
  }

  function renderWarnings(warnings) {
    var box = $('warnings');
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!warnings || !warnings.length) { box.hidden = true; return; }
    box.appendChild(h('strong', { text: '注意' }));
    var ul = h('ul');
    warnings.forEach(function (m) { ul.appendChild(h('li', { text: m })); });
    box.appendChild(ul);
    box.hidden = false;
  }

  function renderSummary(r) {
    var head = $('summary-headline');
    while (head.firstChild) head.removeChild(head.firstChild);
    if (!r) {
      head.textContent = '—';
      setText('summary-dates', '');
      ['sum-weak', 'sum-strong', 'sum-residual', 'sum-weak-sub', 'sum-strong-sub'].forEach(function (id) { setText(id, '—'); });
      return;
    }
    head.appendChild(h('span', { 'data-part': 'start', text: 'A ' + FW.formatRate(r.start.rate) }));
    head.appendChild(h('span', { className: 'arrow', text: ' → ' }));
    head.appendChild(h('span', { 'data-part': 'end', text: 'B ' + FW.formatRate(r.end.rate) }));
    head.appendChild(h('span', { className: 'delta', 'data-part': 'delta',
      text: '（' + FW.formatYen(r.totalYen) + ', ' + FW.formatPct(r.totalPct) + '）' }));
    setText('summary-dates', 'A 時点 ' + r.start.date + ' ／ B 時点 ' + r.end.date + ' ・ 差し引き ' +
      (r.totalYen > 0 ? '円安' : r.totalYen < 0 ? '円高' : '変化なし'));

    var nWeak = r.items.filter(function (i) { return i.direction === 'weak'; }).length;
    var nStrong = r.items.filter(function (i) { return i.direction === 'strong'; }).length;
    var s = r.start.rate;
    setText('sum-weak', FW.formatYen(r.sumWeakYen));
    setText('sum-weak-sub', FW.formatPct(r.sumWeakYen / s * 100) + ' ・ ' + nWeak + ' 件');
    setText('sum-strong', FW.formatYen(r.sumStrongYen));
    setText('sum-strong-sub', FW.formatPct(r.sumStrongYen / s * 100) + ' ・ ' + nStrong + ' 件');
    setText('sum-residual', FW.formatYen(r.residual.yen));
    setText('sum-residual-sub', FW.formatPct(r.residual.pct) + ' ・ イベント外');
  }

  function sourceCell(src) {
    var td = h('td', { 'data-label': '出典' });
    var list = (Array.isArray(src) ? src : (src ? [src] : [])).filter(function (s) { return s && (s.label || s.url); });
    if (!list.length) { td.textContent = '—'; td.setAttribute('data-empty', ''); return td; }
    list.forEach(function (s, i) {
      if (!s) return;
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
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    if (!r) return;
    function row(kind, cells) {
      var tr = h('tr', { 'data-row-kind': kind });
      cells.forEach(function (c) { tr.appendChild(c); });
      tb.appendChild(tr);
    }
    function td(label, text, cls) {
      return h('td', { 'data-label': label, className: cls || (label === '日付' ? 'cell-date' : null), text: text,
        'data-empty': text === '—' ? '' : null });
    }

    row('start', [
      td('要因', 'A 時点', 'cell-label'), td('日付', r.start.date), td('区分', '—'), td('方向', '—'),
      td('前 → 後', '—', 'num'), td('寄与（円）', '—', 'num'), td('寄与（%）', '—', 'num'),
      td('累積', FW.formatRate(r.start.rate), 'num'), sourceCell(r.start.source)
    ]);
    r.items.forEach(function (it) {
      var fill = it.direction === 'weak' ? 'weak' : it.direction === 'strong' ? 'strong' : 'residual';
      var dirTd = h('td', { 'data-label': '方向' }, [dirTag(it.direction, fill)]);
      var tr = [
        td('要因', it.label + (it.merged ? '（統合）' : ''), 'cell-label'), td('日付', it.date), td('区分', it.category || '—'),
        dirTd,
        td('前 → 後', FW.formatRate(it.pre) + ' → ' + FW.formatRate(it.post), 'num'),
        td('寄与（円）', FW.formatYen(it.yen), 'num'), td('寄与（%）', FW.formatPct(it.pct), 'num'),
        td('累積', FW.formatRate(it.to), 'num'), sourceCell(it.sources && it.sources.length ? it.sources : it.source)
      ];
      row('event', tr);
      tb.lastChild.setAttribute('data-id', it.id);
    });
    row('residual', [
      td('要因', 'その他要因', 'cell-label'), td('日付', '—'), td('区分', 'イベント外の値動きの合計'),
      h('td', { 'data-label': '方向' }, [dirTag(r.residual.direction, 'residual')]),
      td('前 → 後', FW.formatRate(r.residual.from) + ' → ' + FW.formatRate(r.residual.to), 'num'),
      td('寄与（円）', FW.formatYen(r.residual.yen), 'num'), td('寄与（%）', FW.formatPct(r.residual.pct), 'num'),
      td('累積', FW.formatRate(r.residual.to), 'num'), td('出典', '—')
    ]);
    row('end', [
      td('要因', 'B 時点', 'cell-label'), td('日付', r.end.date), td('区分', '—'),
      h('td', { 'data-label': '方向' }, [dirTag(r.totalYen > 0 ? 'weak' : r.totalYen < 0 ? 'strong' : 'neutral', 'total')]),
      td('前 → 後', FW.formatRate(r.start.rate) + ' → ' + FW.formatRate(r.end.rate), 'num'),
      td('寄与（円）', FW.formatYen(r.totalYen), 'num'), td('寄与（%）', FW.formatPct(r.totalPct), 'num'),
      td('累積', FW.formatRate(r.end.rate), 'num'), sourceCell(r.end.source)
    ]);
  }

  /* ---------------- エディタ ---------------- */

  function renderEditor() {
    var ds = state.working;
    $('start-date').value = (ds.start && ds.start.date) || '';
    $('start-rate').value = ds.start && ds.start.rate != null ? ds.start.rate : '';
    $('end-date').value = (ds.end && ds.end.date) || '';
    $('end-rate').value = ds.end && ds.end.rate != null ? ds.end.rate : '';

    var list = $('events-editor');
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!ds.events.length) {
      list.appendChild(h('p', { className: 'notes', 'data-empty': 'true', text: 'イベントがありません。「イベントを追加」で追加できます。' }));
    }
    ds.events.forEach(function (ev, i) { list.appendChild(eventRow(ev, i)); });
  }

  function eventRow(ev, i) {
    var n = i + 1;
    var row = h('div', { className: 'event-row', 'data-index': String(i), role: 'group', 'aria-label': 'イベント ' + n });
    function field(cls, label, input) {
      return h('label', { className: 'field ' + cls }, [h('span', { text: label }), input]);
    }
    var cat = h('select', { 'data-field': 'category', 'aria-label': 'イベント ' + n + ' の区分' });
    var cats = CATEGORIES.slice();
    if (ev.category && cats.indexOf(ev.category) < 0) cats.push(ev.category);
    cats.forEach(function (c) {
      var o = h('option', { value: c, text: c });
      if ((ev.category || 'その他') === c) o.selected = true;
      cat.appendChild(o);
    });
    row.appendChild(field('f-label', 'ラベル', h('input', { type: 'text', 'data-field': 'label', value: ev.label || '', maxlength: '60' })));
    row.appendChild(field('f-date', '日付', h('input', { type: 'date', 'data-field': 'date', value: ev.date || '' })));
    row.appendChild(field('f-cat', '区分', cat));
    row.appendChild(field('f-pre', '前（円）', h('input', { type: 'number', step: '0.01', inputmode: 'decimal', 'data-field': 'pre', value: ev.pre != null ? ev.pre : '' })));
    row.appendChild(field('f-post', '後（円）', h('input', { type: 'number', step: '0.01', inputmode: 'decimal', 'data-field': 'post', value: ev.post != null ? ev.post : '' })));
    row.appendChild(field('f-url', '出典 URL', h('input', { type: 'url', 'data-field': 'url', placeholder: 'https://…', value: (ev.source && ev.source.url) || '' })));
    var foot = h('div', { className: 'row-foot' }, [
      h('span', { className: 'event-yen', 'aria-live': 'off' }),
      h('button', { type: 'button', className: 'btn btn-danger event-delete', 'data-index': String(i),
        'aria-label': 'イベント ' + n + '（' + (ev.label || '無題') + '）を削除', text: '削除' })
    ]);
    row.appendChild(foot);
    return row;
  }

  function updateEventYen(r) {
    var rows = document.querySelectorAll('#events-editor .event-row');
    Array.prototype.forEach.call(rows, function (row) {
      var ev = state.working.events[Number(row.getAttribute('data-index'))];
      var out = row.querySelector('.event-yen');
      while (out.firstChild) out.removeChild(out.firstChild);
      if (!ev || typeof ev.pre !== 'number' || typeof ev.post !== 'number') { out.textContent = '寄与 —'; return; }
      var yen = ev.post - ev.pre;
      var dir = FW.directionOf(yen);
      var fill = dir === 'weak' ? 'weak' : dir === 'strong' ? 'strong' : 'residual';
      var inRange = r && ev.date > r.start.date && ev.date <= r.end.date;
      out.appendChild(h('span', { className: 'swatch sw-' + fill, 'aria-hidden': 'true' }));
      out.appendChild(document.createTextNode(DIR_LABEL[dir] + ' ' + FW.formatYen(yen) + (r && !inRange ? '（期間外）' : '')));
    });
  }

  function bindEditor() {
    function onAB() {
      var ds = state.working;
      if (!ds) return;
      ds.start = ds.start || {};
      ds.end = ds.end || {};
      ds.start.date = $('start-date').value;
      ds.start.rate = num($('start-rate').value);
      ds.end.date = $('end-date').value;
      ds.end.rate = num($('end-rate').value);
      recompute();
    }
    ['start-date', 'start-rate', 'end-date', 'end-rate'].forEach(function (id) {
      $(id).addEventListener('input', onAB);
      $(id).addEventListener('change', onAB);
    });

    var list = $('events-editor');
    function onEventInput(e) {
      var t = e.target;
      var f = t.getAttribute && t.getAttribute('data-field');
      if (!f) return;
      var row = t.closest('.event-row');
      var ev = state.working.events[Number(row.getAttribute('data-index'))];
      if (!ev) return;
      if (f === 'pre' || f === 'post') ev[f] = num(t.value);
      else if (f === 'url') {
        ev.source = ev.source && typeof ev.source === 'object' ? ev.source : {};
        ev.source.url = t.value.trim();
      } else ev[f] = t.value;
      recompute();
    }
    list.addEventListener('input', onEventInput);
    list.addEventListener('change', onEventInput);
    list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.event-delete');
      if (!b) return;
      var i = Number(b.getAttribute('data-index'));
      var removed = state.working.events.splice(i, 1)[0];
      renderEditor();
      recompute();
      status('イベント「' + ((removed && removed.label) || '無題') + '」を削除しました');
      var rows = list.querySelectorAll('.event-delete');
      var next = rows[Math.min(i, rows.length - 1)];
      (next || $('add-event')).focus();
    });

    $('add-event').addEventListener('click', function () {
      var ds = state.working;
      var rate = ds.end && typeof ds.end.rate === 'number' ? ds.end.rate : null;
      ds.events.push({
        id: 'event-' + Date.now().toString(36) + '-' + (++idCounter),
        date: (ds.end && ds.end.date) || '',
        label: '新しいイベント',
        category: 'その他',
        pre: rate, post: rate,
        window: '', description: '',
        source: { label: '', url: '' },
        confidence: 'approximate'
      });
      renderEditor();
      recompute();
      var inputs = list.querySelectorAll('.event-row:last-child input[data-field="label"]');
      if (inputs[0]) { inputs[0].focus(); inputs[0].select(); }
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
        try { localStorage.setItem('fxw-order', state.order); } catch (e) { /* noop */ }
        recompute();
      });
    });

    $('json-load').addEventListener('click', function () { $('json-file').click(); });
    $('empty-json-load').addEventListener('click', function () { $('json-file').click(); });
    $('csv-load').addEventListener('click', function () { $('csv-file').click(); });
    $('json-file').addEventListener('change', function (e) { readFile(e.target, loadJsonText); });
    $('csv-file').addEventListener('change', function (e) { readFile(e.target, loadCsvText); });
    $('json-export').addEventListener('click', exportJson);
    $('empty-new').addEventListener('click', function () {
      addDatasets([{
        id: 'custom-' + Date.now().toString(36),
        title: '新しいデータセット',
        pair: 'USD/JPY',
        description: '',
        start: { date: '2024-01-04', rate: 143.0, source: { label: '', url: '' } },
        end: { date: '2024-12-30', rate: 157.0, source: { label: '', url: '' } },
        events: [],
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
    var list = Array.isArray(data) ? data : [data];
    list = list.filter(function (d) { return d && typeof d === 'object' && !Array.isArray(d); });
    if (!list.length) { status('データセットが見つかりませんでした（' + name + '）'); return; }
    var n = addDatasets(list);
    status(name + ' から ' + n + ' 件のデータセットを読み込みました');
  }

  function addDatasets(list) {
    var first = -1;
    list.forEach(function (d) {
      var ds = clone(d);
      if (!Array.isArray(ds.events)) ds.events = [];
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

  function loadCsvText(text, name) {
    if (!state.working) return;
    var series = FW.parseSeriesCsv(text);
    if (!series.length) { status(name + ' に有効な観測値がありませんでした（observation_date,DEXJPUS 形式）'); return; }
    var before = state.working.events;
    var after = FW.applySeries(before, series);
    var changed = 0;
    after.forEach(function (ev, i) {
      if (ev.pre !== before[i].pre || ev.post !== before[i].post) changed++;
    });
    state.working.events = after;
    renderEditor();
    recompute();
    status(name + ': ' + series.length + ' 件の観測値（' + series[0].date + '〜' + series[series.length - 1].date +
      '）を読み込み、' + changed + ' 件のイベントの前後レートを補完しました。A・B 時点のレートは変更していません。');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
