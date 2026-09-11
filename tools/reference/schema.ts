export interface FileIdentity {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface CommandObservation {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly outcome:
    | { readonly kind: "exited"; readonly exitCode: number }
    | { readonly kind: "timed-out"; readonly timeoutMs: number };
  readonly stdout: string;
  readonly stderr: string;
}

export type ToolObservation =
  | { readonly kind: "unavailable"; readonly name: string }
  | {
      readonly kind: "available";
      readonly name: string;
      readonly executable: FileIdentity;
      readonly observations: readonly CommandObservation[];
    };

export type PathObservation =
  | { readonly kind: "file"; readonly identity: FileIdentity }
  | { readonly kind: "symlink"; readonly path: string; readonly target: string }
  | { readonly kind: "deleted"; readonly path: string }
  | { readonly kind: "directory"; readonly path: string };

export interface SourceIdentity {
  readonly sourceId: string;
  readonly path: string;
  readonly role: "original-source" | "typescript-donor";
  readonly expectedHead: string;
  readonly head: string;
  readonly tree: string;
  readonly state: "clean" | "modified";
  readonly changes: readonly PathObservation[];
  readonly observations: readonly CommandObservation[];
}

export interface BinaryObservation {
  readonly identity: FileIdentity;
  readonly format: "elf" | "pe" | "dos-mz";
  readonly purpose:
    | "retail-windows-engine"
    | "retail-dos-engine"
    | "typescript-donor-executable"
    | "source-tree-binary"
    | "other-corpus-binary";
  readonly executablePermission: boolean;
  readonly provenance:
    | { readonly kind: "source-tree" }
    | { readonly kind: "supplied-corpus" }
    | {
        readonly kind: "steam-installation";
        readonly installationPath: string;
        readonly family: "q1" | "q2" | "q3";
        readonly edition: "classic" | "rerelease";
      };
  readonly header: CommandObservation;
  readonly execution: {
    readonly kind: "not-run";
    readonly reason: string;
  };
}

export interface ReadObservation {
  readonly path: string;
  readonly value:
    | { readonly kind: "read"; readonly text: string; readonly sha256: string }
    | { readonly kind: "unavailable"; readonly reason: string };
}

export interface SteamObservation {
  readonly commonPath: string;
  readonly titles: readonly {
    readonly name: string;
    readonly family: "q1" | "q2" | "q3";
    readonly path: string;
    readonly availability:
      | { readonly kind: "present" }
      | { readonly kind: "unavailable"; readonly reason: string };
  }[];
  readonly compatibilityRuntime:
    | { readonly kind: "unavailable"; readonly path: string; readonly reason: string }
    | {
        readonly kind: "present";
        readonly path: string;
        readonly files: readonly FileIdentity[];
        readonly version: ReadObservation;
        readonly wineVersion: CommandObservation;
        readonly steamRuntimeVersions: readonly ReadObservation[];
        readonly launchPolicy: readonly string[];
      };
  readonly provenanceBasis: string;
}

export interface ReferenceEnvironment {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly command: readonly string[];
  readonly runtime: FileIdentity;
  readonly platform: string;
  readonly architecture: string;
  readonly bunVersion: string;
  readonly locale: "C";
  readonly identityHashAlgorithm: "sha256";
  readonly captureProgram: readonly FileIdentity[];
  readonly sourceCensus: {
    readonly definition: FileIdentity;
    readonly manifest: FileIdentity | null;
  };
  readonly sources: readonly SourceIdentity[];
  readonly tools: readonly ToolObservation[];
  readonly availableLibraryFiles: readonly FileIdentity[];
  readonly system: readonly ReadObservation[];
  readonly binaries: readonly BinaryObservation[];
  readonly steam: SteamObservation;
  readonly discovery: {
    readonly roots: readonly string[];
    readonly method: string;
    readonly errors: readonly string[];
  };
  readonly limits: readonly string[];
}
