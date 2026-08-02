export class Plugin {
  app: unknown;

  constructor() {
    this.app = undefined;
  }

  addCommand(): void {}
  addRibbonIcon(): HTMLElement {
    return document.createElement("div");
  }
  addSettingTab(): void {}
  loadData(): Promise<unknown> {
    return Promise.resolve(null);
  }
  registerEvent<T>(eventRef: T): T {
    return eventRef;
  }
  registerView(): void {}
  saveData(): Promise<void> {
    return Promise.resolve();
  }
}

export class PluginSettingTab {
  containerEl = document.createElement("div");

  constructor(readonly app: unknown, readonly plugin?: unknown) {}

  display(): void {}
  hide(): void {}
}

export class ItemView {
  contentEl = document.createElement("div");

  constructor(readonly leaf: unknown) {}

  open(): void {}
}

export class MarkdownView {
  editor = {
    scrollIntoView: () => undefined,
    setCursor: () => undefined,
  };
}

export class Menu {
  setParentElement(): this {
    return this;
  }
  addItem(callback: (item: {
    setIcon: () => unknown;
    setTitle: () => unknown;
    onClick: () => unknown;
  }) => unknown): this {
    const item = {
      setIcon: () => item,
      setTitle: () => item,
      onClick: () => item,
    };
    callback(item);
    return this;
  }
  addSeparator(): this {
    return this;
  }
  showAtPosition(): this {
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.settingEl = container.createDiv();
  }

  addButton(): this {
    return this;
  }
  addDropdown(): this {
    return this;
  }
  addSearch(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addToggle(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  setName(): this {
    return this;
  }
}

export class TFile {
  readonly stat: { readonly mtime: number };

  constructor(
    readonly path: string,
    readonly extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : "",
    modifiedAt = 0,
  ) {
    this.stat = { mtime: modifiedAt };
  }
}

export class Notice {
  static readonly messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export const Platform = {
  isDesktopApp: true,
  isMobileApp: false,
};

export function getLanguage(): string {
  return "en";
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const marker = linktext.indexOf("#");
  return marker < 0
    ? { path: linktext, subpath: "" }
    : { path: linktext.slice(0, marker), subpath: linktext.slice(marker) };
}

export function resolveSubpath(): null {
  return null;
}

export function setIcon(): void {}
