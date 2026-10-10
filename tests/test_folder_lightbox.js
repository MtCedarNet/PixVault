// Requires Playwright and Chromium; PLAYWRIGHT_CHANNEL=msedge can use Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const pages = path.join(__dirname, '..', 'pages');
const items = Array.from({ length: 65 }, (_, i) => ({
  url: `/media/Trips/${i}.svg`, thumb_url: `/thumbs/Trips/${i}.svg`, folder: 'Trips', display_name: `Photo ${i}`,
}));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    const requests = [];
    const hot = [];
    let delayNext = true;
    let releaseNext;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.IntersectionObserver = class { observe() {} disconnect() {} };
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'pixvault.test') return route.fulfill({ body: '' });
      if (url.pathname === '/folders') return route.fulfill({
        contentType: 'text/html', body: fs.readFileSync(path.join(pages, 'folders.html'), 'utf8'),
      });
      if (url.pathname.startsWith('/assets/')) {
        const file = path.join(pages, url.pathname);
        return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(file) });
      }
      if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/thumbs/')) {
        return route.fulfill({ contentType: 'image/svg+xml', body:
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="250"><rect width="100%" height="100%" fill="#7860c0"/></svg>' });
      }
      if (url.pathname === '/api/folders') return route.fulfill({ json: [
        { name: 'Trips', display_name: 'Trips', basename: 'Trips', parent: '', count: 65, total_count: 65, tags: [], thumbnail: '/thumbs/Trips/0.svg' },
        { name: 'Other', display_name: 'Other', basename: 'Other', parent: '', count: 1, total_count: 1, tags: [], thumbnail: '/thumbs/Other/0.svg' },
      ] });
      if (url.pathname === '/api/stats') return route.fulfill({ json: { unique: 0, cumulative: 0 } });
      if (url.pathname.startsWith('/api/hot/')) {
        if (url.pathname.endsWith('/image')) hot.push(url.searchParams.get('url'));
        return route.fulfill({ json: { ok: true } });
      }
      if (!url.pathname.startsWith('/api/folder/')) return route.fulfill({ status: 404, body: '' });
      const n = Number(url.searchParams.get('page'));
      const sort = url.searchParams.get('sort');
      requests.push({ n, sort, folder: url.pathname });
      if (n === 2 && delayNext) await new Promise(resolve => { releaseNext = resolve; });
      const ordered = sort === 'newest' ? [...items].reverse() : items;
      const start = (n - 1) * 20;
      return route.fulfill({ json: { total: ordered.length, has_more: start + 20 < ordered.length, items: ordered.slice(start, start + 20) } });
    });
    await page.goto('http://pixvault.test/folders');
    await page.waitForFunction(() => allFolders.length === 2 && window.popupableOpen);
    await page.evaluate(() => openFolder('Trips', 'Trips'));
    await page.waitForFunction(() => modalSources.length === 20);
    await page.locator('.modal-item[data-idx="0"] img').click();
    await page.waitForSelector('.popupable-open');
    assert.deepEqual(await page.evaluate(() => activePopupElement._state.group.map(entry => Number(entry.original.dataset.idx))), Array.from({ length: 20 }, (_, i) => i));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '1');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.idx), '1');
    assert.equal(await page.locator('.lightbox-selected').count(), 1);
    assert.equal(await page.locator('.popupable-counter').textContent(), '2 / 20');
    const popup = await page.evaluateHandle(() => activePopupElement);
    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '19' && modalLoading);
    await page.waitForTimeout(50);
    assert.equal(requests.length, 2);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => activePopupSource.dataset.idx), '19');
    delayNext = false;
    releaseNext();
    await page.waitForFunction(() => activePopupElement?._state.group.length === 40);
    assert.equal(await page.evaluate(previous => activePopupElement === previous, popup), true);
    assert.equal(await page.locator('.popupable-counter').textContent(), '20 / 40');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '20');
    await page.locator('.popupable-next-container').click();
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '21');
    await page.locator('.popupable-prev-container').click();
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '20');
    await page.setViewportSize({ width: 650, height: 600 });
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(150, 300, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '21');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '20');
    assert.equal(await page.locator('.popupable-content:not(.popupable-content-before):not(.popupable-content-after) .pixvault-similar-link').getAttribute('href'), '/?similar=%2Fmedia%2FTrips%2F20.svg');
    // At 31, exactly eight images remain before the next page.
    await page.evaluate(() => { activePopupElement._state.group.currentIndex = 30; });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '31');
    await page.waitForFunction(() => activePopupElement?._state.group.length === 60);
    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupElement?._state.group.length === 65);
    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '64');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => activePopupSource.dataset.idx), '64');
    assert.deepEqual(requests.map(request => request.n), [1, 2, 3, 4]);
    assert.equal(await page.locator('.popupable-counter').textContent(), '65 / 65');
    assert.ok(hot.includes('/media/Trips/20.svg'));

    const assertClosedAtLastImage = async label => {
      await page.waitForFunction(() => activePopupSource === null && history.state?.overlay === 'modal');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => document.activeElement.dataset.idx), '64');
      assert.equal(await page.locator('#folderModal.open').count(), 1);
      const card = await page.locator('.modal-item[data-idx="64"]').boundingBox();
      const grid = await page.locator('#modalGrid').boundingBox();
      assert.ok(card.y < grid.y + grid.height && card.y + card.height > grid.y, `${label}: final thumbnail remains visible`);
    };
    await page.evaluate(() => history.back());
    await assertClosedAtLastImage('Back');
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '64');
    await page.keyboard.press('Escape');
    await assertClosedAtLastImage('Escape');
    await page.evaluate(() => {
      modalSources[64].dataset.popupableZoomable = '';
      return window.popupableOpen(modalSources[0]);
    });
    await page.waitForSelector('.popupable-open');
    await page.keyboard.press('End');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '64');
    await page.locator('.popupable-close-container').click();
    await assertClosedAtLastImage('Close button');

    // Changing the sort closes the popup and invalidates its pending prefetch.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '64');
    await page.evaluate(() => resetModalImages());
    await page.evaluate(() => loadModalPage());
    await page.waitForFunction(() => modalSources.length === 20);
    delayNext = true;
    await page.evaluate(() => window.popupableOpen(modalSources[11]));
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '11' && modalLoading);
    await page.waitForTimeout(50);
    const releaseStale = releaseNext;
    delayNext = false;
    await page.selectOption('#modalSortSelect', 'newest');
    await page.waitForFunction(() => modalSources.length >= 20 && !modalLoading && activePopupSource === null && modalItems[0].url === '/media/Trips/64.svg');
    const sortedCount = await page.evaluate(() => modalSources.length);
    releaseStale();
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => modalSources.length), sortedCount);
    assert.equal(await page.evaluate(() => modalItems[0].url), '/media/Trips/64.svg');
    await page.evaluate(() => window.popupableOpen(modalSources[0]));
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '0');
    await page.waitForSelector('.popupable-open');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => activePopupSource?.dataset.idx === '1');
    assert.equal(await page.evaluate(() => activePopupSource.dataset.popupableSrc), '/media/Trips/63.svg');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => activePopupSource === null && history.state?.overlay === 'modal');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#folderModal.open', { state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('Folder lightbox: display order, focus/scroll, 20-image live append, final position, Back/Forward, sort and stale reset passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
