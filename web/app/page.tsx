'use client';

import { useEffect, useMemo } from 'react';
import {
  Bookmark, Check, ChevronLeft, ChevronRight, Clock3, Eye, Film, Filter, Heart,
  History, LoaderCircle, Play, Search, ShieldAlert, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import { CatalogItem, optionValue, useFILTROXStore } from '@/lib/store';

function labelOf(value: string | { name?: string; tag?: string; code?: string; label?: string }): string {
  return typeof value === 'string' ? value : value.name || value.tag || value.label || value.code || '';
}

function durationOf(item: CatalogItem): string {
  if (typeof item.duration === 'string' && item.duration.trim()) return item.duration;
  const seconds = typeof item.duration_seconds === 'number' ? item.duration_seconds : Number(item.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function termsInput(value: string, update: (value: string) => void, placeholder: string) {
  return <textarea value={value} onChange={(event) => update(event.target.value)} rows={2} placeholder={placeholder} className="advanced-input" />;
}

export default function HomePage() {
  const configured = useFILTROXStore((state) => state.configured);
  const activeTab = useFILTROXStore((state) => state.activeTab);
  const criteria = useFILTROXStore((state) => state.criteria);
  const setCriteria = useFILTROXStore((state) => state.setCriteria);
  const setTab = useFILTROXStore((state) => state.setTab);
  const searchCatalog = useFILTROXStore((state) => state.searchCatalog);
  const filters = useFILTROXStore((state) => state.filters);
  const catalogItems = useFILTROXStore((state) => state.catalogItems);
  const historyItems = useFILTROXStore((state) => state.historyItems);
  const favoriteItems = useFILTROXStore((state) => state.favoriteItems);
  const favoriteIds = useFILTROXStore((state) => state.favoriteIds);
  const watchedIds = useFILTROXStore((state) => state.watchedIds);
  const total = useFILTROXStore((state) => state.total);
  const page = useFILTROXStore((state) => state.page);
  const pageSize = useFILTROXStore((state) => state.pageSize);
  const loading = useFILTROXStore((state) => state.loading);
  const error = useFILTROXStore((state) => state.error);
  const notice = useFILTROXStore((state) => state.notice);
  const setNotice = useFILTROXStore((state) => state.setNotice);
  const toggleFavorite = useFILTROXStore((state) => state.toggleFavorite);
  const markWatched = useFILTROXStore((state) => state.markWatched);
  const clearHistory = useFILTROXStore((state) => state.clearHistory);

  useEffect(() => {
    if (configured) void searchCatalog(1);
  }, [configured, searchCatalog]);

  const items = activeTab === 'search' ? catalogItems : activeTab === 'history' ? historyItems : favoriteItems;
  const pageCount = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  const pages = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, pageCount - 4));
    return Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index);
  }, [page, pageCount]);

  function play(item: CatalogItem) {
    const target = item.url;
    try {
      const parsed = target ? new URL(target) : null;
      const host = parsed?.hostname.toLowerCase() || '';
      const allowedHost = host === 'xvideos.com' || host.endsWith('.xvideos.com');
      if (!parsed || parsed.protocol !== 'https:' || !allowedHost || parsed.username || parsed.password || !["", "443"].includes(parsed.port)) {
        setNotice('Não foi fornecido um link HTTPS válido do Xvideos para este item.');
        return;
      }
      window.open(parsed.href, '_blank', 'noopener,noreferrer');
      void markWatched(item);
      setNotice('Conteúdo aberto na página oficial do Xvideos em outra aba.');
    } catch {
      setNotice('Não foi possível abrir um link oficial válido para este item.');
    }
  }

  function toggleTag(value: string, type: 'includeTags' | 'excludeTags') {
    const current = criteria[type];
    const next = current.includes(value) ? current.filter((tag) => tag !== value) : [...current, value];
    const other = type === 'includeTags' ? 'excludeTags' : 'includeTags';
    setCriteria({ [type]: next, [other]: criteria[other].filter((tag) => tag !== value) });
  }

  const selectedTabLabel = activeTab === 'search' ? 'resultados' : activeTab === 'history' ? 'histórico' : 'favoritos';

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="FILTROX início"><img src="/filtrox-mark.svg" alt="FILTROX" width="190" height="40" /></a>
        <div className="topbar-right"><span className="status-dot" /> <span>Busca inteligente</span><span className="topbar-separator">·</span><span>v1</span></div>
      </header>

      <section className="hero" id="inicio">
        <p className="eyebrow"><span className="eyebrow-line" /> FILTROX <span className="eyebrow-line" /></p>
        <h1>Encontre o que <span>você procura.</span></h1>
        <p className="hero-copy">Uma busca mais precisa, com filtros do seu jeito.</p>
      </section>

      {!configured && <section className="config-warning" role="status">
        <ShieldAlert size={19} aria-hidden="true" />
        <div><strong>Provedor não configurado</strong><p>Busca, histórico e favoritos ficam vazios até configurar o backend e o provedor de login/verificação de idade. Nenhuma confirmação de maioridade é simulada.</p></div>
      </section>}

      <nav className="tabs" aria-label="Seções do catálogo">
        <button className={activeTab === 'search' ? 'tab active' : 'tab'} onClick={() => setTab('search')}><Search size={16} /> Buscar</button>
        <button className={activeTab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}><History size={16} /> Histórico</button>
        <button className={activeTab === 'favorites' ? 'tab active' : 'tab'} onClick={() => setTab('favorites')}><Heart size={16} /> Favoritos</button>
      </nav>

      {activeTab === 'search' && <form className="search-panel" onSubmit={(event) => { event.preventDefault(); void searchCatalog(1); }}>
        <label className="search-label" htmlFor="query">Busca</label>
        <div className="search-row">
          <Search className="search-icon" size={20} aria-hidden="true" />
          <input id="query" value={criteria.query} onChange={(event) => setCriteria({ query: event.target.value })} placeholder="Buscar no catálogo…" disabled={!configured} />
          <button className="search-submit" type="submit" disabled={!configured || loading}><Search size={17} /> <span>Buscar</span></button>
        </div>
        <details className="advanced">
          <summary><SlidersHorizontal size={16} /> Busca avançada <span>AND · frases exatas · termos opcionais</span></summary>
          <div className="advanced-grid">
            <label>Todos estes termos <small>(AND)</small>{termsInput(criteria.requiredText, (requiredText) => setCriteria({ requiredText }), 'Um termo por linha ou separado por vírgula')}</label>
            <label>Frases exatas <small>(uma por linha)</small>{termsInput(criteria.exactText, (exactText) => setCriteria({ exactText }), 'Ex.: "frase exata"')}</label>
            <label>Termos opcionais{termsInput(criteria.optionalText, (optionalText) => setCriteria({ optionalText }), 'Ex.: termo A, termo B')}</label>
            <label>Excluir termos{termsInput(criteria.excludedText, (excludedText) => setCriteria({ excludedText }), 'Termos que não devem aparecer')}</label>
            <label>Equivalências incluídas{termsInput(criteria.includedEquivalentsText, (includedEquivalentsText) => setCriteria({ includedEquivalentsText }), 'Somente equivalências que você escolher')}</label>
            <label>Equivalências excluídas{termsInput(criteria.excludedEquivalentsText, (excludedEquivalentsText) => setCriteria({ excludedEquivalentsText }), 'Excluir equivalências escolhidas')}</label>
          </div>
          <div className="tag-filters">
            <div className="tag-heading"><Filter size={15} /> Tags da API <span>— incluir / excluir</span></div>
            {filters.tags.length ? <div className="tag-list">{filters.tags.map((tag) => {
              const value = labelOf(tag);
              if (!value) return null;
              const sources = typeof tag === 'string' ? [] : tag.sources || [];
              return <div className="tag-row" key={value}><span title={sources.length ? `${value} · fontes: ${sources.join(', ')}` : value}>{value}</span><button type="button" onClick={() => toggleTag(value, 'includeTags')} className={criteria.includeTags.includes(value) ? 'tag-choice chosen' : 'tag-choice'} aria-label={`Incluir tag ${value}`} title={sources.length ? `Fontes: ${sources.join(', ')}` : undefined}>+ Incluir</button><button type="button" onClick={() => toggleTag(value, 'excludeTags')} className={criteria.excludeTags.includes(value) ? 'tag-choice excluded' : 'tag-choice'} aria-label={`Excluir tag ${value}`} title={sources.length ? `Fontes: ${sources.join(', ')}` : undefined}>− Excluir</button></div>;
            })}</div> : <p className="muted-note">As tags disponíveis serão carregadas pela API.</p>}
          </div>
        </details>
        <div className="filter-row">
          <label>Idioma<select value={criteria.language} onChange={(event) => setCriteria({ language: event.target.value })} disabled={!configured}><option value="">Todos</option>{filters.languages.map((option) => <option key={optionValue(option)} value={optionValue(option)}>{labelOf(option)}</option>)}</select></label>
          <label>País<select value={criteria.country} onChange={(event) => setCriteria({ country: event.target.value })} disabled={!configured}><option value="">Todos</option>{filters.countries.map((option) => <option key={optionValue(option)} value={optionValue(option)}>{labelOf(option)}</option>)}</select></label>
          <label>Ordenar<select value={criteria.sort} onChange={(event) => setCriteria({ sort: event.target.value as 'recent' | 'most_viewed' })} disabled={!configured}><option value="recent">Mais recentes</option><option value="most_viewed">Mais vistos</option></select></label>
          <label>Desempate<select value={criteria.sortSecondary} onChange={(event) => setCriteria({ sortSecondary: event.target.value as '' | 'recent' | 'most_viewed' })} disabled={!configured}><option value="">Sem segundo critério</option><option value="recent" disabled={criteria.sort === 'recent'}>Mais recentes</option><option value="most_viewed" disabled={criteria.sort === 'most_viewed'}>Mais vistos</option></select></label>
          <label className="check-filter"><input type="checkbox" checked={criteria.hideWatched} onChange={(event) => setCriteria({ hideWatched: event.target.checked })} disabled={!configured} /> <span>Ocultar assistidos</span></label>
          <button className="apply-filters" type="button" disabled={!configured || loading} onClick={() => void searchCatalog(1)}><Filter size={15} /> Aplicar filtros</button>
        </div>
      </form>}

      <section className="results-section" aria-live="polite">
        <div className="results-heading"><div><p className="eyebrow-small">{activeTab === 'search' ? 'CATÁLOGO' : activeTab === 'history' ? 'SUA ATIVIDADE' : 'SALVOS'}</p><h2>{activeTab === 'search' ? 'Resultados' : activeTab === 'history' ? 'Histórico' : 'Favoritos'}</h2></div>
          <div className="results-actions">
            {activeTab === 'history' && configured && items.length > 0 && <button className="clear-history" type="button" disabled={loading} onClick={() => { if (window.confirm('Apagar todo o seu histórico? Esta ação não pode ser desfeita.')) void clearHistory(); }}><Trash2 size={15} /> Limpar histórico</button>}
            {configured && <span className="result-count">{total > 0 && activeTab === 'search' ? `${total.toLocaleString('pt-BR')} ${selectedTabLabel}` : items.length ? `${items.length} ${selectedTabLabel}` : '—'}</span>}
          </div>
        </div>

        {(error || notice) && <div className={error ? 'inline-message error-message' : 'inline-message'} role="status"><span>{error || notice}</span><button onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={16} /></button></div>}

        {loading && <div className="loading-state"><LoaderCircle className="spin" size={24} /><span>Carregando…</span></div>}
        {!loading && configured && items.length === 0 && <div className="empty-state"><span className="empty-icon"><Film size={24} /></span><h3>Nenhum item para mostrar</h3><p>{error ? 'Verifique a conexão com o backend e tente novamente.' : activeTab === 'search' ? 'Faça uma busca para consultar os itens fornecidos pelo catálogo.' : 'Os itens desta seção aparecem quando o serviço estiver conectado.'}</p></div>}
        {!configured && <div className="empty-state"><span className="empty-icon"><ShieldAlert size={24} /></span><h3>Catálogo indisponível</h3><p>Configure o backend e a integração de login/verificação de idade para carregar conteúdo real.</p></div>}

        {!loading && items.length > 0 && <div className="card-grid">{items.map((item) => {
          const id = String(item.id);
          const favorite = favoriteIds.includes(id) || Boolean(item.is_favorite);
          const watched = watchedIds.includes(id) || Boolean(item.watched);
          const duration = durationOf(item);
          const views = Number(item.view_count ?? item.views);
          const image = item.thumbnail_url || item.image_url;
          return <article className="item-card" key={id}>
            <div className="poster">
              {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="poster-placeholder"><Film size={30} /></div>}
              {duration && <span className="duration"><Clock3 size={12} /> {duration}</span>}
              {watched && <span className="watched-badge"><Check size={12} /> Assistido</span>}
              <button className={favorite ? 'favorite-button is-favorite' : 'favorite-button'} onClick={() => void toggleFavorite(item)} disabled={!configured} aria-label={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></button>
            </div>
            <div className="card-body"><h3 title={item.title}>{item.title || 'Título não informado'}</h3><div className="card-meta"><span>{item.source_name || item.source || 'Fonte oficial'}</span>{Number.isFinite(views) && views > 0 && <span><Eye size={13} /> {views.toLocaleString('pt-BR')}</span>}</div>
              <button className="play-button" onClick={() => play(item)}><Play size={15} fill="currentColor" /> Play <span>fonte oficial</span></button>
            </div>
          </article>;
        })}</div>}

        {activeTab === 'search' && configured && total > pageSize && <nav className="pagination" aria-label="Paginação dos resultados">
          <button className="page-arrow" disabled={page <= 1 || loading} onClick={() => void searchCatalog(page - 1)} aria-label="Página anterior"><ChevronLeft size={18} /></button>
          {pages.map((number) => <button key={number} className={number === page ? 'page-number selected' : 'page-number'} aria-current={number === page ? 'page' : undefined} onClick={() => void searchCatalog(number)} disabled={loading}>{number}</button>)}
          <button className="page-arrow" disabled={page >= pageCount || loading} onClick={() => void searchCatalog(page + 1)} aria-label="Próxima página"><ChevronRight size={18} /></button>
          <span className="page-caption">30 por página</span>
        </nav>}
      </section>

      <footer className="footer-note"><Bookmark size={14} /> Conteúdo somente das fontes aprovadas e carregado após uma ação explícita.</footer>
    </main>
  );
}
