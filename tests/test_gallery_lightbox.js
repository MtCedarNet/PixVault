// Browser integration test. Requires Playwright and its Chromium browser.
// Run: node tests/test_gallery_lightbox.js (or set NODE_PATH to Playwright's packages).
// PLAYWRIGHT_CHANNEL=msedge can use an installed Edge browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const pages = path.join(__dirname, '..', 'pages');
const items = Array.from({ length: 125 }, (_, i) => ({
  url: `/media/${i}.svg`, thumb_url: `/thumbs/${i}.svg`, folder: `Folder ${i}`,
}));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let releaseNext;
    const requests = [];
    const hot = [];
    // Exercise lightbox prefetch independently of scrolling the sentinel.
    await page.addInitScript(() => {
      window.IntersectionObserver = class { observe() {} disconnect() {} };
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'pixvault.test') return route.fulfill({ body: '' });
      if (url.pathname === '/') return route.fulfill({
        contentType: 'text/html', body: fs.readFileSync(path.join(pages, 'gallery.html'), 'utf8'),
      });
      if (url.pathname.startsWith('/assets/')) {
        const file = path.join(pages, url.pathname);
        return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(file) });
      }
      if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/thumbs/')) {
        const i = Number(url.pathname.match(/(\d+)\.svg/)[1]);
        return route.fulfill({ contentType: 'image/svg+xml', body:
          `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${150 + (i % 5) * 80}"><rect width="100%" height="100%" fill="#7860c0"/></svg>` });
      }
      if (url.pathname === '/api/hot/image') {
        hot.push(url.searchParams.get('url'));
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname === '/api/filters') return route.fulfill({ json: [] });
      if (url.pathname === '/api/stats') return route.fulfill({ json: { unique: 0, cumulative: 0 } });
      const n = Number(url.searchParams.get('page'));
      requests.push(n);
      if (n === 2) await new Promise(resolve => { releaseNext = resolve; });
      const start = (n - 1) * 40;
      return route.fulfill({ json: { total: items.length, has_more: start + 40 < items.length, items: items.slice(start, start + 40) } });
    });
    await page.goto('http://pixvault.test/');
    await page.waitForFunction(() => gallerySources.length === 40 && window.popupableOpen);
    const initialColumns = await page.evaluate(() => gallerySources.map(img => columns.indexOf(img.parentElement.parentElement)));
    assert.notDeepEqual(await page.locator('#grid .grid-item').evaluateAll(cards => cards.map(c => Number(c.dataset.idx))), Array.from({ length: 40 }, (_, i) => i));
    await page.locator('.grid-item[data-idx="0"] img').click();
    await page.waitForSelector('.popupable-open');
    assert.deepEqual(await page.evaluate(() => activePopupElement._state.group.map(entry => Number(entry.original.dataset.popupableIndex))), Array.from({ length: 40 }, (_, i) => i));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '1');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.idx), '1');
    assert.equal(await page.locator('.popupable-counter').textContent(), '2 / 40');
    const rect = await page.locator('.grid-item[data-idx="1"]').boundingBox();
    assert.ok(rect.y < 600 && rect.y + rect.height > 0, 'Selected card scrolls into view');
    const popup = await page.evaluateHandle(() => activePopupElement);

    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '39');
    await page.waitForFunction(() => loading);
    await page.waitForTimeout(50);
    assert.deepEqual(requests, [1, 2], 'Only one request at the loaded end');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => activePopupSource.dataset.popupableIndex), '39', 'No wrap while the next page is loading');
    releaseNext();
    await page.waitForFunction(() => activePopupElement?._state.group.length === 80);
    assert.equal(await page.evaluate(previous => activePopupElement === previous, popup), true, 'Append preserves the open popup');
    assert.equal(await page.locator('.popupable-counter').textContent(), '40 / 80');
    assert.deepEqual(await page.evaluate(() => gallerySources.slice(0, 40).map(img => columns.indexOf(img.parentElement.parentElement))), initialColumns);
    await page.setViewportSize({ width: 650, height: 600 });
    await page.waitForFunction(() => columns.length === 3);
    assert.deepEqual(await page.evaluate(() => activePopupElement._state.group.map(entry => Number(entry.original.dataset.popupableIndex))), Array.from({ length: 80 }, (_, i) => i));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '40');
    await page.locator('.popupable-next-container').click();
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '41');
    await page.locator('.popupable-prev-container').click();
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '40');
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(150, 300, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '41');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '40');
    await page.keyboard.press('Home');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '0');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => activePopupSource.dataset.popupableIndex), '0');

    // Prefetch starts eight images before the end, with no sentinel callback.
    await page.evaluate(() => { activePopupElement._state.group.currentIndex = 70; });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '71');
    await page.waitForFunction(() => activePopupElement?._state.group.length === 120);
    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupElement?._state.group.length === 125);
    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '124');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => activePopupSource.dataset.popupableIndex), '124');
    assert.deepEqual(requests, [1, 2, 3, 4]);
    assert.equal(await page.locator('.popupable-counter').textContent(), '125 / 125');
    assert.ok(hot.includes('/media/40.svg'), 'Navigated images keep hot logging');
    const assertClosedAtLastImage = async label => {
      await page.waitForFunction(() => activePopupSource === null && !history.state?.pixvaultGalleryPopup);
      // History restores scrolling after popstate; check after rendering settles.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const card = await page.locator('.grid-item[data-idx="124"]').boundingBox();
      assert.ok(card.y < 600 && card.y + card.height > 0, `${label}: last viewed image stays in view`);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.popupableIndex), '124');
    };
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => activePopupSource === null);
    await assertClosedAtLastImage('Browser Back');
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '124');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => activePopupSource === null);
    await assertClosedAtLastImage('Escape');
    // Closing with the button traverses to the entry saved at the first image.
    await page.evaluate(() => {
      gallerySources[124].dataset.popupableZoomable = '';
      return window.popupableOpen(gallerySources[0]);
    });
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '0');
    await page.waitForSelector('.popupable-open');
    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '124');
    await page.locator('.popupable-close-container').click();
    await assertClosedAtLastImage('Close button');
    // Keyboard activation reopens the focused gallery image.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '124');
    await page.evaluate(() => resetGrid());
    await page.waitForFunction(() => activePopupSource === null && gallerySources.length === 40);
    assert.equal(await page.locator('.lightbox-selected').count(), 0);
    await page.waitForFunction(() => !history.state?.pixvaultGalleryPopup);
    await page.evaluate(() => window.popupableOpen(gallerySources[31]));
    await page.waitForFunction(() => activePopupSource?.dataset.popupableIndex === '31' && loading);
    await page.waitForTimeout(50);
    const releaseStale = releaseNext;
    await page.evaluate(() => setSearch('new search'));
    await page.waitForFunction(() => gallerySources.length === 40 && !loading);
    releaseStale();
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => gallerySources.length), 40, 'Stale prefetch cannot append into a reset gallery');
    await page.evaluate(() => window.popupableOpen(gallerySources[0]));
    await page.waitForFunction(() => activePopupElement?._state.group.length === 40);
    assert.deepEqual(errors, []);
    console.log('Browser lightbox: packing order, focus/scroll, live append, keyboard/buttons/swipe, resize, boundaries, Back/Forward and stale reset passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
