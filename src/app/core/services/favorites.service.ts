import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const STORAGE_KEY = 'orlando-park-pulse-favorites';

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly favoritesSubject = new BehaviorSubject<Set<string>>(
    this.loadFromStorage()
  );

  readonly favorites$ = this.favoritesSubject.asObservable();

  isFavorite(id: string): boolean {
    return this.favoritesSubject.value.has(id);
  }

  toggleFavorite(id: string): void {
    const next = new Set(this.favoritesSubject.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.persist(next);
    this.favoritesSubject.next(next);
  }

  getSnapshot(): Set<string> {
    return this.favoritesSubject.value;
  }

  private loadFromStorage(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return new Set();
      }
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed);
    } catch {
      return new Set();
    }
  }

  private persist(favorites: Set<string>): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
  }
}