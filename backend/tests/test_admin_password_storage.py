import os
import unittest
from unittest.mock import AsyncMock, patch

from app.auth import hash_password, verify_password_hash
from app.storage import StorageUnavailable, get_admin_password_hash, store_admin_password_hash


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class SyntheticCredentialConnection:
    def __init__(self, password_hash=None):
        self.row = {"password_hash": password_hash} if password_hash is not None else None
        self.executed = []

    def transaction(self):
        return FakeTransaction()

    async def fetchrow(self, query, *args):
        self.executed.append((query, args))
        if "FROM filtrox_admin_credentials" not in query:
            raise AssertionError("Unexpected synthetic credential query")
        return dict(self.row) if self.row is not None else None

    async def execute(self, query, *args):
        self.executed.append((query, args))
        if "pg_advisory_xact_lock" in query:
            return "SELECT 1"
        if query.startswith("INSERT INTO filtrox_admin_credentials"):
            self.row = {"password_hash": args[1]}
            return "INSERT 0 1"
        if query.startswith("UPDATE filtrox_admin_credentials"):
            self.row = {"password_hash": args[1]}
            return "UPDATE 1"
        raise AssertionError("Unexpected synthetic credential write")


class SyntheticAcquire:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class SyntheticCredentialPool:
    def __init__(self, connection):
        self.connection = connection

    async def fetchrow(self, query, *args):
        return await self.connection.fetchrow(query, *args)

    def acquire(self):
        return SyntheticAcquire(self.connection)


class AdminPasswordStorageTests(unittest.IsolatedAsyncioTestCase):
    async def test_unconfigured_database_uses_only_bootstrap_hash_and_disables_change(self):
        initial_hash = hash_password("synthetic-bootstrap-password", iterations=100_000, salt=b"synthetic-salt-001")
        with patch.dict(os.environ, {"DATABASE_URL": ""}), patch("app.storage.get_pool", new=AsyncMock()) as get_pool:
            self.assertEqual(await get_admin_password_hash(initial_hash), initial_hash)
            with self.assertRaises(StorageUnavailable):
                await store_admin_password_hash(initial_hash, "synthetic-new-hash", initial_hash)
        get_pool.assert_not_awaited()

    async def test_read_returns_saved_hash_or_bootstrap_hash_when_row_is_absent(self):
        initial_hash = hash_password("synthetic-bootstrap-password", iterations=100_000, salt=b"synthetic-salt-002")
        saved_hash = hash_password("synthetic-saved-password", iterations=100_000, salt=b"synthetic-salt-003")
        connection = SyntheticCredentialConnection(saved_hash)
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic.invalid/filtrox"}), patch(
            "app.storage.get_pool", new=AsyncMock(return_value=SyntheticCredentialPool(connection))
        ):
            self.assertEqual(await get_admin_password_hash(initial_hash), saved_hash)
            connection.row = None
            self.assertEqual(await get_admin_password_hash(initial_hash), initial_hash)
        self.assertTrue(all("password_hash" in query for query, _args in connection.executed))

    async def test_store_initializes_single_admin_row_with_only_the_hash(self):
        initial_hash = hash_password("synthetic-bootstrap-password", iterations=100_000, salt=b"synthetic-salt-004")
        new_hash = hash_password("synthetic-new-password", iterations=100_000, salt=b"synthetic-salt-005")
        connection = SyntheticCredentialConnection()
        pool = SyntheticCredentialPool(connection)
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic.invalid/filtrox"}), patch(
            "app.storage.get_pool", new=AsyncMock(return_value=pool)
        ):
            changed = await store_admin_password_hash(initial_hash, new_hash, initial_hash)

        self.assertTrue(changed)
        self.assertEqual(connection.row, {"password_hash": new_hash})
        self.assertTrue(verify_password_hash("synthetic-new-password", connection.row["password_hash"]))
        self.assertFalse(verify_password_hash("synthetic-bootstrap-password", connection.row["password_hash"]))
        insert = next(item for item in connection.executed if item[0].startswith("INSERT INTO filtrox_admin_credentials"))
        self.assertEqual(insert[1], ("owner", new_hash))
        self.assertNotIn("synthetic-new-password", repr(connection.executed))
        self.assertNotIn("synthetic-bootstrap-password", repr(connection.executed))
        self.assertTrue(any("pg_advisory_xact_lock" in query for query, _args in connection.executed))

    async def test_store_updates_an_existing_hash_without_persisting_plaintext(self):
        old_hash = hash_password("synthetic-old-password", iterations=100_000, salt=b"synthetic-salt-009")
        new_hash = hash_password("synthetic-new-password", iterations=100_000, salt=b"synthetic-salt-010")
        connection = SyntheticCredentialConnection(old_hash)
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic.invalid/filtrox"}), patch(
            "app.storage.get_pool", new=AsyncMock(return_value=SyntheticCredentialPool(connection))
        ):
            changed = await store_admin_password_hash(old_hash, new_hash, old_hash)

        self.assertTrue(changed)
        self.assertEqual(connection.row, {"password_hash": new_hash})
        update = next(item for item in connection.executed if item[0].startswith("UPDATE filtrox_admin_credentials"))
        self.assertEqual(update[1], ("owner", new_hash))
        self.assertNotIn("synthetic-new-password", repr(connection.executed))

    async def test_store_refuses_to_overwrite_when_active_hash_changed_concurrently(self):
        old_hash = hash_password("synthetic-bootstrap-password", iterations=100_000, salt=b"synthetic-salt-006")
        concurrent_hash = hash_password("synthetic-concurrent-password", iterations=100_000, salt=b"synthetic-salt-007")
        new_hash = hash_password("synthetic-new-password", iterations=100_000, salt=b"synthetic-salt-008")
        connection = SyntheticCredentialConnection(concurrent_hash)
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://synthetic.invalid/filtrox"}), patch(
            "app.storage.get_pool", new=AsyncMock(return_value=SyntheticCredentialPool(connection))
        ):
            changed = await store_admin_password_hash(old_hash, new_hash, old_hash)

        self.assertFalse(changed)
        self.assertEqual(connection.row, {"password_hash": concurrent_hash})
        self.assertFalse(any(query.startswith("UPDATE filtrox_admin_credentials") for query, _args in connection.executed))


if __name__ == "__main__":
    unittest.main()
