'use strict';
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
    await page.waitForSelector('svg.fxw-svg');
    return { page, errors };
  }

  test('file:// で開け、コンソールエラー・pageerror が 0', async () => {
    const { page, errors } = await openPage();
    try {
      await page.waitForTimeout(300);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('SVG とバー: event 数 = 実データのイベント数、start/residual/end は各 1', async () => {
    const { page, errors } = await openPage();
    try {
      assert.equal(await page.locator('svg.fxw-svg').count(), 1);
      assert.equal(await page.locator('svg.fxw-svg g.fxw-bar[data-kind="event"]').count(), EVENT_COUNT);
      assert.equal(EVENT_COUNT, 5, 'datasets.js のイベント数（想定 5）');
      assert.equal(await page.locator('svg.fxw-svg g.fxw-bar[data-kind="start"]').count(), 1);
      assert.equal(await page.locator('svg.fxw-svg g.fxw-bar[data-kind="residual"]').count(), 1);
      assert.equal(await page.locator('svg.fxw-svg g.fxw-bar[data-kind="end"]').count(), 1);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('#summary-headline が "A 140.61円 → B 158.27円" を含む（datasets.js から算出）', async () => {
    const r = FW.decompose(DS);
    const expected = 'A ' + FW.formatRate(DS.start.rate) + ' → B ' + FW.formatRate(DS.end.rate);
    assert.equal(expected, 'A 140.61円 → B 158.27円');
    const { page } = await openPage();
    try {
      const text = await page.textContent('#summary-headline');
      assert.ok(text.includes(expected), 'headline: ' + text);
      assert.ok(text.includes(FW.formatYen(r.totalYen)), 'headline has total yen: ' + text);
      assert.ok(text.includes(FW.formatPct(r.totalPct)), 'headline has total pct: ' + text);
    } finally { await page.close(); }
  });

  test('#end-rate を変更すると #summary-headline と residual が更新される', async () => {
    const { page, errors } = await openPage();
    try {
      const before = await page.textContent('#sum-residual');
      assert.equal(before, '+13.13円', 'initial residual (手計算: 17.66 - 4.53)');
      await page.fill('#end-rate', '160');
      await page.waitForTimeout(100);
      const head = await page.textContent('#summary-headline');
      assert.ok(head.includes('B 160.00円'), 'headline after change: ' + head);
      // 手計算: 合計 19.39円、イベント合計 4.53円 → residual 14.86円
      assert.equal(await page.textContent('#sum-residual'), '+14.86円');
      const resRow = await page.textContent('#result-tbody tr[data-row-kind="residual"] td[data-label="寄与（円）"]');
      assert.equal(resRow, '+14.86円');
      const endBar = await page.getAttribute('svg.fxw-svg g.fxw-bar[data-kind="end"]', 'aria-label');
      assert.ok(endBar && endBar.includes('160.00円'), 'end bar label: ' + endBar);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('#order-magnitude で並びが |yen| 降順になる（既定は日付順）', async () => {
    const { page, errors } = await openPage();
    try {
      const idsOf = () => page.$$eval('svg.fxw-svg g.fxw-bar[data-kind="event"]', (gs) => gs.map((g) => g.getAttribute('data-id')));
      const chronoIds = DS.events.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((e) => e.id);
      assert.deepEqual(await idsOf(), chronoIds, 'chronological default');
      await page.check('#order-magnitude');
      await page.waitForTimeout(100);
      const magIds = DS.events.slice()
        .sort((a, b) => Math.abs(b.post - b.pre) - Math.abs(a.post - a.pre))
        .map((e) => e.id);
      assert.deepEqual(await idsOf(), magIds, 'magnitude order');
      // 手計算での先頭は ldp-ishiba-2024 (|-3.55|)
      assert.equal((await idsOf())[0], 'ldp-ishiba-2024');
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

  test('バーにフォーカスすると .fxw-tooltip が可視になる', async () => {
    const { page, errors } = await openPage();
    try {
      const bar = page.locator('svg.fxw-svg g.fxw-bar[data-kind="event"]').first();
      await bar.focus();
      await page.waitForTimeout(100);
      const tip = page.locator('.fxw-tooltip');
      assert.equal(await tip.count(), 1);
      assert.equal(await tip.isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
