'use client';

import { create } from 'zustand';

export type SortOrder = 'recent' | 'most_viewed';
export type TabKey = 'search' | 'history' | 'favorites';

export interface CatalogItem {
  id: string | number;
  title: string;
  source?: string;
  source_name?: string;
  official_url?: string;
  source_url?: string;
  url?: string;
  thumbnail_url?: string;
  image_url?: string;
  duration?: string | number;
  duration_seconds?: number;
  views?: number;
  view_count?: number;
  watched?: boolean;
  is_favorite?: boolean;
  tags?: Array<string | { name?: string; tag?: string }>;
  [key: string]: unknown;
}

export interface Criteria {
  query: string;
  requiredText: string;
  optionalText: string;
  excludedText: string;
  exactText: string;
  includedEquivalentsText: string;
  excludedEquivalentsText: string;
  includeTags: string[];
  excludeTags: string[];
  language: string;
  country: string;
  hideWatched: boolean;
  sort: SortOrder;
  sortSecondary: SortOrder | '';
}

interface Filters {
  tags: Array<string | { name?: string; tag?: string; count?: number; sources?: string[] }>;
  languages: Array<string | { code?: string; name?: string; label?: string }>;
  countries: Array<string | { code?: string; name?: string; label?: string }>;
}

interface Store {
  configured: boolean;
  activeTab: TabKey;
  criteria: Criteria;
  catalogItems: CatalogItem[];
  historyItems: CatalogItem[];
  favoriteItems: CatalogItem[];
  favoriteIds: string[];
  watchedIds: string[];
  total: number;
  page: number;
  pageSize: number;
  filters: Filters;
  loading: boolean;
  error: string;
  notice: string;
  setCriteria: (patch: Partial<Criteria>) => void;
  setTab: (tab: TabKey) => void;
  searchCatalog: (page?: number) => Promise<void>;
  loadPersonal: (tab: 'history' | 'favorites') => Promise<void>;
  toggleFavorite: (item: CatalogItem) => Promise<void>;
  markWatched: (item: CatalogItem) => Promise<void>;
  clearHistory: () => Promise<void>;
  setNotice: (notice: string) => void;
}

const initialCriteria: Criteria = {
  query: '', requiredText: '', optionalText: '', excludedText: '', exactText: '',
  includedEquivalentsText: '', excludedEquivalentsText: '',
  includeTags: [], excludeTags: [], language: '', country: '', hideWatched: false, sort: 'recent', sortSecondary: '',
};

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/$/, '');
// Deliberately closed until the owner selects an OIDC + age-assurance provider and its
// client adapter is implemented. A public environment flag is not authentication.
const ready = false;

function splitTerms(value: string): string[] {
  return value.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
}

function splitPhrases(value: string): string[] {
  return value.split(/\n+/).map((part) => part.trim()).filter(Boolean);
}

