import csv
import io
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app import catalog
from app.catalog import CatalogUnavailable, _limited_download_text, _validate_blob_url, build_catalog


def make_row(url, title, tags="", duration="120", views="10", date="2026-01-01"):
    values = [""] * 13
    values[0] = url
    values[1] = title
    values[2] = duration
    values[5] = tags
    values[7] = views
    values[12] = date
    return values


def csv_text(rows, delimiter):
    output = io.StringIO()
    writer = csv.writer(output, delimiter=delimiter, lineterminator="\n")
    writer.writerows(rows)
    return output.getvalue()


class CatalogTests(unittest.TestCase):
    def test_synthetic_removals_apply_before_tags_and_duplicates(self):
        base = csv_text([
            make_row("https://www.xvideos.com/video.sample-a/", "Synthetic room", "tag-one|lang:pt|country:BR"),
            make_row("https://xvideos.com/video.sample-b/", "Synthetic removed", "tag-removed|country:US"),
            make_row("https://xvideos.com/video.sample-a", "Duplicate URL", "duplicate-tag"),
            make_row("https://other.example/video.sample-c", "Unapproved source", "external-tag"),
        ], ";")
        removals = csv_text([["", "https://xvideos.com/video.sample-b"]], "|")
        items = build_catalog(base, removals)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "Synthetic room")
        self.assertEqual(items[0]["tags"], ["tag-one", "lang:pt", "country:BR"])
        self.assertEqual(items[0]["language"], "pt")
        self.assertEqual(items[0]["country"], "BR")
        self.assertEqual(items[0]["source"], "xvideos")

    def test_country_is_not_inferred_from_plain_tag(self):
        base = csv_text([make_row("https://xvideos.com/video.sample-a", "Synthetic room", "New York")], ";")
        removals = csv_text([["", "https://xvideos.com/video.sample-z"]], "|")
        self.assertIsNone(build_catalog(base, removals)[0]["country"])

    def test_non_xvideos_removals_do_not_match(self):
        base = csv_text([make_row("https://xvideos.com/video.sample-a", "Synthetic room")], ";")
        removals = csv_text([["", "https://not-xvideos.com/video.sample-a"]], "|")
        with self.assertRaises(CatalogUnavailable):
            build_catalog(base, removals)

    def test_empty_removal_file_fails_closed(self):
        base = csv_text([make_row("https://xvideos.com/video.sample-a", "Synthetic room")], ";")
        with self.assertRaises(CatalogUnavailable):
            build_catalog(base, "")

    def test_sas_validator_requires_exact_blob_and_read_only(self):
        good = "https://filtroxdata.blob.core.windows.net/filtroxdata/xvideos_up.csv?sp=r&sr=b&sig=synthetic"
        self.assertEqual(_validate_blob_url(good, "/filtroxdata/xvideos_up.csv"), good)
        with self.assertRaises(CatalogUnavailable):
            _validate_blob_url(good.replace("sp=r", "sp=rw"), "/filtroxdata/xvideos_up.csv")
        with self.assertRaises(CatalogUnavailable):
            _validate_blob_url(good.replace("xvideos_up.csv", "other.csv"), "/filtroxdata/xvideos_up.csv")

    def test_item_count_limit_fails_closed(self):
        base = csv_text([make_row("https://xvideos.com/video.sample-a", "Synthetic room")], ";")
        removals = csv_text([["", "https://xvideos.com/video.sample-z"]], "|")
        with patch("app.catalog._MAX_XVIDEOS_ITEMS", 0), self.assertRaises(CatalogUnavailable):
            build_catalog(base, removals)


class CatalogDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_download_rejects_content_length_over_limit(self):
        async def handler(request):
            return httpx.Response(200, content=b"12345", request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(CatalogUnavailable):
                await _limited_download_text(client, "https://blob.invalid/synthetic.csv", 4)

    async def test_loader_uses_only_two_authorized_xvideos_csvs(self):
        base = csv_text([make_row("https://xvideos.com/video.sample-a", "Synthetic room")], ";")
        removals = csv_text([["", "https://xvideos.com/video.sample-z"]], "|")
        catalog._cached_items = None
        catalog._cached_until = 0
        with (
            patch.dict(os.environ, {
                "FILTROX_ENABLE_PORNHUB": "false",
                "FILTROX_ENVIRONMENT": "development",
                "CATALOG_CSV_URL": "synthetic-base",
                "CATALOG_REMOVAL_CSV_URL": "synthetic-removals",
            }),
            patch("app.catalog._get_redis", AsyncMock(return_value=None)),
            patch("app.catalog._validate_blob_url", side_effect=["synthetic-base", "synthetic-removals"]),
            patch("app.catalog._limited_download_text", new_callable=AsyncMock, side_effect=[base, removals]),
        ):
            items = await catalog.load_catalog()
        self.assertEqual([item["source"] for item in items], ["xvideos"])
        catalog._cached_items = None
        catalog._cached_until = 0


    async def test_unvalidated_source_flag_fails_before_io(self):
        with patch.dict(os.environ, {"FILTROX_ENABLE_PORNHUB": "true"}), \
             patch("app.catalog._get_redis", new_callable=AsyncMock) as get_redis:
            with self.assertRaises(CatalogUnavailable):
                await catalog.load_catalog()
        get_redis.assert_not_awaited()

if __name__ == "__main__":
    unittest.main()
