import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const STORAGE_KEY = 'orlando-park-pulse-hidden';

@Injectable({ providedIn: 'root' })
export class HiddenAttractionsService {
  private readonly hiddenSubject = new BehaviorSubject<Set<string>>(
    this.loadFromStorage()
  );

  readonly hidden$ = this.hiddenSubject.asObservable();

  isHidden(id: string): boolean {
    return this.hiddenSubject.value.has(id);
  }

  toggleHidden(id: string): void {
    const next = new Set(this.hiddenSubject.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.persist(next);
    this.hiddenSubject.next(next);
  }

  getSnapshot(): Set<string> {
    return this.hiddenSubject.value;
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

  private persist(hidden: Set<string>): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]));
  }
}
