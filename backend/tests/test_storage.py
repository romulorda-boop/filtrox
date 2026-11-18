import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.models import FavoriteItem, HistoryItem
from app.storage import (
    clear_history,
    export_favorites,
    export_history,
    list_favorites,
    list_history,
    record_play,
    set_favorite,
    watched_ids,
)


OWNER_ID = "a" * 64
SYNTHETIC_TIME = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class SyntheticPool:
    def __init__(self):
        self.fetch_calls = []
        self.execute_calls = []

    async def fetch(self, query, *args):
        self.fetch_calls.append((query, args))
        if "SELECT video_id FROM watch_history" in query:
            return [{"video_id": "synthetic-1"}, {"video_id": "synthetic-2"}]
        if "FROM watch_history" in query:
            return [{
                "video_id": "synthetic-1",
                "video_url": "https://www.xvideos.com/video.synthetic-1",
                "source": "xvideos",
                "played_at": SYNTHETIC_TIME,
            }]
        if "FROM favorites" in query:
            return [{
                "video_id": "synthetic-2",
                "video_url": "https://www.xvideos.com/video.synthetic-2",
                "source": "xvideos",
                "created_at": SYNTHETIC_TIME,
            }]
        raise AssertionError("Unexpected synthetic query")

    async def execute(self, query, *args):
        self.execute_calls.append((query, args))


class StorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.pool = SyntheticPool()
        self.get_pool = patch("app.storage.get_pool", new=AsyncMock(return_value=self.pool))
        self.get_pool.start()
        self.addCleanup(self.get_pool.stop)

    async def test_history_and_favorite_models_keep_public_api_shape(self):
        history = await list_history(OWNER_ID)
        favorites = await list_favorites(OWNER_ID)

        self.assertEqual(history, [{
            "video_id": "synthetic-1",
            "url": "https://www.xvideos.com/video.synthetic-1",
            "source": "xvideos",
            "played_at": "2026-01-02T03:04:05+00:00",
        }])
        self.assertEqual(favorites, [{
            "video_id": "synthetic-2",
            "url": "https://www.xvideos.com/video.synthetic-2",
            "source": "xvideos",
            "created_at": "2026-01-02T03:04:05+00:00",
        }])
        self.assertIsInstance(HistoryItem.from_row({
            "video_id": "synthetic-1", "video_url": "https://example.test", "played_at": SYNTHETIC_TIME,
        }), HistoryItem)
        self.assertIsInstance(FavoriteItem.from_row({
            "video_id": "synthetic-2", "video_url": "https://example.test", "created_at": SYNTHETIC_TIME,
        }), FavoriteItem)

    async def test_reads_are_account_scoped_and_history_limit_is_bounded(self):
        self.assertEqual(await watched_ids(OWNER_ID), {"synthetic-1", "synthetic-2"})
        await list_history(OWNER_ID, limit=10_000)
        await list_favorites(OWNER_ID, limit=0)

        self.assertEqual(len(self.pool.fetch_calls), 3)
        for query, args in self.pool.fetch_calls:
            self.assertIn("WHERE actor_id = $1", query)
            self.assertEqual(args[0], OWNER_ID)
        self.assertEqual(self.pool.fetch_calls[1][1], (OWNER_ID, 100))
        self.assertEqual(self.pool.fetch_calls[2][1], (OWNER_ID, 1))

    async def test_exports_read_all_rows_with_actor_scope_and_no_ui_limit(self):
        history = await export_history(OWNER_ID)
        favorites = await export_favorites(OWNER_ID)

        self.assertEqual(history[0]["video_id"], "synthetic-1")
        self.assertEqual(favorites[0]["video_id"], "synthetic-2")
        history_query, favorite_query = self.pool.fetch_calls
        self.assertIn("WHERE actor_id = $1", history_query[0])
        self.assertIn("WHERE actor_id = $1", favorite_query[0])
        self.assertNotIn("LIMIT", history_query[0].upper())
        self.assertNotIn("LIMIT", favorite_query[0].upper())
        self.assertEqual(history_query[1], (OWNER_ID,))
        self.assertEqual(favorite_query[1], (OWNER_ID,))

    async def test_mutations_always_scope_rows_to_the_authenticated_account(self):
        await record_play(OWNER_ID, "synthetic-1", "https://www.xvideos.com/video.synthetic-1", "xvideos")
        await clear_history(OWNER_ID)
        await set_favorite(OWNER_ID, "synthetic-2", "https://www.xvideos.com/video.synthetic-2", "xvideos", True)
        await set_favorite(OWNER_ID, "synthetic-2", "https://www.xvideos.com/video.synthetic-2", "xvideos", False)

        self.assertEqual(len(self.pool.execute_calls), 4)
        insert_history, clear, add_favorite, remove_favorite = self.pool.execute_calls
        self.assertIn("ON CONFLICT (actor_id, video_id)", insert_history[0])
        self.assertEqual(insert_history[1][:4], (OWNER_ID, "synthetic-1", "https://www.xvideos.com/video.synthetic-1", "xvideos"))
        self.assertIn("WHERE actor_id = $1", clear[0])
        self.assertEqual(clear[1], (OWNER_ID,))
        self.assertIn("ON CONFLICT (actor_id, video_id)", add_favorite[0])
        self.assertEqual(add_favorite[1], (OWNER_ID, "synthetic-2", "https://www.xvideos.com/video.synthetic-2", "xvideos"))
        self.assertIn("WHERE actor_id = $1 AND video_id = $2", remove_favorite[0])
        self.assertEqual(remove_favorite[1], (OWNER_ID, "synthetic-2"))


if __name__ == "__main__":
    unittest.main()
