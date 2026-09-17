import type { ContentId } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import { Q2ServerMessageReader, type Q2ServerRecord } from "../../network/q2/index.ts";
import { q2ApplicationLayout } from "./network/q2-layout.ts";
import { translateQ2ServiceRecords } from "./network/q2-service-presentation.ts";
import type { ClassicGuestMessage } from "./simulation/classic-guest-services.ts";
import type { ClassicGuestWorld } from "./simulation/classic-guest-world.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

/** Client presentation state decoded from the existing source host's recipient-filtered messages. */
export class NativeQ2ClientPresentation {
  private readonly reader = new Q2ServerMessageReader({ kind: "q2-classic", version: 34 }, { maxConfigStrings: 2080, inventorySlots: 256 });
  private readonly configs: Map<number, string>;
  private readonly pending: SimulationPresentationEvent[] = [];
  private sequence = 1;
  private counts: readonly number[] = [];
  private layoutText = "";
  constructor(readonly world: ClassicGuestWorld, readonly sourceSlot: number, readonly actor: ActorId, readonly content: ContentId) {
    if (world.actor(sourceSlot)?.equals(actor) !== true) throw new Error("Native client presentation requires its admitted source player");
    this.configs = new Map(world.configstrings());
  }
  get configstrings(): ReadonlyMap<number, string> { return this.configs; }
  get inventory(): readonly number[] { return this.counts; }
  get layout(): string { return this.layoutText; }
  get playerState() { return this.world.playerState(this.sourceSlot); }
  receive(messages: readonly Pick<ClassicGuestMessage, "bytes">[], seconds: number): readonly Q2ServerRecord[] {
    const layout = q2ApplicationLayout({ kind: "q2-classic", version: 34 }), remaining: Q2ServerRecord[] = [];
    for (const message of messages) remaining.push(...translateQ2ServiceRecords(this.reader.read(message.bytes), {
      content: () => this.content, seconds, nextSequence: () => this.sequence++,
      player: () => ({ actor: this.actor, sourceEntity: this.sourceSlot }),
      actor: slot => this.world.actor(slot),
      entity: slot => { const info = this.world.entityInfo(slot); return info.active ? this.world.entityState(slot) : null; },
      soundConfigOffset: layout.sounds, playerSkinConfigOffset: layout.playerSkins,
      configString: index => this.configs.get(index), setConfigString: (index, value) => { this.configs.set(index, value); },
      setInventory: counts => { this.counts = [...counts]; }, setLayout: value => { this.layoutText = value; },
      emit: event => { this.pending.push(event); },
    }));
    return remaining;
  }
  takeEvents(): readonly SimulationPresentationEvent[] { return this.pending.splice(0); }
}
