import io
import unittest
from pathlib import Path
from unittest.mock import patch

import main


TEST_DIR = Path(__file__).resolve().parent


class ConfigTest(unittest.TestCase):
    def test_local_config_loads_all_settings_and_resolves_relative_images_dir(self):
        content = (
            '[auth]\ngallery_password = "viewer"\nadmin_password = "owner"\n'
            'session_secret = "session-key"\n[storage]\nimages_dir = "photos"\n'
        )
        with patch.object(Path, "exists", return_value=True), patch.object(Path, "open", return_value=io.BytesIO(content.encode())):
            config = main.load_config(TEST_DIR / "config.toml")
        self.assertEqual(config["auth"]["gallery_password"], "viewer")
        self.assertEqual(config["auth"]["admin_password"], "owner")
        self.assertEqual(config["auth"]["session_secret"], "session-key")
        self.assertEqual(config["images_dir"], (TEST_DIR / "photos").resolve())

    def test_example_is_used_when_local_config_is_missing(self):
        content = (
            '[auth]\ngallery_password = "public-example"\nadmin_password = "public-admin"\n'
            'session_secret = "public-secret"\n[storage]\nimages_dir = "Gallery"\n'
        )
        with patch.object(Path, "exists", return_value=False), patch.object(Path, "open", return_value=io.BytesIO(content.encode())) as opened:
            config = main.load_config(TEST_DIR / "config.toml")
        opened.assert_called_once_with("rb")
        self.assertEqual(config["images_dir"], (TEST_DIR / "Gallery").resolve())
        self.assertEqual(config["auth"]["gallery_password"], "")
        self.assertEqual(config["auth"]["admin_password"], "")
        self.assertEqual(config["auth"]["session_secret"], "")

    def test_invalid_config_fails_with_field_name(self):
        content = (
            '[auth]\ngallery_password = 123\nadmin_password = "owner"\n'
            'session_secret = ""\n[storage]\nimages_dir = "photos"\n'
        )
        with patch.object(Path, "exists", return_value=True), patch.object(Path, "open", return_value=io.BytesIO(content.encode())):
            with self.assertRaisesRegex(ValueError, r"auth\.gallery_password"):
                main.load_config(TEST_DIR / "config.toml")


if __name__ == "__main__":
    unittest.main()
