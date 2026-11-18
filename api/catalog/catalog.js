const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PAGE_SIZE = 100;
const BASE_BLOB_PATH = '/filtroxdata/xvideos_up.csv';
const REMOVAL_BLOB_PATH = '/filtroxdata/xvideos_remove.csv';
const BASE_COLUMNS = Object.freeze({
  url: 0,
  title: 1,
  duration: 2,
  tags: 5,
  cast: 6,
  views: 7,
  category: 8,
  quality: 9,
  publisher: 10,
  date: 12
});

let cachedCatalog = null;
let inflightKey = '';
let inflightLoad = null;

function validateBlobUrl(raw, expectedPath) {
  if (!raw) throw new Error('Configuração server-side do CSV ausente.');
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new Error('URL de origem CSV inválida.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'filtroxdata.blob.core.windows.net' || url.pathname !== expectedPath) {
    throw new Error('Origem CSV não autorizada.');
  }
  if (url.searchParams.get('sp') !== 'r' || url.searchParams.get('sr') !== 'b' || !url.searchParams.get('sig')) {
    throw new Error('O SAS precisa ser restrito à leitura do blob.');
  }
  return url.toString();
}

function parseCsv(text, delimiter) {
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

function normalizeUrlKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.toLowerCase().replace(/\/+$/, '')}`;
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

function rowUrl(row, column) {
  const value = String(row?.[column] || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function cell(row, column) {
  return String(row?.[column] ?? '').trim();
}

function splitTags(raw) {
  const seen = new Set();
  return String(raw || '').split(/[|,]/).map((tag) => tag.trim()).filter((tag) => {
    const normalized = tag.toLocaleLowerCase('pt-BR');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function numberValue(raw) {
  const value = Number(String(raw || '').trim().replace(/[^\d-]/g, ''));
  return Number.isSafeInteger(value) ? value : 0;
}

function dateValue(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) return parsed;
  const year = Number(String(value || '').match(/\b(?:19|20)\d{2}\b/)?.[0]);
  return Number.isFinite(year) ? Date.UTC(year, 0, 1) : 0;
}

function buildCatalog(baseRows, removalRows) {
  const removalKeys = new Set(removalRows.map((row) => normalizeUrlKey(rowUrl(row, 1))).filter(Boolean));
  if (!removalKeys.size) throw new Error('Lista oficial de remoções vazia ou inválida.');

  const seen = new Set();
  const items = [];
  let hidden = 0;
  for (const row of baseRows) {
    const url = rowUrl(row, BASE_COLUMNS.url);
    const key = normalizeUrlKey(url);
    if (!key) continue;
    if (removalKeys.has(key)) { hidden += 1; continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `csv-${items.length + 1}`,
      url,
      title: cell(row, BASE_COLUMNS.title) || `Vídeo ${items.length + 1}`,
      duration: cell(row, BASE_COLUMNS.duration),
      tags: splitTags(cell(row, BASE_COLUMNS.tags)),
      cast: cell(row, BASE_COLUMNS.cast),
      category: cell(row, BASE_COLUMNS.category),
      quality: cell(row, BASE_COLUMNS.quality),
      publisher: cell(row, BASE_COLUMNS.publisher),
      date: cell(row, BASE_COLUMNS.date),
      views: numberValue(cell(row, BASE_COLUMNS.views))
    });
  }
  if (!items.length) throw new Error('Nenhum registro disponível após aplicar as remoções oficiais.');
  return { items, stats: { base: baseRows.length, removals: removalKeys.size, hidden, remaining: items.length } };
}

function buildTags(items) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of item.tags) {
      const key = tag.toLocaleLowerCase('pt-BR');
      const current = counts.get(key);
      if (current) current.videoCount += 1;
      else counts.set(key, { tag, videoCount: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag, 'pt-BR', { sensitivity: 'base' }));
}

async function loadCatalogData() {
  const baseUrl = validateBlobUrl(process.env.CATALOG_CSV_URL, BASE_BLOB_PATH);
  const removalUrl = validateBlobUrl(process.env.CATALOG_REMOVAL_CSV_URL, REMOVAL_BLOB_PATH);
  const key = `${baseUrl}\n${removalUrl}`;
  if (cachedCatalog && cachedCatalog.key === key && cachedCatalog.expiresAt > Date.now()) return cachedCatalog;
  if (inflightLoad && inflightKey === key) return inflightLoad;

  inflightKey = key;
  const loading = (async () => {
    const [baseResponse, removalResponse] = await Promise.all([fetch(baseUrl), fetch(removalUrl)]);
    if (!baseResponse.ok) throw new Error(`CSV base respondeu HTTP ${baseResponse.status}.`);
    if (!removalResponse.ok) throw new Error(`CSV de remoções respondeu HTTP ${removalResponse.status}.`);
    const [baseText, removalText] = await Promise.all([baseResponse.text(), removalResponse.text()]);
    const baseRows = parseCsv(baseText, ';');
    const removalRows = parseCsv(removalText, '|');
    const catalog = buildCatalog(baseRows, removalRows);
    const result = { key, ...catalog, tags: buildTags(catalog.items), expiresAt: Date.now() + CACHE_TTL_MS };
    cachedCatalog = result;
    return result;
  })();
  inflightLoad = loading;
  try {
    return await loading;
  } finally {
    if (inflightLoad === loading) {
      inflightKey = '';
      inflightLoad = null;
    }
  }
}

function sortItems(items, sort) {
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'pt-BR');
  if (sort === 'watched') return items.sort((a, b) => b.views - a.views || byTitle(a, b));
  return items.sort((a, b) => dateValue(b.date) - dateValue(a.date) || byTitle(a, b));
}

async function getCatalog({
  query = '', sort = 'recent', tag = '', mode = 'search', offset = 0, limit = 48
} = {}) {
  const data = await loadCatalogData();
  if (mode === 'tags') return { tags: data.tags, total: data.tags.length };
  if (mode === 'all') return { items: data.items, total: data.items.length, stats: data.stats };

  const normalizedQuery = String(query || '').trim().slice(0, 200).toLocaleLowerCase('pt-BR');
  const normalizedTag = String(tag || '').trim().slice(0, 100).toLocaleLowerCase('pt-BR');
  const filtered = data.items.filter((item) => {
    if (normalizedTag && !item.tags.some((value) => value.toLocaleLowerCase('pt-BR') === normalizedTag)) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.tags.join(' '), item.cast, item.category, item.publisher].join(' ').toLocaleLowerCase('pt-BR').includes(normalizedQuery);
  });
  sortItems(filtered, sort);
  const safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(limit) || 48)));
  const safeOffset = Math.max(0, Math.min(filtered.length, Math.floor(Number(offset) || 0)));
  return {
    items: filtered.slice(safeOffset, safeOffset + safeLimit),
    total: filtered.length,
    offset: safeOffset,
    limit: safeLimit
  };
}

async function handleCatalogRequest(request, response) {
  const url = new URL(request.url || '/api/catalog', 'http://localhost');
  try {
    let body = {};
    if (String(request.method || 'GET').toUpperCase() === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    if (body.ageConfirmed !== true) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Confirmação 18+ necessária.' }));
      return;
    }
    const payload = await getCatalog({
      query: body.query ?? url.searchParams.get('q') ?? '',
      sort: body.sort ?? url.searchParams.get('sort') ?? 'recent',
      tag: body.tag ?? '',
      mode: body.mode ?? 'search',
      offset: body.offset ?? url.searchParams.get('offset') ?? 0,
      limit: body.limit ?? url.searchParams.get('limit') ?? 48
    });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(payload));
  } catch (error) {
    response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'Catálogo oficial indisponível.' }));
  }
}

module.exports = { getCatalog, handleCatalogRequest, parseCsv, splitTags, normalizeUrlKey };
