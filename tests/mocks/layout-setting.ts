/** Only the controls used by General settings in the Chromium layout fixture. */
export class Setting {
  readonly settingEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.settingEl = parent.ownerDocument.createElement("div");
    this.settingEl.className = "setting-item";
    parent.append(this.settingEl);
  }

  setName(): this { return this; }
  setDesc(): this { return this; }
  setDisabled(): this { return this; }
  addToggle(): this { return this; }

  addDropdown(configure: (dropdown: LayoutDropdown) => void): this {
    configure(new LayoutDropdown(this.settingEl));
    return this;
  }
}

class LayoutDropdown {
  readonly selectEl: HTMLSelectElement;
  private readonly measurement: HTMLSelectElement;

  constructor(row: HTMLElement) {
    const control = row.ownerDocument.createElement("div");
    control.className = "setting-item-control";
    this.selectEl = row.ownerDocument.createElement("select");
    this.selectEl.className = "dropdown";
    this.measurement = this.selectEl.cloneNode() as HTMLSelectElement;
    this.measurement.classList.add("is-measuring");
    control.append(this.selectEl, this.measurement);
    row.append(control);
  }

  addOption(value: string, label: string): this {
    const option = this.selectEl.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = label;
    this.selectEl.append(option);
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    this.measurement.replaceChildren(this.selectEl.selectedOptions[0]!.cloneNode(true));
    // Match the host's synchronous measurement, without the optional insertion animation.
    this.selectEl.style.setProperty("--dropdown-fitted-width", this.measurement.offsetWidth + "px");
    return this;
  }

  setDisabled(): this { return this; }
  onChange(): this { return this; }
}

export function setIcon(button: HTMLElement, name: string): void {
  button.dataset.icon = name;
}
