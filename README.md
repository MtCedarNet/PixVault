# PixVault — Local Media Gallery

PixVault is a dark-mode FastAPI gallery for your images. It has three pages: **Gallery** (masonry grid, filters, infinite scroll), **Folders** (thumbnail grid), and **Admin** (maintenance controls).

## Install and run

Use Python 3.11 or newer. In PowerShell:

```powershell
git clone https://github.com/MtCedarNet/PixVault.git
cd PixVault
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item config.example.toml config.toml
```

On macOS or Linux, activate the environment with `source venv/bin/activate` and copy the template with `cp config.example.toml config.toml`. Edit `config.toml` as described below, then start the server:

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 7979
```

Open `http://localhost:7979` in a browser. Sign in with the gallery password you set, then use **Gallery**, **Folders**, and **Admin** in the navigation bar. Stop the server with Ctrl+C.

## Configuration and gallery access

Replace the public example passwords and session secret with your own values in `config.toml`:

```toml
[auth]
gallery_password = "choose-a-long-unique-password"
admin_password = "choose-a-different-admin-password"
session_secret = "choose-a-separate-long-random-secret"

[storage]
images_dir = 'Gallery'
```

`images_dir = 'Gallery'` uses the `Gallery` folder beside `main.py`. Create subfolders there for your photos. You can use another location, including an absolute Windows path such as `images_dir = 'D:\Gallery'`. Restart the server after editing `config.toml`. The local file is ignored by Git; do not commit passwords. If `session_secret` is empty, sessions end when the server restarts. Set it to the same long random value on every worker to keep sessions valid across workers and restarts.

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
- **Remembered folder controls** — view and sort modes apply across all folders and are saved in browser local storage; shared sort options also carry into the image list inside each folder
- **Search bar** — filter folders by name or tag
- **Click folder** → opens scrollable image grid inside a modal
- **Infinite scroll inside modal**
- **Lightbox** inside folder view, powered by [popupable](https://github.com/ewanhowell5195/popupable); browser Back closes it

### Admin (Page 3)

After signing in through the browser, click **Admin** in the navigation bar and enter the separate `auth.admin_password` from `config.toml`. The page uses it for actions but does not save it.

- Click **Rebuild gallery** after adding or removing images, or after editing folder names or tags. The page shows the last rebuild time and folder and image counts.
- Click **Generate missing thumbnails** to create thumbnails for new images. Progress and failures appear on the page.
- Click **Add missing tags** to add new image folders to `data/tags.json`. Edit the tags in that file, then click **Rebuild gallery**.
- Click **Generate folder names** to create `data/folders.json`. This overwrites manually edited display names, so the page asks for confirmation. Edit the names if needed, then click **Rebuild gallery**.

## Directory Structure

```
PixVault/
├── main.py              # FastAPI app
├── config.example.toml  # Public configuration template
├── config.toml          # Local settings; ignored by Git
├── requirements.txt
├── Gallery/             # Photo library; folders can be nested
│   └── Trips/
│       └── 2026/
│           └── photo.jpg
├── data/                # Generated cache, tags, and folder names
├── pages/
│   ├── gallery.html     # Gallery
│   ├── folders.html     # Folders
│   ├── admin.html       # Admin
│   └── login.html       # Password entry
└── README.md
```

The Folders page has **All folders** and **Browse folders** modes. All folders lists each directory with images of its own; Browse folders lets you open parent directories and use breadcrumbs, the browser Back button, or Esc to move back. If a parent also has images, use its **View photos** button to see those images. The Gallery includes images at every depth.

Use paths relative to `storage.images_dir` as keys in `data/tags.json` and `data/folders.json`, for example `"Trips/2026"`. Top-level folder keys keep their existing format. In `data/tags.json`:

```json
{"Trips/2026": ["travel", "2026"]}
```

In `data/folders.json`:

```json
{"Trips/2026": "Summer trip"}
```

Images belong in subfolders of `images_dir`. After adding images or changing metadata, use **Admin** to rebuild the gallery and generate missing thumbnails.

## Supported Media Formats

Images: `.jpg` `.jpeg` `.png` `.webp` `.gif` `.bmp` `.avif`  
(Videos are detected server-side but not shown in current UI — easy to add)

## Licence and original author

PixVault was originally created by [ApeDevOne](https://github.com/ApeDevOne/PixVault), who is named as the copyright holder in the [PixVault Licence](LICENSE). Under Section 9, contributors grant ApeDevOne a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable licence to use, reproduce, create derivative works from, publicly display, and sublicense their contributions, including for commercial purposes. Read the full licence before contributing.
