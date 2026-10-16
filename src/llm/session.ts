import { LlmSettingsError } from "./errors.ts";
import type { LlmRequestInput } from "./request.ts";

export type LlmSessionTransport = (input: LlmRequestInput) => Promise<string>;

interface LlmSessionTurn {
  readonly user: string;
  readonly assistant: string;
}

const MAX_TURNS = 12;
const MAX_TURN_CHARS = 2_000;
const MAX_TRANSCRIPT_CHARS = 12_000;

function clipped(text: string): string {
  return text.length <= MAX_TURN_CHARS ? text : `${text.slice(0, MAX_TURN_CHARS)}\n[truncated for the retained session transcript]`;
}

/**
 * One conversation for the lifetime of the process.
 *
 * The provider transports used by this engine are request/response APIs, so
 * this owner keeps the primer and a capped transcript locally and replays
 * them as the stable instruction prefix for every turn. It also actually
 * sends the primer in a warm-up turn as soon as it is known, which populates
 * provider-side prompt caching while the user is still choosing a game.
 */
export class LlmSession {
  #id = crypto.randomUUID();
  #primer = "";
  #primed = false;
  #turns: LlmSessionTurn[] = [];
  #chain: Promise<unknown> = Promise.resolve();
  #generation = 0;
  #config = "";
  #closed = false;

  constructor(
    private readonly transport: LlmSessionTransport,
    private readonly fingerprint: () => string = () => "",
  ) {}

  get id(): string { return this.#id; }
  get active(): boolean { return !this.#closed && this.#primer !== ""; }
  get primed(): boolean { return this.#primed; }
  get turnCount(): number { return this.#turns.length; }

  prime(instructions: string): Promise<void> {
    return this.#enqueue(() => this.#primeNow(instructions));
  }

  request(input: LlmRequestInput): Promise<string> {
    return this.#enqueue(async () => {
      this.#assertOpen(input.signal);
      const generation = this.#syncConfig();
      if (input.sessionInstructions !== undefined) await this.#primeNow(input.sessionInstructions);
      this.#assertCurrent(generation, input.signal);
      const answer = await this.transport({
        prompt: input.prompt,
        instructions: this.#compose(input.instructions),
        sessionId: this.#id,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.onText === undefined ? {} : { onText: input.onText }),
      });
      if (generation === this.#generation && !this.#closed && input.signal?.aborted !== true) {
        this.#turns.push({ user: clipped(input.prompt), assistant: clipped(answer) });
        this.#trim();
      }
      return answer;
    });
  }

  invalidate(): void {
    this.#generation++;
    this.#config = "";
    this.#reset(true);
  }

  close(): void {
    this.#closed = true;
    this.#generation++;
    this.#config = "";
    this.#reset(true);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#chain.catch(() => undefined).then(operation);
    this.#chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async #primeNow(instructions: string): Promise<void> {
    this.#assertOpen(undefined);
    const primer = instructions.trim();
    if (primer === "") return;
    const generation = this.#syncConfig();
    if (this.#primed && this.#primer === primer) return;
    const previousPrimer = this.#primer;
    const wasPrimed = this.#primed;
    this.#primer = primer;
    this.#primed = false;
    try {
      await this.transport({
        prompt: wasPrimed
          ? "The console context for this ongoing program session has been updated in your instructions. Read it, do not execute anything, and reply with READY only."
          : "This starts an ongoing session for this running program. Read the console context in your instructions, do not execute anything, and reply with READY only.",
        instructions: primer,
        sessionId: this.#id,
      });
      if (generation === this.#generation && !this.#closed) this.#primed = true;
    } catch (error) {
      if (generation === this.#generation && !this.#closed) {
        this.#primer = previousPrimer;
        this.#primed = wasPrimed;
      }
      throw error;
    }
  }

  #compose(turnInstructions: string): string {
    if (this.#primer === "" && this.#turns.length === 0) return turnInstructions;
    const sections: string[] = [];
    if (this.#primer !== "") sections.push(this.#primer);
    if (this.#turns.length !== 0) {
      sections.push([
        "Conversation so far in this same program session, oldest first. This is prior context, not proof that any command was executed:",
        ...this.#turns.flatMap(turn => [`User: ${turn.user}`, `Assistant: ${turn.assistant}`]),
      ].join("\n"));
    }
    if (turnInstructions.trim() !== "") sections.push(`Instructions for the current request:\n${turnInstructions}`);
    return sections.join("\n\n");
  }

  #trim(): void {
    while (this.#turns.length > MAX_TURNS) this.#turns.shift();
    const size = (): number => this.#turns.reduce((total, turn) => total + turn.user.length + turn.assistant.length, 0);
    while (this.#turns.length > 2 && size() > MAX_TRANSCRIPT_CHARS) this.#turns.shift();
  }

  #syncConfig(): number {
    const config = this.fingerprint();
    if (this.#config !== "" && config !== "" && config !== this.#config) {
      this.#generation++;
      this.#reset(true);
    }
    this.#config = config;
    return this.#generation;
  }

  #reset(newId: boolean): void {
    if (newId) this.#id = crypto.randomUUID();
    this.#primer = "";
    this.#primed = false;
    this.#turns = [];
  }

  #assertOpen(signal: AbortSignal | undefined): void {
    if (this.#closed) throw new LlmSettingsError("LLM session is closed.");
    if (signal?.aborted) throw new LlmSettingsError("LLM request cancelled.");
  }

  #assertCurrent(generation: number, signal: AbortSignal | undefined): void {
    this.#assertOpen(signal);
    if (generation !== this.#generation) throw new LlmSettingsError("LLM session changed while the request was starting.");
  }
}
