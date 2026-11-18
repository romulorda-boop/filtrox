import unittest

from app.search import parse_query, search_catalog


ITEMS = [
    {"id": "a", "title": "Cafe test room", "tags": ["basic", "country:BR", "lang:pt"], "views": 10, "date": "2026-01-02", "language": "pt", "country": "BR"},
    {"id": "b", "title": "Café test-room", "tags": ["basic", "country:PT"], "views": 20, "date": "2026-01-03", "language": None, "country": "PT"},
    {"id": "c", "title": "Testroom cafeteria", "tags": ["other"], "views": 50, "date": "2026-01-04", "language": None, "country": None},
    {"id": "d", "title": "room test", "tags": ["other", "country:BR"], "views": 30, "date": "2026-01-01", "language": "pt", "country": "BR"},
]


class SearchTests(unittest.TestCase):
    def ids(self, payload, items=ITEMS, watched=()):
        return [item["id"] for item in search_catalog(items, payload, watched_ids=watched)["items"]]

    def test_case_insensitive_but_accent_sensitive(self):
        self.assertEqual(self.ids({"query": "CAFE"}), ["a"])
        self.assertEqual(self.ids({"query": "café"}), ["b"])

    def test_whole_words_not_partial_words(self):
        self.assertEqual(self.ids({"query": "test"}), ["b", "a", "d"])
        self.assertEqual(self.ids({"query": "room"}), ["b", "a", "d"])
        self.assertNotIn("c", self.ids({"query": "test"}))

    def test_unquoted_terms_use_and(self):
        self.assertEqual(set(self.ids({"query": "room basic"})), {"a", "b"})

    def test_quoted_phrase_is_ordered_and_contiguous(self):
        self.assertEqual(self.ids({"query": '"room test"'}), ["d"])
        self.assertEqual(set(self.ids({"query": "room test"})), {"a", "b", "d"})

    def test_unmatched_quote_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_query('"room test')

    def test_unmatched_quote_in_advanced_exact_phrase_is_rejected(self):
        with self.assertRaises(ValueError):
            search_catalog(ITEMS, {"exact_phrases": ['"room test']})

    def test_exclusions_override_inclusions(self):
        self.assertEqual(self.ids({"required_terms": ["cafe"], "excluded_terms": ["cafe"]}), [])
        self.assertEqual(self.ids({"required_terms": ["cafe"], "excluded_phrases": ["cafe test"]}), [])

    def test_tags_are_exact_and_include_combination_is_and(self):
        self.assertEqual(set(self.ids({"include_tags": ["basic", "country:BR"]})), {"a"})
        self.assertEqual(self.ids({"include_tags": ["basic"], "exclude_tags": ["basic"]}), [])

    def test_explicit_country_and_language_only(self):
        self.assertEqual(set(self.ids({"country": "BR"})), {"a", "d"})
        self.assertEqual(self.ids({"country": "US"}), [])

    def test_hidden_watched_and_optional_relevance(self):
        self.assertNotIn("a", self.ids({"query": "room", "hide_watched": True}, watched={"a"}))
        items = [dict(item) for item in ITEMS]
        result = search_catalog(items, {"query": "room", "optional_terms": ["café"], "sort": "relevance"})
        self.assertEqual(result["items"][0]["id"], "b")

    def test_multiple_sort_priorities_and_direction(self):
        result = search_catalog(ITEMS, {"sort": [{"field": "views", "direction": "desc"}, {"field": "recent", "direction": "asc"}]})
        self.assertEqual([item["id"] for item in result["items"]], ["c", "d", "b", "a"])

    def test_most_viewed_alias_sorts_by_views(self):
        result = search_catalog(ITEMS, {"sort": "most_viewed"})
        self.assertEqual([item["id"] for item in result["items"]], ["c", "d", "b", "a"])

    def test_equal_tags_keep_their_source_identifiers(self):
        items = [{**ITEMS[0], "source": "xvideos"}, {**ITEMS[1], "source": "pornhub"}]
        facets = search_catalog(items, {})["filters"]["tags"]
        basic = next(facet for facet in facets if facet["tag"] == "basic")
        self.assertEqual(basic["video_count"], 2)
        self.assertEqual(basic["sources"], ["pornhub", "xvideos"])

    def test_dynamic_facets_and_page_size_cap(self):
        many = [dict(ITEMS[index % len(ITEMS)], id=f"v{index}") for index in range(64)]
        result = search_catalog(many, {"page": 2, "page_size": 300})
        self.assertEqual(result["page_size"], 30)
        self.assertEqual(len(result["items"]), 30)
        self.assertTrue(result["filters"]["tags"])


if __name__ == "__main__":
    unittest.main()
