import type { ModuleIdentity, QvmAbiProfile } from "./execution.ts";
import type { Vec3 } from "./math.ts";

/** A hook component declaration is tied to the exact authored server executable. */
export interface QvmGrappleDefinition {
  readonly id: string;
  readonly title: string;
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly entityStride: number;
  readonly clientStride: number;
  readonly fields: {
    readonly inuse: number;
    readonly client: number;
    readonly parent: number;
    readonly target: number;
    readonly mover: number | null;
    readonly hook: number;
    readonly health: number;
    readonly takedamage: number;
    readonly eventTime: number;
    readonly freeAfterEvent: number;
  };
  readonly globals: {
    readonly time: number;
    readonly frame: number;
    readonly movement: number;
    readonly forward: number;
    readonly groundPlane: number;
  };
  readonly callbacks: {
    readonly allocate: number;
    readonly free: number;
    readonly fire: number;
    readonly release: number;
    readonly forceRelease: number;
    readonly missile: number;
    readonly follow: number | null;
    readonly think: number;
    readonly pull: number;
    readonly moveMoverHooks: number | null;
    readonly damage: number;
    readonly sameTeam: number;
    readonly playerMove: number;
  };
  readonly fireArguments: readonly number[];
  readonly movement: { readonly byteLength: number; readonly words: readonly { readonly offset: number; readonly value: number }[] };
  readonly initialCvars: Readonly<Record<string, string>>;
  readonly eventLifetimeMilliseconds: number;
  readonly grappleDamageMethod: number;
  readonly presentation: {
    readonly projectileModel: string;
    readonly viewModel: string;
    readonly weaponIndex: number;
    readonly viewAnchor: { readonly path: string; readonly tag: string; readonly offset: Vec3; readonly fovOffset: { readonly above: number; readonly scale: number } };
    readonly viewAttachments: readonly { readonly path: string; readonly tag: string }[];
    readonly cable: { readonly kind: "shader"; readonly path: string; readonly width: number }
      | { readonly kind: "model"; readonly flight: string; readonly pull: string; readonly hold: string; readonly segmentLength: number };
    readonly fireSound: string | null;
    readonly attachSound: string | null;
    readonly releaseSound: string | null;
    readonly pullSound: string | null;
    readonly hangSound: string | null;
  };
  readonly pullingFlag: number;
}
