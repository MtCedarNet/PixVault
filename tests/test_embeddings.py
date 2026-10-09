import shutil
import uuid
from contextlib import contextmanager
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

import main
from embeddings import EmbeddingConfig, EmbeddingError, EmbeddingIndex, LlamaEmbeddingClient


@contextmanager
def workspace_temp():
    path = (main.DATA_DIR / ("embedding-test-" + uuid.uuid4().hex)).resolve()
    path.mkdir()
    try:
        yield str(path)
    finally:
        assert path.parent == main.DATA_DIR.resolve() and path.name.startswith("embedding-test-")
        shutil.rmtree(path)


def vector(axis):
    result = np.zeros(768, dtype="<f4")
    result[axis] = 1
    return result


class FakeClient:
    profile_id = "test-model"

    def __init__(self):
        self.calls = []
        self.fail = False

    def ready(self):
        return {"media_marker": "marker", "modalities": {"vision": True}}

    def profile(self, root, props):
        return self.profile_id

    def embed_image(self, path, props):
        self.calls.append(path.name)
        if self.fail:
            raise EmbeddingError("Server failed")
        with Image.open(path):
            pass
        return vector(0 if path.name.startswith("cat") else 1)

    def embed(self, content):
        return vector(0)


class IndexTest(unittest.TestCase):
    def setUp(self):
        # Workspace-local temporary data avoids Windows temp ACL issues.
        self.temp = workspace_temp()
        temp_path = self.temp.__enter__()
        self.addCleanup(self.temp.__exit__, None, None, None)
        self.root = Path(temp_path) / "library"
        self.root.mkdir()
        self.client = FakeClient()
        self.index = EmbeddingIndex(Path(temp_path) / "index.sqlite3", self.root, self.client)
        self.cat = self.root / "cat 日本語 #%.png"
        self.dog = self.root / "dog.png"
        for path in (self.cat, self.dog):
            Image.new("RGB", (16, 16), "red").save(path)

    def build(self, force=False):
        self.index.start(lambda: sorted(self.root.glob("*.png")), force)
        self.index._thread.join(timeout=10)
        self.assertFalse(self.index.status()["running"])

    def test_incremental_update_delete_force_and_rank(self):
        self.build()
        self.assertEqual(self.index.status()["created"], 2)
        ranked = self.index.rank("猫", {self.cat.name, self.dog.name})
        self.assertEqual(ranked, [(self.cat.name, 1.0), (self.dog.name, 0.0)])
        self.assertEqual(self.index.rank("猫", {self.dog.name}, 1), [(self.dog.name, 0.0)])
        self.build()
        self.assertEqual(self.index.status()["skipped"], 2)
        Image.new("RGB", (32, 32), "blue").save(self.cat)
        self.dog.unlink()
        self.build()
        self.assertEqual(self.index.status()["created"], 1)
        self.assertEqual(self.index.status()["removed"], 1)
        self.assertEqual(self.index.status()["indexed"], 1)
        self.build(force=True)
        self.assertEqual(self.index.status()["created"], 1)

    def test_resume_after_server_failure_and_profile_isolation(self):
        self.client.fail = True
        self.build()
        self.assertIn("Server failed", self.index.status()["error"])
        self.client.fail = False
        self.build()
        self.client.profile_id = "new-model"
        with self.assertRaisesRegex(EmbeddingError, "current model"):
            self.index.rank("猫", {self.cat.name})
        self.build()
        self.assertEqual(self.index.status()["created"], 2)
        self.assertEqual(len(self.index.rank("猫", {self.cat.name, self.dog.name})), 2)

    def test_corrupt_image_does_not_block_others_or_leave_stale_vector(self):
        self.build()
        self.cat.write_bytes(b"not an image")
        self.build()
        self.assertEqual(self.index.status()["failed"], 1)
        self.assertEqual(self.index.rank("猫", {self.cat.name, self.dog.name}), [(self.dog.name, 0.0)])

    def test_cancel_and_duplicate_job(self):
        original_embed = self.client.embed_image
        def stop_after_first(path, props):
            self.assertEqual(self.index.start(lambda: []), {"status": "already_running"})
            result = original_embed(path, props)
            self.index.cancel()
            return result
        self.client.embed_image = stop_after_first
        self.build()
        self.assertTrue(self.index.status()["cancelled"])
        self.assertEqual(self.index.status()["processed"], 1)
        self.client.embed_image = original_embed
        self.build()
        self.assertEqual(self.index.status()["created"], 1)
        self.assertEqual(self.index.status()["skipped"], 1)

    def test_failed_library_scan_preserves_saved_embeddings(self):
        self.build()
        def failed_scan():
            raise EmbeddingError("Cannot scan library")
        self.index.start(failed_scan)
        self.index._thread.join(timeout=10)
        self.assertIn("Cannot scan library", self.index.status()["error"])
        self.assertEqual(self.index.status()["indexed"], 2)
        self.assertEqual(len(self.index.rank("cat", {self.cat.name, self.dog.name})), 2)
        with patch.object(main, "IMAGES_DIR", self.root / "missing"):
            with self.assertRaisesRegex(EmbeddingError, "not found"):
                list(main._embedding_paths())

    def test_similar_search_uses_stored_vector_and_excludes_source(self):
        self.build()
        kitten = self.root / "cat2.png"
        Image.new("RGB", (20, 20), "blue").save(kitten)
        self.build()
        allowed = {self.cat.name, self.dog.name, kitten.name}
        with patch.object(self.client, "embed", side_effect=AssertionError("No text inference expected")):
            self.assertEqual(self.index.rank(None, allowed, source_path=self.cat.name),
                             [(kitten.name, 1.0), (self.dog.name, 0.0)])
            self.assertEqual(self.index.rank(None, {self.dog.name}, source_path=self.cat.name), [(self.dog.name, 0.0)])
        with self.assertRaisesRegex(EmbeddingError, "no embedding"):
            self.index.rank(None, allowed, source_path="unindexed.png")

    def test_search_auth_tags_and_pagination(self):
        self.build()
        def item(path, folder):
            return {"url": main._url_for("media", Path(path.name)), "folder": folder,
                    "display_name": folder, "thumb_url": main._url_for("thumbs", Path(path.name).with_suffix(".jpg"))}
        cache = {"all_images": [item(self.cat, "cats"), item(self.dog, "dogs")],
                 "tag_index": {"animals": ["cats", "dogs"], "cat": ["cats"]}}
        with patch.object(main, "_embedding_index", self.index), patch.object(main, "get_cache", return_value=cache), \
             patch.object(main, "IMAGES_DIR", self.root), patch.object(main, "GALLERY_PASSWORD", "viewer"), \
             patch.object(main, "ADMIN_PASSWORD", "owner"), TestClient(main.app) as client:
            self.assertEqual(client.get("/api/search?q=猫").status_code, 401)
            self.assertEqual(client.get("/api/search/similar", params={"url": cache["all_images"][0]["url"]}).status_code, 401)
            self.assertEqual(client.post("/api/admin/embeddings/generate").status_code, 401)
            client.post("/login", data={"password": "viewer"})
            with patch.object(self.index, "start") as start:
                self.assertEqual(client.post("/api/admin/embeddings/generate", headers={"X-Admin-Key": "bad"}).status_code, 403)
                start.assert_not_called()
                start.return_value = {"status": "started"}
                self.assertEqual(client.post("/api/admin/embeddings/generate?force=true", headers={"X-Admin-Key": "owner"}).status_code, 200)
                self.assertTrue(start.call_args.kwargs["force"])
            page1 = client.get("/api/search", params={"q": "猫", "per_page": 1}).json()
            page2 = client.get("/api/search", params={"q": "猫", "per_page": 1, "page": 2}).json()
            self.assertTrue(page1["has_more"])
            self.assertFalse(page2["has_more"])
            self.assertIn("%23%25", page1["items"][0]["url"])
            self.assertEqual(page2["items"][0]["folder"], "dogs")
            self.assertEqual(client.get("/api/search", params={"q": "猫", "tags": "animals,cat"}).json()["total"], 1)
            self.assertEqual(client.get("/api/search?q=%20%20").status_code, 422)
            self.assertEqual(client.get("/api/search?q=cat&page=0").status_code, 422)
            self.assertEqual(client.get("/api/search?q=cat&tags=unknown").json()["total"], 0)
            source_url = cache["all_images"][0]["url"]
            similar = client.get("/api/search/similar", params={"url": source_url}).json()
            self.assertEqual(similar["total"], 1)
            self.assertEqual(similar["items"][0]["folder"], "dogs")
            self.assertEqual(client.get("/api/search/similar", params={"url": source_url, "tags": "cat"}).json()["total"], 0)
            for invalid in ("https://example.com/cat.png", "/media/../config.toml", "/media/missing.png"):
                self.assertEqual(client.get("/api/search/similar", params={"url": invalid}).status_code, 404)
            self.cat.unlink()
            self.assertEqual(client.get("/api/search?q=cat").json()["total"], 1)
            self.assertEqual(client.get("/api/search/similar", params={"url": source_url}).status_code, 404)


