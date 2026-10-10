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
- **Image content search** — describe what you want in Japanese or another language; EmbeddingGemma 2 ranks images by similarity, with tag filters and infinite scroll
- **Lightbox** — powered by [popupable](https://github.com/ewanhowell5195/popupable), with keyboard and swipe navigation; browser Back closes it
- **Gallery navigation** — enlarged images follow the order images were packed into the gallery. The selected thumbnail stays highlighted and scrolls into view; within eight images of the loaded end, the next 40 images load and join the open lightbox. Navigation stops at the first and last available image.
- **Lightbox actions** — click **Find similar images** to search from the enlarged image's embedding, or click its folder name to open that folder's photos; folder names on gallery thumbnails are also links
- **Responsive** — 1–6 columns depending on screen width

### Folders (Page 2)
- **Square thumbnail grid** — auto-fill columns with folder names and image counts
- **Nested folders** — switch between all image folders and browsing one directory level at a time
- **Remembered folder controls** — view and sort modes apply across all folders and are saved in browser local storage; shared sort options also carry into the image list inside each folder
- **Search bar** — filter folders by name or tag
- **Click folder** → opens scrollable image grid inside a modal
- **Infinite scroll inside modal**
- **Lightbox** inside folder view, powered by [popupable](https://github.com/ewanhowell5195/popupable); browser Back closes it
- **Image navigation** follows the folder's current sort order, highlights and scrolls to the selected thumbnail, and loads the next 20 images within eight images of the loaded end. Closing the lightbox keeps the last viewed image in view; browser Forward can reopen it while the folder remains open.
- **Similar images and folder links** are also available in the folder lightbox

### Admin (Page 3)

After signing in through the browser, click **Admin** in the navigation bar and enter the separate `auth.admin_password` from `config.toml`. The page uses it for actions but does not save it.

- Click **Rebuild gallery** after adding or removing images, or after editing folder names or tags. The page shows the last rebuild time and folder and image counts.
- Click **Generate missing thumbnails** to create thumbnails for new images. Progress and failures appear on the page.
- Click **Update image embeddings** to create or update the image search DB. Progress, errors, and a stop button appear on the page. **Re-embed all images** recomputes every image.
- Click **Add missing tags** to add new image folders to `data/tags.json`. Edit the tags in that file, then click **Rebuild gallery**.
- Click **Generate folder names** to create `data/folders.json`. This overwrites manually edited display names, so the page asks for confirmation. Edit the names if needed, then click **Rebuild gallery**.

## Local image search with EmbeddingGemma 2

Put a recent `llama-server.exe` and its accompanying DLLs in `llamacpp/`, together with:

- `embeddinggemma-2-Q8_0.gguf`
- `mmproj-embeddinggemma-2-BF16.gguf` (the matching image projector)

PixVault uses these paths by default, so an existing `config.toml` does not need changes. For different paths or ports, copy the `[embeddings]` section from `config.example.toml` into your private `config.toml`. Paths are relative to that configuration file. Restart PixVault after changing settings. Install the updated dependencies with `python -m pip install -r requirements.txt`.

1. Open **Admin**, enter the admin password, and click **Update image embeddings**. The local llama-server starts in the background on `127.0.0.1:8081` when needed. The first pass may take a long time for a large library.
2. Open **Gallery**, enter a description such as `海辺の夕焼け` or `a cat sleeping on a sofa`, and click **Search images** (or press Enter).
3. The closest 200 indexed images appear in similarity order. Tag filters also apply. Click **Clear search** to return to normal browsing.

When an image is enlarged, click **Find similar images** to search the library using that image's saved vector. The source image is excluded, and results support tag filters and pagination. The source must already be indexed; otherwise update the DB in Admin. Clicking the folder name beside the button opens that folder's photos directly, including nested folders. These actions work from Gallery and Folders and follow the currently enlarged image when you use Next/Previous.

The DB is `data/embeddings.sqlite3`. Originals are read directly, orientation is corrected, and a temporary RGB JPEG of at most 768 pixels per side is sent to the local server. Animated images use their first frame. Original images and caption files are never changed. Images receive no text prefix; text queries use the model's search instruction. Vectors have 768 dimensions and are L2-normalized for cosine similarity. See the [EmbeddingGemma 2 model card](https://huggingface.co/google/embeddinggemma-2) and the [llama.cpp native embedding API](https://github.com/ggml-org/llama.cpp/tree/master/tools/server#post-embedding-generate-embedding-of-a-given-text).

**Update image embeddings** skips files whose path, size, and modification time are unchanged. It embeds added or changed files, removes deleted entries after a completed pass, and refreshes the gallery cache. Each successful image is saved immediately, so stopped or interrupted jobs resume on the next update. Corrupt images are reported and skipped; server failures stop the job and leave completed work available. After replacing the model/projector or changing the library root, restart PixVault (and any separately managed llama-server), then run Update again; incompatible profiles are kept separate. Use **Re-embed all images** if file content was changed while preserving size and timestamp, or after changing an external server's projector/pooling settings.

Images stay on this computer: the configured embedding URL must use `http://127.0.0.1:PORT` or `http://localhost:PORT`. An external server on that address can be used with `auto_start = false`; start it with the same model and projector:

```powershell
.\llamacpp\llama-server.exe -m .\llamacpp\embeddinggemma-2-Q8_0.gguf --mmproj .\llamacpp\mmproj-embeddinggemma-2-BF16.gguf --embedding --pooling mean --host 127.0.0.1 --port 8081 -c 8192 -b 8192 -ub 8192 -np 1
```

The integration uses llama.cpp's native `/embedding` API with `prompt_string`, `multimodal_data`, and the current media marker from `/props`. Older builds without multimodal embedding support need updating. The local build used to verify this integration is **b11515 / 3d65c90d0**. Startup and inference errors are shown in Admin; automatically started server logs go to `data/embedding-server.log`. Run one PixVault worker when using the built-in background indexing and server management. The managed llama-server stops when its owning PixVault process exits normally.

## Directory Structure

```
PixVault/
├── main.py              # FastAPI app
├── embeddings.py        # Local llama.cpp client, SQLite index, image search
├── config.example.toml  # Public configuration template
├── config.toml          # Local settings; ignored by Git
├── requirements.txt
├── Gallery/             # Photo library; folders can be nested
│   └── Trips/
│       └── 2026/
│           └── photo.jpg
├── data/                # Generated cache, tags, folder names, and embeddings.sqlite3
├── llamacpp/            # Local llama-server, DLLs, model and mmproj; ignored by Git
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
