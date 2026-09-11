/** Source-memory hooks for collision allocation records. */
export interface ZoneAllocation {
    readonly bytes: Uint8Array;
}
export interface HunkAllocation extends ZoneAllocation {
    readonly kind: "permanent" | "temporary";
    readonly byteOffset: number;
    readonly byteLength: number;
}
export type HunkAccountingProfile = {
    readonly kind: "unaccounted";
} | {
    readonly kind: "source-hunk";
    readonly accounting: {
        reserve(source: string, resource: string, bytes: number, preference: "high"): HunkAllocation;
    };
};
export const SOURCE_HUNK_RELEASE32 = Object.freeze({ pointer: 4, diskShader: 72, collisionModel: 48, collisionNode: 12, brush: 44, leaf: 24, area: 8, plane: 20, brushSide: 12, collisionPatch: 16 });
