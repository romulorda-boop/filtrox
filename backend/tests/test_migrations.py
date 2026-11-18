import asyncio
import tempfile
import unittest
from pathlib import Path

from app.migrations import MigrationError, apply_migrations, discover_migrations


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class SyntheticMigrationConnection:
    def __init__(self, *, existing_schema=False):
        self.versions = set()
        self.existing_schema = existing_schema
        self.executed_sql = []
        self.transactions = 0

    async def execute(self, query, *args):
        normalized = " ".join(query.split())
        if normalized.startswith("CREATE TABLE IF NOT EXISTS filtrox_schema_migrations"):
            self.executed_sql.append(normalized)
        elif normalized.startswith("SELECT pg_advisory_xact_lock"):
            self.executed_sql.append(normalized)
        elif normalized.startswith("INSERT INTO filtrox_schema_migrations"):
            self.versions.add(args[0])
        else:
            self.executed_sql.append(query)

    async def fetchval(self, query, *args):
        normalized = " ".join(query.split())
        if "FROM filtrox_schema_migrations)" in normalized:
            return bool(self.versions)
        if "FROM information_schema.tables" in normalized:
            return self.existing_schema
        if "WHERE version = $1" in normalized:
            return args[0] in self.versions
        raise AssertionError(f"Unexpected synthetic query: {normalized}")

    def transaction(self):
        self.transactions += 1
        return FakeTransaction()


class MigrationTests(unittest.TestCase):
    def test_repository_contains_valid_initial_schema_migration(self):
        migrations = discover_migrations()
        self.assertTrue(migrations)
        self.assertEqual(migrations[0][0], "001")
        sql = migrations[0][1].read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS watch_history", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS favorites", sql)
        self.assertIn("PRIMARY KEY (actor_id, video_id)", sql)

    def test_admin_password_migration_stores_only_a_singleton_hash(self):
        migrations = discover_migrations()
        self.assertEqual(migrations[-1][0], "002")
        sql = migrations[-1][1].read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS filtrox_admin_credentials", sql)
        self.assertIn("CHECK (account_key = 'owner')", sql)
        self.assertIn("password_hash TEXT NOT NULL", sql)
        self.assertNotIn("password TEXT", sql)
        self.assertNotIn("INSERT INTO", sql)

    def test_discovery_sorts_numerically_and_rejects_bad_or_duplicate_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "010_later.sql").write_text("SELECT 10;", encoding="utf-8")
            (root / "002_earlier.sql").write_text("SELECT 2;", encoding="utf-8")
            self.assertEqual([version for version, _ in discover_migrations(root)], ["002", "010"])

            (root / "bad-name.sql").write_text("SELECT 1;", encoding="utf-8")
            with self.assertRaises(MigrationError):
                discover_migrations(root)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "001_first.sql").write_text("SELECT 1;", encoding="utf-8")
            (root / "001_second.sql").write_text("SELECT 2;", encoding="utf-8")
            with self.assertRaises(MigrationError):
                discover_migrations(root)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "001_first.sql").write_text("SELECT 1;", encoding="utf-8")
            (root / "0001_same_number.sql").write_text("SELECT 2;", encoding="utf-8")
            with self.assertRaises(MigrationError):
                discover_migrations(root)

    def test_migrations_apply_once_transactionally_and_are_safe_to_rerun(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "001_initial.sql").write_text("CREATE TABLE synthetic_one;", encoding="utf-8")
            (root / "002_next.sql").write_text("CREATE TABLE synthetic_two;", encoding="utf-8")
            connection = SyntheticMigrationConnection()

            first = asyncio.run(apply_migrations(connection, root))
            second = asyncio.run(apply_migrations(connection, root))

        self.assertEqual(first, ("001", "002"))
        self.assertEqual(second, ())
        self.assertEqual(connection.versions, {"001", "002"})
        self.assertEqual(connection.transactions, 4)
        self.assertEqual(sum("CREATE TABLE synthetic_one" in sql for sql in connection.executed_sql), 1)
        self.assertEqual(sum("CREATE TABLE synthetic_two" in sql for sql in connection.executed_sql), 1)
        self.assertTrue(any("pg_advisory_xact_lock" in sql for sql in connection.executed_sql))

    def test_unversioned_existing_application_schema_is_not_modified(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "001_initial.sql").write_text("CREATE TABLE synthetic_one;", encoding="utf-8")
            connection = SyntheticMigrationConnection(existing_schema=True)
            with self.assertRaises(MigrationError):
                asyncio.run(apply_migrations(connection, root))

        self.assertFalse(any("CREATE TABLE synthetic_one" in sql for sql in connection.executed_sql))
        self.assertEqual(connection.versions, set())


if __name__ == "__main__":
    unittest.main()
