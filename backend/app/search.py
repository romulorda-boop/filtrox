from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence


_WORD_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)
_QUERY_PART_RE = re.compile(r'"([^"\n]+)"|(\S+)')


@dataclass(frozen=True)
class ParsedQuery:
    terms: tuple[str, ...]
    phrases: tuple[str, ...]


def _tokens(value: Any) -> tuple[str, ...]:
    return tuple(_WORD_RE.findall(str(value or "").casefold()))


def _distinct(values: Iterable[Any]) -> tuple[str, ...]:
    seen: set[tuple[str, ...]] = set()
    result: list[str] = []
    for raw in values:
        text = str(raw or "").strip()
        parts = _tokens(text)
        if not parts or parts in seen:
            continue
        seen.add(parts)
        result.append(" ".join(parts))
    return tuple(result)


def parse_query(query: str) -> ParsedQuery:
    """Parse free-text terms and quoted exact phrases; accents remain significant."""
    raw = str(query or "")
    if raw.count('"') % 2:
        raise ValueError("Aspas sem fechamento na busca.")
    terms: list[str] = []
    phrases: list[str] = []
    for match in _QUERY_PART_RE.finditer(raw):
        phrase, unquoted = match.groups()
        if phrase is not None:
            normalized = " ".join(_tokens(phrase))
            if normalized:
                phrases.append(normalized)
        elif unquoted is not None:
            terms.extend(_tokens(unquoted))
    return ParsedQuery(tuple(terms), _distinct(phrases))


def _sequence_in(haystack: Sequence[str], needle: Sequence[str]) -> bool:
    if not needle or len(needle) > len(haystack):
        return False
    width = len(needle)
    return any(tuple(haystack[index:index + width]) == tuple(needle) for index in range(len(haystack) - width + 1))


def _item_sequences(item: Mapping[str, Any]) -> tuple[tuple[str, ...], ...]:
    fields = [str(item.get("title") or "")]
    tags = item.get("tags") or []
    fields.extend(str(tag) for tag in tags if str(tag).strip())
    return tuple(sequence for sequence in (_tokens(field) for field in fields) if sequence)


def _contains_term(sequences: Sequence[Sequence[str]], term: str) -> bool:
    needle = _tokens(term)
    return bool(needle) and any(_sequence_in(sequence, needle) for sequence in sequences)


def _contains_any(sequences: Sequence[Sequence[str]], terms: Sequence[str]) -> bool:
    return any(_contains_term(sequences, term) for term in terms)


def _normalized_tag_set(item: Mapping[str, Any]) -> set[str]:
    return {str(tag).strip().casefold() for tag in (item.get("tags") or []) if str(tag).strip()}


def _matches(item: Mapping[str, Any], criteria: Mapping[str, Any], watched_ids: set[str]) -> bool:
    sequences = _item_sequences(item)
    required = tuple(criteria["required_terms"])
    optional = tuple(criteria["optional_terms"])
    excluded = tuple(criteria["excluded_terms"])
    phrases = tuple(criteria["required_phrases"])
    excluded_phrases = tuple(criteria["excluded_phrases"])
    included_equivalents = tuple(criteria["included_equivalents"])
    excluded_equivalents = tuple(criteria["excluded_equivalents"])
    tags = _normalized_tag_set(item)

    # Exclusions are evaluated first and always override include terms/equivalents.
    if _contains_any(sequences, (*excluded, *excluded_equivalents)):
        return False
    if any(_sequence_in(sequence, _tokens(phrase)) for phrase in excluded_phrases for sequence in sequences):
        return False
    if any(not _contains_term(sequences, term) for term in (*required, *included_equivalents)):
        return False
    if any(not any(_sequence_in(sequence, _tokens(phrase)) for sequence in sequences) for phrase in criteria["required_phrases"]):
        return False

    include_tags = {str(value).strip().casefold() for value in criteria["include_tags"] if str(value).strip()}
    exclude_tags = {str(value).strip().casefold() for value in criteria["exclude_tags"] if str(value).strip()}
    if include_tags and not include_tags.issubset(tags):
        return False
    if exclude_tags.intersection(tags):
        return False

    if criteria["language"] and str(item.get("language") or "").casefold() != str(criteria["language"]).casefold():
        return False
    if criteria["country"] and str(item.get("country") or "").casefold() != str(criteria["country"]).casefold():
        return False
    if criteria["hide_watched"] and str(item.get("id") or "") in watched_ids:
        return False

    # Optional terms never exclude an item; they contribute only to relevance ordering.
    item["_optional_score"] = sum(1 for term in optional if _contains_term(sequences, term))
    return True


def _date_score(item: Mapping[str, Any]) -> float:
    raw = str(item.get("date") or "").strip()
    if not raw:
        return 0.0
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except (ValueError, OverflowError):
        match = re.search(r"\b(?:19|20)\d{2}\b", raw)
        return float(int(match.group(0))) if match else 0.0


