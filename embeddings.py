"""Local image embeddings and cosine search using llama.cpp's native API."""
import atexit
import base64
import hashlib
import io
import json
import sqlite3
import subprocess
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image, ImageOps


class EmbeddingError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmbeddingConfig:
    server_url: str
    auto_start: bool
    executable: Path
    model: Path
    mmproj: Path
    timeout: int

    @classmethod
    def from_dict(cls, settings, base):
        def path(key, default):
            value = settings.get(key, default)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"embeddings.{key} must be a non-empty path")
            result = Path(value).expanduser()
            return (result if result.is_absolute() else base / result).resolve()

        url = settings.get("server_url", "http://127.0.0.1:8081")
        if not isinstance(url, str):
            raise ValueError("embeddings.server_url must be a local HTTP URL")
        url = url.rstrip("/")
        parsed = urlsplit(url)
        # The managed server and image uploads are intentionally local.
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("embeddings.server_url must be http://127.0.0.1:PORT or http://localhost:PORT")
        port = parsed.port
        if port is None or not 1 <= port <= 65535:
            raise ValueError("embeddings.server_url must include a valid port")
        auto = settings.get("auto_start", True)
        timeout = settings.get("timeout", 120)
        if not isinstance(auto, bool):
            raise ValueError("embeddings.auto_start must be a boolean")
        if type(timeout) is not int or not 10 <= timeout <= 600:
            raise ValueError("embeddings.timeout must be an integer between 10 and 600")
        return cls(url, auto, path("executable", "llamacpp/llama-server.exe"),
                   path("model", "llamacpp/embeddinggemma-2-Q8_0.gguf"),
                   path("mmproj", "llamacpp/mmproj-embeddinggemma-2-BF16.gguf"), timeout)


