export class TtlCache {
  constructor({ ttlMs, now = () => Date.now() }) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);

    if (!entry || entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return structuredClone(entry.value);
  }

  set(key, value) {
    this.entries.set(key, { value: structuredClone(value), expiresAt: this.now() + this.ttlMs });
  }

  delete(key) {
    this.entries.delete(key);
  }
}

export async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
