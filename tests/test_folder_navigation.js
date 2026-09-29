const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'folders.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const script = scripts.at(-1)[1];
const documentHandlers = new Map();
const windowHandlers = new Map();
const elements = new Map();

function element(id = '') {
  const classes = new Set();
  return {
    id, children: [], style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    addEventListener() {},
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    setAttribute() {},
    remove() {},
  };
}
function getElement(id) {
  if (!elements.has(id)) elements.set(id, element(id));
  return elements.get(id);
}

const window = { location: new URL('http://localhost/folders') };
window.addEventListener = (name, handler) => windowHandlers.set(name, handler);
const entries = [{ state: null, url: window.location.href }];
let index = 0;
const history = {
  get state() { return entries[index].state; },
  pushState(state, _, url) {
    entries.splice(index + 1);
    entries.push({ state, url: String(url) });
    index++;
    window.location = new URL(entries[index].url);
  },
  replaceState(state, _, url) {
    entries[index] = { state, url: String(url) };
    window.location = new URL(entries[index].url);
  },
  back() {
    if (!index) return;
    index--;
    window.location = new URL(entries[index].url);
    windowHandlers.get('popstate')({ state: entries[index].state });
  },
  forward() {
    if (index === entries.length - 1) return;
    index++;
    window.location = new URL(entries[index].url);
    windowHandlers.get('popstate')({ state: entries[index].state });
  },
};
const context = vm.createContext({
  window, history, URL, URLSearchParams, AbortController, console,
  KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  localStorage: { getItem: () => 'tree', setItem() {} },
  document: {
    body: element('body'),
    getElementById: getElement,
    createElement: () => element(),
    addEventListener: (name, handler) => documentHandlers.set(name, handler),
    dispatchEvent: event => { if (event.key === 'Escape') documentHandlers.get('popupable:close')(); },
  },
  IntersectionObserver: class { disconnect() {} observe() {} },
  fetch: () => new Promise(() => {}),
});
vm.runInContext(script, context);
const run = expression => vm.runInContext(expression, context);
const escape = () => documentHandlers.get('keydown')({
  key: 'Escape', defaultPrevented: false, preventDefault() {},
});

run("navigateFolder('Trips')");
run("navigateFolder('Trips/2026')");
assert.equal(run('currentPath'), 'Trips/2026');
assert.equal(window.location.searchParams.get('folder'), 'Trips/2026');
history.back();
assert.equal(run('currentPath'), 'Trips');
history.forward();
assert.equal(run('currentPath'), 'Trips/2026');
escape();
assert.equal(run('currentPath'), 'Trips');
escape();
assert.equal(run('currentPath'), '');
assert.equal(window.location.searchParams.has('folder'), false);

run("navigateFolder('Trips')");
getElement('folderModal').classList.add('open');
history.pushState(run("folderHistoryState({ overlay: 'modal', modalFolder: 'Trips', modalDisplayName: 'Trips' })"), '', window.location.href);
escape();
assert.equal(getElement('folderModal').classList.contains('open'), false);
assert.equal(run('currentPath'), 'Trips');
history.forward();
assert.equal(getElement('folderModal').classList.contains('open'), true);
context.popup = { dispatchEvent(event) {
  assert.equal(event.key, 'Escape');
  documentHandlers.get('popupable:close')();
} };
run('activePopupSource = popup; activePopupElement = popup');
history.pushState(run("folderHistoryState({ overlay: 'popup', modalFolder: 'Trips', modalDisplayName: 'Trips' })"), '', window.location.href);
history.back();
assert.equal(run('activePopupSource'), null);
assert.equal(getElement('folderModal').classList.contains('open'), true);
escape();
assert.equal(getElement('folderModal').classList.contains('open'), false);

console.log('Folder, modal, and popup Back, Forward, and Esc passed');
