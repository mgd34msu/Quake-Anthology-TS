import type { ModCallbackDeclaration } from "../../contracts/mod-callbacks.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Q1VisibilityClient } from "../../world/gameplay/q1-client-visibility.ts";
import { Q1ClientVisibility } from "../../world/gameplay/q1-client-visibility.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import type { QcBuiltin, QcMachine } from "./machine.ts";
import type { QcProgram } from "./program.ts";

/** Each source guest retains its cvars and the original Quake client-visibility cache. */
export class QcModEnvironment {
  readonly cvars: CvarRegistry;
  readonly visibility: Q1ClientVisibility | null;
  readonly host: ReadonlyMap<QcHostBuiltinName, QcBuiltin>;
  constructor(private readonly services: ModHostServices, program: QcProgram, declaration: ModCallbackDeclaration,
    reference: (actor: ActorId | null) => number) {
    const environment = services.engine?.environment;
    this.cvars = new CvarRegistry({ dialect: program.api.kind, context: { session: services.actors.session, origin: { kind: "server-console" } }, print: text => services.engine?.print(text) });
    const defaults = { skill: String(environment?.skill ?? 1), maxclients: String(declaration.clients?.maximum ?? environment?.maxClients ?? 1),
      coop: environment?.mode === "coop" ? "1" : "0", deathmatch: environment?.mode === "deathmatch" ? "1" : "0", teamplay: "0",
      sv_gravity: String(environment?.gravity ?? 800), sv_aim: "0.93", sv_maxspeed: "320", registered: "1", developer: "0", sv_cheats: "0",
      samelevel: "0", timelimit: "0", fraglimit: "0", gamecfg: "0" };
    for (const [name, value] of Object.entries(defaults)) this.cvars.register(name, value);
    for (const variable of declaration.cvars ?? []) {
      if (this.cvars.find(variable.name) === undefined) this.cvars.register(variable.name, variable.value);
      else this.cvars.set(variable.name, variable.value, true);
    }
    const clients = services.engine?.clients;
    this.visibility = clients === undefined ? null : new Q1ClientVisibility({ maxClients: clients.maximum, visibility: clients.visibility, client: slot => clients.at(slot) });
    this.host = new Map<QcHostBuiltinName, QcBuiltin>([
      ["cvar", vm => { vm.returnFloat(this.cvars.variableValue(vm.argString(0))); }],
      ["cvar_set", vm => { this.cvars.set(vm.argString(0), vm.argString(1)); }],
      ["dprint", vm => { if (this.cvars.variableValue("developer") !== 0) services.engine?.print(vm.varString(0)); }],
      ["checkclient", vm => {
        if (this.visibility === null) return vm.fail("Mod checkclient requires destination client visibility");
        const self = vm.globals.int(vm.globalOffset("self"));
        const actor = this.visibility.check({ origin: vm.entityVector(self, "origin"), viewOffset: vm.entityVector(self, "view_ofs") }, vm.globals.float(vm.globalOffset("time")), vm.numeric);
        vm.returnInt(reference(actor));
      }],
    ]);
  }
  initializeGlobals(machine: QcMachine): void {
    for (const name of ["skill", "deathmatch", "coop", "teamplay"]) {
      const definition = machine.program.globalsByName.get(name);
      if (definition?.type === "float") machine.globals.setFloat(definition.offset, this.cvars.variableValue(name));
    }
    const time = machine.program.globalsByName.get("time"), now = this.services.time();
    if (time?.type === "float") machine.globals.setFloat(time.offset, now.kind === "seconds" ? now.value : now.value / 1000);
    const mapname = machine.program.globalsByName.get("mapname"), map = this.services.engine?.presentation?.map;
    if (mapname?.type === "string" && map !== undefined) machine.globals.setInt(mapname.offset, machine.strings.allocate(map.replace(/^maps\//, "").replace(/\.bsp$/, "")));
  }
  client(actor: ActorId): Q1VisibilityClient | null {
    const clients = this.services.engine?.clients;
    if (clients === undefined) throw new Error("Mod client field requires destination client semantics");
    for (let slot = 1; slot <= clients.maximum; slot++) { const client = clients.at(slot); if (client.actor?.equals(actor)) return client; }
    return null;
  }
}
