import hashlib
import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.auth import hash_password, verify_password_hash
from app.main import app


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
OWNER_ID = hashlib.sha256(TEST_EMAIL.encode("utf-8")).hexdigest()
VIDEO_ID = "synthetic-video-1"
VIDEO_URL = "https://www.xvideos.com/video.synthetic-1"
SYNTHETIC_ITEM = {"id": VIDEO_ID, "url": VIDEO_URL, "source": "xvideos", "title": "Synthetic video"}


class PersonalApiTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, TEST_CONFIG)
        self.environment.start()
        self.client = TestClient(app)
        response = self.client.post("/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        self.assertEqual(response.status_code, 200)

    def tearDown(self):
        self.client.close()
        self.environment.stop()

    def test_private_reads_and_clear_use_authenticated_admin_identity(self):
        history_item = {"video_id": VIDEO_ID, "url": VIDEO_URL, "source": "xvideos", "played_at": "2026-01-01T00:00:00+00:00"}
        favorite_item = {"video_id": VIDEO_ID, "url": VIDEO_URL, "source": "xvideos", "created_at": "2026-01-01T00:00:00+00:00"}
        with patch("app.main.list_history", new=AsyncMock(return_value=[history_item])) as history, patch(
            "app.main.list_favorites", new=AsyncMock(return_value=[favorite_item])
        ) as favorites, patch("app.main.clear_history", new=AsyncMock()) as clear:
            history_response = self.client.get("/v1/me/history")
            favorites_response = self.client.get("/v1/me/favorites")
            clear_response = self.client.delete("/v1/me/history")

        self.assertEqual(history_response.json(), {"items": [history_item]})
        self.assertEqual(favorites_response.json(), {"items": [favorite_item]})
        self.assertEqual(clear_response.status_code, 204)
        history.assert_awaited_once_with(OWNER_ID)
        favorites.assert_awaited_once_with(OWNER_ID)
        clear.assert_awaited_once_with(OWNER_ID)

    def test_writes_use_authenticated_admin_identity_and_validated_catalog_item(self):
        with patch("app.main.load_catalog", new=AsyncMock(return_value=[SYNTHETIC_ITEM])), patch(
            "app.main.record_play", new=AsyncMock()
        ) as record, patch("app.main.set_favorite", new=AsyncMock()) as favorite:
            history_response = self.client.post(
                "/v1/me/history",
                json={"video_id": VIDEO_ID, "url": VIDEO_URL, "source": "xvideos"},
            )
            favorite_response = self.client.post(
                "/v1/me/favorites",
                json={"video_id": VIDEO_ID, "url": VIDEO_URL, "source": "xvideos", "enabled": True},
            )

        self.assertEqual(history_response.status_code, 201)
        self.assertEqual(favorite_response.status_code, 200)
        self.assertEqual(history_response.json(), {"saved": True})
        self.assertEqual(favorite_response.json(), {"saved": True})
        record.assert_awaited_once_with(OWNER_ID, VIDEO_ID, VIDEO_URL, "xvideos")
        favorite.assert_awaited_once_with(OWNER_ID, VIDEO_ID, VIDEO_URL, "xvideos", True)

    def test_client_cannot_select_another_account_for_personal_data(self):
        with patch("app.main.list_history", new=AsyncMock(return_value=[])) as history:
            response = self.client.get("/v1/me/history?actor_id=not-the-admin")
        self.assertEqual(response.status_code, 200)
        history.assert_awaited_once_with(OWNER_ID)

    def test_history_and_favorites_export_as_json_and_csv_with_only_allowlisted_fields(self):
        history_row = {
            "video_id": "synthetic-history-1", "url": VIDEO_URL, "source": "xvideos",
            "played_at": "2026-01-01T00:00:00+00:00", "actor_id": "other-account",
            "password_hash": "synthetic-never-export", "token": "synthetic-token",
            "title": "catalog data must not be exported",
        }
        favorite_row = {
            "video_id": "=HYPERLINK(\"https://example.invalid\")", "url": VIDEO_URL,
            "source": "xvideos", "created_at": "2026-01-02T00:00:00+00:00",
            "actor_id": "other-account", "session_secret": "synthetic-never-export",
        }
        with patch("app.main.export_history", new=AsyncMock(return_value=[history_row])) as history, patch(
            "app.main.export_favorites", new=AsyncMock(return_value=[favorite_row])
        ) as favorites:
            history_json = self.client.get("/v1/me/history/export?format=json&actor_id=other-account")
            history_csv = self.client.get("/v1/me/history/export?format=csv")
            favorites_json = self.client.get("/v1/me/favorites/export?format=json&actor_id=other-account")
            favorites_csv = self.client.get("/v1/me/favorites/export?format=csv")
            invalid_format = self.client.get("/v1/me/history/export?format=xml")

        self.assertEqual(history_json.status_code, 200)
        self.assertEqual(history_json.json(), {"items": [{
            "video_id": history_row["video_id"], "url": VIDEO_URL, "source": "xvideos",
            "played_at": history_row["played_at"],
        }]})
        self.assertEqual(history_json.headers["content-type"], "application/json")
        self.assertIn('filename="filtrox-history.json"', history_json.headers["content-disposition"])
        self.assertNotIn("synthetic-never-export", history_json.text)
        self.assertNotIn("catalog data", history_json.text)
        self.assertEqual(history_csv.headers["content-type"], "text/csv; charset=utf-8")
        self.assertEqual(
            history_csv.text.splitlines()[0], "video_id,url,source,played_at"
        )
        self.assertEqual(favorites_json.json(), {"items": [{
            "video_id": favorite_row["video_id"], "url": VIDEO_URL, "source": "xvideos",
            "created_at": favorite_row["created_at"],
        }]})
        self.assertNotIn("session_secret", favorites_json.text)
        self.assertEqual(favorites_csv.text.splitlines()[0], "video_id,url,source,created_at")
        self.assertIn("'=HYPERLINK(", favorites_csv.text)
        self.assertIn('filename="filtrox-favorites.csv"', favorites_csv.headers["content-disposition"])
        history.assert_has_awaits([unittest.mock.call(OWNER_ID), unittest.mock.call(OWNER_ID)])
        favorites.assert_has_awaits([unittest.mock.call(OWNER_ID), unittest.mock.call(OWNER_ID)])
        self.assertEqual(invalid_format.status_code, 422)

    def test_password_change_verifies_current_and_persists_only_a_pbkdf2_hash(self):
        replacement_hash = hash_password(
            "synthetic-new-password", iterations=100_000, salt=b"synthetic-next-salt"
        )
        with patch("app.main.get_admin_password_hash", new=AsyncMock(return_value=TEST_CONFIG["FILTROX_LOGIN_PASSWORD_HASH"])) as active_hash, patch(
            "app.main.hash_password", return_value=replacement_hash
        ), patch("app.main.store_admin_password_hash", new=AsyncMock(return_value=True)) as store:
            response = self.client.post(
                "/v1/me/password",
                json={"current_password": TEST_PASSWORD, "new_password": "synthetic-new-password"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"changed": True})
        active_hash.assert_awaited_once_with(TEST_CONFIG["FILTROX_LOGIN_PASSWORD_HASH"])
        store.assert_awaited_once_with(
            TEST_CONFIG["FILTROX_LOGIN_PASSWORD_HASH"],
            replacement_hash,
            TEST_CONFIG["FILTROX_LOGIN_PASSWORD_HASH"],
        )
        self.assertTrue(verify_password_hash("synthetic-new-password", replacement_hash))
        self.assertFalse(verify_password_hash(TEST_PASSWORD, replacement_hash))
        self.assertEqual(self.client.get("/healthz").status_code, 200)

    def test_password_change_rejects_wrong_current_password_without_hashing_or_writing(self):
        with patch("app.main.get_admin_password_hash", new=AsyncMock(return_value=TEST_CONFIG["FILTROX_LOGIN_PASSWORD_HASH"])), patch(
            "app.main.hash_password"
        ) as hash_new, patch("app.main.store_admin_password_hash", new=AsyncMock()) as store:
            response = self.client.post(
                "/v1/me/password",
                json={"current_password": "synthetic-wrong-current", "new_password": "synthetic-new-password"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "A senha atual está incorreta.")
        hash_new.assert_not_called()
        store.assert_not_awaited()

    def test_password_change_rejects_unchanged_or_too_short_new_password(self):
        with patch("app.main.get_admin_password_hash", new=AsyncMock(return_value=TEST_CONFIG["FILTROX_LOGIN_PASSWORD_HASH"])), patch(
            "app.main.store_admin_password_hash", new=AsyncMock()
        ) as store:
            same_response = self.client.post(
                "/v1/me/password",
                json={"current_password": TEST_PASSWORD, "new_password": TEST_PASSWORD},
            )
            short_response = self.client.post(
                "/v1/me/password",
                json={"current_password": TEST_PASSWORD, "new_password": "short"},
            )

        self.assertEqual(same_response.status_code, 422)
        self.assertEqual(short_response.status_code, 422)
        store.assert_not_awaited()

    def test_login_accepts_persisted_password_and_rejects_bootstrap_password(self):
        replacement_hash = hash_password(
            "synthetic-new-password", iterations=100_000, salt=b"synthetic-login-salt"
        )
        with patch("app.main.get_admin_password_hash", new=AsyncMock(return_value=replacement_hash)):
            accepted = self.client.post(
                "/auth/login",
                json={"email": TEST_EMAIL, "password": "synthetic-new-password"},
            )
            rejected = self.client.post(
                "/auth/login",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            )

        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(rejected.status_code, 401)

    def test_password_change_returns_conflict_if_another_session_changed_it_first(self):
        with patch("app.main.get_admin_password_hash", new=AsyncMock(return_value=TEST_CONFIG["FILTROX_LOGIN_PASSWORD_HASH"])), patch(
            "app.main.hash_password", return_value="synthetic-pbkdf2-hash"
        ), patch("app.main.store_admin_password_hash", new=AsyncMock(return_value=False)):
            response = self.client.post(
                "/v1/me/password",
                json={"current_password": TEST_PASSWORD, "new_password": "synthetic-new-password"},
            )

        self.assertEqual(response.status_code, 409)
        self.assertIn("outra sessão", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
