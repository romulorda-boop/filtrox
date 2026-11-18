import os
import unittest
from unittest.mock import patch

from app.auth import AuthFailure, _verify_age_assurance, verify_bearer_token


class AuthTests(unittest.TestCase):
    def test_missing_provider_fails_closed_before_catalog_access(self):
        keys = [
            "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL", "AGE_ASSURANCE_CLAIM",
            "AGE_ASSURANCE_VALUE", "AGE_ASSURANCE_TIMESTAMP_CLAIM", "AGE_ASSURANCE_MAX_AGE_SECONDS",
            "FILTROX_ALLOWED_SUBJECTS",
        ]
        with patch.dict(os.environ, {key: "" for key in keys}):
            with self.assertRaises(AuthFailure) as caught:
                verify_bearer_token(None)
        self.assertEqual(caught.exception.status_code, 503)

    def test_unconfigured_age_assurance_never_accepts_a_declarative_token(self):
        keys = [
            "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL", "AGE_ASSURANCE_CLAIM",
            "AGE_ASSURANCE_VALUE", "AGE_ASSURANCE_TIMESTAMP_CLAIM", "AGE_ASSURANCE_MAX_AGE_SECONDS",
            "FILTROX_ALLOWED_SUBJECTS",
        ]
        configured = {
            "OIDC_ISSUER": "https://identity.example.invalid",
            "OIDC_AUDIENCE": "filtrox-local",
            "OIDC_JWKS_URL": "https://identity.example.invalid/jwks",
            "AGE_ASSURANCE_CLAIM": "age_over_18",
            "AGE_ASSURANCE_VALUE": "true",
            "AGE_ASSURANCE_TIMESTAMP_CLAIM": "age_verified_at",
            "AGE_ASSURANCE_MAX_AGE_SECONDS": "86400",
            "FILTROX_ALLOWED_SUBJECTS": "owner-subject",
        }
        with patch.dict(os.environ, configured):
            with self.assertRaises(AuthFailure) as caught:
                verify_bearer_token("Bearer ageConfirmed=true")
        self.assertEqual(caught.exception.status_code, 401)

    def test_age_assurance_requires_fresh_signed_timestamp(self):
        config = {
            "age_claim": "age_over_18",
            "age_value": "true",
            "age_timestamp_claim": "age_verified_at",
            "age_max_age_seconds": "3600",
        }
        _verify_age_assurance({"age_over_18": True, "age_verified_at": 99_000}, config, now=100_000)
        for timestamp in (90_000, 100_031, "not-a-time", None, float("nan"), float("inf")):
            with self.subTest(timestamp=timestamp), self.assertRaises(AuthFailure) as caught:
                _verify_age_assurance({"age_over_18": True, "age_verified_at": timestamp}, config, now=100_000)
            self.assertEqual(caught.exception.status_code, 403)

    def test_age_assurance_max_age_configuration_is_bounded(self):
        config = {
            "age_claim": "age_over_18",
            "age_value": "true",
            "age_timestamp_claim": "age_verified_at",
            "age_max_age_seconds": "999999999",
        }
        with self.assertRaises(AuthFailure) as caught:
            _verify_age_assurance({"age_over_18": True, "age_verified_at": 99_999}, config, now=100_000)
        self.assertEqual(caught.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
