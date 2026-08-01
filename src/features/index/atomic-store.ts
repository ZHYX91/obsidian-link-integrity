import { LinkIndex } from "../../core/link-index";

export interface PublishedIndexSnapshot {
  readonly index: LinkIndex;
  readonly generation: number;
}

export class AtomicLinkIndexStore {
  private indexValue: LinkIndex;
  private generationValue = 0;

  public constructor(initialIndex: LinkIndex = new LinkIndex()) {
    this.indexValue = initialIndex;
  }

  public get current(): LinkIndex {
    return this.indexValue;
  }

  public get generation(): number {
    return this.generationValue;
  }

  public getSnapshot(): PublishedIndexSnapshot {
    return { index: this.indexValue, generation: this.generationValue };
  }

  public publish(index: LinkIndex): PublishedIndexSnapshot {
    this.indexValue = index;
    this.generationValue += 1;
    return this.getSnapshot();
  }
}
