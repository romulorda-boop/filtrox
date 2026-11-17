const filterButtons = [...document.querySelectorAll('[data-filter]')];
const searchForm = document.querySelector('#homeSearch');
const searchInput = document.querySelector('#homeSearchInput');
const searchStatus = document.querySelector('#homeSearchStatus');
const resultGrid = document.querySelector('#homeResultGrid');
const noResults = document.querySelector('#homeNoResults');
const popularTags = document.querySelector('#homePopularTags');
const tagsToggle = document.querySelector('#homeTagsToggle');
const tagsPanel = document.querySelector('#homeTagsPanel');
const tagsSearch = document.querySelector('#homeTagSearch');
const tagsStatus = document.querySelector('#homeTagStatus');
const tagsResults = document.querySelector('#homeTagResults');
const tagsMore = document.querySelector('#homeTagsMore');

const state = { query: '', sort: 'recent', tags: [], shownTags: 100, tagsLoaded: false, tagsLoading: false };
const TAG_PAGE_SIZE = 100;
const POPULAR_TAGS_COUNT = 18;

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function parseDelimitedCsv(text, delimiter = ';') {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]; const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); if (row.some((value) => value.trim())) rows.push(row); }
  rows.forEach((cells) => { if (cells.length) cells[0] = cells[0].replace(/^\uFEFF/, ''); });
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

function rowUrl(row, preferredIndex) {
  const preferred = String(row?.[preferredIndex] || '').trim();
  return /^https?:\/\//i.test(preferred) ? preferred : String(row?.find?.((value) => /^https?:\/\//i.test(String(value || ''))) || '').trim();
}

function goToTag(tag) {
  if (!state.tags.some((item) => item.tag === tag)) return;
  window.location.assign(`/catalog/?tag=${encodeURIComponent(tag)}`);
}

function renderPopularTags() {
  const topTags = [...state.tags]
    .sort((a, b) => b.videoCount - a.videoCount || a.tag.localeCompare(b.tag, 'pt-BR', { sensitivity: 'base' }))
    .slice(0, POPULAR_TAGS_COUNT);
  const fragment = document.createDocumentFragment();
  topTags.forEach((item) => {
    const button = document.createElement('button');
    button.className = 'category-chip';
    button.type = 'button';
    button.dataset.popularTag = item.tag;
    button.setAttribute('aria-label', `${item.tag}, ${item.videoCount.toLocaleString('pt-BR')} vídeos`);
    const name = document.createElement('span'); name.className = 'category-chip-name'; name.textContent = item.tag;
    const count = document.createElement('span'); count.className = 'category-chip-count'; count.textContent = item.videoCount.toLocaleString('pt-BR');
    button.append(name, count);
    fragment.append(button);
  });
  if (!topTags.length) {
    const message = document.createElement('p');
    message.className = 'tags-placeholder';
    message.textContent = 'As tags populares aparecerão quando os CSVs oficiais estiverem disponíveis.';
    fragment.append(message);
  }
  popularTags.replaceChildren(fragment);
}

function renderTags() {
  const query = tagsSearch.value.trim().toLocaleLowerCase('pt-BR');
  const matches = query
    ? state.tags.filter((item) => item.tag.toLocaleLowerCase('pt-BR').includes(query))
    : state.tags;
  const visible = matches.slice(0, state.shownTags);
  const fragment = document.createDocumentFragment();

  visible.forEach((item) => {
    const button = document.createElement('button');
    button.className = 'tag-result';
    button.type = 'button';
    button.setAttribute('role', 'listitem');
    button.dataset.officialTag = item.tag;
    button.setAttribute('aria-label', `${item.tag}, presente em ${item.videoCount.toLocaleString('pt-BR')} vídeos`);
    const name = document.createElement('span'); name.className = 'tag-name'; name.textContent = item.tag;
    const count = document.createElement('span'); count.className = 'tag-video-count'; count.textContent = item.videoCount.toLocaleString('pt-BR');
    button.append(name, count);
    fragment.append(button);
  });

  tagsResults.replaceChildren(fragment);
  tagsMore.hidden = visible.length >= matches.length;
  tagsMore.textContent = `Carregar mais tags (${Math.max(0, matches.length - visible.length).toLocaleString('pt-BR')})`;
  tagsStatus.textContent = query
    ? `${visible.length.toLocaleString('pt-BR')} de ${matches.length.toLocaleString('pt-BR')} tags encontradas nos CSVs oficiais.`
    : `${state.tags.length.toLocaleString('pt-BR')} tags oficiais; categorias ordenadas por frequência.`;
}

