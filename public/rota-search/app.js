import { searchSepiaVideos } from './api.js';
import { collectTagFacets, filterVideosByTags, formatCount, formatDuration, formatPublishedDate, getEligibleVideos, getEmbedUrl, getVideoHost } from './filters.js';

const $ = (selector, root = document) => root.querySelector(selector);
const state = {
  ageConfirmed: false,
  submittedQuery: '',
  videos: [],
  total: 0,
  nextStart: 0,
  included: [],
  excluded: [],
  tagNeedle: '',
  showAllTags: false,
  loading: false,
  loadingMore: false,
  error: '',
  pageError: '',
  controller: null,
  requestId: 0,
};

const ageGate = $('#ageGate');
const searchApp = $('#searchApp');
const queryInput = $('#queryInput');
const consentInput = $('#searchConsent');
const form = $('#searchForm');
const submitButton = $('#searchButton');
const filterPanel = $('#filterPanel');
const videoGrid = $('#videoGrid');
const resultState = $('#resultState');
const resultCount = $('#resultCount');
const loadMoreWrap = $('#loadMoreWrap');
const loadMoreButton = $('#loadMoreButton');

$('#confirmAge').addEventListener('click', () => {
  state.ageConfirmed = true;
  ageGate.hidden = true;
  searchApp.hidden = false;
  queryInput.focus();
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setMessage(node, message, { hidden = false, isError = false } = {}) {
  node.textContent = message;
  node.hidden = hidden;
  node.classList.toggle('is-error', isError);
}

async function requestPage(query, start, append) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const requestId = ++state.requestId;
  if (append) {
    state.loadingMore = true;
    state.pageError = '';
  } else {
    state.submittedQuery = query;
    state.videos = [];
    state.total = 0;
    state.nextStart = 0;
    state.included = [];
    state.excluded = [];
    state.tagNeedle = '';
    state.showAllTags = false;
    state.error = '';
    state.pageError = '';
    state.loading = true;
  }
  render();

  try {
    const page = await searchSepiaVideos({ query, start, signal: controller.signal });
    if (requestId !== state.requestId) return;
    if (append) {
      const seen = new Set(state.videos.map((video) => video.uuid));
      state.videos = [...state.videos, ...page.data.filter((video) => !seen.has(video.uuid))];
    } else {
      state.videos = page.data;
    }
    state.total = page.total;
    state.nextStart = page.rawCount === 0 ? page.total : start + page.rawCount;
  } catch (error) {
    if (controller.signal.aborted || requestId !== state.requestId) return;
    const message = error instanceof Error ? error.message : 'Ocorreu um erro inesperado na busca.';
    if (append) state.pageError = message;
    else state.error = message;
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      state.loadingMore = false;
      render();
    }
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.ageConfirmed) return;
  const query = queryInput.value.trim();
  if (!query) {
    setMessage($('#searchError'), 'Digite um termo antes de buscar.', { isError: true });
    queryInput.focus();
    return;
  }
  if (query.length > 200) {
    setMessage($('#searchError'), 'Use até 200 caracteres no termo de busca.', { isError: true });
    return;
  }
  if (!consentInput.checked) {
    setMessage($('#searchError'), 'Para consultar, marque a autorização: o termo será enviado ao SepiaSearch.', { isError: true });
    consentInput.focus();
    return;
  }
  setMessage($('#searchError'), '', { hidden: true });
  consentInput.checked = false;
  void requestPage(query, 0, false);
});

loadMoreButton.addEventListener('click', () => {
  if (state.loading || state.loadingMore || !state.submittedQuery || state.nextStart >= state.total) return;
  void requestPage(state.submittedQuery, state.nextStart, true);
});

function toggleTag(group, tag) {
  const current = state[group];
  state[group] = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
  render();
}

