import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord, isUnknownArray } from "../../network/common/value.ts";

export type PlayerProgressEvent =
  | { readonly kind: "achievement"; readonly source: "q1" | "q2"; readonly participant: string; readonly event: string; readonly award: string }
  | { readonly kind: "level-completed"; readonly source: "q1" | "q2"; readonly participant: string; readonly event: string; readonly map: string }
  | { readonly kind: "match-completed"; readonly source: "q1" | "q2" | "q3"; readonly participant: string; readonly event: string; readonly map: string; readonly score: number };

function decode(value: unknown): PlayerProgressEvent {
  if (!isRecord(value) || (value["source"] !== "q1" && value["source"] !== "q2" && value["source"] !== "q3")
    || typeof value["participant"] !== "string" || value["participant"].length === 0
    || typeof value["event"] !== "string" || value["event"].length === 0) throw new Error("Invalid player progress identity");
  const source = value["source"], participant = value["participant"], event = value["event"];
  if (value["kind"] === "achievement" && source !== "q3" && typeof value["award"] === "string" && value["award"].length > 0)
    return { kind: "achievement", source, participant, event, award: value["award"] };
  if (typeof value["map"] !== "string" || value["map"].length === 0) throw new Error("Invalid player progress map");
  if (value["kind"] === "level-completed" && source !== "q3") return { kind: "level-completed", source, participant, event, map: value["map"] };
  if (value["kind"] === "match-completed" && typeof value["score"] === "number" && Number.isFinite(value["score"]))
    return { kind: "match-completed", source, participant, event, map: value["map"], score: value["score"] };
  throw new Error("Invalid player progress event");
}
function identity(event: PlayerProgressEvent): string { return JSON.stringify([event.source, event.participant, event.event]); }

/** One application-owned writer; duplicate restored events retain their original durable result. */
export class PlayerProgressStore {
  private readonly events = new Map<string, PlayerProgressEvent>();
  private tail: Promise<void> = Promise.resolve();
  private constructor(private readonly file: string) {}
  static async open(file: string): Promise<PlayerProgressStore> {
    const store = new PlayerProgressStore(file);
    let text: string;
    try { text = await readFile(file, "utf8"); }
    catch (error) { if (isRecord(error) && error["code"] === "ENOENT") return store; throw error; }
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value["version"] !== 1 || !isUnknownArray(value["events"])) throw new Error("Invalid player progress file");
    for (const item of value["events"]) {
      const event = decode(item), key = identity(event);
      if (store.events.has(key)) throw new Error("Duplicate player progress event");
      store.events.set(key, event);
    }
    return store;
  }
  list(participant: string): readonly PlayerProgressEvent[] { return [...this.events.values()].filter(event => event.participant === participant); }
  record(input: PlayerProgressEvent): Promise<boolean> {
    const event = decode(input);
    const operation = this.tail.then(async () => {
      const key = identity(event);
      if (this.events.has(key)) return false;
      const pending = [...this.events.values(), event];
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.pending`;
      await writeFile(temporary, JSON.stringify({ version: 1, events: pending }) + "\n", { mode: 0o600 });
      await rename(temporary, this.file);
      this.events.set(key, event);
      return true;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async flush(): Promise<void> { await this.tail; }
}
