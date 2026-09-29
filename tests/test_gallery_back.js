const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'gallery.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const documentHandlers = new Map();
const windowHandlers = new Map();
const elements = new Map();
function element() {
  return {
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild(child) { this.children.push(child); },
  };
}
const getElement = id => {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
};
const window = { innerWidth: 1200, location: new URL('http://localhost/') };
window.addEventListener = (name, handler) => windowHandlers.set(name, handler);
const entries = [{ state: null, url: window.location.href }];
let index = 0;
const history = {
  get state() { return entries[index].state; },
  pushState(state, _, url) {
    entries.splice(index + 1);
    entries.push({ state, url: String(url) });
    index++;
  },
  back() {
    if (!index) return;
    index--;
    windowHandlers.get('popstate')({ state: entries[index].state });
  },
  forward() {
    if (index === entries.length - 1) return;
    index++;
    windowHandlers.get('popstate')({ state: entries[index].state });
  },
};
const context = vm.createContext({
  window, history, console,
  KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  document: {
    getElementById: getElement,
    createElement: element,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => documentHandlers.set(name, handler),
  },
  IntersectionObserver: class { observe() {} },
  fetch: () => new Promise(() => {}),
});
vm.runInContext(script, context);
const run = expression => vm.runInContext(expression, context);
const popup = { dispatchEvent(event) {
  assert.equal(event.key, 'Escape');
  documentHandlers.get('popupable:close')();
} };
const source = {
  isConnected: true,
  closest: () => ({ dataset: { idx: '0' } }),
  click() { documentHandlers.get('popupable:open')({ target: source, detail: { popup } }); },
};
source.click();
assert.equal(history.state.pixvaultGalleryPopup, true);
history.back();
assert.equal(run('activePopupSource'), null);
assert.equal(index, 0);
history.forward();
assert.equal(run('activePopupSource'), source);
assert.equal(index, 1);
documentHandlers.get('popupable:close')();
assert.equal(index, 0);

console.log('Gallery lightbox Back, Forward, and close passed');
