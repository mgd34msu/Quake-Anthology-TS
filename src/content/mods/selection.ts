import { modSelectionKey, type ModDescription, type ModSelection } from "../../contracts/mods.ts";

/** A successful edit publishes one complete, dependency-ordered selection. */
export class ModSelectionSet {
  private descriptions = new Map<string, ModDescription>();
  private selected: readonly ModSelection[] = [];

  constructor(descriptions: readonly ModDescription[], initial: readonly ModSelection[] = []) {
    this.refresh(descriptions);
    this.restore(initial);
  }

  entries(): readonly ModDescription[] { return [...this.descriptions.values()]; }
  enabled(): readonly ModSelection[] { return this.selected; }
  has(selection: ModSelection): boolean {
    const key = modSelectionKey(selection);
    return this.selected.some(value => modSelectionKey(value) === key);
  }

  refresh(descriptions: readonly ModDescription[]): void {
    const next = new Map<string, ModDescription>();
    for (const description of descriptions) {
      const key = modSelectionKey(description.selection);
      if (next.has(key)) throw new Error(`Duplicate mod declaration: ${key}`);
      next.set(key, description);
    }
    // Missing enabled packages stay visible so users can disable them.
    for (const selection of this.selected) {
      const key = modSelectionKey(selection), previous = this.descriptions.get(key);
      if (!next.has(key) && previous !== undefined) next.set(key, { ...previous,
        availability: { kind: "unavailable", reason: "This enabled mod is no longer installed" } });
    }
    this.descriptions = next;
  }

  restore(selections: readonly ModSelection[]): void {
    this.selected = this.resolve(selections);
  }

  setEnabled(selection: ModSelection, enabled: boolean): void {
    if (enabled) {
      this.selected = this.resolve([...this.selected, selection]);
      return;
    }
    const removed = new Set([modSelectionKey(selection)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const active of this.selected) {
        const key = modSelectionKey(active), description = this.descriptions.get(key);
        if (!removed.has(key) && description?.requires.some(dependency => removed.has(modSelectionKey(dependency)))) {
          removed.add(key); changed = true;
        }
      }
    }
    this.selected = this.selected.filter(active => !removed.has(modSelectionKey(active)));
  }

  validate(): void { this.resolve(this.selected); }

  private resolve(selections: readonly ModSelection[]): readonly ModSelection[] {
    const active = new Map<string, ModDescription>(), visiting = new Set<string>();
    const visit = (selection: ModSelection): void => {
      const key = modSelectionKey(selection);
      if (active.has(key)) return;
      if (visiting.has(key)) throw new Error(`Mod dependency cycle: ${[...visiting, key].join(" -> ")}`);
      const description = this.descriptions.get(key);
      if (description === undefined) throw new Error(`Required mod is not installed: ${key}`);
      if (description.purpose !== "addition") throw new Error(`${description.title} defines a game type; select it as the game's rules`);
      if (description.availability.kind === "unavailable") throw new Error(`${description.title}: ${description.availability.reason}`);
      visiting.add(key);
      for (const dependency of description.requires) visit(dependency);
      visiting.delete(key);
      active.set(key, description);
    };
    for (const selection of selections) visit(selection);
    for (const description of active.values()) {
      for (const conflict of description.conflicts) {
        const other = active.get(modSelectionKey(conflict));
        if (other !== undefined) throw new Error(`${description.title} conflicts with ${other.title}`);
      }
    }
    return [...active.values()].map(description => Object.freeze({ ...description.selection }));
  }
}
