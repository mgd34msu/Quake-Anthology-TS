import type { WeaponTrajectoryUpdate } from "../../../contracts/weapon-behavior.ts";
import type { Q2Die, Q2Entity, Q2Pain, Q2Think, Q2Touch, Q2Use } from "./host.ts";

export const freeQ2Entity: Q2Think = (entity, game) => game.remove(entity);

export interface Q2CallbackDefinitions {
  readonly trajectory?: readonly { readonly touch: Q2Touch; readonly project: (entity: Q2Entity, update: WeaponTrajectoryUpdate) => void }[];
  readonly think?: Readonly<Record<string, Q2Think>>;
  readonly use?: Readonly<Record<string, Q2Use>>;
  readonly touch?: Readonly<Record<string, Q2Touch>>;
  readonly pain?: Readonly<Record<string, Q2Pain>>;
  readonly die?: Readonly<Record<string, Q2Die>>;
  readonly blocked?: Readonly<Record<string, NonNullable<Q2Entity["blocked"]>>>;
}

class SourceCallbacks<T> {
  private readonly functions = new Map<string, T>();
  private readonly names = new Map<T, string>();

  register(definitions: Readonly<Record<string, T>> | undefined): undefined {
    if (definitions === undefined) return undefined;
    for (const [name, callback] of Object.entries(definitions)) {
      const previous = this.functions.get(name);
      if (previous !== undefined && previous !== callback) throw new Error(`Duplicate Q2 source callback ${name}`);
      this.functions.set(name, callback);
      if (!this.names.has(callback)) this.names.set(callback, name);
    }
    return undefined;
  }

  name(callback: T | null): string | null {
    if (callback === null) return null;
    const name = this.names.get(callback);
    if (name === undefined) throw new Error("Q2 save encountered an unnamed source callback");
    return name;
  }

  resolve(name: string | null): T | null {
    if (name === null) return null;
    const callback = this.functions.get(name);
    if (callback === undefined) throw new Error(`Q2 restore cannot resolve source callback ${name}`);
    return callback;
  }
}

/** Q2 saves store source function names, exactly as the original game save tables do. */
export class Q2SourceCallbacks {
  private readonly trajectories = new Map<string, (entity: Q2Entity, update: WeaponTrajectoryUpdate) => void>();
  projectTrajectory(entity: Q2Entity, update: WeaponTrajectoryUpdate): void {
    const name = this.touch.name(entity.touch);
    if (name !== null) this.trajectories.get(name)?.(entity, update);
  }
  readonly think = new SourceCallbacks<Q2Think>();
  readonly use = new SourceCallbacks<Q2Use>();
  readonly touch = new SourceCallbacks<Q2Touch>();
  readonly pain = new SourceCallbacks<Q2Pain>();
  readonly die = new SourceCallbacks<Q2Die>();
  readonly blocked = new SourceCallbacks<NonNullable<Q2Entity["blocked"]>>();

  register(definitions: Q2CallbackDefinitions): undefined {
    this.think.register(definitions.think); this.use.register(definitions.use); this.touch.register(definitions.touch);
    this.pain.register(definitions.pain); this.die.register(definitions.die); this.blocked.register(definitions.blocked);
    for (const projection of definitions.trajectory ?? []) {
      const name = this.touch.name(projection.touch);
      if (name === null) throw new Error("Trajectory projection requires a named source touch callback");
      const previous = this.trajectories.get(name);
      if (previous !== undefined && previous !== projection.project) throw new Error(`Duplicate Q2 trajectory projection ${name}`);
      this.trajectories.set(name, projection.project);
    }
    return undefined;
  }
}
