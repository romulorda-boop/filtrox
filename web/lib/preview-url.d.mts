import type { CatalogItem } from './store';

export function safeXvideosUrl(value: unknown, item: Pick<CatalogItem, 'source'>): string | null;
