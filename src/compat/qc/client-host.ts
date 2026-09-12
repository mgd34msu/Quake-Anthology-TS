import type { ActorId } from "../../contracts/identity.ts";
import { aimQ1 } from "../../world/gameplay/q1-aim.ts";
import { Q1ClientVisibility } from "../../world/gameplay/q1-client-visibility.ts";
import type { Q1ClientVisibilityScene } from "../../world/gameplay/q1-client-visibility.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import type { QcBuiltin } from "./machine.ts";
import { QcProgramError } from "./program.ts";
import type { QcWorldHost } from "./world-host.ts";

/** QC owns the fields and lifetimes; the shared policy owns client rotation and PVS caching. */
export class QcClientHost {
  readonly host: ReadonlyMap<QcHostBuiltinName, QcBuiltin>;
  readonly visibility: Q1ClientVisibility;
  constructor(world: QcWorldHost, services: { readonly scene: Q1ClientVisibilityScene; readonly maxClients: number; readonly serverTime: () => number }) {
    const { program, entities, actors, slots } = world.options;
    if (!Number.isSafeInteger(services.maxClients) || services.maxClients < 1 || services.maxClients >= entities.count) throw new QcProgramError("invalid reserved QC client range");
    for (let slot = 0; slot <= services.maxClients; slot++) {
      if (slots.at(slot) === null) throw new QcProgramError(`missing reserved QC client/world slot ${slot}`);
    }
    const field = (name: string): number => {
      const definition = program.fieldsByName.get(name);
      if (definition === undefined) throw new QcProgramError(`missing entity field ${name}`);
      return definition.offset;
    };
    const origin = field("origin"), viewOffset = field("view_ofs"), health = field("health"), flags = field("flags");
    this.visibility = new Q1ClientVisibility({ maxClients: services.maxClients, visibility: services.scene,
      client: slot => {
        const words = entities.at(slot), actor = slots.at(slot);
        return { actor: actor?.id ?? null, free: world.isFreeEntity(slot) || actor === null || !actors.isLive(actor.id),
          health: words.float(health), notarget: (Math.trunc(words.float(flags)) & 128) !== 0,
          origin: words.vector(origin), viewOffset: words.vector(viewOffset) };
      } });
    const checkclient: QcBuiltin = vm => {
      if (vm.program !== program || vm.entities !== entities) return vm.fail("client builtin belongs to another QC machine");
      const self = entities.at(entities.slot(vm.globals.int(vm.globalOffset("self"))));
      const actor = this.visibility.check({ origin: self.vector(origin), viewOffset: self.vector(viewOffset) }, services.serverTime(), vm.numeric);
      vm.returnInt(actor === null ? 0 : world.reference(actor));
    };
    this.host = new Map<QcHostBuiltinName, QcBuiltin>([["checkclient", checkclient]]);
  }
}

/** PF_aim reads speed but never uses it; all collision and selection uses the shared Q1 policy. */
export function createQcAimBinding(world: QcWorldHost, services: {
  readonly aimThreshold: () => number;
  readonly teamplay: () => number;
}): QcBuiltin {
  const { program, entities, actors, slots, bodies, scene, numeric } = world.options;
  const field = (name: string): number => {
    const value = program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing QC aim field ${name}`); return value.offset;
  };
  const team = field("team"), damage = field("takedamage");
  return vm => {
    if (vm.program !== program || vm.entities !== entities) return vm.fail("aim builtin belongs to another QC machine");
    const actor = world.actor(entities.slot(vm.argInt(0))), body = bodies.read(actor.id);
    if (body === null) return vm.fail("QC aim actor has no body");
    const shooter = entities.fromReference(vm.argInt(0)), targets: ActorId[] = [];
    for (let slot = 1; slot < entities.count; slot++) {
      const target = slots.at(slot); if (target !== null && actors.isLive(target.id)) targets.push(target.id);
    }
    vm.returnVector(aimQ1(body.origin, vm.globals.vector(vm.globalOffset("v_forward")), services.aimThreshold(), {
      targets, body: target => bodies.read(target), eligible: target => {
        const source = actors.sourceOf(target); if (source?.provider !== slots.options.provider || target.equals(actor.id)) return false;
        const words = entities.at(source.slot);
        return words.float(damage) === 2 && !(services.teamplay() !== 0 && shooter.float(team) > 0 && shooter.float(team) === words.float(team));
      }, trace: (start, end) => {
        const trace = scene.trace({ start, end, shape: { kind: "point" }, target: { kind: "world" },
          policy: { kind: "q1", move: "normal", hull: null }, numeric, passActor: actor.id });
        return trace.hit.kind === "actor" ? trace.hit.actor : null;
      },
    }));
  };
}
