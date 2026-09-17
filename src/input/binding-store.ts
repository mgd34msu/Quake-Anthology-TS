import type { InputBinding, InputBindingTarget, PhysicalInput } from "../contracts/ui.ts";

export function physicalInputKey(input: PhysicalInput): string {
  switch (input.kind) {
    case "key": return `key:${input.code}`;
    case "mouse-button": return `mouse:${input.button}`;
    case "controller-button": return `pad:${input.device}:button:${input.button}`;
    case "controller-axis": return `pad:${input.device}:axis:${input.axis}:${input.direction}`;
  }
}
/** Binding data without a device, focus, or interactive seat. */
export class BindingStore {
  private readonly table = new Map<string, InputBinding>();
  constructor(bindings: readonly InputBinding[] = []) { for (const binding of bindings) this.bind(binding); }
  get bindings(): readonly InputBinding[] { return [...this.table.values()]; }
  binding(input: PhysicalInput): InputBindingTarget | null { return this.table.get(physicalInputKey(input))?.target ?? null; }
  bind(binding: InputBinding): void { this.table.set(physicalInputKey(binding.input), binding); }
  unbind(input: PhysicalInput): void { this.table.delete(physicalInputKey(input)); }
  unbindAll(): void { this.table.clear(); }
}
