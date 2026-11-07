'use strict';
// E2E（Playwright, chromium, file://）。index.html を直接開いて UI を検証する。
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const FW = require('../waterfall.js');
const datasets = require('../data/datasets.js');
const INDEX_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const DS = datasets[0];
const EVENT_COUNT = DS.events.length;
const DAY_MS = 86400000;
const DEFAULT_TZ = 'Asia/Tokyo'; // index.html の既定（#tz-jst が checked）

describe('waterfall E2E (file://)', () => {
  let browser;
  before(async () => { browser = await chromium.launch(); });
  after(async () => { if (browser) await browser.close(); });

  async function openPage(viewport) {
    const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(INDEX_URL);
    await page.waitForSelector('#chart svg');
    await page.waitForSelector('#price-chart svg');
    return { page, errors };
  }

  // 期待値は datasets.js と FW の計算から作る（画面の数値との突き合わせ）
  function expected(tz) {
    const r = FW.decompose(DS, { order: 'chronological', tz: tz || DEFAULT_TZ });
    const a = FW.analyze(DS, r);
    return { r: r, a: a };
  }

  test('file:// で開け、コンソールエラー・pageerror が 0', async () => {
    const { page, errors } = await openPage();
    try {
      await page.waitForTimeout(300);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('ウォーターフォール: event バー数 = 実データのイベント数（2）、start / residual / end は各 1', async () => {
    const { page, errors } = await openPage();
    try {
      assert.equal(EVENT_COUNT, 2, 'datasets.js のイベント数（想定 2）');
      assert.equal(await page.locator('#chart svg.fxw-svg g.fxw-bar[data-kind="event"]').count(), EVENT_COUNT);
      assert.equal(await page.locator('#chart svg.fxw-svg g.fxw-bar[data-kind="start"]').count(), 1);
      assert.equal(await page.locator('#chart svg.fxw-svg g.fxw-bar[data-kind="residual"]').count(), 1);
      assert.equal(await page.locator('#chart svg.fxw-svg g.fxw-bar[data-kind="end"]').count(), 1);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('#summary-headline が A・B の値（小数 3 桁）と合計（pips・%）を含む', async () => {
    const { r } = expected();
    const { page, errors } = await openPage();
    try {
      const text = await page.textContent('#summary-headline');
      // 見出しは rate3（小数 3 桁）で表示する（app.js renderSummary）
      assert.ok(text.includes('A ' + DS.start.rate.toFixed(3) + ' → B ' + DS.end.rate.toFixed(3)), 'headline: ' + text);
      assert.ok(text.includes(FW.formatPips(r.totalPips)), 'headline has total pips: ' + text);
      assert.ok(text.includes(FW.formatPct(r.totalPct)), 'headline has total pct: ' + text);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('売りパネル: #sell-panel と #disclaimer が表示され、「推奨」「売り時」の推奨表現を含まない', async () => {
    const { page, errors } = await openPage();
    try {
      assert.equal(await page.locator('#sell-panel').isVisible(), true);
      assert.equal(await page.locator('#disclaimer').isVisible(), true);
      const text = await page.textContent('#sell-panel');
      // 免責文「売買の推奨ではありません」は否定形なので除外してから検査する
      const withoutDisclaimer = text.split('売買の推奨ではありません').join('');
      assert.ok(!withoutDisclaimer.includes('推奨'), '「推奨」が含まれる: ' + text);
      assert.ok(!text.includes('売り時'), '「売り時」が含まれる');
      assert.ok(text.includes('売買の推奨ではありません'), '免責文が含まれる');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('売りパネルの数値は分解・analyze の結果と一致する（basis・イベント寄与・高値からの差）', async () => {
    const { a } = expected();
    const { page, errors } = await openPage();
    try {
      assert.equal(await page.getAttribute('#sp-basis', 'data-basis'), a.basis);
      assert.equal(await page.textContent('#sp-event-pips'), FW.formatPips(a.eventDrivenPips));
      assert.equal(await page.textContent('#sp-nonevent-pips'), FW.formatPips(a.nonEventPips));
      assert.equal(await page.textContent('#sp-from-high'), FW.formatPips(a.fromHighPips));
      assert.equal(await page.textContent('#sp-range-pos'), a.rangePositionPct.toFixed(1) + '%');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('価格推移チャート: line が 1 本、event-marker がイベント数、high が 1', async () => {
    const { page, errors } = await openPage();
    try {
      assert.equal(await page.locator('#price-chart [data-role="line"]').count(), 1);
      assert.equal(await page.locator('#price-chart [data-role="event-marker"]').count(), EVENT_COUNT);
      assert.equal(await page.locator('#price-chart [data-role="high"]').count(), 1);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('#end-time を A から 6 日後にすると #period-duration[data-state=error] になり #errors に表示される', async () => {
    const { page, errors } = await openPage();
    try {
      const startMs = Date.parse(DS.start.time);
      const value = FW.toLocalInput(startMs + 6 * DAY_MS, DEFAULT_TZ);
      await page.fill('#end-time', value);
      await page.waitForTimeout(100);
      assert.equal(await page.getAttribute('#period-duration', 'data-state'), 'error');
      assert.ok((await page.textContent('#period-duration')).includes('5日を超える'), 'period text');
      assert.equal(await page.locator('#errors').isVisible(), true);
      const errText = await page.textContent('#errors');
      assert.ok(errText.includes('期間が長すぎます'), '#errors: ' + errText);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('MT4 形式の架空 CSV を #csv-tz "+02:00" で読み込むと #csv-format[data-format="mt4"]', async () => {
    const { page, errors } = await openPage();
    try {
      const csv = [
        '2024.11.06,13:05,151.60,151.80,151.50,151.70,1234',
        '2024.11.06,13:06,151.70,151.90,151.65,151.85,1100',
        '2024.11.06,13:07,151.85,152.00,151.80,151.95,980'
      ].join('\n') + '\n';
      await page.selectOption('#csv-tz', '+02:00');
      await page.setInputFiles('#csv-file', { name: 'mt4-sample.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
      await page.waitForSelector('#csv-format[data-format="mt4"]', { timeout: 5000 });
      const fmt = await page.textContent('#csv-format');
      assert.ok(fmt.includes('MT4'), 'format text: ' + fmt);
      assert.ok(fmt.includes('3 点'), 'point count in: ' + fmt);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('#tz-utc に切り替えてもエラーが出ない（pageerror・console error が 0、表示時刻が UTC に変わる）', async () => {
    const { page, errors } = await openPage();
    try {
      await page.check('#tz-utc');
      await page.waitForTimeout(150);
      const endValue = await page.inputValue('#end-time');
      assert.equal(endValue, FW.toLocalInput(Date.parse(DS.end.time), 'UTC'), 'end-time in UTC: ' + endValue);
      assert.equal(await page.locator('#errors').isVisible(), false, 'no input errors');
      assert.equal(await page.getAttribute('#period-duration', 'data-state'), 'ok');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('375px 幅で水平スクロールが出ない（scrollWidth <= 375）', async () => {
    const { page, errors } = await openPage({ width: 375, height: 800 });
    try {
      await page.waitForTimeout(200);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= 375, 'scrollWidth=' + sw);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
