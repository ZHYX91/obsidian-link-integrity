const BUCKET_COUNT = 256;

interface Entry<V> {
  readonly owner: object;
  readonly value: V;
}

interface Bucket<V> {
  readonly owner: object;
  readonly entries: Map<string, Entry<V>>;
}

/** Copy-on-write storage. Forks share untouched buckets and immutable values. */
export class ForkableMap<V> {
  private owner: object = {};
  private buckets: (Bucket<V> | undefined)[] = new Array<Bucket<V> | undefined>(BUCKET_COUNT);
  public size = 0;

  public fork(): ForkableMap<V> {
    const next = new ForkableMap<V>();
    next.buckets = this.buckets.slice();
    next.size = this.size;
    // Neither branch owns previously shared buckets or mutable entries now.
    this.owner = {};
    return next;
  }

  public get(key: string): V | undefined {
    return this.buckets[bucketIndex(key)]?.entries.get(key)?.value;
  }

  public has(key: string): boolean {
    return this.buckets[bucketIndex(key)]?.entries.has(key) ?? false;
  }

  public set(key: string, value: V): this {
    const bucket = this.writeBucket(key);
    if (!bucket.entries.has(key)) this.size += 1;
    bucket.entries.set(key, { owner: this.owner, value });
    return this;
  }

  /** All mutations of a mutable value must first acquire its branch-owned copy. */
  public edit(key: string, create: () => V, clone: (value: V) => V): V {
    const entry = this.buckets[bucketIndex(key)]?.entries.get(key);
    if (entry?.owner === this.owner) return entry.value;
    const value = entry === undefined ? create() : clone(entry.value);
    this.set(key, value);
    return value;
  }

  public delete(key: string): boolean {
    if (!this.has(key)) return false;
    this.writeBucket(key).entries.delete(key);
    this.size -= 1;
    return true;
  }

  public clear(): void {
    this.buckets = new Array<Bucket<V> | undefined>(BUCKET_COUNT);
    this.size = 0;
  }

  public *entries(): IterableIterator<[string, V]> {
    for (const bucket of this.buckets) {
      if (bucket === undefined) continue;
      for (const [key, entry] of bucket.entries) yield [key, entry.value];
    }
  }

  public *keys(): IterableIterator<string> {
    for (const bucket of this.buckets) if (bucket !== undefined) yield* bucket.entries.keys();
  }

  public *values(): IterableIterator<V> {
    for (const bucket of this.buckets) {
      if (bucket === undefined) continue;
      for (const entry of bucket.entries.values()) yield entry.value;
    }
  }

  public [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.entries();
  }

  private writeBucket(key: string): Bucket<V> {
    const index = bucketIndex(key);
    let bucket = this.buckets[index];
    if (bucket?.owner !== this.owner) {
      bucket = { owner: this.owner, entries: new Map(bucket?.entries) };
      this.buckets[index] = bucket;
    }
    return bucket;
  }
}

function bucketIndex(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return (hash ^ (hash >>> 16)) & (BUCKET_COUNT - 1);
}
