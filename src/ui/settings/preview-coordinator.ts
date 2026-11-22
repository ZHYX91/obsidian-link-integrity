export type PreviewRequestState<T> =
  | { readonly state: "loading"; readonly value: null; readonly error: null }
  | { readonly state: "ready"; readonly value: T; readonly error: null }
  | { readonly state: "failed"; readonly value: null; readonly error: unknown };

/** Cancels superseded previews and lets only the active request publish a result. */
export class PreviewRequestCoordinator<Key, Value> {
  private readonly controllers = new Map<Key, AbortController>();

  invalidate(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  async request(
    key: Key,
    load: (signal: AbortSignal) => Promise<Value>,
    publish: (state: PreviewRequestState<Value>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      publish({ state: "loading", value: null, error: null });
      if (controller.signal.aborted) return;
      let value: Value;
      try {
        value = await load(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) publish({ state: "failed", value: null, error });
        return;
      }
      if (!controller.signal.aborted) publish({ state: "ready", value, error: null });
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
    }
  }
}
