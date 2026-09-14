import type { EntityThink, EntityBlocked, EntityTouch, EntityUse, EntityPain, EntityDie } from "./state.ts";

export class Q3CallbackFamily<F> {
  private readonly byId = new Map<string, F>();
  private readonly byFunction = new Map<F, string>();

  register(id: string, callback: F): F {
    if (id.length === 0) throw new Error("Q3 callback identity is empty");
    const previous = this.byId.get(id);
    if (previous !== undefined && previous !== callback) throw new Error(`Duplicate Q3 callback identity ${id}`);
    const identity = this.byFunction.get(callback);
    if (identity !== undefined && identity !== id) throw new Error(`Q3 callback has two identities: ${identity}, ${id}`);
    this.byId.set(id, callback);
    this.byFunction.set(callback, id);
    return callback;
  }

  intern(id: string, callback: F): F {
    return this.byId.get(id) ?? this.register(id, callback);
  }

  capture(callback: F | null): string | null {
    if (callback === null) return null;
    const id = this.byFunction.get(callback);
    if (id === undefined) throw new Error("Unregistered native Q3 callback cannot be saved");
    return id;
  }

  resolve(id: string | null): F | null {
    if (id === null) return null;
    const callback = this.byId.get(id);
    if (callback === undefined) throw new Error(`Unknown native Q3 callback ${id}`);
    return callback;
  }
}

export class Q3CallbackCatalog {
  readonly think = new Q3CallbackFamily<EntityThink>();
  readonly reached = new Q3CallbackFamily<EntityThink>();
  readonly blocked = new Q3CallbackFamily<EntityBlocked>();
  readonly touch = new Q3CallbackFamily<EntityTouch>();
  readonly use = new Q3CallbackFamily<EntityUse>();
  readonly pain = new Q3CallbackFamily<EntityPain>();
  readonly die = new Q3CallbackFamily<EntityDie>();
}
