from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import os
import re
from typing import Any
from urllib.parse import urlparse


_BASE_BLOB_PATH = "/filtroxdata/xvideos_up.csv"
_REMOVAL_BLOB_PATH = "/filtroxdata/xvideos_remove.csv"
_ALLOWED_BLOB_HOST = "filtroxdata.blob.core.windows.net"
_ALLOWED_VIDEO_HOST = "xvideos.com"
_CACHE_KEY = "filtrox:catalog:v4"
_CACHE_TTL_SECONDS = 300
_MAX_XVIDEOS_CSV_BYTES = 64 * 1024 * 1024
_MAX_XVIDEOS_REMOVAL_BYTES = 8 * 1024 * 1024
_MAX_XVIDEOS_ITEMS = 200_000

# xvideos_up.csv has no header; the indices are schema metadata, not catalog contents.
_COLUMNS = {
    "url": 0,
    "title": 1,
    "duration": 2,
    "tags": 5,
    "views": 7,
    "date": 12,
}
_LANGUAGE_MARKERS = {
    "en": {"the", "with", "and", "from", "for", "woman", "women", "man", "men"},
    "es": {"con", "una", "para", "de", "mujer", "mujeres", "hombre", "hombres"},
    "pt": {"com", "uma", "para", "de", "mulher", "mulheres", "homem", "homens"},
    "fr": {"avec", "une", "pour", "des", "femme", "femmes", "homme", "hommes"},
}

_cached_items: list[dict[str, Any]] | None = None
_cached_until = 0.0
_cache_lock = asyncio.Lock()
_redis_client: Any = None


class CatalogUnavailable(RuntimeError):
    pass


def _validate_blob_url(raw: str | None, expected_path: str) -> str:
    if not raw:
        raise CatalogUnavailable("CSV server configuration is missing")
    try:
        parsed = urlparse(str(raw))
        query = dict(part.split("=", 1) if "=" in part else (part, "") for part in parsed.query.split("&") if part)
    except Exception as exc:
        raise CatalogUnavailable("CSV source configuration is invalid") from exc
    if parsed.scheme != "https" or parsed.hostname != _ALLOWED_BLOB_HOST or parsed.path != expected_path:
        raise CatalogUnavailable("CSV source is not allowed")
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise CatalogUnavailable("CSV source is not allowed")
    if query.get("sp") != "r" or query.get("sr") != "b" or not query.get("sig"):
        raise CatalogUnavailable("CSV source must be read-only")
    return str(raw)


async def _limited_download_text(client: Any, url: str, limit: int) -> str:
    chunks: list[bytes] = []
    size = 0
    async with client.stream("GET", url) as response:
        if response.status_code != 200:
            raise CatalogUnavailable("Authorized CSV source is unavailable")
        content_length = response.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > limit:
                    raise CatalogUnavailable("Authorized CSV exceeds the local safety limit")
            except ValueError:
                pass
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit:
                raise CatalogUnavailable("Authorized CSV exceeds the local safety limit")
            chunks.append(chunk)
    try:
        return b"".join(chunks).decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CatalogUnavailable("Authorized CSV encoding is invalid") from exc


def _video_url(value: Any) -> str:
    raw = str(value or "").strip()
    try:
        parsed = urlparse(raw)
    except Exception:
        return ""
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not (host == _ALLOWED_VIDEO_HOST or host.endswith("." + _ALLOWED_VIDEO_HOST)):
        return ""
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        return ""
    return raw


def _url_key(value: Any) -> str:
    safe = _video_url(value)
    if not safe:
        return ""
    parsed = urlparse(safe)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    path = re.sub(r"/+", "/", parsed.path).rstrip("/").casefold()
    return f"{host}{path}"


def _cell(row: list[str], column: int) -> str:
    return row[column].strip() if column < len(row) else ""


def _split_tags(raw: str) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in re.split(r"[|,]", raw):
        tag = value.strip()
        key = tag.casefold()
        if tag and key not in seen:
            seen.add(key)
            result.append(tag)
    return result


def _language_from_tags(tags: list[str]) -> str | None:
    explicit: set[str] = set()
    for tag in tags:
        match = re.fullmatch(r"(?:lang|language)\s*[:=]\s*([a-z]{2,3})", tag.strip(), re.IGNORECASE)
        if match:
            explicit.add(match.group(1).lower())
    if len(explicit) == 1:
        return next(iter(explicit))
    if len(explicit) > 1:
        return None

    scores = {code: 0 for code in _LANGUAGE_MARKERS}
    for tag in tags:
        words = set(re.findall(r"[^\W_]+", tag.casefold(), flags=re.UNICODE))
        for code, markers in _LANGUAGE_MARKERS.items():
            scores[code] += len(words.intersection(markers))
    ranked = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
    if ranked[0][1] >= 2 and ranked[0][1] > ranked[1][1]:
        return ranked[0][0]
    return None


