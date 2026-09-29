import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from starlette.routing import Match

import main


class NestedFoldersTest(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parent / "testdata" / "runtime"
        self.assertTrue(root.resolve().is_relative_to(Path(__file__).resolve().parent))
        if root.exists():
            shutil.rmtree(root)
        root.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, root)
        self.root = root
        self.images_dir = root / "Gallery"
        self.images_dir.mkdir()
        self.tags = root / "tags.json"
        self.names = root / "folders.json"
        self.cache = root / "cache.json"
        self.patches = [
            patch.object(main, "ADMIN_PASSWORD", "test-admin-password"),
            patch.object(main, "IMAGES_DIR", self.images_dir),
            patch.object(main, "TAGS_FILE", self.tags),
            patch.object(main, "FOLDERS_FILE", self.names),
            patch.object(main, "CACHE_FILE", self.cache),
            patch.object(main, "_cache", {}),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

        for relative in ("Trip #1/Day 1/a.jpg", "Trip #1/cover.jpg", "Trip #2/Day 1/b.png"):
            target = self.images_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (4, 4), "red").save(target)
        (self.images_dir / "Empty").mkdir()
        self.tags.write_text(json.dumps({"Trip #1/Day 1": ["travel"]}), encoding="utf-8")
        self.names.write_text(json.dumps({"Trip #1/Day 1": "First day"}), encoding="utf-8")

    def test_cache_and_folder_api_keep_relative_paths_distinct(self):
        cache = main._build_cache()
        self.assertEqual(len(cache["all_images"]), 3)
        self.assertEqual(set(cache["folders"]), {"Trip #1", "Trip #1/Day 1", "Trip #2/Day 1"})
        self.assertNotIn("Empty", cache["directories"])
        self.assertEqual(cache["directories"]["Trip #2"]["count"], 0)
        self.assertEqual(cache["directories"]["Trip #2"]["total_count"], 1)
        self.assertEqual(cache["directories"]["Trip #1"]["child_count"], 1)
        self.assertEqual(cache["directories"]["Trip #1/Day 1"]["display_name"], "First day")
        self.assertEqual(cache["all_images"][0]["url"], "/media/Trip%20%231/cover.jpg")
        self.assertEqual(cache["all_images"][1]["thumb_url"], "/thumbs/Trip%20%231/Day%201/a.jpg")

        with patch.object(main, "get_cache", return_value=cache):
            folders = main.get_folders(sort=None, include_parents=True)
            self.assertEqual(len(folders), 4)
            self.assertEqual(len(main.get_folders(sort=None, include_parents=False)), 3)
            items = main.get_folder_images("Trip #2/Day 1", page=1, per_page=60, sort=None)
            self.assertEqual(items["items"][0]["url"], "/media/Trip%20%232/Day%201/b.png")
            self.assertEqual(items["items"][0]["thumb_url"], "/thumbs/Trip%20%232/Day%201/b.jpg")
            self.assertEqual(main.get_filters(), [{"tag": "misc", "count": 2}, {"tag": "travel", "count": 1}])

        route = next(route for route in main.app.routes if route.path == "/api/folder/{folder_name:path}")
        match, scope = route.matches({"type": "http", "path": "/api/folder/Trip #2/Day 1", "method": "GET", "root_path": ""})
        self.assertEqual(match, Match.FULL)
        self.assertEqual(scope["path_params"]["folder_name"], "Trip #2/Day 1")

    def test_generators_use_relative_paths_and_thumbnail_uses_nested_path(self):
        main.generate_tags_file(main.ADMIN_PASSWORD)
        tags = json.loads(self.tags.read_text(encoding="utf-8"))
        self.assertEqual(tags["Trip #1/Day 1"], ["travel"])
        self.assertIn("Trip #2/Day 1", tags)
        main.generate_folders_file(main.ADMIN_PASSWORD)
        names = json.loads(self.names.read_text(encoding="utf-8"))
        self.assertEqual(names["Trip #2/Day 1"], "Day 1")
        self.assertEqual(names["Trip #2"], "Trip #2")

        thumb = self.root / "thumbnails/Trip #2/Day 1/b.jpg"
        result = main.generate_thumbnail((self.images_dir / "Trip #2/Day 1/b.png", thumb, (2, 2)))
        self.assertEqual(result, "created")
        self.assertTrue(thumb.exists())

    def test_hot_image_sort_uses_image_scores(self):
        folder = {
            "folders": {
                "Trip": {
                    "images": ["/media/Trip/a.jpg", "/media/Trip/b.jpg", "/media/Trip/c.jpg"],
                    "mtimes": [1, 2, 3],
                    "display_name": "Trip",
                }
            }
        }
        scores = {"images": {"/media/Trip/a.jpg": 1, "/media/Trip/b.jpg": 3}}
        with patch.object(main, "get_cache", return_value=folder), patch.object(main, "_load_hotlog", return_value=scores):
            result = main.get_folder_images("Trip", page=1, per_page=20, sort="hot")
        self.assertEqual(result["total"], 3)
        self.assertEqual([item["url"] for item in result["items"]], ["/media/Trip/b.jpg", "/media/Trip/a.jpg", "/media/Trip/c.jpg"])


if __name__ == "__main__":
    unittest.main()
