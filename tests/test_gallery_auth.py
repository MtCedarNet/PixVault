import hashlib
import hmac
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class GalleryAuthTest(unittest.TestCase):
    def setUp(self):
        self.password_patch = patch.object(main, "GALLERY_PASSWORD", "example-shared-password")
        self.password_patch.start()
        self.addCleanup(self.password_patch.stop)
        self.client = TestClient(main.app, follow_redirects=False)
        self.addCleanup(self.client.close)

    def test_login_protects_pages_api_and_files(self):
        page = self.client.get("/folders")
        self.assertEqual(page.status_code, 303)
        self.assertEqual(page.headers["location"], "/login?next=%2Ffolders")
        for path in ("/admin", "/api/images", "/media/photo.jpg", "/thumbs/photo.jpg", "/images/photo.jpg"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertIn(response.status_code, (303, 401))

        wrong = self.client.post("/login", data={"password": "wrong", "next": "/folders"})
        self.assertEqual(wrong.status_code, 401)
        self.assertNotIn("gallery_session", wrong.cookies)

        login = self.client.post("/login", data={"password": "example-shared-password", "next": "/folders"})
        self.assertEqual(login.status_code, 303)
        self.assertEqual(login.headers["location"], "/folders")
        self.assertIn("HttpOnly", login.headers["set-cookie"])
        self.assertIn("SameSite=lax", login.headers["set-cookie"])
        self.assertEqual(self.client.get("/admin").status_code, 200)
        self.assertEqual(self.client.get("/api/stats").status_code, 200)
        self.assertEqual(self.client.get("/media/missing.jpg").status_code, 404)
        with patch.object(main, "GALLERY_PASSWORD", "changed-password"):
            self.assertEqual(self.client.get("/api/stats").status_code, 401)

        logout = self.client.post("/logout")
        self.assertEqual(logout.status_code, 303)
        self.assertEqual(self.client.get("/api/stats").status_code, 401)

    def test_invalid_expired_and_redirect_tokens(self):
        self.client.cookies.set("gallery_session", "bad")
        self.assertEqual(self.client.get("/api/stats").status_code, 401)

        issued = str(int(time.time()) - main._SESSION_LIFETIME - 1)
        signature = hmac.new(main._session_key(), issued.encode(), hashlib.sha256).hexdigest()
        self.client.cookies.set("gallery_session", f"{issued}.{signature}")
        self.assertEqual(self.client.get("/api/stats").status_code, 401)

        login = self.client.post("/login", data={"password": "example-shared-password", "next": "//outside.example"})
        self.assertEqual(login.headers["location"], "/")
        page = self.client.get("/login?next=%22%3E%3Cscript%3Ealert(1)%3C/script%3E")
        self.assertNotIn('<script>alert(1)</script>', page.text)

    def test_missing_password_fails_closed(self):
        with patch.object(main, "GALLERY_PASSWORD", ""):
            self.assertEqual(self.client.get("/api/images").status_code, 503)
            self.assertEqual(self.client.post("/login", data={"password": "anything"}).status_code, 503)


if __name__ == "__main__":
    unittest.main()
