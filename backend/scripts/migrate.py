#!/usr/bin/env python3
"""Explicitly apply PostgreSQL migrations; this is never run by the API server."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.migrations import MigrationError, apply_migrations  # noqa: E402
from app.storage import _ssl_setting  # noqa: E402


async def _run() -> tuple[str, ...]:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn.startswith(("postgres://", "postgresql://")):
        raise MigrationError("Defina DATABASE_URL no ambiente antes de executar migrações.")

    try:
        import asyncpg

        connection = await asyncpg.connect(dsn=dsn, ssl=_ssl_setting(dsn), command_timeout=30)
    except Exception as exc:
        raise MigrationError("Não foi possível conectar ao PostgreSQL configurado.") from exc

    try:
        return await apply_migrations(connection)
    finally:
        await connection.close()


def main() -> int:
    try:
        applied = asyncio.run(_run())
    except MigrationError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        # Do not print exception details: driver errors may contain connection metadata.
        print("A migração falhou; os detalhes internos foram omitidos.", file=sys.stderr)
        return 1

    if applied:
        print("Migrações aplicadas: " + ", ".join(applied))
    else:
        print("Schema já está atualizado; nenhuma migração pendente.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