function renderFilters(eligible) {
  filterPanel.replaceChildren();
  const heading = element('div', 'filter-heading');
  heading.append(element('p', 'eyebrow', state.submittedQuery ? 'FACETAS DA BUSCA' : 'REFINO LOCAL'));
  heading.append(element('h2', '', 'Tags mais frequentes'));
  filterPanel.append(heading);

  if (!state.submittedQuery) {
    filterPanel.append(element('p', 'filter-help', 'Faça uma busca confirmada para gerar tags a partir dos vídeos elegíveis. Nenhuma categoria fixa é usada.'));
    return;
  }

  const intro = element('p', 'filter-help', 'Tags dos resultados elegíveis carregados. Incluir aceita qualquer tag selecionada; Excluir remove vídeos com qualquer tag selecionada. Os dois grupos são aplicados juntos, sem nova chamada à API.');
  filterPanel.append(intro);
  const selected = element('div', 'selected-groups');
  const includeLine = element('p', 'selected-line');
  includeLine.append(element('strong', 'include-label', 'INCLUIR'), document.createTextNode(state.included.length ? state.included.join(', ') : 'nenhuma'));
  const excludeLine = element('p', 'selected-line');
  excludeLine.append(element('strong', 'exclude-label', 'EXCLUIR'), document.createTextNode(state.excluded.length ? state.excluded.join(', ') : 'nenhuma'));
  selected.append(includeLine, excludeLine);
  filterPanel.append(selected);

  const clearButton = element('button', 'text-button clear-tags', 'Limpar filtros');
  clearButton.type = 'button';
  clearButton.disabled = !state.included.length && !state.excluded.length;
  clearButton.addEventListener('click', () => { state.included = []; state.excluded = []; render(); });
  filterPanel.append(clearButton);

  const facets = collectTagFacets(eligible);
  if (!facets.length) {
    filterPanel.append(element('p', 'filter-empty', 'Não há tags nos vídeos elegíveis carregados.'));
    return;
  }
  const tagSearchLabel = element('label', 'sr-only', 'Filtrar tags disponíveis');
  tagSearchLabel.htmlFor = 'tagFilterInput';
  const tagSearch = element('input', 'tag-filter-input');
  tagSearch.id = 'tagFilterInput';
  tagSearch.type = 'search';
  tagSearch.placeholder = 'Localizar uma tag…';
  tagSearch.autocomplete = 'off';
  tagSearch.value = state.tagNeedle;
  tagSearch.addEventListener('input', () => { state.tagNeedle = tagSearch.value; renderFilters(eligible); const refreshed = $('#tagFilterInput'); refreshed.focus(); refreshed.setSelectionRange(refreshed.value.length, refreshed.value.length); });
  filterPanel.append(tagSearchLabel, tagSearch);

  const matching = facets.filter((item) => item.name.toLocaleLowerCase('pt-BR').includes(state.tagNeedle.trim().toLocaleLowerCase('pt-BR')));
  const visible = state.showAllTags || state.tagNeedle ? matching : matching.slice(0, 10);
  const list = element('div', 'tag-list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Tags dinâmicas dos resultados');
  for (const facet of visible) {
    const row = element('div', 'tag-row');
    row.setAttribute('role', 'listitem');
    const name = element('span', 'tag-name', facet.name);
    name.title = facet.name;
    const count = element('span', 'tag-count', String(facet.count));
    count.setAttribute('aria-label', `${facet.count} vídeos`);
    const actions = element('div', 'tag-actions');
    const include = element('button', `tag-action include-action${state.included.includes(facet.key) ? ' is-active' : ''}`, '+');
    include.type = 'button'; include.setAttribute('aria-pressed', String(state.included.includes(facet.key))); include.setAttribute('aria-label', `${state.included.includes(facet.key) ? 'Remover inclusão de' : 'Incluir'} ${facet.name}`); include.addEventListener('click', () => toggleTag('included', facet.key));
    const exclude = element('button', `tag-action exclude-action${state.excluded.includes(facet.key) ? ' is-active' : ''}`, '−');
    exclude.type = 'button'; exclude.setAttribute('aria-pressed', String(state.excluded.includes(facet.key))); exclude.setAttribute('aria-label', `${state.excluded.includes(facet.key) ? 'Remover exclusão de' : 'Excluir'} ${facet.name}`); exclude.addEventListener('click', () => toggleTag('excluded', facet.key));
    actions.append(include, exclude);
    row.append(name, count, actions);
    list.append(row);
  }
  filterPanel.append(list);
  if (!state.tagNeedle && facets.length > 10) {
    const expand = element('button', 'text-button expand-tags', state.showAllTags ? 'Mostrar top 10' : `Ver todas as ${facets.length} tags`);
    expand.type = 'button'; expand.setAttribute('aria-expanded', String(state.showAllTags)); expand.addEventListener('click', () => { state.showAllTags = !state.showAllTags; render(); });
    filterPanel.append(expand);
  }
  const occurrenceCount = facets.reduce((sum, item) => sum + item.count, 0);
  filterPanel.append(element('p', 'filter-footnote', `${facets.length} tags únicas · ${occurrenceCount} ocorrências em vídeos elegíveis carregados.`));
}

