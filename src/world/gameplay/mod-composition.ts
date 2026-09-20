import type { ProviderId } from "../../contracts/identity.ts";

export interface ModRegistrationIdentity {
  readonly provider: ProviderId;
  readonly id: `${string}:${string}`;
  readonly order: number;
}

export type ModOperationRegistration<Request, Result> = ModRegistrationIdentity & (
  | { readonly kind: "transform"; transform(request: Request): Request }
  | { readonly kind: "observe"; observe(request: Request, result: Result): undefined }
  | { readonly kind: "replace"; replace(request: Request, next: (request: Request) => Result): Result }
);

interface Registration<Request, Result> {
  readonly contribution: ModOperationRegistration<Request, Result>;
  readonly sequence: number;
  active: boolean;
}

function label(identity: ModRegistrationIdentity): string { return `${identity.provider}/${identity.id}`; }

/** Registrations change between invocations; removing one takes effect even during a nested call. */
export class ModOperation<Request, Result> {
  private entries: readonly Registration<Request, Result>[] = [];
  private sequence = 0;

  constructor(readonly name: string) {}

  get active(): boolean { return this.entries.length !== 0; }

  register(contribution: ModOperationRegistration<Request, Result>): () => undefined {
    if (!Number.isSafeInteger(contribution.order)) throw new RangeError(`Invalid mod order for ${this.name}: ${label(contribution)}`);
    for (const entry of this.entries) {
      const previous = entry.contribution;
      if (previous.provider === contribution.provider && previous.id === contribution.id)
        throw new Error(`Duplicate mod registration for ${this.name}: ${label(contribution)}`);
      if (previous.kind === "replace" && contribution.kind === "replace")
        throw new Error(`Conflicting replacements for ${this.name}: ${label(previous)} and ${label(contribution)}`);
    }
    const entry = { contribution: Object.freeze({ ...contribution }), sequence: this.sequence++, active: true };
    this.entries = [...this.entries, entry].sort((a, b) => a.contribution.order - b.contribution.order || a.sequence - b.sequence);
    return () => {
      if (entry.active) { entry.active = false; this.entries = this.entries.filter(candidate => candidate !== entry); }
      return undefined;
    };
  }

  dispatch(input: Request, canonical: (request: Request) => Result): Result {
    const entries = this.entries;
    if (entries.length === 0) return canonical(input);
    let request = input;
    for (const entry of entries) if (entry.active && entry.contribution.kind === "transform") request = entry.contribution.transform(request);
    const replacement = entries.find(entry => entry.active && entry.contribution.kind === "replace")?.contribution;
    let result: Result;
    if (replacement?.kind === "replace") {
      let open = true, called = false;
      const failure: { value: { error: unknown } | null } = { value: null };
      try {
        result = replacement.replace(request, value => {
          try {
            if (!open) throw new Error(`Mod continuation for ${this.name} is closed: ${label(replacement)}`);
            if (called) throw new Error(`Mod continuation for ${this.name} was already called: ${label(replacement)}`);
            called = true;
            request = value;
            return canonical(value);
          } catch (error) { failure.value = { error }; throw error; }
        });
        if (failure.value !== null) throw failure.value.error;
      } finally { open = false; }
    } else result = canonical(request);
    for (const entry of entries) if (entry.active && entry.contribution.kind === "observe") entry.contribution.observe(request, result);
    return result;
  }

  clear(): undefined {
    for (const entry of this.entries) entry.active = false;
    this.entries = [];
    return undefined;
  }
}
