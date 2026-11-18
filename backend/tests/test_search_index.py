import hashlib
import hmac
import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.search_index import MeilisearchCatalog, SearchEngineUnavailable, _configuration

BASE_ENV = {
    "FILTROX_ENVIRONMENT": "development",
    "MEILI_URL": "http://127.0.0.1:7700",
    "MEILI_API_KEY": "synthetic-meili-key-for-tests-only",
    "MEILI_INDEX_UID": "filtrox_test_catalog",
}
ITEMS = [
    {"id": "a", "title": "Cafe test room", "tags": ["basic"], "url": "https://xvideos.com/private-a"},
    {"id": "b", "title": "room test", "tags": ["other"], "url": "https://xvideos.com/private-b"},
    {"id": "c", "title": "testroom only", "tags": ["other"], "url": "https://xvideos.com/private-c"},
]


def token_key(token):
    secret = BASE_ENV["MEILI_API_KEY"].encode("utf-8")
    digest = hmac.new(secret, token.casefold().encode("utf-8"), hashlib.sha256).hexdigest()
    return "t" + digest


class MockMeilisearch:
    def __init__(self):
        self.index_exists = False
        self.documents = {}
        self.requests = []
        self.next_task = 1
        self.saturate_search = False

    def transport(self):
        return httpx.MockTransport(self.handle)

    def _task_response(self):
        task_uid = self.next_task
        self.next_task += 1
        return {"taskUid": task_uid}

    def handle(self, request):
        path = request.url.path
        method = request.method
        body = json.loads(request.content) if request.content else None
        self.requests.append((method, path, body))

        if method == "GET" and path == "/indexes/filtrox_test_catalog":
            if not self.index_exists:
                return httpx.Response(404, json={"message": "synthetic missing index"})
            return httpx.Response(200, json={"uid": "filtrox_test_catalog", "primaryKey": "id"})
        if method == "POST" and path == "/indexes":
            self.index_exists = True
            return httpx.Response(202, json=self._task_response())
        if method == "GET" and path.startswith("/tasks/"):
            return httpx.Response(200, json={"status": "succeeded"})
        if method == "PATCH" and path == "/indexes/filtrox_test_catalog/settings":
            return httpx.Response(202, json=self._task_response())
        if method == "DELETE" and path == "/indexes/filtrox_test_catalog/documents":
            self.documents.clear()
            return httpx.Response(202, json=self._task_response())
        if method == "POST" and path == "/indexes/filtrox_test_catalog/documents":
            for document in body:
                self.documents[document["id"]] = document
            return httpx.Response(202, json=self._task_response())
        if method == "POST" and path == "/indexes/filtrox_test_catalog/search":
            if self.saturate_search:
                hits = [{"id": "a"}]
                estimated = 10_000
            else:
                query = body["q"]
                hits = [
                    {"id": item_id}
                    for item_id, document in self.documents.items()
                    if query in document["search_tokens"]
                ]
                estimated = len(hits)
            return httpx.Response(200, json={"hits": hits, "estimatedTotalHits": estimated})
        return httpx.Response(500, json={"message": "synthetic unexpected request"})


class SearchIndexTests(unittest.IsolatedAsyncioTestCase):
    async def test_indexes_opaque_tokens_and_runs_strict_search(self):
        mock = MockMeilisearch()
        engine = MeilisearchCatalog(transport=mock.transport())
        with patch.dict(os.environ, BASE_ENV, clear=True):
            result = await engine.search(ITEMS, {"query": "test"})

        self.assertEqual({item["id"] for item in result["items"]}, {"a", "b"})
        self.assertNotIn("c", {item["id"] for item in result["items"]})
        sent_documents = [body for method, path, body in mock.requests if method == "POST" and path.endswith("/documents")]
        indexed = [document for batch in sent_documents for document in batch]
        self.assertEqual(len(indexed), 3)
        self.assertEqual(set(indexed[0]["search_tokens"]), {token_key("cafe"), token_key("room"), token_key("test"), token_key("basic")})
        self.assertTrue(all(set(document) == {"id", "search_tokens"} for document in indexed))
        search_bodies = [body for method, path, body in mock.requests if path.endswith("/search")]
        self.assertEqual(search_bodies[0]["q"], token_key("test"))
        self.assertEqual(search_bodies[0]["limit"], 1_000)

    async def test_exact_phrase_is_still_checked_by_existing_local_rules(self):
        mock = MockMeilisearch()
        engine = MeilisearchCatalog(transport=mock.transport())
        with patch.dict(os.environ, BASE_ENV, clear=True):
            result = await engine.search(ITEMS, {"query": '"room test"'})
        self.assertEqual([item["id"] for item in result["items"]], ["b"])

    async def test_changed_catalog_clears_old_index_before_reindexing(self):
        mock = MockMeilisearch()
        engine = MeilisearchCatalog(transport=mock.transport())
        with patch.dict(os.environ, BASE_ENV, clear=True):
            await engine.search(ITEMS, {"query": "room"})
            reduced = [item for item in ITEMS if item["id"] != "b"]
            await engine.search(reduced, {"query": "room"})

        self.assertEqual(set(mock.documents), {"a", "c"})
        methods = [(method, path) for method, path, _ in mock.requests]
        delete_position = methods.index(("DELETE", "/indexes/filtrox_test_catalog/documents"))
        latest_add_position = max(i for i, pair in enumerate(methods) if pair == ("POST", "/indexes/filtrox_test_catalog/documents"))
        self.assertLess(delete_position, latest_add_position)

    async def test_search_at_meilisearch_result_cap_falls_back_to_full_exact_scan(self):
        mock = MockMeilisearch()
        mock.saturate_search = True
        engine = MeilisearchCatalog(transport=mock.transport())
        with patch.dict(os.environ, BASE_ENV, clear=True):
            result = await engine.search(ITEMS, {"query": "room"})
        self.assertEqual({item["id"] for item in result["items"]}, {"a", "b"})

    def test_production_rejects_non_tls_meilisearch_url(self):
        environment = {**BASE_ENV, "FILTROX_ENVIRONMENT": "production"}
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaises(SearchEngineUnavailable):
                _configuration()

    def test_missing_meilisearch_configuration_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SearchEngineUnavailable):
                _configuration()


if __name__ == "__main__":
    unittest.main()