function sourceIdentity(video) {
  const identity = video.account || video.channel || video.videoChannel;
  return identity?.displayName || identity?.name || '';
}

function addMetaLine(container, label, value) {
  if (!value) return;
  const item = element('span', '', `${label}: ${value}`);
  container.append(item);
}

function buildPlayer(video, embedUrl, stage) {
  const frame = element('div', 'player-frame');
  const iframe = document.createElement('iframe');
  iframe.title = `Player incorporado: ${video.name}`;
  iframe.src = embedUrl;
  iframe.loading = 'eager';
  iframe.referrerPolicy = 'no-referrer';
  iframe.allow = 'encrypted-media; fullscreen; picture-in-picture';
  iframe.allowFullscreen = true;
  const status = element('p', 'player-status', 'Carregando o player da instância. Se não funcionar, abra o vídeo na origem.');
  iframe.addEventListener('error', () => { status.textContent = 'O player não carregou. Use o link para abrir o vídeo no PeerTube de origem.'; status.classList.add('is-error'); });
  const close = element('button', 'close-player', 'Fechar player');
  close.type = 'button';
  close.addEventListener('click', () => {
    frame.replaceChildren(element('p', 'player-closed', 'Player fechado.'));
    close.remove();
    stage.querySelector('.play-button')?.removeAttribute('disabled');
  });
  frame.append(iframe, status, close);
  stage.replaceChildren(frame);
}

function makeVideoCard(video) {
  const card = element('article', 'video-card');
  const host = getVideoHost(video);
  const embedUrl = getEmbedUrl(video);
  const stage = element('div', 'video-stage');
  const poster = element('div', 'video-poster');
  poster.append(element('span', 'poster-mark', 'F'));
  poster.append(element('span', 'poster-category', 'PEERTUBE · PÚBLICO · 18+'));
  poster.append(element('span', 'poster-title', video.name));
  const duration = formatDuration(video.duration);
  if (duration) poster.append(element('span', 'poster-duration', duration));
  if (embedUrl) {
    const play = element('button', 'play-button', '▶  Reproduzir aqui');
    play.type = 'button';
    play.addEventListener('click', () => buildPlayer(video, embedUrl, stage), { once: true });
    poster.append(play);
  } else {
    poster.append(element('span', 'embed-unavailable', 'Player incorporado indisponível'));
  }
  stage.append(poster);
  card.append(stage);

  const body = element('div', 'video-body');
  const titleRow = element('div', 'video-title-row');
  const title = element('h3', '', video.name);
  title.title = video.name;
  titleRow.append(title, element('span', 'explicit-badge', '18+'));
  body.append(titleRow);
  const identity = sourceIdentity(video);
  body.append(element('p', 'video-source', identity ? `${identity} · ${host}` : host));
  const metadata = element('div', 'video-meta');
  addMetaLine(metadata, 'Duração', duration);
  addMetaLine(metadata, 'Visualizações', formatCount(video.views));
  addMetaLine(metadata, 'Curtidas', formatCount(video.likes));
  addMetaLine(metadata, 'Publicado', formatPublishedDate(video.publishedAt || video.createdAt));
  metadata.append(element('span', 'metadata-public', 'Público · flag EXPLICIT_SEX'));
  body.append(metadata);

  if (video.tags.length) {
    const tags = element('div', 'video-tags');
    tags.setAttribute('aria-label', 'Tags do vídeo');
    for (const tag of video.tags) tags.append(element('span', 'video-tag', tag));
    body.append(tags);
  }
  const actions = element('div', 'video-actions');
  const sourceLink = element('a', 'source-link', 'Abrir no PeerTube original ↗');
  sourceLink.href = video.url;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  sourceLink.referrerPolicy = 'no-referrer';
  actions.append(sourceLink);
  body.append(actions);
  body.append(element('p', 'contact-note', embedUrl ? 'O host só é contatado ao carregar o player ou abrir o link original.' : 'O player seguro não está disponível; o link original abre a instância do vídeo.'));
  card.append(body);
  return card;
}

