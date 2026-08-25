export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Index operation was cancelled.");
}

export async function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfAborted(signal);
  if (signal === undefined) return operation;
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(signal.reason instanceof Error
        ? signal.reason
        : new Error("Index operation was cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
