from __future__ import annotations

import re
from pathlib import Path
from typing import Any


_MIGRATION_NAME = re.compile(r"(?P<version>\d{3,})_[a-z0-9][a-z0-9_]*\.sql\Z")
_LOCK_KEY = 0x46494C54524F58  # "FILTROX"; transaction-scoped PostgreSQL advisory lock.
_MIGRATION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS filtrox_schema_migrations (
    version VARCHAR(128) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""


class MigrationError(RuntimeError):
    """Safe-to-display migration error; intentionally excludes DSNs and SQL parameters."""


def discover_migrations(directory: Path | str | None = None) -> list[tuple[str, Path]]:
    """Return validated SQL migrations in numeric order without connecting to a database."""
    root = Path(directory) if directory is not None else Path(__file__).resolve().parents[1] / "sql"
    if not root.is_dir():
        raise MigrationError("O diretório de migrações não foi encontrado.")

    migrations: list[tuple[int, str, Path]] = []
    seen_versions: set[int] = set()
    for path in root.glob("*.sql"):
        match = _MIGRATION_NAME.fullmatch(path.name)
        if not match:
            raise MigrationError("Há um arquivo SQL com nome de migração inválido.")
        version_text = match.group("version")
        numeric_version = int(version_text)
        if numeric_version in seen_versions:
            raise MigrationError("Há versões de migração duplicadas.")
        seen_versions.add(numeric_version)
        try:
            if not path.read_text(encoding="utf-8").strip():
                raise MigrationError("Uma migração SQL está vazia.")
        except OSError as exc:
            raise MigrationError("Não foi possível ler um arquivo de migração.") from exc
        migrations.append((numeric_version, version_text, path))

    migrations.sort(key=lambda item: item[0])
    return [(version, path) for _, version, path in migrations]


async def apply_migrations(connection: Any, directory: Path | str | None = None) -> tuple[str, ...]:
    """Apply pending migrations on an explicitly supplied PostgreSQL connection.

    This function is never called during application startup. Each migration and its
    ledger entry commit together, and the advisory lock serializes concurrent runners.
    An existing application schema without a migration ledger is rejected rather than
    guessed or modified; it needs a separately reviewed baseline plan.
    """
    migrations = discover_migrations(directory)
    await connection.execute(_MIGRATION_TABLE_SQL)

    has_ledger_entries = await connection.fetchval(
        "SELECT EXISTS (SELECT 1 FROM filtrox_schema_migrations)"
    )
    if not has_ledger_entries:
        has_application_tables = await connection.fetchval(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = current_schema() "
            "AND table_name IN ('watch_history', 'favorites', 'tag_equivalences', 'filtrox_admin_credentials'))"
        )
        if has_application_tables:
            raise MigrationError(
                "O banco já tem tabelas FILTROX sem histórico de migrações; "
                "é necessário revisar um plano de baseline antes de alterar o schema."
            )

    applied: list[str] = []
    for version, path in migrations:
        sql = path.read_text(encoding="utf-8")
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEY)
            exists = await connection.fetchval(
                "SELECT EXISTS (SELECT 1 FROM filtrox_schema_migrations WHERE version = $1)",
                version,
            )
            if exists:
                continue
            await connection.execute(sql)
            await connection.execute(
                "INSERT INTO filtrox_schema_migrations (version) VALUES ($1)",
                version,
            )
            applied.append(version)
    return tuple(applied)
