# PixVault — Local Media Gallery

Dark-mode FastAPI gallery for your Images.  
Three pages: **Gallery** (masonry grid, filters, infinite scroll), **Folders** (thumbnail grid), and **Admin** (maintenance controls).

## Documentation

For full documentation, visit [Project Documentation](https://apedevone.github.io/PixVault/).

## Configuration and gallery access

Use Python 3.11 or newer. Copy `config.example.toml` to `config.toml` if the local file does not exist, then edit the values in that one file:

```toml
[auth]
gallery_password = "choose-a-long-unique-password"
admin_password = "choose-a-different-admin-password"
session_secret = "choose-a-separate-long-random-secret"

[storage]
images_dir = 'D:\Photos'
```

`images_dir` may also be relative to the project directory, such as `"Downloads"`. Windows paths can use single-quoted TOML strings as shown above. Restart the server after editing `config.toml`. The local file is ignored by Git; do not commit passwords. If `session_secret` is empty, sessions end when the server restarts. Set it to the same long random value on every worker to keep sessions valid across workers and restarts.

PixVault denies gallery access until `auth.gallery_password` is set. The login protects the gallery, folders, admin page, APIs, full-size media, and thumbnails. Sessions expire after 12 hours; use **Logout** to end one sooner. Changing the gallery password invalidates existing sessions. Management actions require the separate `auth.admin_password`; leaving it empty disables them. Use HTTPS when exposing the gallery beyond your own computer.

## Features

### Gallery (Page 1)
- **Masonry grid** — no blank spaces, portrait/landscape auto-adjust column height
- **Smart filters** — auto-generated from folder names (nature, travel, food, people, art, tech, anime, memes, years…)
- **Infinite scroll** — lazy loads 40 images at a time as you scroll
- **Shuffle toggle** — randomize order
- **Lightbox** — powered by [popupable](https://github.com/ewanhowell5195/popupable), with keyboard and swipe navigation; browser Back closes it
- **Responsive** — 1–6 columns depending on screen width

### Folders (Page 2)
- **Square thumbnail grid** — auto-fill columns with folder names and image counts
- **Nested folders** — switch between all image folders and browsing one directory level at a time
- **Search bar** — filter folders by name or tag
- **Click folder** → opens scrollable image grid inside a modal
- **Infinite scroll inside modal**
- **Lightbox** inside folder view, powered by [popupable](https://github.com/ewanhowell5195/popupable); browser Back closes it

### Admin (Page 3)
- Open `/admin` or click **Admin** in the navigation bar.
- Enter `auth.admin_password` from `config.toml` to run maintenance actions. The page does not save the password.
- Rebuild the gallery cache, generate missing thumbnails with live progress, add missing tag entries, or regenerate folder display names.
- Regenerating folder display names overwrites manual edits in `data/folders.json`; the page asks for confirmation first.

## Directory Structure

```
PixVault/
├── main.py          # FastAPI app
├── config.example.toml # Configuration template
├── config.toml      # Local settings; ignored by Git
├── requirements.txt
├── Downloads/        # Image library; folders can be nested to any depth
│   └── Trips/
│       └── 2026/
│           └── photo.jpg
├── pages/
│   ├── gallery.html # Page 1
│   ├── folders.html # Page 2
│   ├── admin.html   # Page 3
│   └── login.html   # Password entry
└── README.md
```

The Folders page has **All folders** and **Browse folders** modes. All folders lists each directory with images of its own; Browse folders lets you open parent directories and use breadcrumbs, the browser Back button, or Esc to move back. If a parent also has images, use its **View photos** button to see those images. The Gallery includes images at every depth.

Use paths relative to `storage.images_dir` as keys in `data/tags.json` and `data/folders.json`, for example `"Trips/2026"`. Top-level folder keys keep their existing format. After adding images or changing metadata, rebuild the cache and generate thumbnails for new images.

## Supported Media Formats

Images: `.jpg` `.jpeg` `.png` `.webp` `.gif` `.bmp` `.avif`  
(Videos are detected server-side but not shown in current UI — easy to add)
