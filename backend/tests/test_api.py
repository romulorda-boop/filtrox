import os
import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import SESSION_IDLE_TTL_SECONDS, hash_password
from app.main import SearchRequest, _safe_video_url, app
from app.storage import _ssl_setting


TEST_EMAIL = "owner@example.test"
TEST_PASSWORD = "synthetic-test-password"
TEST_CONFIG = {
    "FILTROX_ENVIRONMENT": "development",
    "FILTROX_LOGIN_EMAIL": TEST_EMAIL,
    "FILTROX_LOGIN_PASSWORD_HASH": hash_password(
        TEST_PASSWORD, iterations=100_000, salt=b"synthetic-salt-123"
    ),
    "FILTROX_SESSION_SECRET": "synthetic-session-secret-for-unit-tests-only-32-bytes",
    "FILTROX_COOKIE_SECURE": "false",
}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, TEST_CONFIG)
        self.environment.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.environment.stop()

    def login(self):
        return self.client.post("/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})

    def test_every_site_api_requires_login_including_health(self):
        requests = [
            ("GET", "/healthz", None),
            ("POST", "/v1/catalog/search", {"query": "synthetic"}),
            ("GET", "/v1/me/history", None),
            ("DELETE", "/v1/me/history", None),
            ("GET", "/v1/me/favorites", None),
            ("POST", "/v1/me/favorites", {"source": "xvideos", "video_id": "synthetic", "url": "https://www.xvideos.com/video.synthetic", "enabled": True}),
        ]
        for method, path, body in requests:
            with self.subTest(method=method, path=path):
                response = self.client.request(method, path, json=body)
                self.assertEqual(response.status_code, 401)
                self.assertIn("Autenticação necessária", response.json()["detail"])

    def test_login_sets_http_only_strict_cookie_and_allows_private_health(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"authenticated": True})
        cookie = response.headers["set-cookie"]
        self.assertIn("filtrox_session=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=strict", cookie)
        self.assertIn("Path=/", cookie)
        self.assertIn(f"Max-Age={SESSION_IDLE_TTL_SECONDS}", cookie)
        self.assertNotIn("Secure", cookie)
        self.assertEqual(self.client.get("/healthz").status_code, 200)

    def test_authenticated_api_activity_renews_the_idle_session_cookie(self):
        self.assertEqual(self.login().status_code, 200)
        original_cookie = self.client.cookies.get("filtrox_session")
        refreshed_at = int(time.time()) + 60
        with patch("app.auth.time.time", return_value=refreshed_at):
            response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertIn(f"Max-Age={SESSION_IDLE_TTL_SECONDS}", response.headers["set-cookie"])
        self.assertNotEqual(self.client.cookies.get("filtrox_session"), original_cookie)

    def test_wrong_password_is_rejected_without_creating_a_session(self):
        response = self.client.post("/auth/login", json={"email": TEST_EMAIL, "password": "wrong synthetic password"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "E-mail ou senha incorretos.")
        self.assertNotIn("filtrox_session", self.client.cookies)

    def test_login_fails_closed_when_server_credentials_are_missing(self):
        keys = ["FILTROX_LOGIN_EMAIL", "FILTROX_LOGIN_PASSWORD_HASH", "FILTROX_SESSION_SECRET"]
        with patch.dict(os.environ, {key: "" for key in keys}):
            response = self.client.post("/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("filtrox_session", self.client.cookies)

    def test_logout_clears_cookie_and_protected_api_access(self):
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.client.get("/healthz").status_code, 200)
        response = self.client.post("/auth/logout")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Max-Age=0", response.headers["set-cookie"])
        self.assertEqual(self.client.get("/healthz").status_code, 401)

    def test_no_public_signup_route_exists(self):
        payload = {"email": "new@example.test", "password": "synthetic-password"}
        public_response = self.client.post("/auth/signup", json=payload)
        self.assertEqual(public_response.status_code, 401)
        self.assertEqual(self.login().status_code, 200)
        authenticated_response = self.client.post("/auth/signup", json=payload)
        self.assertEqual(authenticated_response.status_code, 404)

    def test_login_requires_email_field_instead_of_username(self):
        response = self.client.post("/auth/login", json={"username": TEST_EMAIL, "password": TEST_PASSWORD})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("filtrox_session", self.client.cookies)

    def test_declarative_age_value_is_separate_and_cannot_bypass_login(self):
        unauthenticated = self.client.post("/v1/catalog/search", json={"ageConfirmed": True})
        self.assertEqual(unauthenticated.status_code, 401)
        self.assertEqual(self.login().status_code, 200)
        with self.assertRaises(ValidationError):
            SearchRequest(ageConfirmed=True)
        authenticated = self.client.post("/v1/catalog/search", json={"ageConfirmed": True})
        self.assertEqual(authenticated.status_code, 422)

    def test_authenticated_catalog_still_fails_closed_without_server_catalog_configuration(self):
        self.assertEqual(self.login().status_code, 200)
        with patch.dict(os.environ, {"CATALOG_CSV_URL": "", "CATALOG_REMOVAL_CSV_URL": ""}):
            response = self.client.post("/v1/catalog/search", json={"query": "synthetic"})
        self.assertEqual(response.status_code, 503)

    def test_catalog_search_is_post_only_after_login(self):
        self.assertEqual(self.login().status_code, 200)
        response = self.client.get("/v1/catalog/search")
        self.assertEqual(response.status_code, 405)

    def test_multiple_sort_object_contract_is_accepted(self):
        request = SearchRequest(sort=[
            {"field": "most_viewed", "direction": "desc"},
            {"field": "recent", "direction": "asc"},
        ])
        self.assertEqual(request.model_dump()["sort"], [
            {"field": "most_viewed", "direction": "desc"},
            {"field": "recent", "direction": "asc"},
        ])
        with self.assertRaises(ValidationError):
            SearchRequest(sort=[{"field": "recent", "direction": "sideways"}])

    def test_mutation_url_must_match_declared_source(self):
        with self.assertRaises(HTTPException):
            _safe_video_url("https://example.invalid/video.synthetic", "xvideos")
        self.assertEqual(_safe_video_url("https://www.xvideos.com/video.synthetic", "xvideos"), "https://www.xvideos.com/video.synthetic")

    def test_remote_postgres_requires_tls_but_local_dev_can_be_plaintext(self):
        with patch.dict(os.environ, {"FILTROX_ENVIRONMENT": "production"}):
            self.assertEqual(_ssl_setting("postgresql://user:pass@db.example.invalid/app"), "require")
        with patch.dict(os.environ, {"FILTROX_ENVIRONMENT": "development"}):
            self.assertFalse(_ssl_setting("postgresql://user:pass@localhost/app"))
            self.assertEqual(_ssl_setting("postgresql://user:pass@db.example.invalid/app"), "require")


if __name__ == "__main__":
    unittest.main()
