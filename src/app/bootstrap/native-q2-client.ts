import { createQ2Fog } from "../../content/q2/rerelease/types.ts";
import { q2FogFromWire } from "./rerelease-presentation/fog.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { Q2ProtocolIdentity } from "../../contracts/protocol.ts";
import type { ActorId } from "../../contracts/identity.ts";
import { Q2ServerMessageReader, type Q2ServerRecord } from "../../network/q2/index.ts";
import { q2ApplicationLayout } from "./network/q2-layout.ts";
import { q2ServicePrint, translateQ2ServiceRecords, type Q2ServicePresentationHost } from "./network/q2-service-presentation.ts";
import type { ClassicGuestMessage } from "./simulation/classic-guest-services.ts";
import type { Q2NativeWorld } from "./simulation/q2-native-world.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

/** Client presentation state decoded from the existing source host's recipient-filtered messages. */
export class NativeQ2ClientPresentation {
  private readonly reader: Q2ServerMessageReader;
  private readonly sourceLayout;
  private readonly configs: Map<number, string>;
  private readonly pending: SimulationPresentationEvent[] = [];
  private sequence = 1;
  private counts: readonly number[] = [];
  private layoutText = "";
  private fogTarget = createQ2Fog();
  constructor(readonly world: Q2NativeWorld, readonly sourceSlot: number, readonly actor: ActorId, readonly content: ContentId) {
    if (world.actor(sourceSlot)?.equals(actor) !== true) throw new Error("Native client presentation requires its admitted source player");
    this.configs = new Map(world.configstrings());
    // Game imports produce multicast FLOAT records, independently of the selected client wire protocol.
    const protocol: Q2ProtocolIdentity = world.edition === "rerelease"
      ? { kind: "q2-rerelease", version: 1038 }
      : { kind: "q2-classic", version: 34 };
    this.sourceLayout = q2ApplicationLayout(protocol);
    this.reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: this.sourceLayout.maxConfigStrings, inventorySlots: 256 });
  }
  get configstrings(): ReadonlyMap<number, string> { return this.configs; }
  get inventory(): readonly number[] { return this.counts; }
  get layout(): string { return this.layoutText; }
  get playerState() { return this.world.playerState(this.sourceSlot); }
  receive(messages: readonly Pick<ClassicGuestMessage, "bytes">[], seconds: number): readonly Q2ServerRecord[] {
    const remaining: Q2ServerRecord[] = [];
    for (const message of messages) remaining.push(...translateQ2ServiceRecords(this.reader.read(message.bytes), this.presentationHost(seconds)));
    return remaining;
  }
  print(level: number, text: string, seconds: number): void { q2ServicePrint(this.presentationHost(seconds), level, text); }
  private presentationHost(seconds: number): Q2ServicePresentationHost {
    const layout = this.sourceLayout;
    return {
      content: () => this.content, seconds, nextSequence: () => this.sequence++, edition: this.world.edition,
      player: () => ({ actor: this.actor, sourceEntity: this.sourceSlot }),
      actor: slot => this.world.actor(slot),
      entity: slot => { const info = this.world.entityInfo(slot); return info.active ? this.world.entityState(slot) : null; },
      fog: value => { this.fogTarget = q2FogFromWire(this.fogTarget, value); return this.fogTarget; },
      imageConfigOffset: layout.images, soundConfigOffset: layout.sounds, playerSkinConfigOffset: layout.playerSkins,
      configString: index => this.configs.get(index), setConfigString: (index, value) => { this.configs.set(index, value); },
      setInventory: counts => { this.counts = [...counts]; }, setLayout: value => { this.layoutText = value; },
      emit: event => { this.pending.push(event); },
    };
  }
  takeEvents(): readonly SimulationPresentationEvent[] { return this.pending.splice(0); }
}
