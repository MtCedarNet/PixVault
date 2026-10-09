const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function element(tag) {
  return { tag, dataset:{}, children:[], content:{children:[],appendChild(child) {this.children.push(child);}},
    appendChild(child) {this.children.push(child);} };
}
const context = vm.createContext({window:{}, document:{createElement:element}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'assets', 'lightbox-actions.js'), 'utf8'), context);
const img = element('img');
const item = {url:'/media/Trips/%E7%8C%AB%20%23%25.png',folder:'Trips/猫 #%',display_name:'Folder <name>'};
const template = context.window.pixvaultLightboxContent(img, item);
const [similar, folder] = template.content.children[0].children;
assert.equal(img.dataset.popupableContent, 'next');
assert.equal(new URL(similar.href,'http://localhost').searchParams.get('similar'),item.url);
assert.equal(new URL(folder.href,'http://localhost').searchParams.get('folder'),item.folder);
assert.equal(new URL(folder.href,'http://localhost').searchParams.get('photos'),'1');
assert.equal(folder.textContent,item.display_name);
assert.equal(similar.textContent,'Find similar images');
const other = context.window.pixvaultLightboxContent(element('img'),{url:'/media/other.jpg',folder:'Other'});
assert.equal(other.content.children[0].children[1].textContent,'Other');
assert.notEqual(other.content.children[0].children[0].href,similar.href);
console.log('Lightbox templates retain the correct source and folder, including Unicode and special characters');
