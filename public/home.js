const filterButtons = [...document.querySelectorAll('[data-filter]')];
const searchForm = document.querySelector('#homeSearch');
const searchInput = document.querySelector('#homeSearchInput');
const randomButton = document.querySelector('#homeRandom');
const resultGrid = document.querySelector('#homeResultGrid');
const noResults = document.querySelector('#homeNoResults');
const resultSummary = document.querySelector('#homeResultSummary');
const loadMoreButton = document.querySelector('#homeLoadMore');
const popularTags = document.querySelector('#homePopularTags');
const popularStatus = document.querySelector('#homePopularStatus');
const tagsToggle = document.querySelector('#homeTagsToggle');
const tagsPanel = document.querySelector('#homeTagsPanel');
const tagsSearch = document.querySelector('#homeTagSearch');
const tagsStatus = document.querySelector('#homeTagStatus');
const tagsResults = document.querySelector('#homeTagResults');
const tagsMore = document.querySelector('#homeTagsMore');
const ageGate = document.querySelector('#homeAgeGate');
const homeApp = document.querySelector('#homeApp');
const confirmAgeButton = document.querySelector('#homeConfirmAge');
const denyAgeButton = document.querySelector('#homeDenyAge');
const ageDeniedMessage = document.querySelector('#homeAgeDenied');
const PAGE_SIZE = 48;
const TAG_PAGE_SIZE = 100;
const POPULAR_TAGS_SIZE = 30;
const state = {
  query: '', tag: '', sort: 'recent', tags: [], shownTags: TAG_PAGE_SIZE,
  tagsLoaded: false, tagsLoading: false, items: [], total: 0,
  loading: false, loadingMore: false, requestId: 0, ageConfirmed: false,
  randomSelection: false
};
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
function updateSortAvailability(columns = {}) {
  const requirements = {
    commented: ['comments', 'comentários'],
    rated: ['rating', 'avaliações']
  };
  for (const button of filterButtons) {
    const requirement = requirements[button.dataset.filter];
    if (!requirement) continue;
    const [field, label] = requirement;
    if (!Number.isInteger(columns[field])) {
      button.disabled = true;
      button.title = `Indisponível: o CSV oficial não fornece a coluna de ${label}.`;
      button.setAttribute('aria-label', `${button.textContent.trim()}, indisponível porque o CSV oficial não fornece ${label}`);
    }
  }
}
async function requestCatalog({ mode = 'search', offset = 0, limit = PAGE_SIZE } = {}) {
  if (!state.ageConfirmed) throw new Error('Confirmação 18+ necessária.');
  const response = await fetch('/api/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      mode,
      ageConfirmed: state.ageConfirmed,
      query: state.query,
      tag: state.tag,
      sort: state.sort,
      offset,
      limit
    })
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error('Resposta inválida da API do catálogo.'); }
  if (!response.ok || payload.error) throw new Error('API do catálogo indisponível.');
  return payload;
}
function renderResults() {
  resultGrid.replaceChildren(...state.items.map((item) => {
    const card = document.createElement('article');
    card.className = 'result-card';
    const detail = [item.category, item.cast || item.publisher].filter(Boolean).join(' · ');
    card.innerHTML = `<div class="result-thumb result-thumb-empty" aria-hidden="true"></div><div class="result-card-content"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.duration || 'Duração não informada')}${detail ? ` · ${escapeHtml(detail)}` : ''}</p></div>`;
    return card;
  }));
  noResults.textContent = 'Nenhum resultado encontrado';
  noResults.hidden = state.total > 0;
  loadMoreButton.hidden = state.items.length >= state.total;
  loadMoreButton.disabled = state.loadingMore;
  loadMoreButton.textContent = state.loadingMore
    ? 'Carregando…'
    : `Carregar mais resultados (${Math.max(0, state.total - state.items.length).toLocaleString('pt-BR')})`;
  resultSummary.textContent = state.total
    ? state.randomSelection
      ? 'Uma sugestão aleatória do catálogo oficial.'
      : `${state.total.toLocaleString('pt-BR')} ${state.total === 1 ? 'resultado' : 'resultados'}${state.query ? ` para “${state.query}”` : ' no catálogo oficial'} · mostrando ${state.items.length.toLocaleString('pt-BR')}`
    : '';
}
async function loadCatalog() {
  if (!state.ageConfirmed) return;
  const requestId = ++state.requestId;
  randomButton.disabled = false;
  state.loading = true;
  state.loadingMore = false;
  state.randomSelection = false;
  state.items = [];
  state.total = 0;
  resultGrid.setAttribute('aria-busy', 'true');
  noResults.hidden = true;
  loadMoreButton.hidden = true;
  resultSummary.textContent = 'Carregando catálogo oficial…';
  try {
    const payload = await requestCatalog({ offset: 0, limit: PAGE_SIZE });
    if (requestId !== state.requestId) return;
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.total = Number(payload.total) || 0;
    renderResults();
  } catch {
    if (requestId !== state.requestId) return;
    resultGrid.replaceChildren();
    noResults.textContent = 'Não foi possível carregar o catálogo oficial. Confira a conexão e a configuração dos CSVs.';
    noResults.hidden = false;
    loadMoreButton.hidden = true;
    resultSummary.textContent = '';
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      resultGrid.removeAttribute('aria-busy');
    }
  }
}
async function loadRandomResult() {
  if (!state.ageConfirmed || state.loading || state.loadingMore) return;
  state.query = '';
  state.tag = '';
  searchInput.value = '';
  state.randomSelection = true;
  const requestId = ++state.requestId;
  state.loading = true;
  state.items = [];
  state.total = 0;
  randomButton.disabled = true;
  resultGrid.setAttribute('aria-busy', 'true');
  noResults.hidden = true;
  loadMoreButton.hidden = true;
  resultSummary.textContent = 'Escolhendo uma sugestão…';
  try {
    const payload = await requestCatalog({ mode: 'random', limit: 1 });
    if (requestId !== state.requestId) return;
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.total = Number(payload.total) || 0;
    renderResults();
    if (!state.total) {
      noResults.textContent = 'Nenhum item disponível no catálogo oficial.';
      noResults.hidden = false;
    }
  } catch {
    if (requestId !== state.requestId) return;
    noResults.textContent = 'Não foi possível carregar uma sugestão. Confira a conexão e tente novamente.';
    noResults.hidden = false;
    resultSummary.textContent = '';
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      randomButton.disabled = false;
      resultGrid.removeAttribute('aria-busy');
    }
  }
}
async function loadMoreResults() {
  if (!state.ageConfirmed || state.loading || state.loadingMore || state.items.length >= state.total) return;
  const requestId = state.requestId;
  state.loadingMore = true;
  renderResults();
  try {
    const payload = await requestCatalog({ offset: state.items.length, limit: PAGE_SIZE });
    if (requestId !== state.requestId) return;
    state.items.push(...(Array.isArray(payload.items) ? payload.items : []));
    state.total = Number(payload.total) || state.total;
  } catch {
    if (requestId === state.requestId) {
      noResults.textContent = 'Não foi possível carregar mais resultados. Tente novamente.';
      noResults.hidden = false;
    }
  } finally {
    if (requestId === state.requestId) {
      state.loadingMore = false;
      renderResults();
    }
  }
}
function renderPopularTags() {
  popularTags.setAttribute('aria-busy', 'false');
  const visible = state.tags.slice(0, POPULAR_TAGS_SIZE);
  const fragment = document.createDocumentFragment();
  visible.forEach((item) => {
    const button = document.createElement('button');
    button.className = 'popular-tag';
    button.type = 'button';
    button.setAttribute('role', 'listitem');
    button.dataset.officialTag = item.tag;
    button.setAttribute('aria-label', `${item.tag}, presente em ${item.videoCount.toLocaleString('pt-BR')} vídeos`);
    const name = document.createElement('span'); name.textContent = item.tag;
    const count = document.createElement('span'); count.className = 'popular-tag-count'; count.textContent = item.videoCount.toLocaleString('pt-BR');
    button.append(name, count);
    fragment.append(button);
  });
  popularTags.replaceChildren(fragment);
  if (!state.tags.length) {
    popularStatus.textContent = 'Nenhuma tag disponível no CSV oficial carregado.';
    return;
  }
  popularStatus.textContent = `${state.tags.length.toLocaleString('pt-BR')} tags na base oficial · exibindo as ${visible.length.toLocaleString('pt-BR')} com mais ocorrências.`;
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
    : `${state.tags.length.toLocaleString('pt-BR')} tags encontradas nos CSVs oficiais.`;
}
async function loadOfficialTags() {
  if (!state.ageConfirmed || state.tagsLoaded || state.tagsLoading) return;
  state.tagsLoading = true;
  popularTags.setAttribute('aria-busy', 'true');
  popularStatus.textContent = 'Carregando categorias da base oficial…';
  tagsStatus.textContent = 'Carregando tags da base oficial e aplicando remoções…';
  try {
    const payload = await requestCatalog({ mode: 'tags', limit: 1 });
    state.tags = (Array.isArray(payload.tags) ? payload.tags : [])
      .filter((item) => item && typeof item.tag === 'string')
      .sort((a, b) => (Number(b.videoCount) || 0) - (Number(a.videoCount) || 0) || a.tag.localeCompare(b.tag, 'pt-BR', { sensitivity: 'base' }));
    state.tagsLoaded = true;
    const count = tagsToggle.querySelector('.tag-count');
    count.textContent = state.tags.length.toLocaleString('pt-BR');
    count.hidden = false;
    renderPopularTags();
    renderTags();
  } catch {
    popularTags.setAttribute('aria-busy', 'false');
    popularStatus.textContent = 'Não foi possível carregar as categorias oficiais. Confira a conexão e tente novamente.';
    tagsStatus.textContent = 'Não foi possível carregar as tags oficiais. Confira a conexão e tente novamente.';
  } finally {
    state.tagsLoading = false;
  }
}
function selectOfficialTag(tag) {
  if (!state.ageConfirmed || !state.tags.some((item) => item.tag === tag)) return;
  state.query = tag;
  state.tag = tag;
  state.randomSelection = false;
  searchInput.value = tag;
  void loadCatalog();
}
function setSortButton(button) {
  state.sort = button.dataset.filter;
  state.randomSelection = false;
  filterButtons.forEach((item) => {
    const active = item === button;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-pressed', String(active));
  });
}
filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!state.ageConfirmed || button.disabled) return;
    setSortButton(button);
    state.tag = '';
    void loadCatalog();
  });
});
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.ageConfirmed) return;
  state.query = searchInput.value.trim();
  state.tag = '';
  state.randomSelection = false;
  void loadCatalog();
});
randomButton.addEventListener('click', () => { void loadRandomResult(); });
loadMoreButton.addEventListener('click', () => { void loadMoreResults(); });
tagsToggle.addEventListener('click', () => {
  const open = tagsPanel.hidden;
  tagsPanel.hidden = !open;
  tagsToggle.setAttribute('aria-expanded', String(open));
  if (open) { void loadOfficialTags(); tagsSearch.focus(); }
});
tagsSearch.addEventListener('input', () => { state.shownTags = TAG_PAGE_SIZE; if (state.tagsLoaded) renderTags(); });
tagsMore.addEventListener('click', () => { state.shownTags += TAG_PAGE_SIZE; renderTags(); });
popularTags.addEventListener('click', (event) => {
  const button = event.target.closest('[data-official-tag]');
  if (button) selectOfficialTag(button.dataset.officialTag);
});
tagsResults.addEventListener('click', (event) => {
  const button = event.target.closest('[data-official-tag]');
  if (button) selectOfficialTag(button.dataset.officialTag);
});
const parameters = new URLSearchParams(window.location.search);
const initialTag = parameters.get('tag')?.trim() || '';
state.query = parameters.get('q')?.trim() || initialTag;
state.tag = initialTag;
searchInput.value = state.query;
updateSortAvailability(window.FILTROX_CONFIG?.baseColumns || {});
confirmAgeButton.addEventListener('click', () => {
  state.ageConfirmed = true;
  ageGate.hidden = true;
  homeApp.hidden = false;
  void loadOfficialTags();
  if (state.query || state.tag) void loadCatalog();
});
denyAgeButton.addEventListener('click', () => {
  ageDeniedMessage.hidden = false;
  confirmAgeButton.disabled = true;
});
confirmAgeButton.focus();
