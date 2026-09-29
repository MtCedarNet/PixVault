import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.routing import Match

import main


class AdminTest(unittest.TestCase):
    def test_admin_page_and_post_routes(self):
        page = asyncio.run(main.page_admin())
        self.assertIn('id="rebuildButton"', page.body.decode("utf-8"))
        self.assertIn('id="thumbButton"', page.body.decode("utf-8"))
        for path in (
            "/api/admin/cache/rebuild",
            "/api/admin/tags/generate",
            "/api/admin/folders/generate",
            "/api/admin/thumbnails/generate",
        ):
            route = next(route for route in main.app.routes if route.path == path)
            match, _ = route.matches({"type": "http", "path": path, "method": "POST", "root_path": ""})
            self.assertEqual(match, Match.FULL)

    def test_admin_actions_require_key_before_running(self):
        password_patch = patch.object(main, "ADMIN_PASSWORD", "test-admin-password")
        password_patch.start()
        self.addCleanup(password_patch.stop)
        actions = (
            (main.admin_rebuild_cache, "rebuild_cache"),
            (main.admin_generate_tags, "generate_tags_file"),
            (main.admin_generate_folders, "generate_folders_file"),
            (main.admin_generate_thumbnails, "generate_thumbnails"),
        )
        for action, target in actions:
            with self.subTest(action=action.__name__), patch.object(main, target, return_value={"status": "ok"}) as wrapped:
                with self.assertRaises(HTTPException) as raised:
                    action("wrong")
                self.assertEqual(raised.exception.status_code, 403)
                wrapped.assert_not_called()
                self.assertEqual(action(main.ADMIN_PASSWORD), {"status": "ok"})
                wrapped.assert_called_once_with(main.ADMIN_PASSWORD)

        with patch.object(main, "ADMIN_PASSWORD", ""):
            with self.assertRaises(HTTPException):
                main._require_admin_key("")
        with patch.object(main, "ADMIN_PASSWORD", "管理用パスワード"):
            main._require_admin_key("管理用パスワード")

    def test_legacy_cache_routes_require_admin_password(self):
        with patch.object(main, "ADMIN_PASSWORD", "test-admin-password"):
            with patch.object(main, "_build_cache") as build:
                with self.assertRaises(HTTPException):
                    main.rebuild_cache("wrong")
                with self.assertRaises(HTTPException):
                    main.generate_cache("wrong")
                build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
