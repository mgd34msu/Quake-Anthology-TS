/* QW/client/cl_cam.c spectator camera. Copyright id Software. GPL-2.0-or-later. */
import type { Vec3 } from '../../../contracts/math.ts';
import type { QwPlayerState, QwUserCommand } from '../../../contracts/protocol.ts';

export interface QwCameraOptions { hightrack(): number; chasecam(): number; }
export interface QwCameraPlayer { readonly name: string; readonly spectator: boolean; readonly frags: number; }
export interface QwCameraTrace { readonly fraction: number; readonly end: Vec3; readonly inWater: boolean; }
export interface QwCameraFrame {
    readonly self: QwPlayerState;
    readonly players: ReadonlyMap<number, QwPlayerState>;
    readonly users: ReadonlyMap<number, QwCameraPlayer>;
    readonly seconds: number;
}
export interface QwCameraView { readonly origin: Vec3; readonly angles: Vec3; readonly target: QwPlayerState; readonly chase: boolean; }
const vector = (x: number, y: number, z: number): Vec3 => ({ x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) });
const subtract = (a: Vec3, b: Vec3): Vec3 => vector(a.x - b.x, a.y - b.y, a.z - b.z);
const length = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
function viewAngles(v: Vec3): Vec3 {
    if (v.x === 0 && v.y === 0) return vector(v.z > 0 ? -90 : -270, 0, 0);
    const yaw = Math.trunc(Math.atan2(v.y, v.x) * 180 / Math.PI);
    const pitch = Math.trunc(Math.atan2(v.z, Math.sqrt(v.x * v.x + v.y * v.y)) * 180 / Math.PI);
    return vector(-(pitch < 0 ? pitch + 360 : pitch), yaw < 0 ? yaw + 360 : yaw, 0);
}
export class QwSpectatorCamera {
    private tracking = false;
    private locked = false;
    private slot = 0;
    private oldButtons = 0;
    private desired = vector(0, 0, 0);
    private lastViewSeconds = 0;
    private teleport: Vec3 | null = null;
    private current: QwCameraView | null = null;
    constructor(private readonly options: QwCameraOptions, private readonly sendCommand: (text: string) => void,
        private readonly trace: (start: Vec3, end: Vec3) => QwCameraTrace, private readonly print: (text: string) => void) {}
    get view(): QwCameraView | null { return this.tracking && this.locked ? this.current : null; }
    takeTeleport(): Vec3 | null { const result = this.teleport; this.teleport = null; return result; }
    reset(): void { this.tracking = false; this.locked = false; this.slot = 0; this.oldButtons = 0; this.current = null; this.teleport = null; }
    private lock(slot: number): void { this.sendCommand(`ptrack ${slot}`); this.slot = slot; this.locked = false; this.current = null; }
    private unlock(): void { if (this.tracking) this.sendCommand('ptrack'); this.tracking = false; this.locked = false; this.current = null; }
    private eligible(user: QwCameraPlayer | undefined): boolean { return user !== undefined && user.name !== '' && !user.spectator; }
    private highTarget(users: QwCameraFrame['users']): void {
        let best = -1, frags = -9999;
        for (let slot = 0; slot < 32; slot++) {
            const user = users.get(slot);
            if (user !== undefined && this.eligible(user) && user.frags > frags) { best = slot; frags = user.frags; }
        }
        if (best < 0) this.unlock();
        else if (!this.locked || frags > (users.get(this.slot)?.frags ?? -9999)) this.lock(best);
    }
    private visible(target: QwPlayerState): boolean {
        const result = this.trace(target.origin, this.desired);
        return result.fraction === 1 && !result.inWater && length(subtract(target.origin, this.desired)) >= 16;
    }
    private flyby(self: QwPlayerState, target: QwPlayerState, checkVisibility: boolean): boolean {
        const yaw = target.command.angles.y * Math.PI / 180, roll = target.command.angles.z * Math.PI / 180;
        const forward = vector(Math.cos(yaw), Math.sin(yaw), 0);
        const right = vector(Math.cos(roll) * Math.sin(yaw), -Math.cos(roll) * Math.cos(yaw), -Math.sin(roll));
        const up = vector(Math.sin(roll) * Math.sin(yaw), -Math.sin(roll) * Math.cos(yaw), Math.cos(roll));
        const add = (a: Vec3, b: Vec3): Vec3 => vector(a.x + b.x, a.y + b.y, a.z + b.z);
        const directions = [add(add(forward, up), right), subtract(add(forward, up), right),
            add(forward, right), subtract(forward, right), add(forward, up), subtract(forward, up),
            subtract(add(up, right), forward), subtract(subtract(up, right), forward),
            vector(-forward.x, -forward.y, -forward.z), forward, vector(-right.x, -right.y, -right.z), right];
        let best = 1000, position: Vec3 | null = null;
        for (const direction of directions) {
            const magnitude = length(direction), unit = vector(direction.x / magnitude, direction.y / magnitude, direction.z / magnitude);
            const result = this.trace(target.origin, vector(target.origin.x + 800 * unit.x, target.origin.y + 800 * unit.y, target.origin.z + 800 * unit.z));
            if (result.inWater) continue;
            let distance = length(subtract(result.end, target.origin));
            if (distance < 32 || distance > 800) continue;
            if (checkVisibility) {
                distance = length(subtract(result.end, self.origin));
                const visible = this.trace(self.origin, result.end);
                if (visible.fraction !== 1 || visible.inWater) continue;
            }
            if (distance < best) { best = distance; position = result.end; }
        }
        if (position === null) return false;
        this.locked = true; this.desired = position; return true;
    }
    command(command: QwUserCommand, frame: QwCameraFrame): QwUserCommand {
        let result = command;
        if (this.options.hightrack() !== 0 && !this.locked) this.highTarget(frame.users);
        if (this.tracking) {
            if (this.locked && !this.eligible(frame.users.get(this.slot))) {
                this.locked = false;
                if (this.options.hightrack() !== 0) this.highTarget(frame.users); else this.unlock();
            } else {
                const target = frame.players.get(this.slot);
                if (target !== undefined) {
                    if (!this.locked || !this.visible(target)) {
                        if (!this.locked || frame.seconds - this.lastViewSeconds > 0.1) {
                            if (!this.flyby(frame.self, target, true)) this.flyby(frame.self, target, false);
                            this.lastViewSeconds = frame.seconds;
                        }
                    } else this.lastViewSeconds = frame.seconds;
                    if (this.locked) {
                        const chase = this.options.chasecam() !== 0;
                        if (chase) this.desired = target.origin;
                        const delta = subtract(this.desired, frame.self.origin);
                        if (chase ? delta.x !== 0 || delta.y !== 0 || delta.z !== 0 : length(delta) > 16) this.teleport = this.desired;
                        const angles = chase ? target.command.angles : viewAngles(subtract(target.origin, this.desired));
                        this.current = { origin: this.desired, angles, target, chase };
                        result = { ...command, angles, forwardMove: 0, sideMove: 0, upMove: 0 };
                    }
                }
            }
        }
        this.finish(result, frame.users);
        return result;
    }
    private finish(command: QwUserCommand, users: QwCameraFrame['users']): void {
        if ((command.buttons & 1) !== 0) {
            if ((this.oldButtons & 1) !== 0) return;
            this.oldButtons |= 1;
            if (this.tracking) { this.unlock(); return; }
            this.tracking = true;
        } else { this.oldButtons &= ~1; if (!this.tracking) return; }
        if (this.options.hightrack() !== 0) { this.highTarget(users); return; }
        if (this.locked) {
            if ((command.buttons & 2) !== 0 && (this.oldButtons & 2) !== 0) return;
            if ((command.buttons & 2) === 0) { this.oldButtons &= ~2; return; }
            this.oldButtons |= 2;
        }
        const start = this.locked ? (this.slot + 1) % 32 : this.slot;
        for (let offset = 0; offset < 32; offset++) {
            const slot = (start + offset) % 32;
            if (this.eligible(users.get(slot))) { this.lock(slot); return; }
        }
        this.print('No target found ...\n'); this.tracking = false; this.locked = false; this.current = null;
    }
}
