import type { ActorId, ProviderId } from "./identity.ts";
import type { MissionGate, ObjectiveId } from "./gameplay.ts";

export interface SourceTeamValue { readonly value: number; readonly team: string | null; }
export interface SourceMatchPlayer {
  readonly owner: ProviderId;
  team(): string | null;
  score(): number;
  setTeam(team: string | null): void;
  setScore(score: number): void;
}
export interface SourceObjectiveState {
  readonly stage: string;
  readonly complete: boolean;
  readonly carrier: ActorId | null;
  readonly target: ActorId | null;
}
export interface SourceObjectiveBinding {
  readonly owner: ProviderId;
  readonly id: ObjectiveId;
  readonly campaignGate: boolean;
  readonly botGoal: boolean;
  read(): SourceObjectiveState;
  change(request: Omit<SourceObjectiveState, "complete">): void;
}
export interface SourceMatchServices {
  player(actor: ActorId): SourceMatchPlayer | null;
  bindSource(owner: ProviderId, resolve: (actor: ActorId) => SourceMatchPlayer | null): () => void;
  objective(id: ObjectiveId): SourceObjectiveState | null;
  changeObjective(id: ObjectiveId, request: Omit<SourceObjectiveState, "complete">): SourceObjectiveState | null;
  bindObjective(binding: SourceObjectiveBinding): () => void;
  objectives(): readonly { readonly id: ObjectiveId; readonly state: SourceObjectiveState; readonly botGoal: boolean }[];
  gates(): readonly MissionGate[];
}

export function sourceTeam(values: readonly SourceTeamValue[], value: number): string | null {
  const match = values.find(entry => entry.value === value);
  if (match === undefined) throw new Error(`Original team value ${value} has no declared shared identity`);
  return match.team;
}
export function originalTeam(values: readonly SourceTeamValue[], team: string | null): number {
  const match = values.find(entry => entry.team === team);
  if (match === undefined) throw new Error(`Shared team ${team ?? "unassigned"} has no declared original value`);
  return match.value;
}

export type SourceMatchField = { readonly binding: "score" } | { readonly binding: "team"; readonly values: readonly SourceTeamValue[] };
export function validateSourceMatchField(field: SourceMatchField): void {
  if (field.binding === "score") return;
  if (field.values.length === 0 || new Set(field.values.map(value => value.value)).size !== field.values.length
    || new Set(field.values.map(value => value.team)).size !== field.values.length
    || field.values.some(value => !Number.isFinite(value.value) || value.team !== null && value.team.length === 0))
    throw new Error("Team projection requires distinct original values and shared identities");
}
export function readSourceMatchField(match: SourceMatchServices | undefined, actor: ActorId, field: SourceMatchField): number {
  if (match === undefined) throw new Error("Component match fields require destination match services");
  const player = match.player(actor);
  return field.binding === "score" ? player?.score() ?? 0 : originalTeam(field.values, player?.team() ?? null);
}
export function writeSourceMatchField(match: SourceMatchServices | undefined, actor: ActorId, field: SourceMatchField, value: number): void {
  const player = match?.player(actor);
  if (player == null) throw new Error("Component match mutation requires an admitted destination player");
  if (field.binding === "score") player.setScore(value); else player.setTeam(sourceTeam(field.values, value));
}

export interface SourceTeamAlias { readonly source: string | null; readonly team: string | null; }
export interface SourceTeamCommand extends SourceTeamAlias { readonly arguments: readonly string[]; }
export interface SourcePrimaryMatch { readonly score: number; readonly teams: readonly SourceTeamCommand[]; }
export function sourceTeamCommand(profile: SourcePrimaryMatch, team: string | null): readonly string[] {
  const command = profile.teams.find(value => value.team === team);
  if (command === undefined) throw new Error(`The original source has no declared command for team ${team ?? "unassigned"}`);
  return command.arguments;
}
export function sourceScore(value: number): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new Error("Original score requires an int32 value");
  return value;
}

export interface SourceObjectiveValue { readonly value: number; readonly stage: string; readonly complete: boolean; }
export type SourceObjectiveDeclaration<Scalar, Reference, Call> = {
  readonly id: ObjectiveId;
  readonly state: { readonly storage: Scalar; readonly values: readonly SourceObjectiveValue[] };
  readonly carrier: Reference | null;
  readonly target: Reference | null;
} & ({ readonly role: "owned"; readonly campaignGate: boolean; readonly botGoal: boolean; readonly change: Call | null }
  | { readonly role: "borrowed"; readonly writable: boolean });
