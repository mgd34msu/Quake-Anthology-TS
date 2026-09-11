// Adapted from quake-1-re-ts and id Software Quake. GPL-2.0-or-later.
export class WireVector {
    private x = 0;
    private y = 0;
    private z = 0;
    get 0(): number { return this.x; }
    set 0(n: number) { this.x = Math.fround(n); }
    get 1(): number { return this.y; }
    set 1(n: number) { this.y = Math.fround(n); }
    get 2(): number { return this.z; }
    set 2(n: number) { this.z = Math.fround(n); }
}
export type Vec3 = WireVector;
export function vec3(): Vec3 { return new WireVector(); }
export const AXES: readonly (0 | 1 | 2)[] = [0, 1, 2];
export const MAX_MODELS = 8192;
export const MAX_MSGLEN = 1450;
export const MAX_DATAGRAM = 1450;
export function Sys_Error(message: string): never { throw new Error(message); }
export class EntityStateT {
    origin: Vec3 = vec3();
    angles: Vec3 = vec3();
    modelindex = 0;
    frame = 0;
    colormap = 0;
    skin = 0;
    alpha = 0; // ENTALPHA_DEFAULT
    scale = 16; // ENTSCALE_DEFAULT
    effects = 0;
    clear(): void {
        this.origin[0] = this.origin[1] = this.origin[2] = 0;
        this.angles[0] = this.angles[1] = this.angles[2] = 0;
        this.modelindex = 0;
        this.frame = 0;
        this.colormap = 0;
        this.skin = 0;
        this.alpha = 0;
        this.scale = 16;
        this.effects = 0;
    }
    copyFrom(src: EntityStateT): void {
        this.origin[0] = src.origin[0];
        this.origin[1] = src.origin[1];
        this.origin[2] = src.origin[2];
        this.angles[0] = src.angles[0];
        this.angles[1] = src.angles[1];
        this.angles[2] = src.angles[2];
        this.modelindex = src.modelindex;
        this.frame = src.frame;
        this.colormap = src.colormap;
        this.skin = src.skin;
        this.alpha = src.alpha;
        this.scale = src.scale;
        this.effects = src.effects;
    }
}
