// Storage fakes for tests.

export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Storage whose every access throws, like a browser with blocked site data. */
export const brokenStorage = new Proxy({} as Storage, {
  get() {
    return () => {
      throw new DOMException("blocked", "SecurityError");
    };
  },
});
