import os
import time
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import SESSION_IDLE_TTL_SECONDS, hash_password
from app.main import SearchRequest, _safe_video_url, app
from app.search_index import SearchEngineUnavailable
from app.storage import _ssl_setting


TEST_EMAIL = "owner@example.test"
TEST_PASSWORD = "synthetic-test-password"
TEST_CONFIG = {
    "FILTROX_ENVIRONMENT": "development",
    "DATABASE_URL": "",
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
            ("GET", "/v1/me/history/export?format=csv", None),
            ("DELETE", "/v1/me/history", None),
            ("GET", "/v1/me/favorites", None),
            ("GET", "/v1/me/favorites/export?format=json", None),
            ("GET", "/v1/admin/backups", None),
            ("GET", "/v1/admin/backups/download", None),
            ("POST", "/v1/admin/backups/restore", {
                "filename": "filtrox-postgres-20260101T000000Z-000000000001.dump.age",
                "confirmation": "RESTAURAR FILTROX: filtrox-postgres-20260101T000000Z-000000000001.dump.age",
            }),
            ("POST", "/v1/me/password", {"current_password": TEST_PASSWORD, "new_password": "synthetic-new-password"}),
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

    def test_backup_status_is_unavailable_without_key_and_does_not_leak_database_values(self):
        self.assertEqual(self.login().status_code, 200)
        with patch.dict(os.environ, {
            "FILTROX_BACKUP_AGE_RECIPIENT": "",
            "DATABASE_URL": "synthetic malformed value; must not be inspected by listing",
        }):
            response = self.client.get("/v1/admin/backups")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["download_available"])
        self.assertFalse(response.json()["restore_available"])
        self.assertIn("age", response.json()["message"])
        self.assertNotIn("synthetic malformed", response.text)

    def test_backup_status_needs_no_server_directory_when_configuration_is_ready(self):
        self.assertEqual(self.login().status_code, 200)
        config = object()
        with patch("app.main.load_configuration", return_value=config), patch(
            "app.main._close_configuration"
        ) as close_config:
            response = self.client.get("/v1/admin/backups")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["download_available"])
        self.assertFalse(response.json()["restore_available"])
        self.assertIn("baixado pelo navegador", response.json()["message"])
        self.assertIn("não cria", response.json()["message"])
        close_config.assert_called_once_with(config)

    def test_download_returns_encrypted_attachment_without_a_server_archive_path(self):
        self.assertEqual(self.login().status_code, 200)

        class SyntheticStream:
            def __iter__(self):
                yield b"synthetic age ciphertext only"

            def close(self):
                self.closed = True

        config = object()
        stream = SyntheticStream()
        stream.closed = False
        with patch("app.main.load_configuration", return_value=config), patch(
            "app.main.EncryptedBackupStream", return_value=stream
        ) as stream_factory:
            response = self.client.get("/v1/admin/backups/download")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"synthetic age ciphertext only")
        self.assertEqual(response.headers["content-type"], "application/octet-stream")
        self.assertIn("attachment; filename=\"filtrox-postgres-", response.headers["content-disposition"])
        self.assertEqual(response.headers["cache-control"], "no-store, private, max-age=0")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertTrue(stream.closed)
        stream_factory.assert_called_once_with(config)

    def test_restore_stays_blocked_even_if_legacy_flag_is_set(self):
        self.assertEqual(self.login().status_code, 200)
        filename = "filtrox-postgres-20260101T000000Z-000000000001.dump.age"
        with patch.dict(os.environ, {
            "FILTROX_WEB_RESTORE_ENABLED": "true",
        }), patch("app.main.EncryptedBackupStream") as export:
            response = self.client.post("/v1/admin/backups/restore", json={
                "filename": filename,
                "confirmation": f"RESTAURAR FILTROX: {filename}",
            })

        self.assertEqual(response.status_code, 503)
        self.assertIn("arquivo local", response.json()["detail"])
        export.assert_not_called()

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

    def test_search_engine_failure_returns_generic_503_without_internal_details(self):
        self.assertEqual(self.login().status_code, 200)
        with patch("app.main.load_catalog", new=AsyncMock(return_value=[{"id": "synthetic", "title": "synthetic title", "tags": []}])), patch(
            "app.main.search_catalog_indexed",
            new=AsyncMock(side_effect=SearchEngineUnavailable("synthetic secret diagnostic")),
        ):
            response = self.client.post("/v1/catalog/search", json={"query": "synthetic"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"error": "Serviço de busca indisponível."})
        self.assertNotIn("synthetic secret diagnostic", response.text)

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

    def test_tag_match_mode_defaults_to_and_and_rejects_unknown_values(self):
        self.assertEqual(SearchRequest().include_tags_mode, "and")
        self.assertEqual(SearchRequest(include_tags_mode="or").include_tags_mode, "or")
        with self.assertRaises(ValidationError):
            SearchRequest(include_tags_mode="xor")

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
