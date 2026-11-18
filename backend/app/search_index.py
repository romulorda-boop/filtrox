from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import time
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

import httpx

from .search import parse_query, search_catalog

_INDEX_UID_DEFAULT = "filtrox_catalog"
_MAX_TOTAL_HITS = 10_000
_SEARCH_BATCH_SIZE = 1_000
_INDEX_BATCH_SIZE = 1_000
_INDEX_UID_RE = re.compile(r"^[A-Za-z0-9_-]{1,400}$")
_WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
_SETTINGS: dict[str, Any] = {
    "searchableAttributes": ["search_tokens"],
    "displayedAttributes": ["id"],
    "filterableAttributes": [],
    "typoTolerance": {"enabled": False},
    "pagination": {"maxTotalHits": _MAX_TOTAL_HITS},
}


class SearchEngineUnavailable(RuntimeError):
    """The required private search index could not be used safely."""


def _configuration() -> tuple[str, str, str]:
    url = os.getenv("MEILI_URL", "").strip().rstrip("/")
    api_key = os.getenv("MEILI_API_KEY", "").strip()
    index_uid = os.getenv("MEILI_INDEX_UID", _INDEX_UID_DEFAULT).strip()
    environment = os.getenv("FILTROX_ENVIRONMENT", "development").strip().casefold()
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").casefold()
    except Exception:
        parsed = None
        host = ""
    local_hosts = {"localhost", "127.0.0.1", "::1", "meilisearch"}
    secure_url = bool(parsed and parsed.scheme == "https" and host and not parsed.username and not parsed.password and parsed.port in (None, 443))
    local_url = bool(parsed and parsed.scheme == "http" and host in local_hosts and parsed.port in (None, 7700) and not parsed.username and not parsed.password)
    if not url or not api_key or len(api_key) < 16 or not _INDEX_UID_RE.fullmatch(index_uid):
        raise SearchEngineUnavailable("Search engine configuration is incomplete")
    if not secure_url and not (environment == "development" and local_url):
        raise SearchEngineUnavailable("Search engine transport must use HTTPS outside local development")
    return url, api_key, index_uid


def _documents(items: Sequence[Mapping[str, Any]], token_secret: bytes) -> list[dict[str, Any]]:
    """Index IDs and opaque token fingerprints; never store source text, URLs, or personal data."""
    documents: list[dict[str, Any]] = []
    for item in items:
        item_id = str(item.get("id") or "").strip()
        if not item_id:
            continue
        tags = item.get("tags") or []
        searchable_text = [str(item.get("title") or ""), *(str(tag) for tag in tags)]
        tokens = {
            hmac.new(token_secret, token.encode("utf-8"), hashlib.sha256).hexdigest()
            for value in searchable_text
            for token in _WORD_RE.findall(value.casefold())
        }
        documents.append({
            "id": item_id,
            "search_tokens": [f"t{token}" for token in sorted(tokens)],
        })
    return documents


