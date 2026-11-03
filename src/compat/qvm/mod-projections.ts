// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../contracts/identity.ts";

/** Actor to entity slot, with the reverse lookup kept in step; the earliest projection of a slot wins. */
export class ProjectionSlots extends Map<ActorId, number> {
  readonly bySlot = new Map<number, ActorId>();
  override set(actor: ActorId, slot: number): this {
    const previous = super.get(actor);
    super.set(actor, slot);
    if (previous !== undefined && previous !== slot) this.reindex(previous, actor);
    if (!this.bySlot.has(slot)) this.bySlot.set(slot, actor);
    return this;
  }
  override delete(actor: ActorId): boolean {
    const slot = super.get(actor),
      removed = super.delete(actor);
    if (slot !== undefined) this.reindex(slot, actor);
    return removed;
  }
  override clear(): void {
    super.clear();
    this.bySlot.clear();
  }
  private reindex(slot: number, actor: ActorId): void {
    if (this.bySlot.get(slot) !== actor) return;
    this.bySlot.delete(slot);
    for (const [other, index] of this)
      if (index === slot) {
        this.bySlot.set(slot, other);
        break;
      }
  }
}