class ClientTest(unittest.TestCase):
    def test_embedding_protocol_and_invalid_outputs(self):
        config = EmbeddingConfig.from_dict({}, main.CONFIG_FILE.parent)
        client = LlamaEmbeddingClient(config, main.DATA_DIR)
        with patch.object(client, "request", return_value=[{"embedding": [vector(0).tolist()]}]) as req:
            self.assertEqual(client.embed("task: search result | query: 猫").shape, (768,))
            self.assertEqual(req.call_args.args[0], "/embedding")
        for data in ([{"embedding": [[float("nan")] * 768]}], [{"embedding": [[0] * 768]}], [{"embedding": [[1, 2]]}], []):
            with patch.object(client, "request", return_value=data), self.assertRaises(EmbeddingError):
                client.embed("test")
        with workspace_temp() as temp:
            path = Path(temp) / "image.png"
            Image.new("RGB", (20, 20), "red").save(path)
            with patch.object(client, "embed", return_value=vector(0)) as embed:
                client.embed_image(path, {"media_marker": "dynamic-marker"})
                content = embed.call_args.args[0]
                self.assertEqual(content["prompt_string"], "dynamic-marker")
                self.assertEqual(len(content["multimodal_data"]), 1)

    def test_config_defaults_and_local_only_url(self):
        config = EmbeddingConfig.from_dict({}, main.CONFIG_FILE.parent)
        self.assertTrue(config.auto_start)
        self.assertTrue(config.model.is_absolute())
        for settings in ({"server_url": "http://example.com:8081"}, {"auto_start": "yes"}, {"timeout": 0}, {"server_url": 1}):
            with self.assertRaises(ValueError):
                EmbeddingConfig.from_dict(settings, main.CONFIG_FILE.parent)


if __name__ == "__main__":
    unittest.main()