def _country_from_tags(tags: list[str]) -> str | None:
    countries = {
        match.group(1).upper()
        for tag in tags
        if (match := re.fullmatch(r"(?:country|origin)\s*[:=]\s*([a-z]{2})", tag.strip(), re.IGNORECASE))
    }
    return next(iter(countries)) if len(countries) == 1 else None


def build_catalog(base_text: str, removal_text: str) -> list[dict[str, Any]]:
    """Parse synthetic or server-fetched CSV text; remove blocked URLs before deriving facets."""
    try:
        removal_rows = csv.reader(io.StringIO(removal_text), delimiter="|", strict=True)
        removal_keys = {_url_key(_cell(row, 1)) for row in removal_rows if len(row) > 1}
        removal_keys.discard("")
        if not removal_keys:
            raise CatalogUnavailable("The removal list is empty or invalid")

        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in csv.reader(io.StringIO(base_text), delimiter=";", strict=True):
            if not row:
                continue
            url = _video_url(_cell(row, _COLUMNS["url"]))
            key = _url_key(url)
            if not key or key in removal_keys or key in seen:
                continue
            seen.add(key)
            tags = _split_tags(_cell(row, _COLUMNS["tags"]))
            raw_duration = _cell(row, _COLUMNS["duration"])
            duration_match = re.search(r"\d+", raw_duration)
            views_match = re.search(r"\d+", _cell(row, _COLUMNS["views"]).replace(",", ""))
            items.append({
                "id": "xv-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:20],
                "source": "xvideos",
                "source_name": "Xvideos",
                "url": url,
                "title": _cell(row, _COLUMNS["title"]),
                "duration_seconds": int(duration_match.group(0)) if duration_match else None,
                "tags": tags,
                "views": int(views_match.group(0)) if views_match else None,
                "date": _cell(row, _COLUMNS["date"]),
                "language": _language_from_tags(tags),
                "country": _country_from_tags(tags),
            })
            if len(items) > _MAX_XVIDEOS_ITEMS:
                raise CatalogUnavailable("Authorized Xvideos catalog exceeds the local item limit")
        return items
    except CatalogUnavailable:
        raise
    except csv.Error as exc:
        raise CatalogUnavailable("CSV format is invalid") from exc


async def _get_redis() -> Any:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        return None
    try:
        from redis.asyncio import Redis
        _redis_client = Redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=3, socket_timeout=5)
        await _redis_client.ping()
        return _redis_client
    except Exception as exc:
        raise CatalogUnavailable("Catalog cache is unavailable") from exc


async def load_catalog() -> list[dict[str, Any]]:
    """Load authorized Xvideos blobs; keep unvalidated planned sources fail-closed."""
    global _cached_items, _cached_until
    if os.getenv("FILTROX_ENABLE_PORNHUB", "false").casefold() == "true":
        raise CatalogUnavailable("Pornhub ingestion is disabled until its official CSV format and privacy controls are validated")
    redis = await _get_redis()
    if redis is None and os.getenv("FILTROX_ENVIRONMENT", "development").casefold() != "development":
        raise CatalogUnavailable("Shared catalog cache is not configured")

    now = asyncio.get_running_loop().time()
    if redis is None and _cached_items is not None and _cached_until > now:
        return _cached_items

    async with _cache_lock:
        if redis is None and _cached_items is not None and _cached_until > asyncio.get_running_loop().time():
            return _cached_items
        if redis is not None:
            try:
                cached = await redis.get(_CACHE_KEY)
                if cached:
                    return json.loads(cached)
            except Exception as exc:
                raise CatalogUnavailable("Catalog cache is unavailable") from exc

        base_url = _validate_blob_url(os.getenv("CATALOG_CSV_URL"), _BASE_BLOB_PATH)
        removal_url = _validate_blob_url(os.getenv("CATALOG_REMOVAL_CSV_URL"), _REMOVAL_BLOB_PATH)
        try:
            import httpx

            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0), follow_redirects=False) as client:
                base_text, removal_text = await asyncio.gather(
                    _limited_download_text(client, base_url, _MAX_XVIDEOS_CSV_BYTES),
                    _limited_download_text(client, removal_url, _MAX_XVIDEOS_REMOVAL_BYTES),
                )
            items = build_catalog(base_text, removal_text)
        except CatalogUnavailable:
            raise
        except Exception as exc:
            # Deliberately omit exception details, URLs, and row/value data.
            raise CatalogUnavailable("Authorized Xvideos catalog is unavailable") from exc

        if redis is None:
            _cached_items = items
            _cached_until = asyncio.get_running_loop().time() + _CACHE_TTL_SECONDS
        else:
            try:
                await redis.set(_CACHE_KEY, json.dumps(items, ensure_ascii=False, separators=(",", ":")), ex=_CACHE_TTL_SECONDS)
            except Exception as exc:
                raise CatalogUnavailable("Catalog cache is unavailable") from exc
        return items
