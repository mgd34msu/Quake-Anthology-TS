import type { ProviderId, SessionId } from "../contracts/identity.ts";
import type { SourceTime } from "../contracts/time.ts";

export interface Diagnostic {
  readonly severity: "debug" | "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly session: SessionId;
  readonly provider: ProviderId | null;
  readonly time: SourceTime | null;
}

export type DiagnosticSink = (diagnostic: Diagnostic) => undefined;

/** Host aborts unwind the current synchronous frame; fatal errors end its owner. */
export class EngineError extends Error {
  constructor(readonly kind: "disconnect" | "drop" | "fatal", message: string) {
    super(message);
    this.name = "EngineError";
  }
}

export class SessionDiagnostics {
  constructor(readonly session: SessionId, private readonly sink: DiagnosticSink) {}

  emit(diagnostic: Omit<Diagnostic, "session">): undefined {
    this.sink({ ...diagnostic, session: this.session });
    return undefined;
  }
}
