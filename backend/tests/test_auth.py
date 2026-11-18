import os
import time
import unittest
from unittest.mock import patch

from app.auth import (
    AuthFailure,
    SESSION_IDLE_TTL_SECONDS,
    create_session_token,
    hash_password,
    refresh_session_token,
    verify_credentials,
    verify_session_token,
)


TEST_PASSWORD = "synthetic-test-password"
TEST_CONFIG = {
    "FILTROX_ENVIRONMENT": "development",
    "FILTROX_LOGIN_EMAIL": "Owner@Test.Example",
    "FILTROX_LOGIN_PASSWORD_HASH": hash_password(
        TEST_PASSWORD, iterations=100_000, salt=b"synthetic-salt-123"
    ),
    "FILTROX_SESSION_SECRET": "synthetic-session-secret-for-unit-tests-only-32-bytes",
    "FILTROX_COOKIE_SECURE": "false",
}


class AuthTests(unittest.TestCase):
    def test_missing_server_credentials_fail_closed(self):
        keys = [
            "FILTROX_LOGIN_EMAIL",
            "FILTROX_LOGIN_PASSWORD_HASH",
            "FILTROX_SESSION_SECRET",
        ]
        with patch.dict(os.environ, {key: "" for key in keys}):
            with self.assertRaises(AuthFailure) as caught:
                verify_credentials("owner@test.example", TEST_PASSWORD)
        self.assertEqual(caught.exception.status_code, 503)

    def test_one_configured_email_authenticates_case_insensitively_without_signup(self):
        with patch.dict(os.environ, TEST_CONFIG):
            principal = verify_credentials(" owner@test.example ", TEST_PASSWORD)
            self.assertEqual(len(principal.actor_id), 64)
            with self.assertRaises(AuthFailure) as caught:
                verify_credentials("another@example.test", TEST_PASSWORD)
        self.assertEqual(caught.exception.status_code, 401)

    def test_password_hash_requires_sufficient_length_and_uses_salt(self):
        with self.assertRaises(ValueError):
            hash_password("short")
        first = hash_password(TEST_PASSWORD, iterations=100_000, salt=b"salt-one-12345678")
        second = hash_password(TEST_PASSWORD, iterations=100_000, salt=b"salt-two-12345678")
        self.assertNotEqual(first, second)

    def test_session_expires_after_30_idle_days_and_activity_extends_deadline(self):
        with patch.dict(os.environ, TEST_CONFIG):
            token, ttl, secure = create_session_token()
            principal = verify_session_token(token)
            self.assertEqual(len(principal.actor_id), 64)
            self.assertEqual(ttl, SESSION_IDLE_TTL_SECONDS)
            self.assertFalse(secure)

            issued_at = int(time.time())
            with self.assertRaises(AuthFailure) as expired:
                verify_session_token(token, now=issued_at + ttl + 1)
            self.assertEqual(expired.exception.status_code, 401)

            refreshed_at = issued_at + 60
            refreshed, refreshed_ttl, refreshed_secure = refresh_session_token(token, now=refreshed_at)
            self.assertEqual(refreshed_ttl, SESSION_IDLE_TTL_SECONDS)
            self.assertFalse(refreshed_secure)
            self.assertEqual(
                len(verify_session_token(refreshed, now=refreshed_at + ttl - 1).actor_id),
                64,
            )
            with self.assertRaises(AuthFailure):
                verify_session_token(refreshed, now=refreshed_at + ttl)

            encoded_payload, signature = token.split(".", 1)
            changed_first_char = "A" if signature[0] != "A" else "B"
            tampered = f"{encoded_payload}.{changed_first_char}{signature[1:]}"
            with self.assertRaises(AuthFailure) as invalid:
                verify_session_token(tampered)
            self.assertEqual(invalid.exception.status_code, 401)

    def test_session_secret_must_be_configured_and_long_enough(self):
        with patch.dict(os.environ, {**TEST_CONFIG, "FILTROX_SESSION_SECRET": "short"}):
            with self.assertRaises(AuthFailure) as caught:
                create_session_token()
        self.assertEqual(caught.exception.status_code, 503)

    def test_production_requires_secure_cookie(self):
        with patch.dict(os.environ, {**TEST_CONFIG, "FILTROX_ENVIRONMENT": "production", "FILTROX_COOKIE_SECURE": "false"}):
            with self.assertRaises(AuthFailure) as caught:
                create_session_token()
        self.assertEqual(caught.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
