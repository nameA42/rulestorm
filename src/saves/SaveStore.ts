/**
 * Save slots in this browser's localStorage. Knows nothing about what is
 * inside a save — main.ts decides that.
 */
export interface SaveMeta {
  id: string;
  name: string;
  savedAt: number;
}

interface SaveRecord<T> extends SaveMeta {
  data: T;
}

const KEY = 'rulestorm.saves.v1';
const MAX_SAVES = 20;

export class SaveStore<T> {
  /** Last storage error (quota, private mode…), for the UI to show. */
  lastError: string | null = null;

  private read(): SaveRecord<T>[] {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as SaveRecord<T>[]) : [];
    } catch {
      return [];
    }
  }

  private write(all: SaveRecord<T>[]): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  list(): SaveMeta[] {
    return this.read()
      .map(({ id, name, savedAt }) => ({ id, name, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  save(name: string, data: T): SaveMeta | null {
    const rec: SaveRecord<T> = { id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name, savedAt: Date.now(), data };
    const all = [rec, ...this.read()].slice(0, MAX_SAVES);
    return this.write(all) ? rec : null;
  }

  load(id: string): T | null {
    return this.read().find((r) => r.id === id)?.data ?? null;
  }

  remove(id: string): void {
    this.write(this.read().filter((r) => r.id !== id));
  }
}
