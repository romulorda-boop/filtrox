from __future__ import annotations

import asyncio
import csv
import io
import json
import os
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from starlette.background import BackgroundTask

from .backup import (
    BackupError,
    EncryptedBackupStream,
    _close_configuration,
    backup_filename,
    load_configuration,
)
from .auth import (
    SESSION_COOKIE_NAME,
    AuthFailure,
    Principal,
    cookie_secure_enabled,
    configured_password_hash,
    create_session_token,
    hash_password,
    refresh_session_token,
    verify_credentials,
    verify_password_hash,
    verify_session_token,
)
from .catalog import CatalogUnavailable, load_catalog
from .search_index import SearchEngineUnavailable, search_catalog_indexed
from .storage import (
    StorageUnavailable,
    clear_history,
    close_pool,
    export_favorites,
    export_history,
    get_admin_password_hash,
    list_favorites,
    list_history,
    record_play,
    set_favorite,
    store_admin_password_hash,
    watched_ids,
)


_WEB_RESTORE_DISABLED_MESSAGE = (
    "A restauração permanece bloqueada até haver um fluxo validado para enviar o arquivo local, "
    "descriptografá-lo com a chave privada local e baixar/guardar o backup pré-restauração local."
)


app = FastAPI(
    title="FILTROX API",
    version="0.2.0-local",
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
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
        allow_credentials=True,
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
    include_tags_mode: Literal["and", "or"] = "and"
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


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=12, max_length=1024)


class BackupRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: StrictStr = Field(min_length=1, max_length=128)
    confirmation: StrictStr = Field(min_length=1, max_length=256)


@app.middleware("http")
async def private_access_and_headers(request: Request, call_next):
    # Only the explicit login and logout handlers are public. There is intentionally no signup route.
    public_auth_routes = {("POST", "/auth/login"), ("POST", "/auth/logout")}
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if (request.method.upper(), request.url.path) not in public_auth_routes:
        try:
            principal = await asyncio.to_thread(verify_session_token, session_token)
        except AuthFailure as error:
            response = JSONResponse(status_code=error.status_code, content={"detail": error.public_message})
            response.headers["Cache-Control"] = "no-store, private, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
            return response
        request.state.principal = principal

    response = await call_next(request)
    if (request.method.upper(), request.url.path) not in public_auth_routes:
        refreshed_token, ttl, secure = await asyncio.to_thread(refresh_session_token, session_token)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=refreshed_token,
            max_age=ttl,
            path="/",
            secure=secure,
            httponly=True,
            samesite="strict",
        )
    response.headers["Cache-Control"] = "no-store, private, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


def current_principal(request: Request) -> Principal:
    principal = getattr(request.state, "principal", None)
    if not isinstance(principal, Principal):
        raise HTTPException(status_code=401, detail="Autenticação necessária.")
    return principal


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


@app.exception_handler(CatalogUnavailable)
async def catalog_unavailable(_request: Request, _error: CatalogUnavailable):
    return JSONResponse(status_code=503, content={"error": "Catálogo autorizado indisponível."})


@app.exception_handler(StorageUnavailable)
async def storage_unavailable(_request: Request, _error: StorageUnavailable):
    return JSONResponse(status_code=503, content={"error": "Armazenamento privado indisponível."})


@app.exception_handler(SearchEngineUnavailable)
async def search_engine_unavailable(_request: Request, _error: SearchEngineUnavailable):
    return JSONResponse(status_code=503, content={"error": "Serviço de busca indisponível."})


@app.post("/auth/login")
async def login(body: LoginRequest) -> Response:
    try:
        initial_password_hash = configured_password_hash()
        active_password_hash = await get_admin_password_hash(initial_password_hash)
        await asyncio.to_thread(
            verify_credentials,
            body.email,
            body.password,
            password_hash=active_password_hash,
        )
        token, ttl, secure = create_session_token()
    except AuthFailure as error:
        response = JSONResponse(status_code=error.status_code, content={"detail": error.public_message})
        response.headers["Cache-Control"] = "no-store, private, max-age=0"
        return response

    response = JSONResponse({"authenticated": True})
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=ttl,
        path="/",
        secure=secure,
        httponly=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store, private, max-age=0"
    return response


@app.post("/v1/me/password")
async def change_my_password(
    body: PasswordChangeRequest,
    _principal: Principal = Depends(current_principal),
) -> dict[str, bool]:
    try:
        initial_password_hash = configured_password_hash()
        active_password_hash = await get_admin_password_hash(initial_password_hash)
        current_password_ok = await asyncio.to_thread(
            verify_password_hash, body.current_password, active_password_hash
        )
        if not current_password_ok:
            raise HTTPException(status_code=401, detail="A senha atual está incorreta.")
        if body.current_password == body.new_password:
            raise HTTPException(status_code=422, detail="A nova senha deve ser diferente da senha atual.")

        new_password_hash = await asyncio.to_thread(hash_password, body.new_password)
        changed = await store_admin_password_hash(
            active_password_hash,
            new_password_hash,
            initial_password_hash,
        )
    except AuthFailure as error:
        raise HTTPException(status_code=error.status_code, detail=error.public_message) from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None

    if not changed:
        raise HTTPException(
            status_code=409,
            detail="A senha foi alterada em outra sessão. Atualize e tente novamente.",
        )
    return {"changed": True}


