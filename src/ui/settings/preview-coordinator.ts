export type PreviewRequestState<T> =
  | { readonly state: "loading"; readonly value: null; readonly error: null }
  | { readonly state: "ready"; readonly value: T; readonly error: null }
  | { readonly state: "failed"; readonly value: null; readonly error: unknown };

/** Guards async preview completion by visible generation and per-key revision. */
export class PreviewRequestCoordinator<Key, Value> {
  private generation = 0;
  private readonly revisions = new Map<Key, number>();

  beginGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
    this.revisions.clear();
  }

  request(
    key: Key,
    load: () => Promise<Value>,
    publish: (state: PreviewRequestState<Value>) => void,
  ): Promise<void> {
    const generation = this.generation;
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    publish({ state: "loading", value: null, error: null });
    let operation: Promise<Value>;
    try {
      operation = load();
    } catch (error) {
      if (this.isCurrent(key, generation, revision)) {
        publish({ state: "failed", value: null, error });
      }
      return Promise.resolve();
    }
    return operation.then(
      (value) => {
        if (!this.isCurrent(key, generation, revision)) return;
        publish({ state: "ready", value, error: null });
      },
      (error: unknown) => {
        if (!this.isCurrent(key, generation, revision)) return;
        publish({ state: "failed", value: null, error });
      },
    );
  }

  private isCurrent(key: Key, generation: number, revision: number): boolean {
    return generation === this.generation && this.revisions.get(key) === revision;
  }
}
