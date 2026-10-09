// A template beside each source image gives popupable the correct links even
// when it switches to another image in the group. Templates leave with the grid.
window.pixvaultLightboxContent = function(image, item) {
  const template = document.createElement('template');
  const actions = document.createElement('div');
  actions.className = 'pixvault-lightbox-actions';

  const similar = document.createElement('a');
  similar.className = 'pixvault-similar-link';
  similar.href = '/?similar=' + encodeURIComponent(item.url);
  similar.textContent = 'Find similar images';
  actions.appendChild(similar);

  const folder = document.createElement('a');
  folder.className = 'pixvault-folder-link';
  folder.href = '/folders?folder=' + encodeURIComponent(item.folder) + '&photos=1';
  folder.textContent = item.display_name || item.folder;
  folder.title = 'Open folder: ' + item.folder;
  actions.appendChild(folder);

  template.content.appendChild(actions);
  image.dataset.popupableContent = 'next';
  return template;
};