class LlamaEmbeddingClient:
    def __init__(self, config, data_dir):
        self.config = config
        self.data_dir = Path(data_dir)
        self._start_lock = threading.Lock()
        self._process = None
        atexit.register(self.close)

    def close(self):
        if self._process is not None and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()

    def request(self, path, payload=None, timeout=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = Request(self.config.server_url + path, data=data, headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=timeout or self.config.timeout) as response:
                return json.load(response)
        except HTTPError as exc:
            raise EmbeddingError(f"llama-server returned HTTP {exc.code}. Check data/embedding-server.log and the embedding/pooling options.") from exc
        except (URLError, OSError, ValueError) as exc:
            raise EmbeddingError("Cannot reach llama-server. Check the local server URL and data/embedding-server.log.") from exc

    def ready(self):
        with self._start_lock:
            try:
                props = self.request("/props", timeout=2)
            except EmbeddingError:
                if not self.config.auto_start:
                    raise
                if self._process is None or self._process.poll() is not None:
                    for path in (self.config.executable, self.config.model, self.config.mmproj):
                        if not path.is_file():
                            raise EmbeddingError(f"Embedding file not found: {path.name}. Configure [embeddings] in config.toml.")
                    self.data_dir.mkdir(parents=True, exist_ok=True)
                    args = [str(self.config.executable), "-m", str(self.config.model), "--mmproj", str(self.config.mmproj),
                            "--embedding", "--pooling", "mean", "--host", "127.0.0.1", "--port", str(urlsplit(self.config.server_url).port),
                            "-c", "8192", "-b", "8192", "-ub", "8192", "-np", "1", "--alias", "embeddinggemma-2"]
                    with (self.data_dir / "embedding-server.log").open("ab") as log:
                        self._process = subprocess.Popen(args, cwd=self.config.executable.parent,
                                                         stdout=log, stderr=log,
                                                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                deadline = time.monotonic() + self.config.timeout
                while True:
                    if self._process.poll() is not None:
                        raise EmbeddingError("llama-server exited during startup. Check data/embedding-server.log.")
                    try:
                        props = self.request("/props", timeout=2)
                        break
                    except EmbeddingError:
                        if time.monotonic() >= deadline:
                            raise EmbeddingError("llama-server startup timed out. Check data/embedding-server.log.")
                        time.sleep(0.5)
            if not props.get("modalities", {}).get("vision") or not props.get("media_marker"):
                raise EmbeddingError("llama-server needs a vision-capable EmbeddingGemma 2 model and its mmproj.")
            if Path(props.get("model_path", "")).name != self.config.model.name:
                raise EmbeddingError("llama-server is serving a different model. Use the configured EmbeddingGemma 2 model.")
            return props

    def profile(self, root, props):
        def identity(path):
            if path.is_file():
                stat = path.stat()
                return [str(path), stat.st_size, stat.st_mtime_ns]
            return [str(path)]
        values = ["pixvault-embeddinggemma2-v1", str(root.resolve()), identity(self.config.model), identity(self.config.mmproj),
                  props.get("build_info"), "mean", "rgb-exif-jpeg-768-q90", "task: search result | query: "]
        return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()

    def embed(self, content):
        data = self.request("/embedding", {"content": content, "embd_normalize": 2})
        try:
            vector = data[0]["embedding"]
            if len(vector) == 1 and isinstance(vector[0], list):
                vector = vector[0]
            result = np.asarray(vector, dtype="<f4")
            norm = np.linalg.norm(result)
            if result.shape != (768,) or not np.isfinite(result).all() or not np.isfinite(norm) or norm <= 0:
                raise ValueError("Invalid pooled embedding")
            return result / norm
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise EmbeddingError("Expected a finite 768-dimensional pooled embedding. Start llama-server with --embedding --pooling mean.") from exc

    def embed_image(self, path, props):
        # Read originals, fixing orientation; GIFs use the first frame. No changes to library files.
        with Image.open(path) as original:
            image = ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((768, 768), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, "JPEG", quality=90)
        return self.embed({"prompt_string": props["media_marker"],
                           "multimodal_data": [base64.b64encode(output.getvalue()).decode("ascii")]})


class EmbeddingIndex:
    def __init__(self, db_path, root, client):
        self.db_path = Path(db_path)
        self.root = Path(root).resolve()
        self.client = client
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread = None
        self._queries = OrderedDict()
        self._query_lock = threading.Lock()
        self._progress = dict(running=False, done=False, cancelled=False, total=0, processed=0,
                              created=0, skipped=0, failed=0, removed=0, current="", error="")

    @contextmanager
    def connect(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.db_path, timeout=30)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE IF NOT EXISTS images (profile TEXT, path TEXT, mtime_ns INTEGER, size INTEGER, vector BLOB, PRIMARY KEY (profile, path))")
        try:
            with db:
                yield db
        finally:
            db.close()

    def status(self):
        with self._lock:
            result = dict(self._progress)
        if self.db_path.exists():
            with self.connect() as db:
                result["indexed"] = db.execute("SELECT COUNT(DISTINCT path) FROM images").fetchone()[0]
        else:
            result["indexed"] = 0
        return result

    def update_progress(self, **values):
        with self._lock:
            self._progress.update(values)

    def start(self, paths_factory, force=False, on_complete=None):
        with self._lock:
            if self._progress["running"]:
                return {"status": "already_running"}
            self._cancel.clear()
            self._progress = dict(running=True, done=False, cancelled=False, total=0, processed=0,
                                  created=0, skipped=0, failed=0, removed=0, current="", error="")
            self._thread = threading.Thread(target=self._worker, args=(paths_factory, force, on_complete), daemon=True)
            self._thread.start()
        return {"status": "started"}

    def cancel(self):
        self._cancel.set()
        return {"status": "cancelling"}

    def _worker(self, paths_factory, force, on_complete):
        try:
            props = self.client.ready()
            profile = self.client.profile(self.root, props)
            paths = list(paths_factory())
            self.update_progress(total=len(paths))
            seen = set()
            with self.connect() as db:
                existing = {row[0]: (row[1], row[2]) for row in db.execute("SELECT path, mtime_ns, size FROM images WHERE profile=?", (profile,))}
                for path in paths:
                    if self._cancel.is_set():
                        break
                    relative = path.relative_to(self.root).as_posix()
                    seen.add(relative)
                    self.update_progress(current=relative)
                    try:
                        # Do not follow file symlinks outside the configured library.
                        if not path.resolve().is_relative_to(self.root):
                            raise OSError("Image is outside the library")
                        stat = path.stat()
                        if not force and existing.get(relative) == (stat.st_mtime_ns, stat.st_size):
                            field = "skipped"
                        else:
                            vector = self.client.embed_image(path, props)
                            after = path.stat()
                            if (stat.st_mtime_ns, stat.st_size) != (after.st_mtime_ns, after.st_size):
                                raise OSError("Image changed while embedding; run Update again")
                            db.execute("INSERT OR REPLACE INTO images VALUES (?, ?, ?, ?, ?)",
                                       (profile, relative, stat.st_mtime_ns, stat.st_size, vector.astype("<f4").tobytes()))
                            db.commit()
                            field = "created"
                    except EmbeddingError:
                        # Abort on server failures; a subsequent update resumes committed images.
                        raise
                    except (OSError, ValueError, Image.DecompressionBombError) as exc:
                        db.execute("DELETE FROM images WHERE profile=? AND path=?", (profile, relative))
                        db.commit()
                        self.update_progress(error=f"{relative}: {exc}")
                        field = "failed"
                    with self._lock:
                        self._progress[field] += 1
                        self._progress["processed"] += 1
                if not self._cancel.is_set():
                    stale = set(existing) - seen
                    db.executemany("DELETE FROM images WHERE profile=? AND path=?", ((profile, path) for path in stale))
                    # Only discard old model/library profiles after a complete, successful pass.
                    if self._progress["failed"] == 0:
                        db.execute("DELETE FROM images WHERE profile<>?", (profile,))
                    db.commit()
                    self.update_progress(removed=len(stale))
            if on_complete:
                on_complete()
        except Exception as exc:
            self.update_progress(error=str(exc))
        finally:
            self.update_progress(running=False, done=True, cancelled=self._cancel.is_set(), current="")

    def rank(self, query, allowed_paths, limit=200, source_path=None):
        if not self.db_path.exists():
            raise EmbeddingError("The embedding DB is empty. Open Admin and click Update image embeddings first.")
        props = self.client.ready()
        profile = self.client.profile(self.root, props)
        with self.connect() as db:
            # Load and score in bounded chunks, keeping memory use independent of library size.
            cursor = db.execute("SELECT path, vector FROM images WHERE profile=? ORDER BY path", (profile,))
            first = cursor.fetchmany(1024)
            if not first:
                raise EmbeddingError("No embeddings for the current model/library. Open Admin and update image embeddings.")
            if source_path is not None:
                source = db.execute("SELECT vector FROM images WHERE profile=? AND path=?", (profile, source_path)).fetchone()
                if source is None:
                    raise EmbeddingError("This image has no embedding yet. Open Admin and update image embeddings.")
                vector = np.frombuffer(source[0], dtype="<f4")
            else:
                key = (profile, query)
                with self._query_lock:
                    vector = self._queries.get(key)
                    if vector is None:
                        vector = self.client.embed("task: search result | query: " + query)
                        self._queries[key] = vector
                        if len(self._queries) > 64:
                            self._queries.popitem(last=False)
                    else:
                        self._queries.move_to_end(key)
            best = []
            rows = first
            while rows:
                rows = [(path, blob) for path, blob in rows if path in allowed_paths and path != source_path]
                if rows:
                    matrix = np.vstack([np.frombuffer(blob, dtype="<f4") for _, blob in rows])
                    scores = matrix @ vector
                    best.extend((path, float(score)) for (path, _), score in zip(rows, scores))
                    best.sort(key=lambda item: (-item[1], item[0]))
                    best = best[:limit]
                rows = cursor.fetchmany(1024)
        return best
