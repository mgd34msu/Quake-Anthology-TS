import { inhibitQ2Spawn, parseQ2Entities } from "./fields.ts";
import type { Q2Entity, Q2SpawnFields } from "./host.ts";
import { Q2EntityServices } from "./entity-services.ts";

export interface Q2SpawnReport {
  readonly authored: number;
  readonly inhibited: readonly Q2SpawnFields[];
  readonly removedBySource: readonly Q2SpawnFields[];
  readonly spawned: readonly Q2Entity[];
  readonly unsupported: readonly Q2Entity[];
}

/** Authored Q2 map admission and native team assembly over the reusable entity services. */
export class Q2Foundation extends Q2EntityServices {
  load(source: string): Q2SpawnReport {
    const fields = parseQ2Entities(source, this.options.edition);
    const inhibited: Q2SpawnFields[] = [], removedBySource: Q2SpawnFields[] = [], spawned: Q2Entity[] = [];
    for (const field of fields) {
      if (inhibitQ2Spawn(field, this.options)) { inhibited.push(field); continue; }
      const entity = this.spawn(field);
      if (this.host.actors.isLive(entity.actor.id)) spawned.push(entity);
      else removedBySource.push(field);
    }
    this.findTeams();
    return { authored: fields.length, inhibited, removedBySource, spawned, unsupported: [...this.unsupported] };
  }

  /** G_FindTeams, followed by the rerelease's Rogue G_FixTeams train repair. */
  private findTeams(): undefined {
    const entities = [...this.entities.values()].sort((a, b) => (this.sourceSlots.get(a.actor.id) ?? 0) - (this.sourceSlots.get(b.actor.id) ?? 0));
    for (const master of entities) {
      const name = master.spawn.values.get("team");
      if (!name || (master.flags & 0x400) !== 0) continue;
      master.teamMaster = master.actor.id;
      if (this.options.edition === "rerelease") master.flags |= 0x4000000;
      let chain = master;
      for (const member of entities) {
        if (member === master || (this.sourceSlots.get(member.actor.id) ?? 0) <= (this.sourceSlots.get(master.actor.id) ?? 0) || member.spawn.values.get("team") !== name || (member.flags & 0x400) !== 0) continue;
        chain.teamChain = member.actor.id; member.teamMaster = master.actor.id;
        member.flags |= 0x400; chain = member;
      }
    }
    if (this.options.edition !== "rerelease") return undefined;
    for (const master of entities) {
      const name = master.spawn.values.get("team");
      if (!name || master.classname !== "func_train" || (master.spawnflags & 8) === 0 || (master.flags & 0x400) === 0) continue;
      master.teamMaster = master.actor.id; master.teamChain = null; master.flags = master.flags & ~0x400 | 0x4000000;
      let chain = master;
      for (const member of entities) {
        if (member === master || member.spawn.values.get("team") !== name) continue;
        chain.teamChain = member.actor.id; member.teamMaster = master.actor.id; member.teamChain = null;
        member.flags = member.flags & ~0x4000000 | 0x400; member.speed = master.speed;
        this.motion(member, "push"); chain = member;
      }
    }
    return undefined;
  }

}
