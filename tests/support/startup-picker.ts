// SPDX-License-Identifier: GPL-2.0-or-later
import type { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";

/** Pointer input into a 640x480 startup menu: click at a point, wheel one notch down (true) or up (false). */
export interface MenuPointer {
  readonly click: (x: number, y: number) => void;
  readonly wheel: (down: boolean) => void;
}

/**
 * Picks an "enemies" dropdown choice the way a user would: it mirrors the picker's edition collapse, category
 * grouping and scroll anchoring, then wheels and clicks. If the picker layout changes, update it here.
 */
export function pickEnemiesChoice(model: StartupSelectionModel, { click, wheel }: MenuPointer, choiceId: string): void {
  const row = model.rows().find(candidate => candidate.id === "enemies");
  const choices = row?.choices ?? [],
    target = choices.find(option => option.id === choiceId);
  if (row === undefined || target === undefined) throw new Error(`Missing enemies choice ${choiceId}`);
  const current = choices.find(option => option.id === row.value);
  const editions = new Set(choices.flatMap(option => (option.edition === undefined ? [] : [option.edition])));
  let edition: "classic" | "rerelease" | null = editions.size > 1 ? (current?.edition ?? "classic") : null;
  const visible = edition === null ? 8 : 7,
    itemsTop = edition === null ? 138 : 164;
  const collapsed = new Set(choices.flatMap(option => (option.group === undefined || option.group === current?.group ? [] : [option.group])));
  const entriesOf = (): ({ readonly kind: "header"; readonly group: string } | { readonly kind: "choice"; readonly id: string })[] => {
    // The picker shows one unified list: edition variants of a title collapse to one entry.
    const shown: (typeof choices)[number][] = [],
      seen = new Map<string, (typeof choices)[number]>();
    for (const option of choices) {
      if (option.edition === undefined) {
        shown.push(option);
        continue;
      }
      const key = `${option.group ?? ""}|${option.label}`,
        existing = seen.get(key);
      if (existing === undefined) {
        seen.set(key, option);
        shown.push(option);
      } else if (edition !== null && option.edition === edition) {
        shown[shown.indexOf(existing)] = option;
        seen.set(key, option);
      }
    }
    const entries: ({ kind: "header"; group: string } | { kind: "choice"; id: string })[] = shown
      .filter(option => option.group === undefined)
      .map(option => ({ kind: "choice", id: option.id }));
    for (const group of [...new Set(shown.flatMap(option => (option.group === undefined ? [] : [option.group])))]) {
      entries.push({ kind: "header", group });
      if (!collapsed.has(group)) for (const option of shown) if (option.group === group) entries.push({ kind: "choice", id: option.id });
    }
    return entries;
  };
  let entries = entriesOf();
  const selectedIndex = Math.max(
    0,
    entries.findIndex(entry => entry.kind === "choice" && entry.id === row.value),
  );
  // The picker opens at the selection's category header when the selection fits below it.
  let headerIndex = -1;
  for (let index = selectedIndex - 1; index >= 0; index--)
    if (entries[index]?.kind === "header") {
      headerIndex = index;
      break;
    }
  const anchored = headerIndex >= 0 && selectedIndex - headerIndex < visible ? headerIndex : selectedIndex;
  let scroll = Math.max(0, Math.min(anchored, Math.max(0, entries.length - visible)));
  const scrollTo = (index: number): void => {
    while (index - scroll > visible - 1) {
      wheel(true);
      scroll++;
    }
    while (index - scroll < 0) {
      wheel(false);
      scroll--;
    }
  };
  const clickEntry = (index: number): void => {
    scrollTo(index);
    click(360, itemsTop + (index - scroll) * 27 + 12);
  };
  if (target.edition !== undefined && edition !== null && target.edition !== edition) {
    click(target.edition === "classic" ? 388 : 516, 147);
    edition = target.edition;
    scroll = 0;
    entries = entriesOf();
  }
  if (target.group !== undefined && collapsed.has(target.group)) {
    clickEntry(entries.findIndex(entry => entry.kind === "header" && entry.group === target.group));
    collapsed.delete(target.group);
    entries = entriesOf();
  }
  clickEntry(entries.findIndex(entry => entry.kind === "choice" && entry.id === choiceId));
}