async function loadOfficialTags() {
  if (state.tagsLoaded || state.tagsLoading) return;
  state.tagsLoading = true;
  tagsStatus.textContent = 'Carregando tags da base oficial e aplicando remoções…';
  try {
    const config = window.FILTROX_CONFIG || {};
    if (!config.baseCsvUrl || !config.removalCsvUrl) throw new Error('Configuração CSV indisponível');
    const [baseResponse, removalResponse] = await Promise.all([
      fetch(config.baseCsvUrl, { cache: 'no-store' }),
      fetch(config.removalCsvUrl, { cache: 'no-store' })
    ]);
    if (!baseResponse.ok || !removalResponse.ok) throw new Error('CSV oficial indisponível');
    const [baseText, removalText] = await Promise.all([baseResponse.text(), removalResponse.text()]);
    const baseRows = parseDelimitedCsv(baseText, config.baseDelimiter || ';');
    const removalRows = parseDelimitedCsv(removalText, config.removalDelimiter || '|');
    const baseUrlColumn = Number.isInteger(config.baseUrlColumn) ? config.baseUrlColumn : 0;
    const removalUrlColumn = Number.isInteger(config.removalUrlColumn) ? config.removalUrlColumn : 1;
    const tagColumn = config.baseColumns?.tags;
    const removalKeys = new Set(removalRows.map((row) => normalizeUrlKey(rowUrl(row, removalUrlColumn))).filter(Boolean));
    if (!Number.isInteger(tagColumn) || !baseRows.length || !removalKeys.size) throw new Error('Estrutura CSV oficial inválida');
    const videoKeys = new Set();
    const tagCounts = new Map();
    for (let index = 0; index < baseRows.length; index += 1) {
      const row = baseRows[index];
      if (index === 0 && String(row[baseUrlColumn] || '').trim().toLowerCase() === String(config.keyField || 'url').toLowerCase()) continue;
      const videoKey = normalizeUrlKey(rowUrl(row, baseUrlColumn));
      if (!videoKey || removalKeys.has(videoKey) || videoKeys.has(videoKey)) continue;
      videoKeys.add(videoKey);
      const tagsInVideo = new Map();
      String(row[tagColumn] || '').split(/[|,]/).forEach((rawTag) => {
        const tag = rawTag.trim();
        const normalized = tag.toLocaleLowerCase('pt-BR');
        if (tag && !tagsInVideo.has(normalized)) tagsInVideo.set(normalized, tag);
      });
      tagsInVideo.forEach((tag, normalized) => {
        const entry = tagCounts.get(normalized);
        if (entry) entry.videoCount += 1;
        else tagCounts.set(normalized, { tag, videoCount: 1 });
      });
    }
    state.tags = [...tagCounts.values()].sort((a, b) => a.tag.localeCompare(b.tag, 'pt-BR', { sensitivity: 'base' }));
    state.tagsLoaded = true;
    const count = tagsToggle.querySelector('.tag-count');
    count.textContent = state.tags.length.toLocaleString('pt-BR');
    count.hidden = false;
    renderPopularTags();
    renderTags();
    console.info(`[FILTROX] ${state.tags.length.toLocaleString('pt-BR')} tags oficiais carregadas; remoções aplicadas.`);
  } catch (error) {
    popularTags.innerHTML = '<p class="tags-placeholder">Não foi possível carregar as tags oficiais agora.</p>';
    tagsStatus.textContent = 'Não foi possível carregar os CSVs oficiais. Confira a conexão e tente novamente.';
    console.warn('[FILTROX] Falha ao carregar as tags oficiais.', error?.name || 'erro');
  } finally {
    state.tagsLoading = false;
  }
}

function render(items) {
  resultGrid.replaceChildren(...items.map((item) => {
    const card = document.createElement('article');
    card.className = 'result-card';
    const imageUrl = safeUrl(item.thumb || item.thumb2);
    const image = imageUrl
      ? `<img class="result-thumb" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : '<div class="result-thumb result-thumb-empty" aria-hidden="true"></div>';
    card.innerHTML = `${image}<div class="result-card-content"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.duration || 'Duração não informada')}</p></div>`;
    const img = card.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        const fallback = safeUrl(item.thumb2);
        if (fallback && img.src !== fallback) img.src = fallback;
        else img.replaceWith(Object.assign(document.createElement('div'), { className: 'result-thumb result-thumb-empty' }));
      });
    }
    return card;
  }));
  noResults.hidden = items.length > 0;
  searchStatus.textContent = items.length
    ? `${items.length.toLocaleString('pt-BR')} ${items.length === 1 ? 'resultado' : 'resultados'} encontrados.`
    : 'Nenhum resultado encontrado para essa busca.';
}

async function loadCatalog() {
  if (!state.query) {
    resultGrid.replaceChildren();
    noResults.hidden = true;
    document.querySelector('#homeResults').hidden = true;
    searchStatus.textContent = 'Digite um termo ou escolha uma tag para começar.';
    return;
  }
  document.querySelector('#homeResults').hidden = false;
  resultGrid.setAttribute('aria-busy', 'true');
  searchStatus.textContent = 'Buscando no catálogo…';
  const params = new URLSearchParams({ sort: state.sort, q: state.query });
  try {
    const response = await fetch(`/api/catalog?${params.toString()}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Busca indisponível.');
    render(Array.isArray(payload.items) ? payload.items : []);
  } catch {
    resultGrid.replaceChildren();
    noResults.hidden = true;
    searchStatus.textContent = 'A busca está temporariamente indisponível. Tente novamente em instantes.';
  } finally {
    resultGrid.removeAttribute('aria-busy');
  }
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.sort = button.dataset.filter;
    filterButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    if (state.query) void loadCatalog();
  });
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim();
  void loadCatalog();
  if (state.query) document.querySelector('#homeResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

tagsToggle.addEventListener('click', () => {
  const open = tagsPanel.hidden;
  tagsPanel.hidden = !open;
  tagsToggle.setAttribute('aria-expanded', String(open));
  if (open) { void loadOfficialTags(); tagsSearch.focus(); }
});

tagsSearch.addEventListener('input', () => { state.shownTags = TAG_PAGE_SIZE; if (state.tagsLoaded) renderTags(); });
tagsMore.addEventListener('click', () => { state.shownTags += TAG_PAGE_SIZE; renderTags(); });
tagsResults.addEventListener('click', (event) => {
  const button = event.target.closest('[data-official-tag]');
  if (button) goToTag(button.dataset.officialTag);
});
popularTags.addEventListener('click', (event) => {
  const button = event.target.closest('[data-popular-tag]');
  if (button) goToTag(button.dataset.popularTag);
});

void loadOfficialTags();
