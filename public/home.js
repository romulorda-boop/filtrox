const filterButtons = [...document.querySelectorAll('[data-filter]')];
const searchForm = document.querySelector('#homeSearch');
const searchInput = document.querySelector('#homeSearchInput');
const resultGrid = document.querySelector('#homeResultGrid');
const noResults = document.querySelector('#homeNoResults');

const state = { query: '', sort: 'recent' };

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

function render(items) {
  resultGrid.replaceChildren(...items.map((item) => {
    const card = document.createElement('article');
    card.className = 'result-card';
    const imageUrl = safeUrl(item.thumb || item.thumb2);
    const image = imageUrl
      ? `<img class="result-thumb" src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : '<div class="result-thumb result-thumb-empty" aria-hidden="true"></div>';
    card.innerHTML = `${image}<div class="result-card-content"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.duration || 'Duração não informada')}</p></div>`;
    const img = card.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        if (item.thumb2 && img.src !== item.thumb2) img.src = safeUrl(item.thumb2);
        else img.replaceWith(Object.assign(document.createElement('div'), { className: 'result-thumb result-thumb-empty' }));
      });
    }
    return card;
  }));
  noResults.hidden = items.length > 0;
}

async function loadCatalog() {
  resultGrid.setAttribute('aria-busy', 'true');
  const params = new URLSearchParams({ sort: state.sort });
  if (state.query) params.set('q', state.query);
  try {
    const response = await fetch(`/api/catalog?${params.toString()}`, { cache: 'no-store' });
    const payload = await response.json();
    render(response.ok && Array.isArray(payload.items) ? payload.items : []);
  } catch {
    render([]);
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
    void loadCatalog();
  });
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim();
  void loadCatalog();
});

void loadCatalog();
