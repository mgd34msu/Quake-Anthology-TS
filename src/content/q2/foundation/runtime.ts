import { inhibitQ2Spawn, parseQ2Entities } from "./fields.ts";
import type { Q2Entity, Q2SpawnFields } from "./host.ts";
import { Q2EntityServices } from "./entity-services.ts";
import type { OwnedActor } from "../../../contracts/identity.ts";
import type { MonsterDefinitionReference } from "../../../contracts/content.ts";

export interface Q2SpawnReport {
  readonly authored: number;
  readonly inhibited: readonly Q2SpawnFields[];
  readonly removedBySource: readonly Q2SpawnFields[];
  readonly spawned: readonly Q2Entity[];
  readonly unsupported: readonly Q2Entity[];
  readonly replaced: readonly OwnedActor[];
}

/** Authored Q2 map admission and native team assembly over the reusable entity services. */
export class Q2Foundation extends Q2EntityServices {
  monsterAdmission: {
    resolve(classname: string, source: Q2SpawnFields): MonsterDefinitionReference | null;
    spawn(actor: OwnedActor, source: Q2SpawnFields, definition: MonsterDefinitionReference): undefined;
  } | null = null;
  load(source: string): Q2SpawnReport {
    const fields = parseQ2Entities(source, this.options.edition);
    const replacements = new Map<number, MonsterDefinitionReference>();
    if (this.monsterAdmission !== null) for (const field of fields) {
      if (inhibitQ2Spawn(field, this.options) || this.options.mode === "deathmatch" && field.classname.startsWith("monster_")) continue;
      const definition = this.monsterAdmission.resolve(field.classname, field);
      if (definition !== null) replacements.set(field.ordinal, definition);
    }
    const inhibited: Q2SpawnFields[] = [], removedBySource: Q2SpawnFields[] = [], spawned: Q2Entity[] = [];
    const replaced: OwnedActor[] = [];
    for (const field of fields) {
      if (inhibitQ2Spawn(field, this.options)) { inhibited.push(field); continue; }
      const definition = replacements.get(field.ordinal);
      if (definition != null && this.monsterAdmission !== null) {
        const actor = this.allocateActor(field, `${definition.source.provider}/${definition.classname}`);
        this.host.combat.create(actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: false, invulnerable: false, team: null });
        this.monsterAdmission.spawn(actor, field, definition); replaced.push(actor); continue;
      }
      const entity = this.spawn(field);
      if (this.host.actors.isLive(entity.actor.id)) spawned.push(entity);
      else removedBySource.push(field);
    }
    this.findTeams();
    return { authored: fields.length, inhibited, removedBySource, spawned, replaced, unsupported: [...this.unsupported] };
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
