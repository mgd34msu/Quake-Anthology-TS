export type VerificationProfile = "dev" | "integration" | "full" | "release";
export type VerificationStatus = "PASS" | "FAIL" | "BLOCKED_MISSING_INPUT" | "TIMEOUT" | "NOT_RUN";
export type InputKind = "source" | "reference" | "content" | "executable" | "schedule";
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface InputRequirement {
  readonly id: string;
  readonly kind: InputKind;
  readonly path: string;
  readonly sha256: string | null;
}

export interface ExpectedContract {
  readonly id: string;
  readonly description: string;
  readonly oracle: {
    readonly kind: "source" | "reference" | "project";
    readonly identity: string;
    readonly sha256: string | null;
  };
  readonly minimumAssertions: number;
  readonly tolerances: readonly {
    readonly metric: string;
    readonly absolute: number;
    readonly relative: number;
    readonly justification: string;
  }[];
}

export interface CommandContract {
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly ports: number;
  readonly display: "headless" | "offscreen" | "xvfb";
}

export interface ExpectedCase {
  readonly id: string;
  readonly configurationId: string;
  readonly suiteId: string;
  readonly evidenceKind: "tooling" | "component" | "gameplay" | "release";
  readonly configuration: Readonly<Record<string, string>>;
  readonly profiles: readonly VerificationProfile[];
  readonly requirements: readonly InputRequirement[];
  readonly contracts: readonly ExpectedContract[];
  readonly seed: number;
  readonly clockScheduleSha256: string | null;
  readonly networkScheduleSha256: string | null;
  readonly sourcePaths: readonly string[];
  readonly command: CommandContract | null;
}

export interface CaseManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly cases: readonly ExpectedCase[];
}

export interface CompositionDomain {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly axes: readonly {
    readonly id: string;
    readonly values: readonly {
      readonly id: string;
      readonly requirements: readonly InputRequirement[];
    }[];
  }[];
  readonly requirements: readonly InputRequirement[];
  readonly suites: readonly {
    readonly id: string;
    readonly evidenceKind: ExpectedCase["evidenceKind"];
    readonly profiles: readonly VerificationProfile[];
    readonly contracts: readonly ExpectedContract[];
    readonly command: CommandContract | null;
  }[];
  readonly seed: number;
  readonly clockScheduleSha256: string | null;
  readonly networkScheduleSha256: string | null;
  readonly sourcePaths: readonly string[];
}

export interface Artifact {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface Checkpoint {
  readonly id: string;
  readonly at: string;
  readonly observations: JsonValue;
}

export interface AssertionObservation {
  readonly id: string;
  readonly contractId: string;
  readonly passed: boolean;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
}

export interface DriverOutput {
  readonly schemaVersion: 1;
  readonly caseId: string;
  readonly assertions: readonly AssertionObservation[];
  readonly checkpoints: readonly Checkpoint[];
  readonly artifactPaths: readonly string[];
}

export interface Fingerprints {
  readonly manifest: string;
  readonly expectedCase: string;
  readonly source: string;
  readonly snapshot: string;
  readonly executable: string;
  readonly runtimeExecutable: string;
  readonly fixtures: string;
  readonly environment: string;
  readonly clockSchedule: string | null;
  readonly networkSchedule: string | null;
  readonly seed: number;
}

export interface RuntimeEnvironment {
  readonly platform: string;
  readonly architecture: string;
  readonly osRelease: string;
  readonly bunVersion: string;
  readonly cpu: string;
  readonly libraries: readonly InputRequirement[];
  readonly variables: Readonly<Record<string, string>>;
}

export interface AttemptProvenance {
  readonly runId: string;
  readonly attemptId: string;
  readonly previousAttempt: { readonly runId: string; readonly attemptId: string; readonly recordSha256: string } | null;
  readonly reuse: { readonly runId: string; readonly attemptId: string; readonly recordSha256: string } | null;
}

export interface ExecutionRecord {
  readonly schemaVersion: 1;
  readonly caseId: string;
  readonly configurationId: string;
  readonly suiteId: string;
  readonly evidenceKind: ExpectedCase["evidenceKind"];
  readonly contracts: readonly ExpectedContract[];
  readonly provenance: AttemptProvenance;
  readonly fingerprints: Fingerprints;
  readonly inputs: readonly InputRequirement[];
  readonly environment: RuntimeEnvironment;
  readonly command: CommandContract | null;
  readonly resolvedCommand: readonly string[];
  readonly outputRoot: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly assertionCount: number;
  readonly assertions: readonly AssertionObservation[];
  readonly checkpoints: readonly Checkpoint[];
  readonly artifacts: readonly Artifact[];
  readonly outcome:
    | { readonly status: "PASS"; readonly exitCode: 0 }
    | { readonly status: "FAIL"; readonly exitCode: number | null; readonly reasons: readonly string[] }
    | { readonly status: "BLOCKED_MISSING_INPUT"; readonly missingInputs: readonly string[] }
    | { readonly status: "TIMEOUT"; readonly timeoutMs: number; readonly exitCode: number | null }
    | { readonly status: "NOT_RUN"; readonly reason: string };
}

export interface Reconciliation {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  readonly manifestSha256: string;
  readonly expected: number;
  readonly records: number;
  readonly counts: Readonly<Record<VerificationStatus, number>>;
  readonly missingCaseIds: readonly string[];
  readonly unexpectedCaseIds: readonly string[];
  readonly duplicateCaseIds: readonly string[];
  readonly invalidRecords: readonly { readonly caseId: string; readonly reasons: readonly string[] }[];
  readonly complete: boolean;
  readonly gameplayComplete: boolean;
}