function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    // O cliente não mantém nem envia sessões via cookies.
    credentials: 'omit',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; detail?: string } | null;
    throw new Error(body?.message || body?.detail || `Falha na API (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function unwrapItems(data: unknown): CatalogItem[] {
  const rows = Array.isArray(data) ? data : (data as { items?: unknown } | null)?.items;
  return Array.isArray(rows) ? rows as CatalogItem[] : [];
}

function normalizePersonalItems(data: unknown, tab: 'history' | 'favorites'): CatalogItem[] {
  return unwrapItems(data).map((item) => ({
    ...item,
    id: String(item.id ?? item.video_id ?? ''),
    title: String(item.title || 'Vídeo indisponível'),
    url: String(item.url || item.source_url || ''),
    source: item.source === 'xvideos' ? item.source : '',
    watched: tab === 'history' || Boolean(item.watched),
    is_favorite: tab === 'favorites' || Boolean(item.is_favorite),
  }));
}

function sourceOf(item: CatalogItem): 'xvideos' {
  if (item.source === 'xvideos') return item.source;
  throw new Error('A origem do item não foi validada pelo catálogo.');
}

function toId(item: CatalogItem): string {
  return String(item.id);
}

function normalizeFilters(input: unknown): Filters {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Filters>;
  return {
    tags: Array.isArray(source.tags) ? source.tags : [],
    languages: Array.isArray(source.languages) ? source.languages : [],
    countries: Array.isArray(source.countries) ? source.countries : [],
  };
}

export function optionValue(option: string | { code?: string; name?: string; label?: string; tag?: string }): string {
  if (typeof option === 'string') return option;
  return option.code || option.name || option.tag || option.label || '';
}

export const useFILTROXStore = create<Store>((set, get) => ({
  configured: ready,
  activeTab: 'search',
  criteria: initialCriteria,
  catalogItems: [],
  historyItems: [],
  favoriteItems: [],
  favoriteIds: [],
  watchedIds: [],
  total: 0,
  page: 1,
  pageSize: 30,
  filters: { tags: [], languages: [], countries: [] },
  loading: false,
  error: '',
  notice: '',

  setCriteria: (patch) => set((state) => ({ criteria: { ...state.criteria, ...patch } })),
  setNotice: (notice) => set({ notice }),
  setTab: (activeTab) => {
    set({ activeTab, error: '', notice: '' });
    if (activeTab !== 'search') void get().loadPersonal(activeTab);
  },

  searchCatalog: async (requestedPage = 1) => {
    if (!ready) return;
    set({ loading: true, error: '', notice: '', page: requestedPage });
    const criteria = get().criteria;
    const body = {
      query: criteria.query.trim(),
      required_terms: splitTerms(criteria.requiredText),
      optional_terms: splitTerms(criteria.optionalText),
      excluded_terms: splitTerms(criteria.excludedText),
      exact_phrases: splitPhrases(criteria.exactText),
      included_equivalents: splitTerms(criteria.includedEquivalentsText),
      excluded_equivalents: splitTerms(criteria.excludedEquivalentsText),
      include_tags: criteria.includeTags,
      exclude_tags: criteria.excludeTags,
      language: criteria.language,
      country: criteria.country,
      hide_watched: criteria.hideWatched,
      sort: criteria.sortSecondary && criteria.sortSecondary !== criteria.sort
        ? [criteria.sort, criteria.sortSecondary].map((field) => ({ field, direction: 'desc' }))
        : criteria.sort,
      page: requestedPage,
      page_size: 30,
    };
    try {
      const data = await request('/v1/catalog/search', { method: 'POST', body: JSON.stringify(body) }) as {
        items?: CatalogItem[]; total?: number; page?: number; page_size?: number; filters?: unknown;
      } | null;
      const items = Array.isArray(data?.items) ? data.items : [];
      set((state) => ({
        catalogItems: items,
        total: Number(data?.total) || 0,
        page: Number(data?.page) || requestedPage,
        pageSize: Number(data?.page_size) || 30,
        filters: normalizeFilters(data?.filters),
        favoriteIds: Array.from(new Set([...state.favoriteIds, ...items.filter((item) => item.is_favorite).map(toId)])),
        watchedIds: Array.from(new Set([...state.watchedIds, ...items.filter((item) => item.watched).map(toId)])),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível buscar o catálogo.' });
    } finally {
      set({ loading: false });
    }
  },

  loadPersonal: async (tab) => {
    if (!ready) return;
    set({ loading: true, error: '', notice: '' });
    try {
      const data = await request(`/v1/me/${tab}`);
      const items = normalizePersonalItems(data, tab);
      if (tab === 'history') {
        set({ historyItems: items, watchedIds: items.map(toId) });
      } else {
        set({ favoriteItems: items, favoriteIds: items.map(toId) });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível carregar seus itens.' });
    } finally {
      set({ loading: false });
    }
  },

  toggleFavorite: async (item) => {
    if (!ready) return;
    const id = toId(item);
    const wasFavorite = get().favoriteIds.includes(id);
    set({ error: '', notice: '' });
    try {
      await request('/v1/me/favorites', { method: 'POST', body: JSON.stringify({ video_id: id, url: item.url, source: sourceOf(item), enabled: !wasFavorite }) });
      set((state) => ({
        favoriteIds: wasFavorite ? state.favoriteIds.filter((value) => value !== id) : [...state.favoriteIds, id],
        favoriteItems: wasFavorite ? state.favoriteItems.filter((value) => toId(value) !== id) : [item, ...state.favoriteItems],
        catalogItems: state.catalogItems.map((value) => toId(value) === id ? { ...value, is_favorite: !wasFavorite } : value),
        notice: wasFavorite ? 'Removido dos favoritos.' : 'Adicionado aos favoritos.',
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível atualizar o favorito.' });
    }
  },

  markWatched: async (item) => {
    if (!ready) return;
    const id = toId(item);
    try {
      await request('/v1/me/history', { method: 'POST', body: JSON.stringify({ video_id: id, url: item.url, source: sourceOf(item) }) });
      set((state) => ({
        watchedIds: Array.from(new Set([...state.watchedIds, id])),
        catalogItems: state.catalogItems.map((value) => toId(value) === id ? { ...value, watched: true } : value),
        historyItems: [item, ...state.historyItems.filter((value) => toId(value) !== id)],
      }));
    } catch {
      set({ notice: 'O link foi aberto, mas não foi possível registrar no histórico.' });
    }
  },

  clearHistory: async () => {
    if (!ready) return;
    set({ loading: true, error: '', notice: '' });
    try {
      await request('/v1/me/history', { method: 'DELETE' });
      set((state) => ({
        historyItems: [],
        watchedIds: [],
        catalogItems: state.catalogItems.map((item) => ({ ...item, watched: false })),
        notice: 'Seu histórico foi apagado.',
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Não foi possível apagar o histórico.' });
    } finally {
      set({ loading: false });
    }
  },
}));
