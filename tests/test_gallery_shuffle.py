import unittest
from unittest.mock import patch

import main


class GalleryShuffleTest(unittest.TestCase):
    def test_seeded_pages_share_one_stable_permutation(self):
        images = [{"url": f"/media/{i}.jpg", "folder": "Test"} for i in range(105)]
        cache = {"all_images": images}

        with patch.object(main, "get_cache", return_value=cache):
            pages = [
                main.get_images(page=page, per_page=40, tags=None, shuffle=True, seed=1234, sort=None)
                for page in range(1, 4)
            ]
            repeated = main.get_images(page=2, per_page=40, tags=None, shuffle=True, seed=1234, sort=None)
            other_seed = main.get_images(page=1, per_page=40, tags=None, shuffle=True, seed=4321, sort=None)

        urls = [item["url"] for page in pages for item in page["items"]]
        self.assertEqual(len(urls), len(images))
        self.assertEqual(set(urls), {item["url"] for item in images})
        self.assertEqual(repeated["items"], pages[1]["items"])
        self.assertNotEqual(other_seed["items"], pages[0]["items"])


if __name__ == "__main__":
    unittest.main()
