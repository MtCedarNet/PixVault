# popupable for Gallery and Folders

Source: `src/popupable.js` and `src/popupable.css` from [popupable v1.11.0](https://github.com/ewanhowell5195/popupable/tree/v1.11.0), commit `51ff3afffc643e82f2e222d56c62e21e69aa2061`. CSS is unchanged.
This release's npm package declares the MIT license and its distribution banner credits Ewan Howell. Later upstream versions may use a different license.

PixVault changes:

- Sort groups by numeric `data-popupable-index` when every source has that attribute. The Gallery uses the order in which images were packed into columns; Folders uses the current image sort order.
- `popup.popupableAppendImages(sources)` appends previously unseen sources to an open group, preserves the current slide, and updates slides, action links, counter, arrows and decode queue. This API supports groups without a thumbnail strip; pass sources in navigation order.
- `window.popupableOpen(source)` opens a source programmatically for keyboard activation and browser Forward.
- `popup.popupableClose(immediate)` closes even when zoomed; immediate close allows a grid reset to deliver the close event before removing the source.
- Move the hidden source and closing animation target to the currently selected image when navigating.

Both pages use this local version and the unchanged v1.11.0 stylesheet.
