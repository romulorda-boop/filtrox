const fs = require('node:fs/promises');
const path = require('node:path');

const FIELD_ALIASES = {
  url: ['url', 'link', 'video_url'],
  title: ['title', 'titulo', 'name'],
  duration: ['duration', 'duracao', 'length'],
  thumb: ['thumb', 'thumbnail', 'poster'],
  thumb2: ['thumb2', 'thumbnail2', 'poster2'],
  iframe: ['iframe', 'embed', 'embed_url'],
  tags: ['tags', 'tag'],
  models: ['models', 'model', 'cast'],
  category: ['category', 'categoria'],
  quality: ['quality', 'qualidade', 'resolution'],
  channel: ['channel', 'canal', 'publisher'],
  date: ['date', 'data', 'published_at', 'uploaded_at'],
  views: ['views', 'view_count', 'visualizacoes', 'watch_count'],
  comments: ['comments', 'comment_count', 'comentarios'],
  rating: ['rating', 'score', 'avaliacao', 'vote_average'],
};

function normalizeHeader(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function parseCsv(text, delimiter = ';') {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { row.push(cell); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => String(value).trim())) rows.push(row);
  }
  return rows;
}

function findColumn(headers, field) {
  const names = new Set(FIELD_ALIASES[field].map(normalizeHeader));
  return headers.findIndex((header) => names.has(normalizeHeader(header)));
}

function value(row, columns, field) {
  const index = columns[field];
  return index >= 0 ? String(row[index] || '').trim() : '';
}

function numberValue(raw) {
  const value = String(raw || '').trim().replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function splitTags(raw) {
  return String(raw || '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

function normalizeItem(row, columns, index) {
  const tags = splitTags(value(row, columns, 'tags'));
  const url = value(row, columns, 'url');
  return {
    id: `csv-${index}`,
    url,
    title: value(row, columns, 'title') || `Vídeo ${index + 1}`,
    duration: value(row, columns, 'duration'),
    thumb: value(row, columns, 'thumb'),
    thumb2: value(row, columns, 'thumb2'),
    iframe: value(row, columns, 'iframe'),
    tags,
    models: value(row, columns, 'models'),
    category: value(row, columns, 'category'),
    quality: value(row, columns, 'quality'),
    channel: value(row, columns, 'channel'),
    date: value(row, columns, 'date'),
    views: numberValue(value(row, columns, 'views')),
    comments: numberValue(value(row, columns, 'comments')),
    rating: numberValue(value(row, columns, 'rating')),
  };
}

async function readCatalogCsv() {
  const sourceUrl = process.env.CATALOG_CSV_URL || process.env.BASE_CSV_URL;
  let csv;
  if (sourceUrl) {
    const response = await fetch(sourceUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`CSV remoto respondeu HTTP ${response.status}.`);
    csv = await response.text();
  } else {
    const candidates = [
      process.env.CATALOG_CSV_PATH,
      path.join(__dirname, '..', '..', 'data', 'xvideos_up.csv'),
      path.join(__dirname, '..', 'data', 'xvideos_up.csv'),
    ].filter(Boolean);
    let lastError;
    for (const sourcePath of candidates) {
      try {
        csv = await fs.readFile(sourcePath, 'utf8');
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (csv === undefined) throw lastError || new Error('xvideos_up.csv não encontrado.');
  }
  const rows = parseCsv(csv, ';');
  if (rows.length < 2) throw new Error('xvideos_up.csv está vazio ou sem registros.');
  const headers = rows[0];
  const columns = Object.fromEntries(Object.keys(FIELD_ALIASES).map((field) => [field, findColumn(headers, field)]));
  if (columns.url < 0 || columns.title < 0) throw new Error('O CSV precisa conter as colunas url e title.');
  return rows.slice(1).map((row, index) => normalizeItem(row, columns, index)).filter((item) => item.url || item.title);
}

function dateValue(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) return parsed;
  const year = Number(String(value || '').match(/\b(?:19|20)\d{2}\b/)?.[0]);
  return Number.isFinite(year) ? Date.UTC(year, 0, 1) : 0;
}

function filterAndSort(items, query, sort) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('pt-BR');
  const filtered = normalizedQuery
    ? items.filter((item) => [item.title, item.tags.join(' '), item.models, item.category, item.channel].join(' ').toLocaleLowerCase('pt-BR').includes(normalizedQuery))
    : [...items];
  const title = (a, b) => a.title.localeCompare(b.title, 'pt-BR');
  if (sort === 'watched') filtered.sort((a, b) => b.views - a.views || title(a, b));
  else if (sort === 'commented') filtered.sort((a, b) => b.comments - a.comments || title(a, b));
  else if (sort === 'rated') filtered.sort((a, b) => b.rating - a.rating || title(a, b));
  else filtered.sort((a, b) => dateValue(b.date) - dateValue(a.date) || title(a, b));
  return filtered;
}

async function getCatalog({ query = '', sort = 'recent' } = {}) {
  const items = await readCatalogCsv();
  return filterAndSort(items, query, sort);
}

async function handleCatalogRequest(request, response) {
  const requestUrl = new URL(request.url || '/api/catalog', 'http://localhost');
  try {
    const items = await getCatalog({ query: requestUrl.searchParams.get('q') || '', sort: requestUrl.searchParams.get('sort') || 'recent' });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ items, total: items.length }));
  } catch (error) {
    response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'Catálogo indisponível.', ...(process.env.NODE_ENV !== 'production' ? { detail: error.message } : {}) }));
  }
}

module.exports = { getCatalog, handleCatalogRequest };
