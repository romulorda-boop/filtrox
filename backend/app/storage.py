from __future__ import annotations

import asyncio
import os
from typing import Any
from urllib.parse import urlparse


_pool: Any = None
_pool_lock = asyncio.Lock()


class StorageUnavailable(RuntimeError):
    pass


def _ssl_setting(dsn: str) -> str | bool:
    host = (urlparse(dsn).hostname or "").casefold()
    local_hosts = {"localhost", "127.0.0.1", "::1", "postgres", "db"}
    if os.getenv("FILTROX_ENVIRONMENT", "development").casefold() == "development" and host in local_hosts:
        return False
    return "require"


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
            _pool = await asyncpg.create_pool(dsn=dsn, ssl=_ssl_setting(dsn), min_size=1, max_size=8, command_timeout=5)
            return _pool
        except Exception as exc:
            raise StorageUnavailable("Private account storage is unavailable") from exc


async def close_pool() -> None:
    global _pool
    async with _pool_lock:
        if _pool is not None:
            pool, _pool = _pool, None
            await pool.close()


async def watched_ids(actor_id: str) -> set[str]:
    pool = await get_pool()
    try:
        rows = await pool.fetch("SELECT video_id FROM watch_history WHERE actor_id = $1", actor_id)
        return {str(row["video_id"]) for row in rows}
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def list_history(actor_id: str, limit: int = 100) -> list[dict[str, Any]]:
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT video_id, video_url, source, played_at FROM watch_history WHERE actor_id = $1 ORDER BY played_at DESC LIMIT $2",
            actor_id, max(1, min(100, int(limit))),
        )
        return [{"video_id": str(row["video_id"]), "url": str(row["video_url"]), "source": str(row["source"]), "played_at": row["played_at"].isoformat()} for row in rows]
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def record_play(actor_id: str, video_id: str, video_url: str, source: str) -> None:
    pool = await get_pool()
    try:
        await pool.execute(
            "INSERT INTO watch_history (actor_id, video_id, video_url, source, played_at) VALUES ($1, $2, $3, $4, NOW()) "
            "ON CONFLICT (actor_id, video_id) DO UPDATE SET video_url = EXCLUDED.video_url, source = EXCLUDED.source, played_at = NOW()",
            actor_id, video_id, video_url, source,
        )
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def clear_history(actor_id: str) -> None:
    pool = await get_pool()
    try:
        await pool.execute("DELETE FROM watch_history WHERE actor_id = $1", actor_id)
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def list_favorites(actor_id: str, limit: int = 100) -> list[dict[str, Any]]:
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT video_id, video_url, source, created_at FROM favorites WHERE actor_id = $1 ORDER BY created_at DESC LIMIT $2",
            actor_id, max(1, min(100, int(limit))),
        )
        return [{"video_id": str(row["video_id"]), "url": str(row["video_url"]), "source": str(row["source"]), "created_at": row["created_at"].isoformat()} for row in rows]
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc


async def set_favorite(actor_id: str, video_id: str, video_url: str, source: str, enabled: bool) -> None:
    pool = await get_pool()
    try:
        if enabled:
            await pool.execute(
                "INSERT INTO favorites (actor_id, video_id, video_url, source, created_at) VALUES ($1, $2, $3, $4, NOW()) "
                "ON CONFLICT (actor_id, video_id) DO UPDATE SET video_url = EXCLUDED.video_url, source = EXCLUDED.source",
                actor_id, video_id, video_url, source,
            )
        else:
            await pool.execute("DELETE FROM favorites WHERE actor_id = $1 AND video_id = $2", actor_id, video_id)
    except Exception as exc:
        raise StorageUnavailable("Private account storage is unavailable") from exc
