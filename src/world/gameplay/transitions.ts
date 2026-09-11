import type { ObjectiveId, TransitionCoordinator, TransitionDecision, TransitionIntent, TransitionMode } from "../../contracts/gameplay.ts";

export class SharedTransitionCoordinator implements TransitionCoordinator {
  private readonly pending = new WeakSet<TransitionDecision>();
  private committing = false;

  constructor(private readonly apply: (decision: Exclude<TransitionDecision, { readonly kind: "stay" }>) => undefined) {}

  resolve(mode: TransitionMode, intents: readonly TransitionIntent[]): TransitionDecision {
    const campaign = intents.filter(intent => (intent.kind === "campaign-level" || intent.kind === "campaign-complete") && mode.kind !== "competitive" && intent.campaign === mode.campaign);
    const match = intents.filter(intent => (intent.kind === "round-complete" || intent.kind === "match-rotation") &&
      (mode.kind === "campaign" ? mode.allowRoundRestart && intent.kind === "round-complete" : intent.match === mode.match));
    const blocked: ObjectiveId[] = [];
    const candidates = mode.kind === "combined" && mode.simultaneous === "round-first" ? [...match, ...campaign] : [...campaign, ...match];
    for (const intent of candidates) {
      if (intent.kind === "campaign-level" || intent.kind === "campaign-complete") {
        const missing = intent.gates.filter(gate => !gate.satisfied).map(gate => gate.objective);
        if (missing.length > 0) { blocked.push(...missing); continue; }
      }
      let decision: TransitionDecision;
      switch (intent.kind) {
        case "campaign-level": decision = { kind: "travel", map: intent.map, spawnPoint: intent.spawnPoint, completeCampaign: false }; break;
        case "campaign-complete": decision = { kind: "campaign-complete", campaign: intent.campaign }; break;
        case "round-complete": decision = { kind: "round", winner: intent.winner }; break;
        case "match-rotation":
          // In combined mode, match rotation cannot bypass the campaign's authored gates.
          if (mode.kind === "combined") continue;
          decision = { kind: "travel", map: intent.map, spawnPoint: "", completeCampaign: false }; break;
      }
      Object.freeze(decision);
      this.pending.add(decision);
      return decision;
    }
    return Object.freeze({ kind: "stay", blocked: Object.freeze([...new Set(blocked)]) });
  }

  commit(decision: TransitionDecision): undefined {
    if (decision.kind === "stay") return undefined;
    if (this.committing) throw new Error("A level transition is already committing");
    if (!this.pending.delete(decision)) throw new Error("Transition was not resolved here or was already committed");
    this.committing = true;
    try { return this.apply(decision); } finally { this.committing = false; }
  }
}
