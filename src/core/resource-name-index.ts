interface NameSlots { readonly slots: Set<number>; first: number; }

/** Mirrors source lookup order: a matching name must occur before the first free slot. */
export class ResourceNameIndex {
  readonly #values: string[];
  readonly #reserved: ReadonlySet<number>;
  readonly #names = new Map<string, NameSlots>();
  #free = 1;

  constructor(capacity: number, reserved: readonly number[] = []) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Invalid resource capacity");
    this.#values = new Array<string>(capacity).fill(""); this.#reserved = new Set(reserved);
    this.#advance();
  }
  clear(): void { this.#values.fill(""); this.#names.clear(); this.#free = 1; this.#advance(); }
  set(index: number, value: string): void {
    if (index <= 0 || index >= this.#values.length || this.#reserved.has(index)) return;
    const previous = this.#values[index];
    if (previous === value) return;
    if (previous !== undefined && previous !== "") {
      const entry = this.#names.get(previous);
      if (entry !== undefined) {
        entry.slots.delete(index);
        if (entry.slots.size === 0) this.#names.delete(previous);
        else if (entry.first === index) {
          entry.first = this.#values.length;
          for (const slot of entry.slots) entry.first = Math.min(entry.first, slot);
        }
      }
    }
    this.#values[index] = value;
    if (value === "") this.#free = Math.min(this.#free, index);
    else {
      const entry = this.#names.get(value);
      if (entry === undefined) this.#names.set(value, { slots: new Set([index]), first: index });
      else { entry.slots.add(index); entry.first = Math.min(entry.first, index); }
      if (index === this.#free) this.#advance();
    }
  }
  find(name: string): number | null {
    if (name === "") return 0;
    const match = this.#names.get(name)?.first;
    return match !== undefined && match < this.#free ? match : this.#free < this.#values.length ? this.#free : null;
  }
  #advance(): void {
    while (this.#free < this.#values.length && (this.#reserved.has(this.#free) || this.#values[this.#free] !== "")) this.#free++;
  }
}
