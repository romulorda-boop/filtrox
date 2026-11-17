const filterButtons = [...document.querySelectorAll('[data-filter]')];
const searchForm = document.querySelector('#homeSearch');
const searchInput = document.querySelector('#homeSearchInput');
const resultGrid = document.querySelector('#homeResultGrid');
const noResults = document.querySelector('#homeNoResults');

const state = {
  items: [],
  query: '',
  sort: 'recent',
};

const text = (value) => String(value ?? '').trim();
const key = (value) => text(value).toLocaleLowerCase('pt-BR');

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function parseNumber(value) {
  const normalized = text(value).replace(',', '.').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
  const timestamp = Date.parse(text(value));
  if (Number.isFinite(timestamp)) return timestamp;
  const year = Number(text(value).match(/\b(?:19|20)\d{2}\b/)?.[0]);
  return Number.isFinite(year) ? Date.UTC(year, 0, 1) : 0;
}

function parseRows(csv, delimiter) {
  if (!window.Papa) return [];
  return window.Papa.parse(csv, { delimiter, skipEmptyLines: 'greedy' }).data
    .filter((row) => Array.isArray(row) && row.some((value) => text(value)));
}

function headerIndex(headers, names, fallback = -1) {
  const normalized = headers.map((value) => key(value).replace(/[^a-z0-9]/g, ''));
  const index = names.map((name) => normalized.indexOf(name.replace(/[^a-z0-9]/g, '')))
    .find((value) => value >= 0);
  return index === undefined ? fallback : index;
}

function normalizeRemoteRows(rows, config) {
  if (!rows.length) return [];
  const columns = config.baseColumns || {};
  const first = rows[0];
  const hasHeader = key(first[config.baseUrlColumn ?? 0]) === key(config.keyField || 'url');
  const headers = hasHeader ? first : [];
  const titleIndex = headerIndex(headers, ['title', 'name'], columns.title ?? 1);
  const tagsIndex = headerIndex(headers, ['tags', 'tag'], columns.tags ?? 5);
  const viewsIndex = headerIndex(headers, ['views', 'viewcount', 'visualizacoes'], columns.views ?? -1);
  const commentsIndex = headerIndex(headers, ['comments', 'commentcount', 'comentarios'], columns.comments ?? -1);
  const ratingIndex = headerIndex(headers, ['rating', 'score', 'avaliacao'], columns.rating ?? -1);
  const dateIndex = headerIndex(headers, ['uploadedat', 'publishedat', 'published', 'date'], columns.uploadedAt ?? -1);
  const categoryIndex = columns.category ?? -1;
  const creatorIndex = columns.publisher ?? -1;
  const rowsToRead = hasHeader ? rows.slice(1) : rows;
  return rowsToRead.map((row, index) => {
    const url = text(row[config.baseUrlColumn ?? 0]);
    if (!url) return null;
    const tags = text(row[tagsIndex]).split(/[|,]/).map((tag) => tag.trim()).filter(Boolean);
    return {
      id: `remote-${index}-${url}`,
      url,
      title: text(row[titleIndex]) || `Vídeo ${index + 1}`,
      tags,
      subtitle: text(row[creatorIndex]) || 'Catálogo FILTROX',
      category: text(row[categoryIndex]),
      views: parseNumber(row[viewsIndex]),
      comments: parseNumber(row[commentsIndex]),
      rating: parseNumber(row[ratingIndex]),
      publishedAt: text(row[dateIndex]),
    };
  }).filter(Boolean);
}

function normalizeSampleRows(csv) {
  if (!window.Papa) return [];
  return window.Papa.parse(csv, { header: true, skipEmptyLines: true }).data.map((row) => ({
    id: text(row.id),
    title: text(row.title),
    tags: text(row.tags).split(/[|,]/).map((tag) => tag.trim()).filter(Boolean),
    subtitle: text(row.subtitle),
    category: text(row.category),
    views: parseNumber(row.views),
    comments: parseNumber(row.comments),
    rating: parseNumber(row.rating),
    publishedAt: text(row.year),
  })).filter((item) => item.title);
}

function removalKey(value) {
  try {
    const url = new URL(text(value));
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.toLowerCase().replace(/\/+$/, '')}`;
  } catch {
    return key(value).replace(/\/+$/, '');
  }
}

async function loadItems() {
  const config = window.FILTROX_CONFIG || {};
  try {
    if (!config.baseCsvUrl || !window.Papa) throw new Error('remote catalog unavailable');
    const [baseResponse, removalResponse] = await Promise.all([
      fetch(config.baseCsvUrl, { cache: 'no-store' }),
      config.removalCsvUrl ? fetch(config.removalCsvUrl, { cache: 'no-store' }) : Promise.resolve(null),
    ]);
    if (!baseResponse.ok) throw new Error('base catalog unavailable');
    const baseRows = parseRows(await baseResponse.text(), config.baseDelimiter || ';');
    const removalRows = removalResponse?.ok
      ? parseRows(await removalResponse.text(), config.removalDelimiter || '|')
      : [];
    const removalColumn = Number.isInteger(config.removalUrlColumn) ? config.removalUrlColumn : 1;
    const removed = new Set(removalRows.map((row) => removalKey(row[removalColumn])).filter(Boolean));
    const items = normalizeRemoteRows(baseRows, config);
    state.items = items.filter((item) => !removed.has(removalKey(item.url)));
  } catch {
    const response = await fetch('/data/videos.sample.csv', { cache: 'no-store' });
    state.items = response.ok ? normalizeSampleRows(await response.text()) : [];
  }
  render();
}

function sortItems(items) {
  const sorted = [...items];
  const title = (a, b) => a.title.localeCompare(b.title, 'pt-BR');
  if (state.sort === 'watched') sorted.sort((a, b) => b.views - a.views || title(a, b));
  else if (state.sort === 'commented') sorted.sort((a, b) => b.comments - a.comments || title(a, b));
  else if (state.sort === 'rated') sorted.sort((a, b) => b.rating - a.rating || title(a, b));
  else sorted.sort((a, b) => parseDate(b.publishedAt) - parseDate(a.publishedAt) || title(a, b));
  return sorted;
}

function render() {
  const query = key(state.query);
  const filtered = sortItems(state.items).filter((item) => {
    if (!query) return true;
    return [item.title, item.subtitle, item.category, ...item.tags].some((value) => key(value).includes(query));
  });
  resultGrid.replaceChildren(...filtered.slice(0, 12).map((item) => {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.innerHTML = `<h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.tags.join(' · ') || item.subtitle)}</p>`;
    return card;
  }));
  noResults.hidden = filtered.length > 0;
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.sort = button.dataset.filter;
    filterButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    render();
  });
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim();
  render();
});

loadItems();