@app.post("/auth/logout")
async def logout() -> Response:
    response = JSONResponse({"authenticated": False})
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=cookie_secure_enabled(),
        httponly=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store, private, max-age=0"
    return response


@app.get("/healthz")
async def healthz(_principal: Principal = Depends(current_principal)) -> dict[str, str]:
    return {"status": "ok", "mode": "local-prototype"}


@app.get("/v1/admin/backups")
def get_admin_backups(_principal: Principal = Depends(current_principal)) -> dict[str, Any]:
    try:
        config = load_configuration()
    except BackupError as error:
        return {
            "download_available": False,
            "restore_available": False,
            "message": str(error),
            "restore_message": _WEB_RESTORE_DISABLED_MESSAGE,
        }
    _close_configuration(config)
    return {
        "download_available": True,
        "restore_available": False,
        "message": "A exportação é manual: o dump passa diretamente por age e é baixado pelo navegador; o backend não cria nem retém arquivos de backup.",
        "restore_message": _WEB_RESTORE_DISABLED_MESSAGE,
    }


@app.get("/v1/admin/backups/download")
def download_admin_backup(
    _principal: Principal = Depends(current_principal),
) -> StreamingResponse:
    config = None
    try:
        config = load_configuration()
        stream = EncryptedBackupStream(config)
    except BackupError as error:
        if config is not None:
            _close_configuration(config)
        raise HTTPException(status_code=503, detail=str(error)) from None
    except Exception:
        if config is not None:
            _close_configuration(config)
        raise HTTPException(status_code=503, detail="Não foi possível iniciar a exportação criptografada.") from None

    return StreamingResponse(
        stream,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{backup_filename()}"',
            "Cache-Control": "no-store, private, max-age=0",
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(stream.close),
    )


@app.post("/v1/admin/backups/restore")
def restore_admin_backup(
    _body: BackupRestoreRequest,
    _principal: Principal = Depends(current_principal),
) -> None:
    # Never enable this through an environment flag: local-file upload/decryption and
    # local retention of a pre-restore backup have not been implemented or validated.
    raise HTTPException(status_code=503, detail=_WEB_RESTORE_DISABLED_MESSAGE)


@app.post("/v1/catalog/search")
async def catalog_search(body: SearchRequest, principal: Principal = Depends(current_principal)) -> dict[str, Any]:
    try:
        items = await load_catalog()
        seen = await watched_ids(principal.actor_id) if body.hide_watched else set()
        result = await search_catalog_indexed(items, body.model_dump(), watched_ids=seen)
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


def _export_response(collection: Literal["history", "favorites"], items: list[dict[str, Any]], output_format: Literal["csv", "json"]) -> Response:
    fields = (
        ("video_id", "url", "source", "played_at")
        if collection == "history"
        else ("video_id", "url", "source", "created_at")
    )
    safe_items = [{field: item.get(field, "") for field in fields} for item in items]
    extension = output_format
    headers = {"Content-Disposition": f'attachment; filename="filtrox-{collection}.{extension}"'}
    if output_format == "json":
        return Response(
            content=json.dumps({"items": safe_items}, ensure_ascii=False, separators=(",", ":")),
            media_type="application/json",
            headers=headers,
        )

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(fields)
    for item in safe_items:
        row = []
        for field in fields:
            value = "" if item[field] is None else str(item[field])
            significant = value.lstrip(" \t\r\n")
            if significant.startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            row.append(value)
        writer.writerow(row)
    return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8", headers=headers)


@app.get("/v1/me/history/export")
async def export_my_history(
    format: Literal["csv", "json"] = "json",
    principal: Principal = Depends(current_principal),
) -> Response:
    return _export_response("history", await export_history(principal.actor_id), format)


@app.post("/v1/me/history", status_code=201)
async def add_to_my_history(body: VideoMutation, principal: Principal = Depends(current_principal)) -> dict[str, bool]:
    url = _safe_video_url(body.url, body.source)
    await _require_catalog_item(body.video_id, url, body.source)
    await record_play(principal.actor_id, body.video_id, url, body.source)
    return {"saved": True}


@app.delete("/v1/me/history", status_code=204)
async def delete_my_history(_principal: Principal = Depends(current_principal)) -> Response:
    await clear_history(_principal.actor_id)
    return Response(status_code=204)


@app.get("/v1/me/favorites")
async def get_my_favorites(principal: Principal = Depends(current_principal)) -> dict[str, Any]:
    return {"items": await list_favorites(principal.actor_id)}


@app.get("/v1/me/favorites/export")
async def export_my_favorites(
    format: Literal["csv", "json"] = "json",
    principal: Principal = Depends(current_principal),
) -> Response:
    return _export_response("favorites", await export_favorites(principal.actor_id), format)


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
