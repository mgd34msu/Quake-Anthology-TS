import type { LibraryEntry, LibraryMenuService } from "../../ui/library/menu.ts";
import type { PlayerProgressEvent, PlayerProgressStore } from "./player-progress.ts";

/** Reads the retained profile's existing store; never creates a second writer. */
export class PlayerProgressLibrary implements LibraryMenuService {
  private rows: readonly LibraryEntry[] = [];
  private message = "";
  private generation = 0;
  constructor(private readonly store: () => Promise<PlayerProgressStore>, private readonly participant: () => string) {}
  entries(): readonly LibraryEntry[] { return this.rows; }
  status(): string { return this.message; }
  refresh(): void { void this.load(); }
  async load(): Promise<void> {
    const generation = ++this.generation, participant = this.participant();
    this.rows = []; this.message = "Loading progress...";
    try {
      const store = await this.store();
      if (generation !== this.generation || participant !== this.participant()) return;
      this.rows = store.list(participant).map(event => this.entry(event));
      this.message = this.rows.length === 0 ? "No recorded achievements or completed levels for this player." : `${this.rows.length} progress records`;
    } catch (error) {
      if (generation !== this.generation || participant !== this.participant()) return;
      this.rows = []; this.message = `Cannot read progress: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  activate(id: string): void {
    const row = this.rows.find(entry => entry.id === id);
    if (row !== undefined) this.message = `${row.label}: ${row.detail ?? ""}`;
  }
  private entry(event: PlayerProgressEvent): LibraryEntry {
    const id = JSON.stringify([event.source, event.participant, event.event]);
    const family = event.source.toUpperCase();
    if (event.kind === "achievement") return { id, label: event.award, detail: `${family} · Achievement earned` };
    if (event.kind === "level-completed") return { id, label: event.map, detail: `${family} · Level completed` };
    return { id, label: event.map, detail: `${family} · Match completed · Score ${event.score}` };
  }
}
