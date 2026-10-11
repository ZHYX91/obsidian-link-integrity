import type { PotentialMentionMatch, PotentialMentionSource } from "../../core/potential-mention-model";

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote";
export const MENTION_READING_INTERACTIVE = "a,button,input,select,textarea,code,pre,math,svg,[contenteditable],[role=button],[role=link]";
const roots = new WeakMap<Element, Map<object, MentionReadingRoot>>();

export interface MentionReadingRootOptions {
  readonly mode: () => "off" | "paragraph" | "document";
  readonly subscribe: (listener: () => void) => () => void;
  readonly pick: (source: PotentialMentionSource, matches: readonly PotentialMentionMatch[], document: Document) => void;
}

export interface MentionReadingSection {
  readonly clear: () => void;
  readonly cancel: () => void;
  readonly refresh: (current: Element | null) => Promise<void>;
}

/** Shared event ownership, paragraph selection and decoration budget for one preview root. */
export class MentionReadingRoot {
  private readonly sections = new Set<MentionReadingSection>();
  private readonly hints = new Map<HTMLElement, { source: PotentialMentionSource; matches: readonly PotentialMentionMatch[] }>();
  private focused: Element | null = null;
  private timer: number | null = null;
  private readonly unsubscribe: () => void;
  private readonly removals: Array<() => void> = [];
  private get window(): Window { return this.root.ownerDocument.defaultView!; }
  public get budget(): number { return Math.max(0, 1_000 - this.hints.size); }

  public static attach(root: Element, options: MentionReadingRootOptions, section: MentionReadingSection): MentionReadingRoot {
    const owners = roots.get(root) ?? new Map<object, MentionReadingRoot>();
    const coordinator = owners.get(options.subscribe) ?? new MentionReadingRoot(root, options);
    owners.set(options.subscribe, coordinator);
    roots.set(root, owners);
    coordinator.sections.add(section);
    coordinator.schedule();
    return coordinator;
  }

  private constructor(private readonly root: Element, private readonly options: MentionReadingRootOptions) {
    this.unsubscribe = options.subscribe(() => this.schedule());
    for (const name of ["click", "focusin", "touchstart"]) this.listen(name, (event) => this.focus(event));
    this.listen("click", (event) => this.open(event as MouseEvent));
    this.listen("keydown", (event) => this.open(event as KeyboardEvent));
    this.listen("scroll", () => this.schedule(), { passive: true });
  }

  private listen(name: string, listener: EventListener, options?: AddEventListenerOptions): void {
    this.root.addEventListener(name, listener, options);
    this.removals.push(() => this.root.removeEventListener(name, listener, options));
  }

  public remove(section: MentionReadingSection): void {
    this.sections.delete(section);
    if (this.sections.size > 0) { this.schedule(); return; }
    if (this.timer !== null) this.window.clearTimeout(this.timer);
    this.unsubscribe();
    for (const remove of this.removals) remove();
    this.focused = null;
    const owners = roots.get(this.root);
    if (owners?.get(this.options.subscribe) === this) owners.delete(this.options.subscribe);
    if (owners?.size === 0) roots.delete(this.root);
  }

  public addHint(hint: HTMLElement, source: PotentialMentionSource, matches: readonly PotentialMentionMatch[]): void {
    this.hints.set(hint, { source, matches });
  }

  public removeHint(hint: HTMLElement): void { this.hints.delete(hint); }

  private focus(event: Event): void {
    const target = event.target;
    if (!(target instanceof this.root.ownerDocument.defaultView!.Element)) return;
    const block = target.closest(BLOCKS);
    if (block !== null && this.root.contains(block)) this.focused = block;
    const hint = target.closest<HTMLElement>(".link-integrity-mention-hint");
    if (hint !== null && this.hints.has(hint)) return;
    this.schedule();
  }

  private open(event: MouseEvent | KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const keyboard = event.type === "keydown";
    if (keyboard ? !["Enter", " "].includes((event as KeyboardEvent).key) :
      (event as MouseEvent).button !== 0 || this.root.ownerDocument.getSelection()?.isCollapsed === false) return;
    const target = event.target;
    if (!(target instanceof this.root.ownerDocument.defaultView!.Element)) return;
    const hint = target.closest<HTMLElement>(".link-integrity-mention-hint");
    if (hint === null || target.closest(MENTION_READING_INTERACTIVE) !== hint ||
      hint.parentElement?.closest(MENTION_READING_INTERACTIVE) !== null) return;
    const selected = this.hints.get(hint);
    if (selected === undefined) return;
    if (keyboard) event.preventDefault();
    hint.focus();
    this.options.pick(selected.source, selected.matches, this.root.ownerDocument);
  }

  private schedule(): void {
    for (const section of this.sections) section.cancel();
    if (this.timer !== null) this.window.clearTimeout(this.timer);
    this.timer = this.window.setTimeout(() => {
      this.timer = null;
      const current = this.options.mode() === "paragraph" ? this.currentBlock() : null;
      for (const section of this.sections) section.clear();
      for (const section of this.sections) void section.refresh(current);
    }, 80);
  }

  private currentBlock(): Element | null {
    if (this.focused?.isConnected === true && this.root.contains(this.focused)) return this.focused;
    const rect = this.root.getBoundingClientRect();
    const center = (Math.max(0, rect.top) + Math.min(this.window.innerHeight, rect.bottom)) / 2;
    let result: Element | null = null;
    let distance = Infinity;
    for (const block of this.root.querySelectorAll(BLOCKS)) {
      if (block.closest(MENTION_READING_INTERACTIVE) !== null) continue;
      const bounds = block.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= this.window.innerHeight) continue;
      const next = Math.abs((bounds.top + bounds.bottom) / 2 - center);
      if (next < distance) { result = block; distance = next; }
    }
    return result;
  }
}
