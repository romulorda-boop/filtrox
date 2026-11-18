import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from fastapi import HTTPException

from app.main import SearchRequest, _safe_video_url, app
from app.storage import _ssl_setting


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_health_is_local_and_never_contains_catalog_data(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "mode": "local-prototype"})
        self.assertIn("no-store", response.headers["cache-control"])

    def test_catalog_is_unavailable_until_identity_and_age_providers_are_selected(self):
        keys = [
            "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL", "AGE_ASSURANCE_CLAIM",
            "AGE_ASSURANCE_VALUE", "AGE_ASSURANCE_TIMESTAMP_CLAIM", "AGE_ASSURANCE_MAX_AGE_SECONDS",
            "FILTROX_ALLOWED_SUBJECTS",
        ]
        with patch.dict(os.environ, {key: "" for key in keys}):
            response = self.client.post("/v1/catalog/search", json={"query": "synthetic"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("verificação de idade", response.json()["detail"])
        self.assertEqual(response.headers["cache-control"], "no-store, private, max-age=0")

    def test_declarative_age_checkbox_is_not_a_valid_authentication_mechanism(self):
        with self.assertRaises(ValidationError):
            SearchRequest(ageConfirmed=True)
        response = self.client.post("/v1/catalog/search", json={"ageConfirmed": True})
        self.assertEqual(response.status_code, 503)

    def test_catalog_search_is_post_only(self):
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

    def test_clear_history_endpoint_fails_closed_without_authentication(self):
        keys = [
            "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL", "AGE_ASSURANCE_CLAIM",
            "AGE_ASSURANCE_VALUE", "AGE_ASSURANCE_TIMESTAMP_CLAIM", "AGE_ASSURANCE_MAX_AGE_SECONDS",
            "FILTROX_ALLOWED_SUBJECTS",
        ]
        with patch.dict(os.environ, {key: "" for key in keys}):
            response = self.client.delete("/v1/me/history")
        self.assertEqual(response.status_code, 503)
        self.assertIn("verificação de idade", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
