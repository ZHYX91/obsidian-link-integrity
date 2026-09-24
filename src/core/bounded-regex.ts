export interface PatternMatcher {
  test(value: string): boolean;
}

type Builder = (next: number) => number;
type State =
  | { kind: "accept" }
  | { kind: "split"; targets: number[] }
  | { kind: "atom"; expression: RegExp; next: number }
  | { kind: "assert"; assertion: string; next: number };

/** Thompson simulation: each state is visited at most once per input code point.
 * Native regexes only match one character; user repetition never reaches their engine.
 */
export function compileBoundedRegex(source: string, flags: string): PatternMatcher {
  if (source.length > 4096) throw new Error("Pattern > 4096 chars.");
  if (/[^iu]/u.test(flags) || new Set(flags).size !== flags.length) {
    throw new Error("Regex flags: unique i/u only.");
  }
  const unicodeFlags = flags.includes("u") ? flags : `${flags}u`;
  // Validate ECMAScript syntax, but never execute the complete expression.
  new RegExp(source, unicodeFlags);
  const states: State[] = [{ kind: "accept" }];
  const add = (state: State): number => {
    if (states.length >= 1024) throw new Error("Regex > 1024 states.");
    states.push(state);
    return states.length - 1;
  };
  let cursor = 0;

  const escapeEnd = (start: number): number => {
    const kind = source[start + 1];
    if (kind === "p" || kind === "P" || (kind === "u" && source[start + 2] === "{")) {
      return source.indexOf("}", start + 2) + 1;
    }
    if (kind === "u") {
      const first = Number.parseInt(source.slice(start + 2, start + 6), 16);
      const second = Number.parseInt(source.slice(start + 8, start + 12), 16);
      return first >= 0xd800 && first <= 0xdbff && source.slice(start + 6, start + 8) === "\\u" &&
        second >= 0xdc00 && second <= 0xdfff ? start + 12 : start + 6;
    }
    return start + (kind === "x" ? 4 : kind === "c" ? 3 : 2);
  };

  const atom = (): Builder => {
    const start = cursor;
    const character = source[cursor++];
    if (character === "(") {
      if (source[cursor] === "?") {
        if (source[cursor + 1] !== ":") throw new Error("Lookaround/special groups unsupported.");
        cursor += 2;
      }
      const group = choice();
      cursor += 1; // Closing parenthesis, already checked by native syntax validation.
      return group;
    }
    if (character === "^" || character === "$") {
      return (next) => add({ kind: "assert", assertion: character, next });
    }
    if (character === "\\") {
      const escaped = source[cursor] ?? "";
      if (/[1-9k]/u.test(escaped)) throw new Error("Backreferences unsupported.");
      if (escaped === "b" || escaped === "B") {
        cursor += 1;
        return (next) => add({ kind: "assert", assertion: escaped, next });
      }
      cursor = escapeEnd(start);
    } else if (character === "[") {
      while (source[cursor] !== "]") {
        cursor = source[cursor] === "\\" ? escapeEnd(cursor) : cursor + 1;
      }
      cursor += 1;
    } else {
      cursor = start + (source.codePointAt(start)! > 0xffff ? 2 : 1);
    }
    const expression = new RegExp(`^(?:${source.slice(start, cursor)})$`, unicodeFlags);
    return (next) => add({ kind: "atom", expression, next });
  };

  const repeated = (): Builder => {
    const build = atom();
    let minimum = 1;
    let maximum = 1;
    const quantifier = source[cursor];
    if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
      minimum = quantifier === "+" ? 1 : 0;
      maximum = quantifier === "?" ? 1 : Infinity;
      cursor += 1;
    } else if (quantifier === "{") {
      const close = source.indexOf("}", cursor);
      const parts = source.slice(cursor + 1, close).split(",");
      minimum = Number(parts[0]);
      maximum = parts.length === 1 ? minimum : parts[1] === "" ? Infinity : Number(parts[1]);
      cursor = close + 1;
    } else return build;
    // Greedy/lazy order cannot change a boolean match result.
    if (source[cursor] === "?") cursor += 1;
    if (minimum > 512 || (maximum !== Infinity && maximum > 512)) {
      throw new Error("Regex repetition > 512.");
    }
    return (next) => {
      let result = next;
      if (maximum === Infinity) {
        const split: State = { kind: "split", targets: [next] };
        result = add(split);
        split.targets.push(build(result));
      } else {
        for (let count = minimum; count < maximum; count += 1) {
          result = add({ kind: "split", targets: [result, build(result)] });
        }
      }
      for (let count = 0; count < minimum; count += 1) result = build(result);
      return result;
    };
  };

  const sequence = (): Builder => {
    const parts: Builder[] = [];
    while (cursor < source.length && source[cursor] !== ")" && source[cursor] !== "|") {
      parts.push(repeated());
    }
    return (next) => {
      let result = next;
      for (let index = parts.length - 1; index >= 0; index -= 1) result = parts[index]!(result);
      return result;
    };
  };
  const choice = (): Builder => {
    const branches = [sequence()];
    while (source[cursor] === "|") {
      cursor += 1;
      branches.push(sequence());
    }
    return branches.length === 1 ? branches[0]! :
      (next) => add({ kind: "split", targets: branches.map((build) => build(next)) });
  };
  const start = choice()(0);
  const word = new RegExp("^\\w$", unicodeFlags);
  return {
    test(value) {
      const characters = Array.from(value);
      let pending: number[] = [];
      for (let position = 0; position <= characters.length; position += 1) {
        pending.push(start); // Unanchored search shares states instead of retrying suffixes.
        const visited = new Set<number>();
        const next: number[] = [];
        while (pending.length > 0) {
          const id = pending.pop()!;
          if (visited.has(id)) continue;
          visited.add(id);
          const state = states[id]!;
          if (state.kind === "accept") return true;
          if (state.kind === "split") pending.push(...state.targets);
          else if (state.kind === "atom") {
            if (position < characters.length && state.expression.test(characters[position]!)) {
              next.push(state.next);
            }
          } else {
            const boundary = word.test(characters[position - 1] ?? "") !==
              word.test(characters[position] ?? "");
            const passed = state.assertion === "^" ? position === 0 :
              state.assertion === "$" ? position === characters.length :
                state.assertion === "b" ? boundary : !boundary;
            if (passed) pending.push(state.next);
          }
        }
        pending = next;
      }
      return false;
    },
  };
}
