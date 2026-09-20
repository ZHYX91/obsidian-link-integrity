export type PreviewRequestState<T> =
  | { readonly state: "loading"; readonly value: null; readonly error: null }
  | { readonly state: "ready"; readonly value: T; readonly error: null }
  | { readonly state: "failed"; readonly value: null; readonly error: unknown };

/** Guards async preview completion by visible generation and per-key revision. */
export class PreviewRequestCoordinator<Key, Value> {
  private generation = 0;
  private readonly revisions = new Map<Key, number>();
  private readonly controllers = new Map<Key, AbortController>();

  beginGeneration(): number {
    this.invalidate();
    return this.generation;
  }

  invalidate(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.generation += 1;
    this.revisions.clear();
  }

  request(
    key: Key,
    load: (signal: AbortSignal) => Promise<Value>,
    publish: (state: PreviewRequestState<Value>) => void,
  ): Promise<void> {
    const generation = this.generation;
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    publish({ state: "loading", value: null, error: null });
    let operation: Promise<Value>;
    try {
      operation = load(controller.signal);
    } catch (error) {
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
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
    ).finally(() => {
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
    });
  }

  private isCurrent(key: Key, generation: number, revision: number): boolean {
    return generation === this.generation && this.revisions.get(key) === revision;
  }
}
