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
    id, children: [], style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', handlers: new Map(),
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    addEventListener(name, handler) { this.handlers.set(name, handler); },
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
const cookies = new Map([['pixvault-folder-mode', 'tree'], ['pixvault-folder-sort', 'newest']]);
const cookieWrites = [];
const storage = new Map([['pixvault-folder-mode', 'flat']]);
const document = {
  get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); },
  set cookie(value) {
    cookieWrites.push(value);
    const [name, setting] = value.split(';', 1)[0].split('=');
    if (value.includes('Max-Age=0')) cookies.delete(name);
    else cookies.set(name, setting);
  },
  body: element('body'),
  getElementById: getElement,
  createElement: () => element(),
  addEventListener: (name, handler) => documentHandlers.set(name, handler),
  dispatchEvent: event => { if (event.key === 'Escape') documentHandlers.get('popupable:close')(); },
};
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
  localStorage: {
    getItem: name => storage.get(name) ?? null,
    setItem: (name, value) => storage.set(name, value),
  },
  document,
  IntersectionObserver: class { disconnect() {} observe() {} },
  fetch: () => new Promise(() => {}),
});
vm.runInContext(script, context);
const run = expression => vm.runInContext(expression, context);
assert.equal(getElement('viewModeSelect').value, 'tree');
assert.equal(getElement('folderSortSelect').value, 'newest');
assert.equal(cookies.size, 0);
assert.equal(storage.get('pixvault-folder-mode'), 'tree');
assert.equal(storage.get('pixvault-folder-sort'), 'newest');
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

const sortSelect = getElement('folderSortSelect');
sortSelect.value = 'za';
sortSelect.handlers.get('change').call(sortSelect);
assert.equal(storage.get('pixvault-folder-sort'), 'za');
const viewSelect = getElement('viewModeSelect');
viewSelect.value = 'flat';
viewSelect.handlers.get('change').call(viewSelect);
assert.equal(storage.get('pixvault-folder-mode'), 'flat');
assert.equal(storage.get('pixvault-folder-sort'), 'za');
assert.equal(cookieWrites.length, 2);
assert.ok(cookieWrites.every(value => value.includes('Max-Age=0') && value.includes('Path=/folders')));

console.log('Folder navigation and global local-storage preferences passed');
