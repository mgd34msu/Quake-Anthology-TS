import type { ContentDigest } from './content.ts';
import type { ProjectileRole } from './weapon-behavior.ts';

/** Offsets are bytes; v1 fixes storage widths and calling conventions rather than guessing them. */
export interface NativeWeaponRegistrationLayout {
  readonly byteLength: number;
  readonly name: number;
  readonly tag: number;
  readonly callback: number;
}
export interface NativeWeaponEntry {
  readonly rva: number;
  readonly registration: null | {
    readonly rva: number;
    readonly name: string;
    readonly tag: number;
    readonly layout: NativeWeaponRegistrationLayout;
  };
}
export interface NativeWeaponCommand { readonly arguments: readonly string[]; readonly tail: string }
export interface NativeWeaponCvar { readonly name: string; readonly value: string }
export interface NativeWeaponBehaviorDeclaration {
  readonly version: 1;
  readonly kind: 'q2-api2023-trajectory';
  readonly abi: 'windows-x86-64';
  readonly artifactPath: string;
  readonly artifactDigest: ContentDigest;
  readonly id: `${string}:${string}`;
  readonly title: string;
  readonly role: ProjectileRole;
  readonly aspect: 'trajectory';
  readonly entity: {
    readonly byteLength: number;
    readonly origin: number; readonly angles: number; readonly velocity: number;
    readonly client: number; readonly owner: number; readonly viewHeight: number;
    readonly generation: number; readonly nextThink: number;
    readonly thinkCallback: number; readonly thinkRegistration: number; readonly touchCallback: number;
  };
  readonly client: {
    readonly byteLength: number;
    readonly weapon: number; readonly viewAngles: number; readonly forward: number;
  };
  readonly equippedWeapon: { readonly byteLength: number; readonly callback: number; readonly expected: NativeWeaponEntry };
  readonly time: { readonly storage: 'int64-milliseconds'; readonly rva: number };
  readonly think: { readonly signature: 'entity-void'; readonly tag: number; readonly registration: NativeWeaponRegistrationLayout };
  readonly allocate: { readonly signature: 'void-pointer'; readonly entry: NativeWeaponEntry };
  readonly free: { readonly signature: 'entity-void'; readonly entry: NativeWeaponEntry };
  readonly projectileTouch: NativeWeaponEntry;
  readonly equip: { readonly signature: 'entity-void'; readonly calls: readonly NativeWeaponEntry[] };
  readonly launch: { readonly signature: 'entity-void'; readonly calls: readonly NativeWeaponEntry[] };
  readonly activateRva: number | null;
  readonly fireRva: number;
  readonly initializationClasses: readonly string[];
  readonly equipment: readonly NativeWeaponCommand[];
  readonly ammunition: NativeWeaponCommand;
  readonly initialCvars: readonly NativeWeaponCvar[];
  readonly provisioningCvars: readonly NativeWeaponCvar[];
}
