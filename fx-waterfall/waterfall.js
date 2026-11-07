/*
 * USD/JPY 短期要因分解ウォーターフォール — 計算ロジック（仕様 v2）
 * UMD: ブラウザでは window.FxWaterfall、Node では module.exports。DOM 非依存。
 * 計算式・時刻・CSV 形式・analyze の定義は fx-waterfall/SPEC.md に従う。
 *
 * 時刻はすべて ISO 8601（オフセット必須）で受け取り、内部では epoch ms で扱う。
 * 期間（B − A）は 5 分以上 5 日（432,000,000 ms）以内。
 * 本モジュールは過去データの集計のみを行い、将来予測・売買推奨は行わない。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FxWaterfall = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;
  var MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
  var MIN_DURATION_MS = 5 * MINUTE;
  var MAX_DURATION_MS = 5 * DAY; // 432,000,000 ms
  var PIP = 0.01; // USD/JPY: 1 pip = 0.01 円

  var DIRECTION_LABELS = { weak: '円安', strong: '円高', neutral: '中立' };
  var IMPORTANCE_LEVELS = ['high', 'medium', 'low'];
  var IMPORTANCE_LABELS = { high: '高', medium: '中', low: '低' };
  var IMPORTANCE_RANK = { high: 3, medium: 2, low: 1 };
  var DEFAULT_IMPORTANCE = 'medium';
  var TZ_ALIASES = { JST: 'Asia/Tokyo', NY: 'America/New_York', ET: 'America/New_York', UTC: 'UTC', Z: 'UTC', GMT: 'UTC' };
  var FORMAT_LABELS = {
    mt4: 'MT4 履歴（ヘッダなし）',
    mt5: 'MT5 書き出し（タブ区切り）',
    tradingview: 'TradingView 書き出し',
    generic: '汎用 CSV',
    unknown: '不明'
  };

  function isFiniteNumber(n) { return typeof n === 'number' && isFinite(n); }
  function clean(x) { return Math.abs(x) < EPS ? 0 : x; }
  // 円の差分を 1e-10 円に丸め、浮動小数誤差（1.9000000000000057 など）を除く
  function roundYen(x) { return clean(Math.round(x * 1e10) / 1e10); }
  function roundPips(x) { return clean(Math.round(x * 1e8) / 1e8); }
  function yenToPips(yen) { return roundPips(yen / PIP); }
  function directionOf(yen) {
    if (yen > EPS) return 'weak';
    if (yen < -EPS) return 'strong';
    return 'neutral';
  }
  function sameRate(a, b) { return Math.abs(a - b) < EPS; }
  function toNumber(v) {
    if (isFiniteNumber(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v.trim());
      if (isFinite(n)) return n;
    }
    return NaN;
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
  function normImportance(v) { return IMPORTANCE_RANK[v] ? v : DEFAULT_IMPORTANCE; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------------ */
  /* 時刻                                                                */
  /* ------------------------------------------------------------------ */

  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)$/i;

  function fieldsValid(y, mo, d, h, mi, s) {
    if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  function parseOffset(s) {
    if (/^z$/i.test(s)) return 0;
    var m = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(s);
    if (!m) return null;
    var h = +m[2], mi = m[3] ? +m[3] : 0;
    if (h > 23 || mi > 59) return null;
    return (m[1] === '-' ? -1 : 1) * (h * HOUR + mi * MINUTE);
  }

  /** ISO 8601（オフセット必須）→ epoch ms。オフセットなし・不正なら null。 */
  function parseTime(iso) {
    if (typeof iso !== 'string') return null;
    var m = ISO_RE.exec(iso.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0;
    if (!fieldsValid(y, mo, d, h, mi, s)) return null;
    var off = parseOffset(m[8]);
    if (off == null) return null;
    var ms = m[7] ? Math.floor(Number('0.' + m[7]) * 1000) : 0;
    return Date.UTC(y, mo - 1, d, h, mi, s, ms) - off;
  }

  // 内部用: epoch ms（数値）・ISO 文字列・Date を受け付ける
  function timeOf(v) {
    if (isFiniteNumber(v)) return v;
    if (typeof v === 'string') return parseTime(v);
    if (v instanceof Date && isFinite(v.getTime())) return v.getTime();
    return null;
  }

  var fmtCache = {};
  function ianaFormatter(name) {
    if (!fmtCache[name]) {
      fmtCache[name] = new Intl.DateTimeFormat('en-US', {
        timeZone: name, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      });
    }
    return fmtCache[name];
  }

  /**
   * タイムゾーン指定の解決。"UTC" | "JST" | "NY" | IANA 名（"Asia/Tokyo" 等）| 固定オフセット（"+02:00"）。
   * 戻り値 { kind: 'fixed', offset(ms), name } | { kind: 'iana', name }。不明なら RangeError。
   */
  function resolveTimeZone(tz) {
    if (tz && typeof tz === 'object' && tz.kind) return tz;
    if (tz == null || tz === '') tz = 'UTC';
    if (typeof tz !== 'string') throw new RangeError('タイムゾーンの指定が不正です: ' + String(tz));
    var t = tz.trim();
    var alias = TZ_ALIASES[t.toUpperCase()];
    if (alias) t = alias;
    if (t === 'UTC') return { kind: 'fixed', offset: 0, name: 'UTC' };
    var m = /^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(t);
    if (m) {
      var h = +m[2], mi = m[3] ? +m[3] : 0;
      if (h > 23 || mi > 59) throw new RangeError('タイムゾーンのオフセットが不正です: ' + tz);
      var off = (m[1] === '-' ? -1 : 1) * (h * HOUR + mi * MINUTE);
      if (off === 0) return { kind: 'fixed', offset: 0, name: 'UTC' };
      return { kind: 'fixed', offset: off, name: m[1] + pad2(h) + ':' + pad2(mi) };
    }
    try { ianaFormatter(t); } catch (e) { throw new RangeError('不明なタイムゾーンです: ' + tz); }
    return { kind: 'iana', name: t };
  }

  /** その瞬間の UTC からのオフセット（ms）。DST は Intl API に従う。 */
  function offsetAt(ms, tz) {
    var zone = resolveTimeZone(tz);
    if (zone.kind === 'fixed') return zone.offset;
    var parts = ianaFormatter(zone.name).formatToParts(new Date(ms));
    var o = {};
    for (var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
    var h = +o.hour;
    if (h === 24) h = 0;
    var asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, h, +o.minute, +o.second);
    var floored = ms - (((ms % 1000) + 1000) % 1000);
    return asUtc - floored;
  }

  /**
   * 壁時計の時刻（tz の現地時刻）→ epoch ms。
   * DST の重複（秋）は早い方（夏時間側）、DST の欠落（春）は時計を進めた側に解釈する。
   */
  function wallToUtc(y, mo, d, h, mi, s, msec, tz) {
    var zone = resolveTimeZone(tz);
    var wall = Date.UTC(y, mo - 1, d, h, mi, s || 0, msec || 0);
    if (zone.kind === 'fixed') return wall - zone.offset;
    var before = offsetAt(wall - DAY, zone), after = offsetAt(wall + DAY, zone);
    var cands = [];
    [before, after].forEach(function (o) {
      var t = wall - o;
      if (offsetAt(t, zone) === o && cands.indexOf(t) < 0) cands.push(t);
    });
    if (cands.length) return Math.min.apply(null, cands);
    return wall - before; // 欠落した時刻: 変更前のオフセットで解釈（= 時計を進めた側）
  }

  /** epoch ms → tz の壁時計 { year, month, day, hour, minute, second, offset } */
  function wallClock(ms, tz) {
    var zone = resolveTimeZone(tz);
    var off = offsetAt(ms, zone);
    var d = new Date(ms + off);
    return {
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
      hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), offset: off
    };
  }

  function offsetString(off) {
    if (off === 0) return 'Z';
    var a = Math.abs(off);
    return (off < 0 ? '-' : '+') + pad2(Math.floor(a / HOUR)) + ':' + pad2(Math.floor((a % HOUR) / MINUTE));
  }

  /** epoch ms → ISO 8601（tz のオフセット付き、例 "2024-11-06T09:30:00+09:00"。UTC は "Z"） */
  function toIso(ms, tz) {
    var t = timeOf(ms);
    if (t == null) return null;
    var w = wallClock(t, tz || 'UTC');
    return w.year + '-' + pad2(w.month) + '-' + pad2(w.day) + 'T' + pad2(w.hour) + ':' + pad2(w.minute) + ':' +
      pad2(w.second) + offsetString(w.offset);
  }

  /** epoch ms → <input type="datetime-local"> 用 "YYYY-MM-DDTHH:MM"（tz の現地時刻） */
  function toLocalInput(ms, tz) {
    var t = timeOf(ms);
    if (t == null) return '';
    var w = wallClock(t, tz);
    return w.year + '-' + pad2(w.month) + '-' + pad2(w.day) + 'T' + pad2(w.hour) + ':' + pad2(w.minute);
  }

  /** "YYYY-MM-DDTHH:MM[:SS]"（tz の現地時刻）→ epoch ms。不正なら null。 */
  function fromLocalInput(value, tz) {
    if (typeof value !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0;
    if (!fieldsValid(y, mo, d, h, mi, s)) return null;
    return wallToUtc(y, mo, d, h, mi, s, 0, tz);
  }

  /** 表示用のタイムゾーン略称（JST / UTC / EDT / EST / UTC+02:00） */
  function tzLabel(tz, ms) {
    var zone = resolveTimeZone(tz);
    if (zone.kind === 'fixed') return zone.offset === 0 ? 'UTC' : 'UTC' + zone.name;
    if (zone.name === 'Asia/Tokyo') return 'JST';
    var off = offsetAt(isFiniteNumber(ms) ? ms : Date.now(), zone);
    if (zone.name === 'America/New_York') return off === -4 * HOUR ? 'EDT' : 'EST';
    return 'UTC' + (off === 0 ? '' : offsetString(off));
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
  /** "+30.2 pips" */
  function formatPips(n, digits) { return signed(n, digits == null ? 1 : digits, ' pips'); }

  /** "2日3時間" / "1時間5分" / "45分" / "30秒"（日がある場合は分を省略） */
  function formatDuration(ms) {
    if (!isFiniteNumber(ms)) return '—';
    var neg = ms < 0;
    var a = Math.abs(ms);
    var out;
    if (a < MINUTE) out = Math.round(a / 1000) + '秒';
    else {
      var totalMin = Math.floor(a / MINUTE + 1e-9);
      var d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
      if (d > 0) out = d + '日' + (h ? h + '時間' : '');
      else if (h > 0) out = h + '時間' + (m ? m + '分' : '');
      else out = m + '分';
    }
    return (neg ? '-' : '') + out;
  }

  // エラーメッセージ用の正確な長さ（"5日1秒" など、0 の単位は省略）
  function exactDuration(ms) {
    var a = Math.abs(Math.round(ms / 1000));
    var parts = [[Math.floor(a / 86400), '日'], [Math.floor(a % 86400 / 3600), '時間'], [Math.floor(a % 3600 / 60), '分'], [a % 60, '秒']]
      .filter(function (p) { return p[0] > 0; }).map(function (p) { return p[0] + p[1]; });
    return (ms < 0 ? '-' : '') + (parts.join('') || '0秒');
  }

  /**
   * "11/06 09:30 JST" のような短い形式。tz 既定は Asia/Tokyo。
   * opts.year: true で "2024/11/06 09:30 JST"、opts.tzLabel: false で略称なし。
   */
  function formatTime(ms, tz, opts) {
    opts = opts || {};
    var t = timeOf(ms);
    if (t == null) return '—';
    var zone = resolveTimeZone(tz || 'Asia/Tokyo');
    var w = wallClock(t, zone);
    var s = (opts.year ? w.year + '/' : '') + pad2(w.month) + '/' + pad2(w.day) + ' ' + pad2(w.hour) + ':' + pad2(w.minute);
    if (opts.seconds) s += ':' + pad2(w.second);
    if (opts.tzLabel !== false) s += ' ' + tzLabel(zone, t);
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* validateDataset                                                     */
  /* ------------------------------------------------------------------ */

  function validatePoint(p, name, errors) {
    if (!p || typeof p !== 'object') { errors.push(name + ' がありません'); return null; }
    var t = parseTime(p.time);
    if (t == null) {
      if (p.time == null && p.date != null) {
        errors.push(name + '.time がありません（旧形式の date: ' + String(p.date) + ' です。v2 では ISO 8601・オフセット付きの time が必要です）');
      } else {
        errors.push(name + '.time が ISO 8601（オフセット付き）の時刻ではありません: ' + String(p.time));
      }
    }
    if (!isFiniteNumber(p.rate)) errors.push(name + '.rate が数値ではありません: ' + String(p.rate));
    else if (p.rate <= 0) errors.push(name + '.rate は正の数である必要があります: ' + p.rate);
    return t;
  }

  /** { ok: boolean, errors: string[] } */
  function validateDataset(dataset) {
    var errors = [];
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
      return { ok: false, errors: ['データセットがオブジェクトではありません'] };
    }
    if (typeof dataset.id !== 'string' || dataset.id.trim() === '') errors.push('id がありません');
    if (typeof dataset.title !== 'string' || dataset.title.trim() === '') errors.push('title がありません');
    var ts = validatePoint(dataset.start, 'start', errors);
    var te = validatePoint(dataset.end, 'end', errors);
    if (ts != null && te != null) {
      var dur = te - ts;
      if (dur <= 0) errors.push('B 時点は A 時点より後である必要があります');
      else if (dur < MIN_DURATION_MS) errors.push('期間が短すぎます（' + exactDuration(dur) + '）。期間は 5分以上 5日以内にしてください');
      else if (dur > MAX_DURATION_MS) errors.push('期間が長すぎます（' + exactDuration(dur) + '）。期間は 5分以上 5日以内にしてください');
    }

    if (!Array.isArray(dataset.events)) {
      errors.push('events が配列ではありません');
    } else {
      var seen = {};
      dataset.events.forEach(function (ev, i) {
        var name = 'events[' + i + ']';
        if (!ev || typeof ev !== 'object') { errors.push(name + ' がオブジェクトではありません'); return; }
        if (ev.id != null && ev.id !== '') {
          name += '（' + ev.id + '）';
          if (seen[ev.id]) errors.push(name + ': id が重複しています');
          seen[ev.id] = true;
        }
        if (typeof ev.label !== 'string' || ev.label.trim() === '') errors.push(name + ': label がありません');
        if (parseTime(ev.time) == null) {
          errors.push(name + ': time が ISO 8601（オフセット付き）の時刻ではありません: ' + String(ev.time != null ? ev.time : ev.date));
        }
        ['pre', 'post'].forEach(function (k) {
          if (!isFiniteNumber(ev[k])) errors.push(name + ': ' + k + ' が数値ではありません: ' + String(ev[k]));
          else if (ev[k] <= 0) errors.push(name + ': ' + k + ' は正の数である必要があります: ' + ev[k]);
        });
        ['preTime', 'postTime'].forEach(function (k) {
          if (ev[k] != null && ev[k] !== '' && parseTime(ev[k]) == null) errors.push(name + ': ' + k + ' が ISO 8601（オフセット付き）ではありません: ' + String(ev[k]));
        });
        if (ev.importance != null && !IMPORTANCE_RANK[ev.importance]) {
          errors.push(name + ': importance は high / medium / low のいずれかです: ' + String(ev.importance));
        }
      });
    }

    if (dataset.series != null) {
      if (!Array.isArray(dataset.series)) errors.push('series が配列ではありません');
      else {
        var bad = 0, firstBad = -1;
        dataset.series.forEach(function (p, i) {
          if (!p || timeOf(p.time) == null || !(isFiniteNumber(p.rate) && p.rate > 0)) {
            bad++;
            if (firstBad < 0) firstBad = i;
          }
        });
        if (bad) errors.push('series の ' + bad + ' 件が不正です（time は ISO 8601・オフセット付き、rate は正の数）。最初の不正: series[' + firstBad + ']');
      }
    }
    if (dataset.upcoming != null) {
      if (!Array.isArray(dataset.upcoming)) errors.push('upcoming が配列ではありません');
      else dataset.upcoming.forEach(function (u, i) {
        var name = 'upcoming[' + i + ']';
        if (!u || typeof u !== 'object') { errors.push(name + ' がオブジェクトではありません'); return; }
        if (parseTime(u.time) == null) errors.push(name + ': time が ISO 8601（オフセット付き）ではありません: ' + String(u.time));
        if (typeof u.label !== 'string' || u.label.trim() === '') errors.push(name + ': label がありません');
        if (u.importance != null && !IMPORTANCE_RANK[u.importance]) errors.push(name + ': importance は high / medium / low のいずれかです');
      });
    }
    if (dataset.levels != null) {
      if (!Array.isArray(dataset.levels)) errors.push('levels が配列ではありません');
      else dataset.levels.forEach(function (l, i) {
        var name = 'levels[' + i + ']';
        if (!l || typeof l !== 'object') { errors.push(name + ' がオブジェクトではありません'); return; }
        if (!(isFiniteNumber(l.rate) && l.rate > 0)) errors.push(name + ': rate は正の数である必要があります: ' + String(l.rate));
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* ------------------------------------------------------------------ */
  /* decompose                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * decompose(dataset, { order: 'chronological' | 'magnitude', tz }) → result
   * result = {
   *   start: { time(ms), rate, source }, end: { time, rate, source }, order, durationMs,
   *   totalYen, totalPips, totalPct,
   *   items: [{ id, label, time(ms), importance, category, pre, post, preTime(ms|null), postTime(ms|null),
   *             yen, pips, pct, eventPct, direction, from, to, merged, mergedIds?, source, sources,
   *             window, confidence, description }],
   *   residual: { id:'residual', label, yen, pips, pct, direction, from, to },
   *   sumWeakYen, sumStrongYen, sumEventsYen, sumWeakPips, sumStrongPips, sumEventsPips,
   *   warnings: string[]
   * }
   * 期間が 5 分未満・5 日超（または B ≦ A）なら RangeError。
   */
  function decompose(dataset, options) {
    options = options || {};
    var order = options.order === 'magnitude' ? 'magnitude' : 'chronological';
    var msgTz = options.tz || 'Asia/Tokyo';
    try { resolveTimeZone(msgTz); } catch (e) { msgTz = 'UTC'; }
    var warnings = [];

    if (!dataset || typeof dataset !== 'object') throw new Error('データセットがありません');
    var s = dataset.start || {}, e = dataset.end || {};
    var startT = timeOf(s.time), endT = timeOf(e.time);
    if (startT == null || endT == null) throw new Error('A 時点・B 時点の時刻が不正です（ISO 8601・オフセット付き）');
    var startRate = toNumber(s.rate), endRate = toNumber(e.rate);
    if (!(startRate > 0) || !(endRate > 0)) throw new Error('A 時点・B 時点のレートが不正です');
    var dur = endT - startT;
    if (dur <= 0) throw new RangeError('B 時点は A 時点より後である必要があります');
    if (dur < MIN_DURATION_MS) throw new RangeError('期間が短すぎます（' + exactDuration(dur) + '）。期間は 5分以上 5日以内にしてください');
    if (dur > MAX_DURATION_MS) throw new RangeError('期間が長すぎます（' + exactDuration(dur) + '）。期間は 5分以上 5日以内にしてください');

    var start = { time: startT, rate: startRate, source: s.source || null };
    var end = { time: endT, rate: endRate, source: e.source || null };
    function ft(t) { return formatTime(t, msgTz); }

    // 1) 採用するイベント
    var accepted = [];
    var events = Array.isArray(dataset.events) ? dataset.events : [];
    events.forEach(function (ev, idx) {
      if (!ev || typeof ev !== 'object') return;
      var name = ev.label || ev.id || ('#' + (idx + 1));
      var t = timeOf(ev.time);
      if (t == null) { warnings.push('「' + name + '」は時刻が不正なため除外しました'); return; }
      var pre = toNumber(ev.pre), post = toNumber(ev.post);
      if (!(pre > 0) || !(post > 0)) { warnings.push('「' + name + '」は pre/post が数値でないため除外しました'); return; }
      if (!(t > startT && t <= endT)) {
        warnings.push('「' + name + '」（' + ft(t) + '）は期間 ' + ft(startT) + ' 〜 ' + ft(endT) + ' の範囲外のため除外しました');
        return;
      }
      accepted.push({ ev: ev, idx: idx, t: t, pre: pre, post: post });
    });

    // 2) 同時刻・pre/post 同一のイベントを統合
    var groups = [];
    accepted.forEach(function (a) {
      for (var g = 0; g < groups.length; g++) {
        var head = groups[g][0];
        if (head.t === a.t && sameRate(head.pre, a.pre) && sameRate(head.post, a.post)) { groups[g].push(a); return; }
      }
      groups.push([a]);
    });
    var byTime = {};
    groups.forEach(function (g) { (byTime[g[0].t] = byTime[g[0].t] || []).push(g); });
    Object.keys(byTime).map(Number).sort(function (a, b) { return a - b; }).forEach(function (t) {
      if (byTime[t].length > 1) {
        var names = byTime[t].map(function (g) { return g.map(function (a) { return a.ev.label || a.ev.id; }).join(' / '); });
        warnings.push(ft(t) + ' に pre/post の異なるイベントが複数あります（' + names.join('、') +
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
      var imp = evs.reduce(function (best, x) {
        var v = normImportance(x.importance);
        return IMPORTANCE_RANK[v] > IMPORTANCE_RANK[best] ? v : best;
      }, 'low');
      var preT = timeOf(first.ev.preTime), postT = timeOf(first.ev.postTime);
      return {
        id: evs.map(function (x, i) { return x.id || ('event-' + g[i].idx); }).join('+'),
        label: evs.map(function (x) { return x.label || x.id || ''; }).join(' / '),
        time: first.t,
        importance: imp,
        category: uniqueJoin(evs.map(function (x) { return x.category; }), ' / ') || 'その他',
        pre: pre,
        post: post,
        preTime: preT,
        postTime: postT,
        yen: yen,
        pips: yenToPips(yen),
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
      if (a.time !== b.time) return a.time - b.time;
      return a._idx - b._idx;
    });

    // 4) 累積レベル
    var level = start.rate, sumEvents = 0, sumWeak = 0, sumStrong = 0;
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
      pips: yenToPips(residualYen),
      pct: clean(residualYen / start.rate * 100),
      direction: directionOf(residualYen),
      from: level,
      to: end.rate // 浮動小数誤差で end とずれないよう end.rate をそのまま使う
    };

    return {
      start: start,
      end: end,
      order: order,
      durationMs: dur,
      totalYen: totalYen,
      totalPips: yenToPips(totalYen),
      totalPct: clean((end.rate / start.rate - 1) * 100),
      items: items,
      residual: residual,
      sumWeakYen: roundYen(sumWeak),
      sumStrongYen: roundYen(sumStrong),
      sumEventsYen: sumEvents,
      sumWeakPips: yenToPips(roundYen(sumWeak)),
      sumStrongPips: yenToPips(roundYen(sumStrong)),
      sumEventsPips: yenToPips(sumEvents),
      warnings: warnings
    };
  }

  /* ------------------------------------------------------------------ */
  /* 価格系列 CSV                                                        */
  /* ------------------------------------------------------------------ */

  function splitLine(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }

  function detectDelimiter(line) {
    if (line.indexOf('\t') >= 0) return '\t';
    if (line.indexOf(';') >= 0 && line.indexOf(',') < 0) return ';';
    return ',';
  }

  var DATE_LOCAL_RE = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/;
  var TIME_LOCAL_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?$/;
  var DATETIME_LOCAL_RE = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?$/;
  var UNIX_RE = /^\d{9,13}(?:\.\d+)?$/;

  function localToMs(y, mo, d, h, mi, s, frac, zone) {
    if (!fieldsValid(y, mo, d, h, mi, s)) return null;
    var msec = frac ? Math.floor(Number('0.' + frac) * 1000) : 0;
    return wallToUtc(y, mo, d, h, mi, s, msec, zone);
  }

  // 日付セル + 時刻セル（MT4 / MT5）
  function parseDateAndTime(dateStr, timeStr, zone) {
    var dm = DATE_LOCAL_RE.exec(dateStr || '');
    if (!dm) return null;
    var h = 0, mi = 0, s = 0, frac = null;
    if (timeStr != null && timeStr !== '') {
      var tm = TIME_LOCAL_RE.exec(timeStr);
      if (!tm) return null;
      h = +tm[1]; mi = +tm[2]; s = tm[3] ? +tm[3] : 0; frac = tm[4] || null;
    }
    return localToMs(+dm[1], +dm[2], +dm[3], h, mi, s, frac, zone);
  }

  // 1 セルの日時（ISO・オフセット付き / オフセットなし日時 / UNIX 秒・ミリ秒）
  function parseDateTimeCell(str, zone, allowUnix) {
    if (str == null) return null;
    var s = String(str).trim();
    if (s === '') return null;
    var t = parseTime(s);
    if (t != null) return t;
    var m = DATETIME_LOCAL_RE.exec(s);
    if (m) return localToMs(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, m[7] || null, zone);
    if (allowUnix && UNIX_RE.test(s)) {
      var n = Number(s);
      return n >= 1e11 ? Math.round(n) : Math.round(n * 1000);
    }
    return null;
  }

  function looksLikeDateCell(s) {
    s = (s || '').trim();
    return DATE_LOCAL_RE.test(s) || DATETIME_LOCAL_RE.test(s) || ISO_RE.test(s) || UNIX_RE.test(s);
  }

  function priceCell(v) {
    if (v == null) return NaN;
    var s = String(v).trim();
    if (s === '' || s === '.') return NaN;
    var n = Number(s);
    return isFinite(n) && n > 0 ? n : NaN;
  }

  function findCol(norm, names) {
    for (var i = 0; i < names.length; i++) {
      var j = norm.indexOf(names[i]);
      if (j >= 0) return j;
    }
    return -1;
  }

  function modeInterval(times) {
    var counts = {};
    for (var i = 1; i < times.length; i++) {
      var d = times[i] - times[i - 1];
      if (d > 0) counts[d] = (counts[d] || 0) + 1;
    }
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (k) {
      var d = Number(k), n = counts[k];
      if (n > bestN || (n === bestN && d < best)) { best = d; bestN = n; }
    });
    return best;
  }

  /**
   * parseSeriesCsvDetailed(text, { tz }) → {
   *   series: [{ time(ms), rate, high?, low? }]（時刻昇順・同時刻は後勝ち）,
   *   format: 'mt4' | 'mt5' | 'tradingview' | 'generic' | 'unknown',
   *   formatLabel, ohlc: boolean, intervalMs: number|null（OHLC 足の間隔＝連続差分の最頻値）,
   *   rows（データ行数）, skipped（スキップ行数）, tz（解釈に使ったタイムゾーン名）,
   *   unixTime（時刻列が UNIX 時刻だった）, notes: string[]
   * }
   * OHLC 足は時刻を始値時刻とみなし、rate（終値）の時刻 = 時刻 + intervalMs とする。
   * オフセットなしの日時は tz（"UTC" | "Asia/Tokyo" | "America/New_York" | "+02:00" 等、既定 UTC）で解釈。
   */
  function parseSeriesCsvDetailed(text, options) {
    options = options || {};
    var zone = resolveTimeZone(options.tz || 'UTC');
    var res = { series: [], format: 'unknown', formatLabel: FORMAT_LABELS.unknown, ohlc: false, intervalMs: null,
      rows: 0, skipped: 0, tz: zone.name, unixTime: false, notes: [] };
    if (typeof text !== 'string') return res;
    var lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return res;

    var delim = detectDelimiter(lines[0]);
    var first = splitLine(lines[0], delim);
    var norm = first.map(function (h) { return h.replace(/^<|>$/g, '').trim().toLowerCase(); });
    var L = null; // { format, date, time, open, high, low, close, from }

    if (!looksLikeDateCell(first[0])) {
      // ヘッダあり
      if (/^<[^>]+>$/.test(first[0])) {
        L = { format: 'mt5', date: norm.indexOf('date'), time: norm.indexOf('time'),
          open: norm.indexOf('open'), high: norm.indexOf('high'), low: norm.indexOf('low'), close: norm.indexOf('close') };
      } else if (norm[0] === 'time' && norm.indexOf('close') >= 0 && norm.indexOf('open') >= 0) {
        L = { format: 'tradingview', date: 0, time: -1, open: norm.indexOf('open'), high: norm.indexOf('high'),
          low: norm.indexOf('low'), close: norm.indexOf('close') };
      } else {
        var dcol = findCol(norm, ['datetime', 'date_time', 'timestamp', 'date', 'time', 'observation_date', '日時', '日付']);
        var tcol = -1;
        if (norm[dcol] === 'date' || norm[dcol] === '日付') tcol = findCol(norm, ['time', '時刻']);
        var ccol = findCol(norm, ['close', '終値', 'rate', 'price', 'value', 'last', 'bid', 'dexjpus']);
        if (ccol < 0 && norm.length === 2 && dcol >= 0) ccol = dcol === 0 ? 1 : 0;
        if (dcol >= 0 && ccol >= 0) {
          L = { format: 'generic', date: dcol, time: tcol, open: findCol(norm, ['open', '始値']),
            high: findCol(norm, ['high', '高値']), low: findCol(norm, ['low', '安値']), close: ccol };
        }
      }
      if (L) L.from = 1;
    } else if (DATE_LOCAL_RE.test(first[0]) && TIME_LOCAL_RE.test(first[1] || '') && first.length >= 6) {
      L = { format: 'mt4', date: 0, time: 1, open: 2, high: 3, low: 4, close: 5, from: 0 };
    } else {
      L = first.length >= 5
        ? { format: 'generic', date: 0, time: -1, open: 1, high: 2, low: 3, close: 4, from: 0 }
        : { format: 'generic', date: 0, time: -1, open: -1, high: -1, low: -1, close: 1, from: 0 };
    }
    if (!L || L.date < 0 || L.close < 0) {
      res.skipped = lines.length;
      res.notes.push('CSV の形式を判別できませんでした（MT4 / MT5 / TradingView / 汎用 datetime,close に対応）');
      return res;
    }
    res.format = L.format;
    res.formatLabel = FORMAT_LABELS[L.format];
    res.ohlc = L.high >= 0 && L.low >= 0;
    var allowUnix = L.format === 'tradingview' || L.format === 'generic';

    var map = {}, order = [], seenTimes = {};
    for (var i = L.from; i < lines.length; i++) {
      res.rows++;
      var c = splitLine(lines[i], delim);
      var t = L.time >= 0 ? parseDateAndTime(c[L.date], c[L.time], zone) : parseDateTimeCell(c[L.date], zone, allowUnix);
      if (t != null && allowUnix && !res.unixTime && UNIX_RE.test(c[L.date] || '')) res.unixTime = true;
      var rate = priceCell(c[L.close]);
      if (t != null) seenTimes[t] = true; // 足の間隔の判定には値が欠けた行の時刻も使う
      if (t == null || !(rate > 0)) { res.skipped++; continue; }
      var p = { time: t, rate: rate };
      if (res.ohlc) {
        var hi = priceCell(c[L.high]), lo = priceCell(c[L.low]);
        if (hi > 0) p.high = hi;
        if (lo > 0) p.low = lo;
      }
      if (!(t in map)) order.push(t);
      map[t] = p; // 同時刻は後勝ち
    }
    var times = order.sort(function (a, b) { return a - b; });
    var shift = 0;
    if (res.ohlc) {
      var iv = modeInterval(Object.keys(seenTimes).map(Number).sort(function (a, b) { return a - b; }));
      res.intervalMs = iv;
      if (iv) shift = iv;
      else res.notes.push('足が 1 本のみのため足の間隔を判別できず、時刻をそのまま終値時刻として扱いました');
    }
    res.series = times.map(function (t) {
      var p = map[t];
      var o = { time: t + shift, rate: p.rate };
      if (p.high != null) o.high = p.high;
      if (p.low != null) o.low = p.low;
      return o;
    });
    if (res.skipped) res.notes.push(res.skipped + ' 行を空値・不正値のためスキップしました');
    return res;
  }

  /**
   * parseSeriesCsv(text, { tz }) → [{ time(ms), rate, high?, low? }]
   * 配列には列挙されないプロパティ format / formatLabel / intervalMs / skipped / ohlc / notes を付ける。
   */
  function parseSeriesCsv(text, options) {
    var d = parseSeriesCsvDetailed(text, options);
    var arr = d.series;
    ['format', 'formatLabel', 'intervalMs', 'skipped', 'ohlc', 'notes', 'rows', 'tz'].forEach(function (k) {
      Object.defineProperty(arr, k, { value: d[k], enumerable: false, writable: true, configurable: true });
    });
    return arr;
  }

  /** series を [{ time(ms), rate, high?, low? }] に正規化（不正点除外・時刻昇順・同時刻は後勝ち） */
  function normalizeSeries(series) {
    if (!Array.isArray(series)) return [];
    var map = {}, keys = [];
    series.forEach(function (p) {
      if (!p) return;
      var t = timeOf(p.time), r = toNumber(p.rate);
      if (t == null || !(r > 0)) return;
      var o = { time: t, rate: r };
      var hi = toNumber(p.high), lo = toNumber(p.low);
      if (hi > 0) o.high = hi;
      if (lo > 0) o.low = lo;
      if (!(t in map)) keys.push(t);
      map[t] = o;
    });
    return keys.sort(function (a, b) { return a - b; }).map(function (t) { return map[t]; });
  }

  /**
   * applySeries(events, series, { windowMinutes = 5 }) → 新しい events 配列（元は破壊しない）
   * pre  = イベント時刻より厳密に前の直近観測、post = イベント時刻 + windowMinutes 以降の最初の観測。
   * 両方取れたときだけ pre/post を上書きし、preTime/postTime（ISO 8601 UTC）を記録する。
   */
  function applySeries(events, series, options) {
    options = options || {};
    var w = toNumber(options.windowMinutes);
    if (!(w >= 0)) w = 5;
    var s = normalizeSeries(series);
    if (!Array.isArray(events)) return [];
    return events.map(function (ev) {
      if (!ev || typeof ev !== 'object') return ev;
      var copy = {};
      for (var key in ev) if (Object.prototype.hasOwnProperty.call(ev, key)) copy[key] = ev[key];
      if (ev.source && typeof ev.source === 'object') copy.source = Object.assign({}, ev.source);
      var t = timeOf(ev.time);
      if (t == null || s.length === 0) return copy;
      var target = t + w * MINUTE;
      var pre = null, post = null;
      for (var i = 0; i < s.length; i++) {
        if (s[i].time < t) pre = s[i];
        if (s[i].time >= target) { post = s[i]; break; }
      }
      if (pre && post) {
        copy.pre = pre.rate;
        copy.post = post.rate;
        copy.preTime = toIso(pre.time, 'UTC');
        copy.postTime = toIso(post.time, 'UTC');
      }
      return copy;
    });
  }

  /* ------------------------------------------------------------------ */
  /* analyze — 売りエントリーの判断材料（事実の集計のみ）               */
  /* ------------------------------------------------------------------ */

  var MOMENTUM_MINUTES = [5, 15, 60];
  var NEXT_EVENT_WARN_MINUTES = 60;

  /**
   * analyze(dataset, result) → {
   *   basis: 'series' | 'points',      // series: 価格系列から / points: A・B・各イベント前後の点のみ（粗い推定）
   *   pointCount,                      // 計算に使った期間内の観測点数
   *   start: { time, rate }, end: { time, rate }, durationMs,
   *   high: { rate, time }, low: { rate, time },   // 期間 [A, B] の高値・安値（series の high/low があれば使う）
   *   fromHighPips,                    // (B − 高値) × 100（≦ 0）
   *   fromLowPips,                     // (B − 安値) × 100（≧ 0）
   *   rangePips,                       // (高値 − 安値) × 100
   *   rangePositionPct,                // (B − 安値) / (高値 − 安値) × 100（高値 = 安値 なら 100）
   *   totalPips, eventDrivenPips (= Σ pips_i), nonEventPips (= residual × 100),
   *   reactions: [{ id, label, time, importance, direction, pre, post, postTime,
   *                 initialPips,       // (post − pre) × 100
   *                 extreme: { rate, time } | null,  // 発表後〜B の極値（円安イベント=最高値、円高イベント=最安値）
   *                 extensionPips,     // (極値 − post) × 100
   *                 movePips,          // (極値 − pre) × 100（初動〜極値）
   *                 retracePct,        // (極値 − B) / (極値 − pre) × 100。極値から B までに戻した割合
   *                 retracePips }],    // (B − 極値) × 100
   *                                    // basis = 'points' のときは空配列
   *   momentum: [{ minutes: 5|15|60, pips|null, fromRate|null, fromTime|null }],  // B 直前の変化（series 時のみ）
   *   nextEvent: { time, label, importance, minutesUntil, source } | null,  // upcoming のうち B より後の最初
   *   nextHighEvent: { ... } | null,   // B より後の最初の重要度 high
   *   nextEventWarning: boolean,       // 重要度 high の予定が B から 60 分以内
   *   upcoming: [{ time, label, importance, minutesUntil, source }],  // B より後の予定（時刻順）
   *   levels: [{ rate, label, source, distancePips, position: 'above'|'below'|'at' }],
   *                                    // distancePips = (水準 − B) × 100。水準の高い順
   *   warnings: string[], notes: string[]
   * }
   */
  function analyze(dataset, result) {
    if (!result) result = decompose(dataset);
    var ds = dataset || {};
    var startT = result.start.time, endT = result.end.time, endRate = result.end.rate;
    var warnings = [], notes = [];
    var all = normalizeSeries(ds.series);
    var inRange = all.filter(function (p) { return p.time >= startT && p.time <= endT; });
    var basis = inRange.length >= 2 ? 'series' : 'points';
    if (all.length && basis === 'points') {
      warnings.push('価格系列はありますが、期間 A〜B 内の観測が 2 点未満のため使っていません');
    }

    var pts;
    if (basis === 'series') {
      pts = inRange.slice();
      // A/B 時点の値も候補に入れる（系列の端と A/B の値がずれていても高値・安値に反映）
      pts.push({ time: startT, rate: result.start.rate });
      pts.push({ time: endT, rate: endRate });
    } else {
      pts = [{ time: startT, rate: result.start.rate }, { time: endT, rate: endRate }];
      result.items.forEach(function (it) {
        pts.push({ time: it.preTime != null && it.preTime >= startT ? it.preTime : it.time, rate: it.pre });
        pts.push({ time: it.postTime != null && it.postTime <= endT ? it.postTime : it.time, rate: it.post });
      });
      notes.push('価格系列がないため、高値・安値・レンジ内位置は A・B 時点と各イベント前後の点のみから計算した粗い推定です。実際の高値・安値はこれより外側にある可能性があります。');
    }
    var high = null, low = null;
    pts.forEach(function (p) {
      var hi = p.high != null ? p.high : p.rate, lo = p.low != null ? p.low : p.rate;
      if (!high || hi > high.rate) high = { rate: hi, time: p.time };
      if (!low || lo < low.rate) low = { rate: lo, time: p.time };
    });
    var rangeYen = high.rate - low.rate;
    var rangePositionPct = rangeYen > EPS ? clean((endRate - low.rate) / rangeYen * 100) : 100;

    // イベント反応（series 時のみ）
    var reactions = [];
    if (basis === 'series') {
      result.items.slice().sort(function (a, b) { return a.time - b.time; }).forEach(function (it) {
        var from = it.postTime != null ? it.postTime : it.time;
        var ext = null;
        if (it.direction !== 'neutral') {
          // 系列の点に加え、イベント直後(post)と B 時点の値も候補にする
          // （手入力で post / B のレートを変えた場合や、系列末尾と B がずれる場合でも期間高値・安値と矛盾しない）
          var cands = inRange.concat([{ time: from, rate: it.post }, { time: endT, rate: endRate }]);
          cands.forEach(function (p) {
            if (p.time < from) return;
            if (it.direction === 'weak') {
              var hi = p.high != null ? p.high : p.rate;
              if (!ext || hi > ext.rate) ext = { rate: hi, time: p.time };
            } else {
              var lo = p.low != null ? p.low : p.rate;
              if (!ext || lo < ext.rate) ext = { rate: lo, time: p.time };
            }
          });
        }
        var move = ext ? ext.rate - it.pre : null;
        reactions.push({
          id: it.id, label: it.label, time: it.time, importance: it.importance, direction: it.direction,
          pre: it.pre, post: it.post, postTime: it.postTime,
          initialPips: it.pips,
          extreme: ext,
          extensionPips: ext ? roundPips((ext.rate - it.post) / PIP) : null,
          movePips: ext ? roundPips(move / PIP) : null,
          retracePct: ext && Math.abs(move) > EPS ? clean((ext.rate - endRate) / move * 100) : null,
          retracePips: ext ? roundPips((endRate - ext.rate) / PIP) : null
        });
      });
      if (reactions.some(function (r) { return r.extreme == null && r.direction !== 'neutral'; })) {
        notes.push('発表後〜B 時点の観測がないイベントは、伸び・戻り率を計算していません。');
      }
    }

    // モメンタム（series 時のみ）
    var momentum = MOMENTUM_MINUTES.map(function (m) {
      var out = { minutes: m, pips: null, fromRate: null, fromTime: null };
      if (basis !== 'series') return out;
      var target = endT - m * MINUTE, base = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].time <= target) base = all[i];
        else break;
      }
      // 直前の観測が古すぎる（窓の 2 倍以上前。週末の空白など）ときはデータ不足とみなす
      if (base && base.time > endT - 2 * m * MINUTE) {
        out.pips = roundPips((endRate - base.rate) / PIP);
        out.fromRate = base.rate;
        out.fromTime = base.time;
      }
      return out;
    });
    if (basis === 'series' && momentum.some(function (m) { return m.pips == null; })) {
      warnings.push('B 時点の直前の価格系列が足りないため、一部の直近変化（' +
        momentum.filter(function (m) { return m.pips == null; }).map(function (m) { return m.minutes + '分'; }).join('・') +
        '）を計算できません');
    }

    // 予定イベント
    var upcoming = (Array.isArray(ds.upcoming) ? ds.upcoming : []).map(function (u) {
      if (!u) return null;
      var t = timeOf(u.time);
      if (t == null || !(t > endT)) return null;
      return { time: t, label: u.label || '', importance: normImportance(u.importance),
        minutesUntil: (t - endT) / MINUTE, source: u.source || null };
    }).filter(Boolean).sort(function (a, b) { return a.time - b.time; });
    var nextEvent = upcoming[0] || null;
    var nextHighEvent = null;
    for (var k = 0; k < upcoming.length; k++) if (upcoming[k].importance === 'high') { nextHighEvent = upcoming[k]; break; }
    var nextEventWarning = !!(nextHighEvent && nextHighEvent.minutesUntil <= NEXT_EVENT_WARN_MINUTES);
    if (nextEventWarning) {
      warnings.push('重要度「高」の予定イベント「' + nextHighEvent.label + '」まで ' +
        formatDuration(nextHighEvent.time - endT) + 'です。発表前後は値動きが大きくなることがあります');
    }
    if (!upcoming.length) notes.push('B 時点より後の予定イベントは登録されていません（登録済みのもののみ表示します）。');

    // 警戒ライン
    var levels = (Array.isArray(ds.levels) ? ds.levels : []).map(function (l) {
      if (!l || !(isFiniteNumber(l.rate) && l.rate > 0)) return null;
      var dp = roundPips((l.rate - endRate) / PIP);
      return { rate: l.rate, label: l.label || '', source: l.source || null, distancePips: dp,
        position: dp > 0 ? 'above' : dp < 0 ? 'below' : 'at' };
    }).filter(Boolean).sort(function (a, b) { return b.rate - a.rate; });

    notes.push('天井（ピーク）は事後にしか確定しません。期間高値は B 時点までに観測された最大値であり、今後さらに上がる可能性も下がる可能性もあります。');
    notes.push('イベントの寄与は発表前後の窓内の値動きで、同じ時間帯の他の要因も含みます。因果関係を特定するものではありません。');
    if (basis === 'series' && all.some(function (p) { return p.high != null; })) {
      notes.push('OHLC 足の高値・安値は足の終値時刻で表示しています（足の中のどの時点かは分かりません）。');
    }

    return {
      basis: basis,
      pointCount: basis === 'series' ? inRange.length : pts.length,
      start: { time: startT, rate: result.start.rate },
      end: { time: endT, rate: endRate },
      durationMs: endT - startT,
      high: high,
      low: low,
      fromHighPips: roundPips((endRate - high.rate) / PIP),
      fromLowPips: roundPips((endRate - low.rate) / PIP),
      rangePips: roundPips(rangeYen / PIP),
      rangePositionPct: rangePositionPct,
      totalPips: result.totalPips,
      eventDrivenPips: result.sumEventsPips,
      nonEventPips: result.residual.pips,
      reactions: reactions,
      momentum: momentum,
      nextEvent: nextEvent,
      nextHighEvent: nextHighEvent,
      nextEventWarning: nextEventWarning,
      upcoming: upcoming,
      levels: levels,
      warnings: warnings,
      notes: notes
    };
  }

  return {
    // 計算
    decompose: decompose,
    validateDataset: validateDataset,
    analyze: analyze,
    parseSeriesCsv: parseSeriesCsv,
    parseSeriesCsvDetailed: parseSeriesCsvDetailed,
    applySeries: applySeries,
    normalizeSeries: normalizeSeries,
    // 時刻
    parseTime: parseTime,
    toIso: toIso,
    toLocalInput: toLocalInput,
    fromLocalInput: fromLocalInput,
    wallClock: wallClock,
    wallToUtc: function (y, mo, d, h, mi, s, tz) { return wallToUtc(y, mo, d, h, mi, s, 0, tz); },
    offsetAt: offsetAt,
    resolveTimeZone: resolveTimeZone,
    tzLabel: tzLabel,
    // 書式
    formatYen: formatYen,
    formatPct: formatPct,
    formatRate: formatRate,
    formatPips: formatPips,
    formatDuration: formatDuration,
    formatTime: formatTime,
    directionOf: directionOf,
    // 定数
    DIRECTION_LABELS: DIRECTION_LABELS,
    IMPORTANCE_LEVELS: IMPORTANCE_LEVELS,
    IMPORTANCE_LABELS: IMPORTANCE_LABELS,
    FORMAT_LABELS: FORMAT_LABELS,
    MIN_DURATION_MS: MIN_DURATION_MS,
    MAX_DURATION_MS: MAX_DURATION_MS,
    PIP: PIP
  };
});
