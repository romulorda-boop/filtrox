from __future__ import annotations

import asyncio
import os
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .auth import AuthFailure, Principal, verify_bearer_token
from .catalog import CatalogUnavailable, load_catalog
from .search import search_catalog
from .storage import StorageUnavailable, clear_history, close_pool, list_favorites, list_history, record_play, set_favorite, watched_ids


app = FastAPI(
    title="FILTROX API",
    version="0.1.0-local",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

cors_origins = [value.strip() for value in os.getenv("FILTROX_WEB_ORIGINS", "").split(",") if value.strip()]
if "*" in cors_origins:
    raise RuntimeError("Wildcard CORS origins are not allowed")
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
    )


SortName = Literal["recent", "most_viewed", "views", "newest", "relevance"]


class SortSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: SortName
    direction: Literal["asc", "desc"] = "desc"


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(default="", max_length=2000)
    required_terms: list[str] = Field(default_factory=list, max_length=50)
    optional_terms: list[str] = Field(default_factory=list, max_length=50)
    excluded_terms: list[str] = Field(default_factory=list, max_length=100)
    exact_phrases: list[str] = Field(default_factory=list, max_length=50)
    excluded_phrases: list[str] = Field(default_factory=list, max_length=100)
    included_equivalents: list[str] = Field(default_factory=list, max_length=100)
    excluded_equivalents: list[str] = Field(default_factory=list, max_length=100)
    include_tags: list[str] = Field(default_factory=list, max_length=500)
    exclude_tags: list[str] = Field(default_factory=list, max_length=500)
    language: str | None = Field(default=None, max_length=8)
    country: str | None = Field(default=None, max_length=8)
    hide_watched: bool = False
    sort: SortName | list[SortName | SortSpec] = "recent"
    page: int = Field(default=1, ge=1, le=1_000_000)
    page_size: int = Field(default=30, ge=1, le=30)


class VideoMutation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["xvideos"]
    video_id: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=12, max_length=2048)


class FavoriteMutation(VideoMutation):
    enabled: bool


async def current_principal(authorization: str | None = Header(default=None)) -> Principal:
    try:
        return await asyncio.to_thread(verify_bearer_token, authorization)
    except AuthFailure as error:
        raise HTTPException(status_code=error.status_code, detail=error.public_message) from None


def _safe_video_url(raw: str, source: str) -> str:
    from urllib.parse import urlparse

    try:
        parsed = urlparse(raw)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        allowed = hostname == "xvideos.com" or hostname.endswith(".xvideos.com")
        if source != "xvideos" or parsed.scheme != "https" or not allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError
        return raw
    except Exception:
        raise HTTPException(status_code=422, detail="A URL não pertence à fonte autorizada.") from None


async def _require_catalog_item(video_id: str, url: str, source: str) -> None:
    items = await load_catalog()
    if not any(str(item.get("id")) == video_id and item.get("url") == url and item.get("source") == source for item in items):
        raise HTTPException(status_code=404, detail="O item não pertence ao catálogo autorizado atual.")


@app.middleware("http")
async def private_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, private, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.exception_handler(CatalogUnavailable)
async def catalog_unavailable(_request: Request, _error: CatalogUnavailable):
    return JSONResponse(status_code=503, content={"error": "Catálogo autorizado indisponível."})


@app.exception_handler(StorageUnavailable)
async def storage_unavailable(_request: Request, _error: StorageUnavailable):
    return JSONResponse(status_code=503, content={"error": "Armazenamento privado indisponível."})


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "mode": "local-prototype"}


@app.post("/v1/catalog/search")
async def catalog_search(body: SearchRequest, principal: Principal = Depends(current_principal)) -> dict[str, Any]:
    try:
        items = await load_catalog()
        seen = await watched_ids(principal.actor_id) if body.hide_watched else set()
        result = search_catalog(items, body.model_dump(), watched_ids=seen)
        return result
    except ValueError:
        raise HTTPException(status_code=400, detail="A busca contém aspas sem fechamento.") from None
    except CatalogUnavailable:
        raise
    except StorageUnavailable:
        raise


@app.get("/v1/me/history")
async def get_my_history(principal: Principal = Depends(current_principal)) -> dict[str, Any]:
    return {"items": await list_history(principal.actor_id)}


@app.post("/v1/me/history", status_code=201)
async def add_to_my_history(body: VideoMutation, principal: Principal = Depends(current_principal)) -> dict[str, bool]:
    url = _safe_video_url(body.url, body.source)
    await _require_catalog_item(body.video_id, url, body.source)
    await record_play(principal.actor_id, body.video_id, url, body.source)
    return {"saved": True}


@app.delete("/v1/me/history", status_code=204)
async def delete_my_history(principal: Principal = Depends(current_principal)) -> Response:
    await clear_history(principal.actor_id)
    return Response(status_code=204)


@app.get("/v1/me/favorites")
async def get_my_favorites(principal: Principal = Depends(current_principal)) -> dict[str, Any]:
    return {"items": await list_favorites(principal.actor_id)}


@app.post("/v1/me/favorites")
async def update_my_favorite(body: FavoriteMutation, principal: Principal = Depends(current_principal)) -> dict[str, bool]:
    url = _safe_video_url(body.url, body.source)
    if body.enabled:
        await _require_catalog_item(body.video_id, url, body.source)
    await set_favorite(principal.actor_id, body.video_id, url, body.source, body.enabled)
    return {"saved": body.enabled}


@app.on_event("shutdown")
async def shutdown_storage() -> None:
    await close_pool()
