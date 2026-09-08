/** Stable merge sort whose comparisons can be scheduled between browser tasks. */
export function* sortSteps<T>(
  values: readonly T[], compare: (left: T, right: T) => number,
): Generator<void, T[]> {
  let source = [...values];
  let target = new Array<T>(source.length);
  for (let width = 1; width < source.length; width *= 2) {
    for (let start = 0; start < source.length; start += width * 2) {
      const middle = Math.min(start + width, source.length);
      const end = Math.min(start + width * 2, source.length);
      let left = start;
      let right = middle;
      for (let index = start; index < end; index += 1) {
        const a = source[left];
        const b = source[right];
        if (left < middle && a !== undefined &&
          (right >= end || b === undefined || compare(a, b) <= 0)) {
          target[index] = a;
          left += 1;
        } else if (b !== undefined) {
          target[index] = b;
          right += 1;
        }
        yield;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}
