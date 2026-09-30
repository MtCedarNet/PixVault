const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'gallery.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const elements = new Map();
const windowHandlers = new Map();

function element() {
  return {
    style: {}, dataset: {}, children: [], parent: null, className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild(child) {
      child.remove();
      child.parent = this;
      this.children.push(child);
    },
    remove() {
      if (!this.parent) return;
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    },
    set innerHTML(_) {
      for (const child of this.children) child.parent = null;
      this.children = [];
    },
    get offsetHeight() {
      if (this.className === 'grid-column') {
        return this.children.reduce((height, child) => height + child.offsetHeight, 0)
          + Math.max(0, this.children.length - 1) * 8;
      }
      if (this.className.includes('grid-item')) return this.children[0].offsetHeight;
      if (this.className === 'skeleton') return Number.parseInt(this.style.height, 10);
      if (this.src) return 100 + (Number(this.src.match(/(\d+)\.jpg/)?.[1]) % 5) * 70;
      return 0;
    },
  };
}

const getElement = id => {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
};
const grid = getElement('grid');
const window = { innerWidth: 900, location: new URL('http://localhost/') };
window.addEventListener = (name, handler) => windowHandlers.set(name, handler);
const items = Array.from({ length: 85 }, (_, i) => ({
  url: `/media/${i}.jpg`, thumb_url: `/thumbs/${i}.jpg`, folder: 'Test',
}));
const context = vm.createContext({
  window, console,
  document: {
    getElementById: getElement,
    createElement: element,
    querySelectorAll: selector => selector === '#grid .grid-item'
      ? grid.children.flatMap(column => column.children.filter(child => child.className.includes('grid-item')))
      : [],
    addEventListener() {},
  },
  IntersectionObserver: class { observe() {} },
  fetch: async url => ({
    json: async () => {
      if (url === '/api/filters') return [];
      if (url === '/api/stats') return { unique: 0, cumulative: 0 };
      const page = Number(new URL(url, window.location).searchParams.get('page'));
      const start = (page - 1) * 40;
      return { total: items.length, has_more: start + 40 < items.length, items: items.slice(start, start + 40) };
    },
  }),
});
vm.runInContext(script, context);
const run = expression => vm.runInContext(expression, context);
const loadedItems = () => grid.children.flatMap(column => column.children.filter(child => child.className.includes('grid-item')));

(async () => {
  await new Promise(setImmediate); // Initial page load
  assert.equal(loadedItems().length, 40);
  assert.equal(grid.children.length, 4);
  const firstHeights = grid.children.map(column => column.offsetHeight);
  assert.ok(Math.max(...firstHeights) - Math.min(...firstHeights) <= 388);
  const originalColumns = new Map(loadedItems().map(item => [item.dataset.idx, item.parent]));

  await run('loadMore()');
  assert.equal(loadedItems().length, 80);
  for (const item of loadedItems()) {
    if (Number(item.dataset.idx) < 40) assert.equal(item.parent, originalColumns.get(item.dataset.idx));
  }
  assert.equal(new Set(loadedItems().map(item => item.dataset.idx)).size, 80);

  window.innerWidth = 650;
  windowHandlers.get('resize')();
  assert.equal(grid.children.length, 3);
  assert.equal(loadedItems().length, 80);
  assert.equal(new Set(loadedItems().map(item => item.dataset.idx)).size, 80);
  const resizedColumns = new Map(loadedItems().map(item => [item.dataset.idx, item.parent]));

  await run('loadMore()');
  assert.equal(loadedItems().length, 85);
  for (const item of loadedItems()) {
    if (Number(item.dataset.idx) < 80) assert.equal(item.parent, resizedColumns.get(item.dataset.idx));
  }
  console.log('Gallery columns stay fixed across page loads and resize without losing images');
})().catch(error => { console.error(error); process.exitCode = 1; });