def _fingerprint(documents: Sequence[Mapping[str, Any]]) -> str:
    encoded = json.dumps(documents, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _anchor(payload: Mapping[str, Any]) -> str | None:
    """Return one mandatory word as an index accelerator; exact matching stays local."""
    parsed = parse_query(str(payload.get("query") or ""))
    exact_phrases = payload.get("exact_phrases") or []
    if any(str(phrase or "").count('"') % 2 for phrase in exact_phrases):
        raise ValueError("Aspas sem fechamento nas frases exatas.")

    candidates: list[str] = list(parsed.terms)
    for phrase in parsed.phrases:
        candidates.extend(phrase.split())
    for field in ("required_terms", "included_equivalents", "exact_phrases"):
        for raw in payload.get(field) or []:
            candidates.extend(_WORD_RE.findall(str(raw or "").casefold()))
    return candidates[0] if candidates else None


def _token_key(token: str, token_secret: bytes) -> str:
    digest = hmac.new(token_secret, token.casefold().encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t{digest}"


class MeilisearchCatalog:
    """Private Meilisearch index used to narrow candidates before strict local rules."""

    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport
        self._fingerprint: str | None = None
        self._settings_ready = False
        self._lock = asyncio.Lock()

    async def search(
        self,
        items: Sequence[Mapping[str, Any]],
        payload: Mapping[str, Any],
        *,
        watched_ids: Sequence[str] | set[str] = (),
    ) -> dict[str, Any]:
        anchor = _anchor(payload)
        url, api_key, index_uid = _configuration()
        token_secret = api_key.encode("utf-8")
        documents = _documents(items, token_secret)
        fingerprint = _fingerprint(documents)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(10.0, connect=3.0)

        # Keep synchronization and the query under one lock so a refresh cannot
        # replace the index between another request's sync and candidate query.
        async with self._lock:
            try:
                async with httpx.AsyncClient(
                    base_url=url,
                    headers=headers,
                    timeout=timeout,
                    follow_redirects=False,
                    transport=self._transport,
                ) as client:
                    created = await self._ensure_index(client, index_uid)
                    if not self._settings_ready:
                        await self._update_settings(client, index_uid)
                        self._settings_ready = True
                    if fingerprint != self._fingerprint:
                        await self._replace_documents(client, index_uid, documents, created=created)
                        self._fingerprint = fingerprint
                    if anchor is None:
                        candidates = items
                    else:
                        candidate_ids = await self._candidate_ids(client, index_uid, _token_key(anchor, token_secret))
                        # At the configured cap, Meilisearch cannot promise that it
                        # returned every candidate. The full local pass is exact.
                        candidates = items if candidate_ids is None else [
                            item for item in items if str(item.get("id") or "") in candidate_ids
                        ]
                    return search_catalog(candidates, payload, watched_ids=watched_ids)
            except ValueError:
                raise
            except SearchEngineUnavailable:
                raise
            except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                raise SearchEngineUnavailable("Search engine is unavailable") from exc
            except Exception as exc:
                # Do not surface response bodies, credentials, or catalog values.
                raise SearchEngineUnavailable("Search engine is unavailable") from exc

    async def _ensure_index(self, client: httpx.AsyncClient, index_uid: str) -> bool:
        response = await client.get(f"/indexes/{index_uid}")
        if response.status_code == 404:
            created_response = await client.post("/indexes", json={"uid": index_uid, "primaryKey": "id"})
            self._raise_status(created_response)
            created = created_response.json()
            await self._wait_for_task(client, created.get("taskUid"))
            return True
        self._raise_status(response)
        index = response.json()
        if index.get("primaryKey") != "id":
            raise SearchEngineUnavailable("Search index primary key is incompatible")
        return False

    async def _update_settings(self, client: httpx.AsyncClient, index_uid: str) -> None:
        response = await client.patch(f"/indexes/{index_uid}/settings", json=_SETTINGS)
        self._raise_status(response)
        await self._wait_for_task(client, response.json().get("taskUid"))

    async def _replace_documents(
        self,
        client: httpx.AsyncClient,
        index_uid: str,
        documents: list[dict[str, Any]],
        *,
        created: bool,
    ) -> None:
        if not created:
            response = await client.delete(f"/indexes/{index_uid}/documents")
            self._raise_status(response)
            await self._wait_for_task(client, response.json().get("taskUid"))
        for start in range(0, len(documents), _INDEX_BATCH_SIZE):
            batch = documents[start:start + _INDEX_BATCH_SIZE]
            response = await client.post(f"/indexes/{index_uid}/documents", json=batch)
            self._raise_status(response)
            await self._wait_for_task(client, response.json().get("taskUid"))

    async def _candidate_ids(self, client: httpx.AsyncClient, index_uid: str, anchor: str) -> set[str] | None:
        candidate_ids: set[str] = set()
        offset = 0
        total: int | None = None
        while total is None or offset < total:
            response = await client.post(
                f"/indexes/{index_uid}/search",
                json={"q": anchor, "limit": _SEARCH_BATCH_SIZE, "offset": offset},
            )
            self._raise_status(response)
            result = response.json()
            hits = result.get("hits")
            total_hits = result.get("estimatedTotalHits")
            if not isinstance(hits, list) or isinstance(total_hits, bool) or not isinstance(total_hits, int) or total_hits < 0:
                raise SearchEngineUnavailable("Search engine returned an invalid response")
            total = total_hits
            if total >= _MAX_TOTAL_HITS:
                return None
            for hit in hits:
                if not isinstance(hit, dict) or not hit.get("id"):
                    raise SearchEngineUnavailable("Search engine returned an invalid document")
                candidate_ids.add(str(hit["id"]))
            if not hits or len(hits) < _SEARCH_BATCH_SIZE:
                break
            offset += len(hits)
        if total is not None and len(candidate_ids) < total:
            raise SearchEngineUnavailable("Search engine returned incomplete candidates")
        return candidate_ids

    async def _wait_for_task(self, client: httpx.AsyncClient, task_uid: Any) -> None:
        if isinstance(task_uid, bool) or not isinstance(task_uid, int) or task_uid < 0:
            raise SearchEngineUnavailable("Search engine returned an invalid task")
        deadline = time.monotonic() + 60.0
        while time.monotonic() < deadline:
            response = await client.get(f"/tasks/{task_uid}")
            self._raise_status(response)
            task = response.json()
            status = task.get("status")
            if status == "succeeded":
                return
            if status in {"failed", "canceled"}:
                raise SearchEngineUnavailable("Search index update failed")
            await asyncio.sleep(0.1)
        raise SearchEngineUnavailable("Search index update timed out")

    @staticmethod
    def _raise_status(response: httpx.Response) -> None:
        if response.is_error:
            raise SearchEngineUnavailable("Search engine request failed")


_default_catalog = MeilisearchCatalog()


async def search_catalog_indexed(
    items: Sequence[Mapping[str, Any]],
    payload: Mapping[str, Any],
    *,
    watched_ids: Sequence[str] | set[str] = (),
) -> dict[str, Any]:
    return await _default_catalog.search(items, payload, watched_ids=watched_ids)
