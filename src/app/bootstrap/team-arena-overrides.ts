import type { SaveImage } from "../../contracts/session.ts";
import type { CvarArchiveEntry, CvarRegistry } from "../../core/cvars/index.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../persistence/value.ts";
import { simulationProviderCheckpoint } from "./simulation/save.ts";
import { teamArenaServerOverrides } from "./team-arena-skirmish.ts";

export interface OverrideSeat { readonly seat: number; readonly client: number; }
export interface OverrideRegistry extends OverrideSeat { readonly cvars: CvarRegistry; }
export interface TeamArenaOverrides {
  readonly phase: "active" | "released";
  readonly seats: readonly (OverrideSeat & { readonly baseline: string; readonly effective: string })[];
}
const schema = "world:team-arena-overrides";
function requireSeats(state: TeamArenaOverrides, expected: readonly OverrideSeat[]): void {
  if (state.seats.length !== expected.length || new Set(state.seats.map(row => row.seat)).size !== state.seats.length
    || new Set(state.seats.map(row => row.client)).size !== state.seats.length
    || state.seats.some(row => !expected.some(seat => seat.seat === row.seat && seat.client === row.client)))
    throw new Error("Saved Team Arena override seats do not match local clients");
}
export function captureTeamArenaOverrides(seats: readonly OverrideRegistry[]): TeamArenaOverrides {
  const state: TeamArenaOverrides = { phase: "active", seats: seats.map(row => {
    const baseline = row.cvars.find("ui_drawTimer");
    if (baseline === undefined) throw new Error("Team Arena timer baseline is missing");
    return { seat: row.seat, client: row.client, baseline: baseline.value, effective: row.cvars.variableString("cg_drawTimer") };
  }) };
  requireSeats(state, seats); return state;
}
export function readTeamArenaOverrides(image: SaveImage, seats: readonly OverrideSeat[]): TeamArenaOverrides | null {
  if (!image.providers.some(row => row.schema === schema)) return null;
  if (!image.recipe.execution.some(module => module.kind === "typescript" && module.api.kind === "q3-qagame"))
    throw new Error("Team Arena override checkpoint has no native Q3 owner");
  return decodeTeamArenaOverrides(decodeCheckpointValue(simulationProviderCheckpoint(image, schema).bytes), seats);
}
export function decodeTeamArenaOverrides(value: unknown, seats: readonly OverrideSeat[]): TeamArenaOverrides {
  const reader = new SaveReader(value, "Team Arena overrides");
  const phase = reader.field("phase").string();
  if (phase !== "active" && phase !== "released") return reader.fail("invalid override phase");
  const state: TeamArenaOverrides = { phase, seats: reader.field("seats").list(row => ({ seat: row.field("seat").integer(0), client: row.field("client").integer(0),
    baseline: row.field("baseline").string(), effective: row.field("effective").string() })) };
  requireSeats(state, seats); return state;
}
export function saveTeamArenaOverrides(image: SaveImage, state: TeamArenaOverrides | null, seats: readonly OverrideRegistry[]): SaveImage {
  if (state === null) return image;
  requireSeats(state, seats);
  const saved = { phase: state.phase, seats: state.seats.map(row => {
    const seat = seats.find(seat => seat.seat === row.seat && seat.client === row.client);
    if (seat === undefined) throw new Error("Missing saved override seat");
    return { ...row, effective: seat.cvars.variableString("cg_drawTimer") };
  }) };
  return { ...image, providers: [...image.providers, { provider: image.recipe.map.entities.provider, schema, version: 1, bytes: encodeCheckpointValue(saved) }] };
}
export function applyTeamArenaOverrides(state: TeamArenaOverrides | null, seats: readonly OverrideRegistry[]): void {
  if (state === null) return;
  requireSeats(state, seats);
  if (state.phase === "released") return;
  for (const row of state.seats) {
    const seat = seats.find(seat => seat.seat === row.seat && seat.client === row.client);
    if (seat === undefined) throw new Error("Missing override seat");
    seat.cvars.set("ui_drawTimer", row.baseline, true); seat.cvars.set("cg_drawTimer", row.effective, true);
  }
}
export function releaseTeamArenaOverrides(state: TeamArenaOverrides | null, seats: readonly OverrideRegistry[]): TeamArenaOverrides | null {
  if (state === null || state.phase === "released") return state;
  requireSeats(state, seats);
  for (const row of state.seats) {
    const seat = seats.find(seat => seat.seat === row.seat && seat.client === row.client);
    if (seat === undefined) throw new Error("Missing override seat");
    seat.cvars.set("cg_drawTimer", row.baseline, true);
  }
  return { ...state, phase: "released" };
}
export function teamArenaArchiveEntries(registry: CvarRegistry, state: TeamArenaOverrides | null, seat?: number): readonly CvarArchiveEntry[] {
  const entries = registry.archiveEntries();
  if (state?.phase !== "active") return entries;
  return entries.map(entry => {
    if (seat !== undefined) {
      const saved = state.seats.find(row => row.seat === seat);
      return entry.name.toLowerCase() === "cg_drawtimer" && saved !== undefined ? { ...entry, value: saved.baseline } : entry;
    }
    const setting = teamArenaServerOverrides.find(row => row.name.toLowerCase() === entry.name.toLowerCase());
    const saved = setting === undefined ? undefined : registry.find(setting.saved);
    if (setting !== undefined && saved === undefined) throw new Error("Team Arena source archive baseline is missing");
    return saved === undefined ? entry : { ...entry, value: saved.value };
  });
}