def _sort_items(items: list[dict[str, Any]], sort: Any) -> None:
    if isinstance(sort, str):
        priorities = [(sort, "desc")]
    elif isinstance(sort, list):
        priorities = [
            (str(value.get("field")), str(value.get("direction", "desc")).casefold())
            if isinstance(value, Mapping) else (str(value), "desc")
            for value in sort
        ]
    else:
        priorities = [("recent", "desc")]
    aliases = {"most_viewed": "views", "newest": "recent"}
    priorities = [(aliases.get(field, field), direction) for field, direction in priorities]
    priorities = [(field, direction) for field, direction in priorities if field in {"recent", "views", "relevance"} and direction in {"asc", "desc"}]
    if not priorities:
        priorities = [("recent", "desc")]

    def key(item: Mapping[str, Any]) -> tuple[Any, ...]:
        parts: list[Any] = []
        for field, direction in priorities:
            sign = -1 if direction == "desc" else 1
            if field == "recent":
                parts.append(sign * _date_score(item))
            elif field == "views":
                parts.append(sign * int(item.get("views") or 0))
            else:
                parts.append(sign * int(item.get("_optional_score") or 0))
        parts.append(str(item.get("title") or "").casefold())
        return tuple(parts)

    items.sort(key=key)


def _build_criteria(payload: Mapping[str, Any]) -> dict[str, Any]:
    parsed = parse_query(str(payload.get("query") or ""))
    required = _distinct((*parsed.terms, *(payload.get("required_terms") or [])))
    optional = _distinct(payload.get("optional_terms") or [])
    excluded = _distinct(payload.get("excluded_terms") or [])
    raw_exact_phrases = payload.get("exact_phrases") or []
    if any(str(phrase or "").count('"') % 2 for phrase in raw_exact_phrases):
        raise ValueError("Aspas sem fechamento nas frases exatas.")
    required_phrases = _distinct((*parsed.phrases, *raw_exact_phrases))
    excluded_phrases = _distinct(payload.get("excluded_phrases") or [])
    return {
        "required_terms": required,
        "optional_terms": optional,
        "excluded_terms": excluded,
        "required_phrases": required_phrases,
        "excluded_phrases": excluded_phrases,
        "included_equivalents": _distinct(payload.get("included_equivalents") or []),
        "excluded_equivalents": _distinct(payload.get("excluded_equivalents") or []),
        "include_tags": tuple(str(value) for value in (payload.get("include_tags") or [])),
        "exclude_tags": tuple(str(value) for value in (payload.get("exclude_tags") or [])),
        "language": str(payload.get("language") or "").strip(),
        "country": str(payload.get("country") or "").strip(),
        "hide_watched": bool(payload.get("hide_watched", False)),
    }


def search_catalog(
    items: Sequence[Mapping[str, Any]],
    payload: Mapping[str, Any],
    *,
    watched_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Apply strict word/phrase matching, filters, ordering, facets, and 30-item pages."""
    criteria = _build_criteria(payload)
    watched = {str(value) for value in watched_ids}
    matched: list[dict[str, Any]] = []
    for original in items:
        item = dict(original)
        if _matches(item, criteria, watched):
            matched.append(item)
    _sort_items(matched, payload.get("sort", "recent"))

    # Facets are computed from the matching set, so they stay dynamic as search changes.
    tag_counts: Counter[str] = Counter()
    tag_sources: dict[str, set[str]] = {}
    language_values: set[str] = set()
    country_values: set[str] = set()
    for item in matched:
        item_tags = {str(tag) for tag in (item.get("tags") or []) if str(tag).strip()}
        tag_counts.update(item_tags)
        source = str(item.get("source") or "").strip()
        if source:
            for tag in item_tags:
                tag_sources.setdefault(tag, set()).add(source)
        if item.get("language"):
            language_values.add(str(item["language"]))
        if item.get("country"):
            country_values.add(str(item["country"]))

    try:
        page = max(1, int(payload.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    try:
        page_size = max(1, min(30, int(payload.get("page_size", 30))))
    except (ValueError, TypeError):
        page_size = 30
    total = len(matched)
    start = (page - 1) * page_size
    visible = matched[start:start + page_size]
    for item in visible:
        item.pop("_optional_score", None)

    return {
        "items": visible,
        "total": total,
        "page": page,
        "page_size": page_size,
        "filters": {
            "tags": [{"tag": tag, "video_count": count, "sources": sorted(tag_sources.get(tag, set()))} for tag, count in sorted(tag_counts.items(), key=lambda pair: (-pair[1], pair[0].casefold()))],
            "languages": sorted(language_values),
            "countries": sorted(country_values),
        },
    }
