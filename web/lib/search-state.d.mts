import type { Criteria } from './store';

export interface SearchStateSnapshot {
  criteria: Criteria;
  page: number;
}

export function readSearchState(): SearchStateSnapshot | null;
export function saveSearchState(criteria: Criteria, page: number): void;
export function clearSearchState(): void;