function renderResults(eligible, visible) {
  videoGrid.replaceChildren(...visible.map(makeVideoCard));
  const hiddenCount = Math.max(0, state.videos.length - eligible.length);
  $('#filterSummary').hidden = !hiddenCount;
  $('#filterSummary').textContent = hiddenCount ? `${hiddenCount} registro(s) não exibidos por não atenderem aos critérios de privacidade pública e flag EXPLICIT_SEX.` : '';

  const canLoadMore = Boolean(state.submittedQuery) && state.nextStart < state.total && state.videos.length > 0;
  loadMoreWrap.hidden = !canLoadMore;
  loadMoreButton.disabled = state.loadingMore;
  loadMoreButton.textContent = state.loadingMore ? 'Carregando…' : 'Carregar mais';
  $('#paginationError').hidden = !state.pageError;
  $('#paginationError').textContent = state.pageError;

  if (state.loading) {
    resultState.hidden = false;
    resultState.className = 'state-card is-loading';
    resultState.textContent = 'Buscando no índice SepiaSearch…';
  } else if (state.error) {
    resultState.hidden = false;
    resultState.className = 'state-card is-error';
    resultState.textContent = state.error;
  } else if (!state.submittedQuery) {
    resultState.hidden = false;
    resultState.className = 'state-card';
    resultState.textContent = 'Nenhuma consulta é feita ao abrir esta página. Confirme a idade e, para buscar, autorize o envio do termo ao SepiaSearch.';
  } else if (!state.videos.length) {
    resultState.hidden = false;
    resultState.className = 'state-card';
    resultState.textContent = 'Nenhum resultado retornado. Tente outro termo ou uma grafia diferente.';
  } else if (!eligible.length) {
    resultState.hidden = false;
    resultState.className = 'state-card';
    resultState.textContent = 'Nenhum vídeo elegível foi encontrado nesta página. São exibidos somente registros públicos com a flag EXPLICIT_SEX.';
  } else if (!visible.length) {
    resultState.hidden = false;
    resultState.className = 'state-card';
    resultState.textContent = 'Nenhum vídeo corresponde aos filtros locais atuais. Remova tags de Incluir ou Excluir para ampliar os resultados.';
  } else {
    resultState.hidden = true;
    resultState.className = 'state-card';
    resultState.textContent = '';
  }
  resultCount.textContent = state.submittedQuery && !state.loading ? `${visible.length} exibidos · ${eligible.length} elegíveis carregados` : '';
  $('#resultsTitle').textContent = state.submittedQuery ? `Busca: “${state.submittedQuery}”` : 'Resultados da busca';
}

function render() {
  const eligible = getEligibleVideos(state.videos);
  const visible = filterVideosByTags(eligible, state.included, state.excluded);
  renderFilters(eligible);
  renderResults(eligible, visible);
  submitButton.disabled = state.loading;
  submitButton.textContent = state.loading ? 'Buscando…' : 'Buscar vídeos';
}

render();
