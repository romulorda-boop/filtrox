from __future__ import annotations

import asyncio
import hmac
import os
import re
from typing import Any
from urllib.parse import urlparse

from .models import FavoriteItem, HistoryItem


_pool: Any = None
_pool_lock = asyncio.Lock()
_ACTOR_ID = re.compile(r"[0-9a-f]{64}\Z")
_ADMIN_ACCOUNT_KEY = "owner"
_ADMIN_CREDENTIAL_LOCK_KEY = 0x46494C54524F59


class StorageUnavailable(RuntimeError):
    pass


def _ssl_setting(dsn: str) -> str | bool:
    host = (urlparse(dsn).hostname or "").casefold()
    local_hosts = {"localhost", "127.0.0.1", "::1", "postgres", "db"}
    if os.getenv("FILTROX_ENVIRONMENT", "development").casefold() == "development" and host in local_hosts:
        return False
    return "require"


def _validate_actor_id(actor_id: str) -> str:
    # The authentication layer derives this stable key from the one configured admin email.
    # Never accept a client-supplied account identifier for history or favorites.
    if not isinstance(actor_id, str) or not _ACTOR_ID.fullmatch(actor_id):
        raise ValueError("Identificador privado de conta inválido.")
    return actor_id


async def get_pool() -> Any:
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is not None:
            return _pool
        dsn = os.getenv("DATABASE_URL", "").strip()
        if not dsn or not dsn.startswith(("postgres://", "postgresql://")):
            raise StorageUnavailable("Private account storage is not configured")
        try:
            import asyncpg

            _pool = await asyncpg.create_pool(
                dsn=dsn,
                ssl=_ssl_setting(dsn),
                min_size=1,
                max_size=8,
                command_timeout=5,
            )
            return _pool
        except Exception as exc:
            # Keep connection details out of public API errors.
            raise StorageUnavailable("Private account storage is unavailable") from exc


async def close_pool() -> None:
    global _pool
    async with _pool_lock:
        if _pool is not None:
            pool, _pool = _pool, None
            await pool.close()


async def get_admin_password_hash(initial_password_hash: str) -> str:
    """Read the persisted admin hash, or use the bootstrap hash before DB setup."""
    if not os.getenv("DATABASE_URL", "").strip():
        return initial_password_hash
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "SELECT password_hash FROM filtrox_admin_credentials WHERE account_key = $1",
            _ADMIN_ACCOUNT_KEY,
        )
        return str(row["password_hash"]) if row is not None else initial_password_hash
    except Exception as exc:
        raise StorageUnavailable("Private administrator credentials are unavailable") from exc


async def store_admin_password_hash(
    expected_password_hash: str,
    new_password_hash: str,
    initial_password_hash: str,
) -> bool:
    """Atomically replace the one admin hash, initializing it from server config if needed."""
    if not os.getenv("DATABASE_URL", "").strip():
        raise StorageUnavailable("Private administrator credential storage is not configured")
    pool = await get_pool()
    try:
        async with pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute("SELECT pg_advisory_xact_lock($1)", _ADMIN_CREDENTIAL_LOCK_KEY)
                row = await connection.fetchrow(
                    "SELECT password_hash FROM filtrox_admin_credentials WHERE account_key = $1 FOR UPDATE",
                    _ADMIN_ACCOUNT_KEY,
                )
                current_password_hash = str(row["password_hash"]) if row is not None else initial_password_hash
                if not hmac.compare_digest(
                    current_password_hash.encode("utf-8"), expected_password_hash.encode("utf-8")
                ):
                    return False
                if row is None:
                    await connection.execute(
                        "INSERT INTO filtrox_admin_credentials (account_key, password_hash, updated_at) "
                        "VALUES ($1, $2, NOW())",
                        _ADMIN_ACCOUNT_KEY,
                        new_password_hash,
                    )
                else:
                    await connection.execute(
                        "UPDATE filtrox_admin_credentials SET password_hash = $2, updated_at = NOW() "
                        "WHERE account_key = $1",
                        _ADMIN_ACCOUNT_KEY,
                        new_password_hash,
                    )
                return True
    except Exception as exc:
        raise StorageUnavailable("Private administrator credentials are unavailable") from exc


async def watched_ids(actor_id: str) -> set[str]:
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT video_id FROM watch_history WHERE actor_id = $1",
            actor_id,
        )
        return {str(row["video_id"]).strip() for row in rows}
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def list_history(actor_id: str, limit: int = 100) -> list[dict[str, str]]:
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT video_id, video_url, source, played_at "
            "FROM watch_history WHERE actor_id = $1 ORDER BY played_at DESC LIMIT $2",
            actor_id,
            max(1, min(100, int(limit))),
        )
        return [HistoryItem.from_row(row).as_dict() for row in rows]
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def export_history(actor_id: str) -> list[dict[str, str]]:
    """Read every history row for the authenticated account for a private export."""
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT video_id, video_url, source, played_at "
            "FROM watch_history WHERE actor_id = $1 ORDER BY played_at DESC",
            actor_id,
        )
        return [HistoryItem.from_row(row).as_dict() for row in rows]
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def record_play(actor_id: str, video_id: str, video_url: str, source: str) -> None:
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        await pool.execute(
            "INSERT INTO watch_history (actor_id, video_id, video_url, source, played_at) "
            "VALUES ($1, $2, $3, $4, NOW()) "
            "ON CONFLICT (actor_id, video_id) DO UPDATE "
            "SET video_url = EXCLUDED.video_url, source = EXCLUDED.source, played_at = NOW()",
            actor_id,
            video_id,
            video_url,
            source,
        )
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def clear_history(actor_id: str) -> None:
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        await pool.execute(
            "DELETE FROM watch_history WHERE actor_id = $1",
            actor_id,
        )
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def list_favorites(actor_id: str, limit: int = 100) -> list[dict[str, str]]:
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT video_id, video_url, source, created_at "
            "FROM favorites WHERE actor_id = $1 ORDER BY created_at DESC LIMIT $2",
            actor_id,
            max(1, min(100, int(limit))),
        )
        return [FavoriteItem.from_row(row).as_dict() for row in rows]
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def export_favorites(actor_id: str) -> list[dict[str, str]]:
    """Read every favorite row for the authenticated account for a private export."""
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT video_id, video_url, source, created_at "
            "FROM favorites WHERE actor_id = $1 ORDER BY created_at DESC",
            actor_id,
        )
        return [FavoriteItem.from_row(row).as_dict() for row in rows]
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def set_favorite(
    actor_id: str,
    video_id: str,
    video_url: str,
    source: str,
    enabled: bool,
) -> None:
    actor_id = _validate_actor_id(actor_id)
    pool = await get_pool()
    try:
        if enabled:
            await pool.execute(
                "INSERT INTO favorites (actor_id, video_id, video_url, source, created_at) "
                "VALUES ($1, $2, $3, $4, NOW()) "
                "ON CONFLICT (actor_id, video_id) DO UPDATE "
                "SET video_url = EXCLUDED.video_url, source = EXCLUDED.source",
                actor_id,
                video_id,
                video_url,
                source,
            )
        else:
            await pool.execute(
                "DELETE FROM favorites WHERE actor_id = $1 AND video_id = $2",
                actor_id,
                video_id,
            )
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc
