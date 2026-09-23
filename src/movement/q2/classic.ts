import { sweepQ2Body } from "./swept.ts";
/* Quake II movement, id Software / ZeniMax. GPL-2.0-or-later.
 * Ported from quake-2-re-ts and checked against the original pmove sources. */
import type { NumericOperations } from "../../contracts/numeric.ts";
import { characterHeight } from "./dimensions.ts";
import { createMovementMath } from "./math.ts";
import { classicViewAngles } from "./view.ts";
import { type Vec3, type TraceT, type CsurfaceT, type CplaneT, type ClassicPmove, plane, PmTypeT, PMF_DUCKED, PMF_JUMP_HELD, PMF_ON_GROUND, PMF_TIME_WATERJUMP, PMF_TIME_LAND, PMF_TIME_TELEPORT, MAXTOUCH, PITCH, CONTENTS_SOLID, CONTENTS_WATER, CONTENTS_SLIME, CONTENTS_LADDER, MASK_WATER, MASK_CURRENT, CONTENTS_CURRENT_0, CONTENTS_CURRENT_90, CONTENTS_CURRENT_180, CONTENTS_CURRENT_270, CONTENTS_CURRENT_UP, CONTENTS_CURRENT_DOWN, SURF_SLICK, axes, element } from "./types.ts";
export function pmoveClassic(pm: ClassicPmove, numericOps: NumericOperations, airAccelerate = 0, strafejumpHack = false, flight = false, speedMultiplier = 1): void {
    const { vec3, DotProduct, VectorCopy, VectorClear, VectorMA, VectorScale, VectorNormalize, VectorLength, AngleVectors } = createMovementMath(numericOps);
    const equipmentSpeed = (value: number): number => speedMultiplier === 1 ? value : numericOps.multiply(value, speedMultiplier);
    const STEPSIZE = 18;
    class PmlT {
        origin: Vec3 = vec3();
        velocity: Vec3 = vec3();
        forward: Vec3 = vec3();
        right: Vec3 = vec3();
        up: Vec3 = vec3();
        frametime = 0;
        groundsurface: CsurfaceT | null = null;
        groundplane: CplaneT = plane();
        groundcontents = 0;
        previous_origin: Vec3 = vec3();
        ladder = false;
    }
    let pml: PmlT = new PmlT();
    let pm_stopspeed = 100;
    let pm_maxspeed = equipmentSpeed(300);
    let pm_duckspeed = equipmentSpeed(100);
    let pm_accelerate = 10;
    const pm_airaccelerate = airAccelerate;
    let pm_wateraccelerate = 10;
    let pm_friction = 6;
    let pm_waterfriction = 1;
    let pm_waterspeed = 400;
    function copyPlane(dst: CplaneT, src: CplaneT): void {
        VectorCopy(src.normal, dst.normal);
        dst.dist = src.dist;
        dst.type = src.type;
        dst.signbits = src.signbits;
    }
    function toShort(x: number): number {
        return (x << 16) >> 16;
    }
    const STOP_EPSILON = 0.1;
    function PM_ClipVelocity(inVec: Vec3, normal: Vec3, out: Vec3, overbounce: number): void {
        if (numericOps.profile.arithmetic.kind !== "donor-binary64") overbounce = numericOps.store(overbounce);
        const backoff = numericOps.multiply(DotProduct(inVec, normal), overbounce);
        for (const i of axes) {
            const change = numericOps.multiply(element(normal, i), backoff);
            out[i] = numericOps.store(numericOps.subtract(element(inVec, i), change));
            if (element(out, i) > -STOP_EPSILON && element(out, i) < STOP_EPSILON)
                out[i] = numericOps.store(0);
        }
    }
    const MIN_STEP_NORMAL = 0.7;
    function PM_StepSlideMove_(): void {
        const primal_velocity = vec3(); VectorCopy(pml.velocity, primal_velocity);
        const stop = sweepQ2Body({ origin: pml.origin, velocity: pml.velocity, elapsed: pml.frametime, numeric: numericOps,
            trace: (start, end) => pm.trace(start, pm.mins, pm.maxs, end),
            clip: (velocity, normal) => { const out = vec3(); PM_ClipVelocity(velocity, normal, out, 1.01); return out; },
            touch: trace => {
                if (pm.numtouch < MAXTOUCH && trace.ent) {
                    pm.touchents[pm.numtouch] = trace.ent; pm.touchtraces[pm.numtouch] = trace; pm.numtouch++;
                }
            },
        });
        if (stop !== "solid" && pm.s.pm_time) VectorCopy(primal_velocity, pml.velocity);
    }
    function PM_StepSlideMove(): void {
        const start_o = vec3();
        const start_v = vec3();
        const down_o = vec3();
        const down_v = vec3();
        const up = vec3();
        const down = vec3();
        VectorCopy(pml.origin, start_o);
        VectorCopy(pml.velocity, start_v);
        PM_StepSlideMove_();
        VectorCopy(pml.origin, down_o);
        VectorCopy(pml.velocity, down_v);
        VectorCopy(start_o, up);
        up[2] = numericOps.store(numericOps.add(element(up, 2), STEPSIZE));
        let trace: TraceT = pm.trace(up, pm.mins, pm.maxs, up);
        if (trace.allsolid)
            return;
        VectorCopy(up, pml.origin);
        VectorCopy(start_v, pml.velocity);
        PM_StepSlideMove_();
        VectorCopy(pml.origin, down);
        down[2] = numericOps.store(numericOps.subtract(element(down, 2), STEPSIZE));
        trace = pm.trace(pml.origin, pm.mins, pm.maxs, down);
        if (!trace.allsolid) {
            VectorCopy(trace.endpos, pml.origin);
        }
        VectorCopy(pml.origin, up);
        const down_dist = numericOps.add(numericOps.multiply((numericOps.subtract(element(down_o, 0), element(start_o, 0))), (numericOps.subtract(element(down_o, 0), element(start_o, 0)))), numericOps.multiply((numericOps.subtract(element(down_o, 1), element(start_o, 1))), (numericOps.subtract(element(down_o, 1), element(start_o, 1)))));
        const up_dist = numericOps.add(numericOps.multiply((numericOps.subtract(element(up, 0), element(start_o, 0))), (numericOps.subtract(element(up, 0), element(start_o, 0)))), numericOps.multiply((numericOps.subtract(element(up, 1), element(start_o, 1))), (numericOps.subtract(element(up, 1), element(start_o, 1)))));
        if (down_dist > up_dist || element(trace.plane.normal, 2) < MIN_STEP_NORMAL) {
            VectorCopy(down_o, pml.origin);
            VectorCopy(down_v, pml.velocity);
            return;
        }
        pml.velocity[2] = numericOps.store(element(down_v, 2));
    }
    function PM_Friction(): void {
        const vel = pml.velocity;
        const speed = numericOps.squareRoot(numericOps.add(numericOps.add(numericOps.multiply(element(vel, 0), element(vel, 0)), numericOps.multiply(element(vel, 1), element(vel, 1))), numericOps.multiply(element(vel, 2), element(vel, 2))));
        if (speed < 1) {
            vel[0] = numericOps.store(0);
            vel[1] = numericOps.store(0);
            return;
        }
        let drop = 0;
        if ((pm.groundentity && pml.groundsurface && (pml.groundsurface.flags & SURF_SLICK) === 0) || pml.ladder) {
            const friction = pm_friction;
            const control = speed < pm_stopspeed ? pm_stopspeed : speed;
            drop = numericOps.add(drop, numericOps.multiply(numericOps.multiply(control, friction), pml.frametime));
        }
        if (pm.waterlevel && !pml.ladder) {
            drop = numericOps.add(drop, numericOps.multiply(numericOps.multiply(numericOps.multiply(speed, pm_waterfriction), pm.waterlevel), pml.frametime));
        }
        let newspeed = numericOps.subtract(speed, drop);
        if (newspeed < 0) {
            newspeed = 0;
        }
        newspeed = numericOps.divide(newspeed, speed);
        vel[0] = numericOps.store(numericOps.multiply(element(vel, 0), newspeed));
        vel[1] = numericOps.store(numericOps.multiply(element(vel, 1), newspeed));
        vel[2] = numericOps.store(numericOps.multiply(element(vel, 2), newspeed));
    }
    function PM_Accelerate(wishdir: Vec3, wishspeed: number, accel: number): void {
        const currentspeed = DotProduct(pml.velocity, wishdir);
        const addspeed = numericOps.subtract(wishspeed, currentspeed);
        if (addspeed <= 0)
            return;
        let accelspeed = numericOps.multiply(numericOps.multiply(accel, pml.frametime), wishspeed);
        if (accelspeed > addspeed)
            accelspeed = addspeed;
        for (const i of axes)
            pml.velocity[i] = numericOps.store(numericOps.add(element(pml.velocity, i), numericOps.multiply(accelspeed, element(wishdir, i))));
    }
    function PM_AirAccelerate(wishdir: Vec3, wishspeed: number, accel: number): void {
        let wishspd = wishspeed;
        if (wishspd > 30)
            wishspd = 30;
        const currentspeed = DotProduct(pml.velocity, wishdir);
        const addspeed = numericOps.subtract(wishspd, currentspeed);
        if (addspeed <= 0)
            return;
        let accelspeed = numericOps.multiply(numericOps.multiply(accel, wishspeed), pml.frametime);
        if (accelspeed > addspeed)
            accelspeed = addspeed;
        for (const i of axes)
            pml.velocity[i] = numericOps.store(numericOps.add(element(pml.velocity, i), numericOps.multiply(accelspeed, element(wishdir, i))));
    }
    function PM_AddCurrents(wishvel: Vec3): void {
        const v = vec3();
        if (pml.ladder && Math.abs(element(pml.velocity, 2)) <= 200) {
            if (element(pm.viewangles, PITCH) <= -15 && pm.cmd.forwardmove > 0)
                wishvel[2] = numericOps.store(200);
            else if (element(pm.viewangles, PITCH) >= 15 && pm.cmd.forwardmove > 0)
                wishvel[2] = numericOps.store(-200);
            else if (pm.cmd.upmove > 0)
                wishvel[2] = numericOps.store(200);
            else if (pm.cmd.upmove < 0)
                wishvel[2] = numericOps.store(-200);
            else
                wishvel[2] = numericOps.store(0);
            if (element(wishvel, 0) < -25)
                wishvel[0] = numericOps.store(-25);
            else if (element(wishvel, 0) > 25)
                wishvel[0] = numericOps.store(25);
            if (element(wishvel, 1) < -25)
                wishvel[1] = numericOps.store(-25);
            else if (element(wishvel, 1) > 25)
                wishvel[1] = numericOps.store(25);
        }
        if (pm.watertype & MASK_CURRENT) {
            VectorClear(v);
            if (pm.watertype & CONTENTS_CURRENT_0)
                v[0] = numericOps.store(numericOps.add(element(v, 0), 1));
            if (pm.watertype & CONTENTS_CURRENT_90)
                v[1] = numericOps.store(numericOps.add(element(v, 1), 1));
            if (pm.watertype & CONTENTS_CURRENT_180)
                v[0] = numericOps.store(numericOps.subtract(element(v, 0), 1));
            if (pm.watertype & CONTENTS_CURRENT_270)
                v[1] = numericOps.store(numericOps.subtract(element(v, 1), 1));
            if (pm.watertype & CONTENTS_CURRENT_UP)
                v[2] = numericOps.store(numericOps.add(element(v, 2), 1));
            if (pm.watertype & CONTENTS_CURRENT_DOWN)
                v[2] = numericOps.store(numericOps.subtract(element(v, 2), 1));
            let s = pm_waterspeed;
            if (pm.waterlevel === 1 && pm.groundentity)
                s = numericOps.divide(s, 2);
            VectorMA(wishvel, s, v, wishvel);
        }
        if (pm.groundentity) {
            VectorClear(v);
            if (pml.groundcontents & CONTENTS_CURRENT_0)
                v[0] = numericOps.store(numericOps.add(element(v, 0), 1));
            if (pml.groundcontents & CONTENTS_CURRENT_90)
                v[1] = numericOps.store(numericOps.add(element(v, 1), 1));
            if (pml.groundcontents & CONTENTS_CURRENT_180)
                v[0] = numericOps.store(numericOps.subtract(element(v, 0), 1));
            if (pml.groundcontents & CONTENTS_CURRENT_270)
                v[1] = numericOps.store(numericOps.subtract(element(v, 1), 1));
            if (pml.groundcontents & CONTENTS_CURRENT_UP)
                v[2] = numericOps.store(numericOps.add(element(v, 2), 1));
            if (pml.groundcontents & CONTENTS_CURRENT_DOWN)
                v[2] = numericOps.store(numericOps.subtract(element(v, 2), 1));
            VectorMA(wishvel, 100, v, wishvel);
        }
    }
    function PM_WaterMove(): void {
        const wishvel = vec3();
        for (const i of axes)
            wishvel[i] = numericOps.store(numericOps.add(numericOps.multiply(element(pml.forward, i), equipmentSpeed(pm.cmd.forwardmove)), numericOps.multiply(element(pml.right, i), equipmentSpeed(pm.cmd.sidemove))));
        if (!pm.cmd.forwardmove && !pm.cmd.sidemove && !pm.cmd.upmove)
            wishvel[2] = numericOps.store(numericOps.subtract(element(wishvel, 2), 60));
        else
            wishvel[2] = numericOps.store(numericOps.add(element(wishvel, 2), equipmentSpeed(pm.cmd.upmove)));
        PM_AddCurrents(wishvel);
        const wishdir = vec3();
        VectorCopy(wishvel, wishdir);
        let wishspeed = VectorNormalize(wishdir);
        if (wishspeed > pm_maxspeed) {
            VectorScale(wishvel, numericOps.divide(pm_maxspeed, wishspeed), wishvel);
            wishspeed = pm_maxspeed;
        }
        wishspeed = numericOps.multiply(wishspeed, 0.5);
        PM_Accelerate(wishdir, wishspeed, pm_wateraccelerate);
        PM_StepSlideMove();
    }
    function PM_AirMove(): void {
        const wishvel = vec3();
        const fmove = equipmentSpeed(pm.cmd.forwardmove);
        const smove = equipmentSpeed(pm.cmd.sidemove);
        for (let i = 0; i < 2; i++)
            wishvel[i] = numericOps.store(numericOps.add(numericOps.multiply(element(pml.forward, i), fmove), numericOps.multiply(element(pml.right, i), smove)));
        wishvel[2] = numericOps.store(0);
        PM_AddCurrents(wishvel);
        const wishdir = vec3();
        VectorCopy(wishvel, wishdir);
        let wishspeed = VectorNormalize(wishdir);
        const maxspeed = pm.s.pm_flags & PMF_DUCKED ? pm_duckspeed : pm_maxspeed;
        if (wishspeed > maxspeed) {
            VectorScale(wishvel, numericOps.divide(maxspeed, wishspeed), wishvel);
            wishspeed = maxspeed;
        }
        if (pml.ladder) {
            PM_Accelerate(wishdir, wishspeed, pm_accelerate);
            if (element(wishvel, 2) === 0) {
                if (element(pml.velocity, 2) > 0) {
                    pml.velocity[2] = numericOps.store(numericOps.subtract(element(pml.velocity, 2), numericOps.multiply(pm.s.gravity, pml.frametime)));
                    if (element(pml.velocity, 2) < 0)
                        pml.velocity[2] = numericOps.store(0);
                }
                else {
                    pml.velocity[2] = numericOps.store(numericOps.add(element(pml.velocity, 2), numericOps.multiply(pm.s.gravity, pml.frametime)));
                    if (element(pml.velocity, 2) > 0)
                        pml.velocity[2] = numericOps.store(0);
                }
            }
            PM_StepSlideMove();
        }
        else if (pm.groundentity) {
            pml.velocity[2] = numericOps.store(0);
            PM_Accelerate(wishdir, wishspeed, pm_accelerate);
            if (pm.s.gravity > 0)
                pml.velocity[2] = numericOps.store(0);
            else
                pml.velocity[2] = numericOps.store(numericOps.subtract(element(pml.velocity, 2), numericOps.multiply(pm.s.gravity, pml.frametime)));
            if (element(pml.velocity, 0) === 0 && element(pml.velocity, 1) === 0)
                return;
            PM_StepSlideMove();
        }
        else {
            if (pm_airaccelerate)
                PM_AirAccelerate(wishdir, wishspeed, pm_accelerate);
            else
                PM_Accelerate(wishdir, wishspeed, 1);
            pml.velocity[2] = numericOps.store(numericOps.subtract(element(pml.velocity, 2), numericOps.multiply(pm.s.gravity, pml.frametime)));
            PM_StepSlideMove();
        }
    }
    function PM_CatagorizePosition(): void {
        const point = vec3();
        point[0] = numericOps.store(element(pml.origin, 0));
        point[1] = numericOps.store(element(pml.origin, 1));
        point[2] = numericOps.store(numericOps.subtract(element(pml.origin, 2), 0.25));
        if (element(pml.velocity, 2) > 180) {
            pm.s.pm_flags &= ~PMF_ON_GROUND;
            pm.groundentity = null;
        }
        else {
            const trace = pm.trace(pml.origin, pm.mins, pm.maxs, point);
            copyPlane(pml.groundplane, trace.plane);
            pml.groundsurface = trace.surface;
            pml.groundcontents = trace.contents;
            if (!trace.ent || (element(trace.plane.normal, 2) < 0.7 && !trace.startsolid)) {
                pm.groundentity = null;
                pm.s.pm_flags &= ~PMF_ON_GROUND;
            }
            else {
                pm.groundentity = trace.ent;
                if (pm.s.pm_flags & PMF_TIME_WATERJUMP) {
                    pm.s.pm_flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT);
                    pm.s.pm_time = 0;
                }
                if (!(pm.s.pm_flags & PMF_ON_GROUND)) {
                    pm.s.pm_flags |= PMF_ON_GROUND;
                    if (element(pml.velocity, 2) < -200 && !strafejumpHack) {
                        pm.s.pm_flags |= PMF_TIME_LAND;
                        if (element(pml.velocity, 2) < -400)
                            pm.s.pm_time = 25;
                        else
                            pm.s.pm_time = 18;
                    }
                }
            }
            if (pm.numtouch < MAXTOUCH && trace.ent) {
                pm.touchents[pm.numtouch] = trace.ent;
                pm.touchtraces[pm.numtouch] = trace;
                pm.numtouch++;
            }
        }
        pm.waterlevel = 0;
        pm.watertype = 0;
        const sample2 = Math.trunc(numericOps.subtract(pm.viewheight, element(pm.mins, 2)));
        const sample1 = (numericOps.divide(sample2, 2)) | 0;
        point[2] = numericOps.store(numericOps.add(numericOps.add(element(pml.origin, 2), element(pm.mins, 2)), 1));
        let cont = pm.pointcontents(point);
        if (cont & MASK_WATER) {
            pm.watertype = cont;
            pm.waterlevel = 1;
            point[2] = numericOps.store(numericOps.add(numericOps.add(element(pml.origin, 2), element(pm.mins, 2)), sample1));
            cont = pm.pointcontents(point);
            if (cont & MASK_WATER) {
                pm.waterlevel = 2;
                point[2] = numericOps.store(numericOps.add(numericOps.add(element(pml.origin, 2), element(pm.mins, 2)), sample2));
                cont = pm.pointcontents(point);
                if (cont & MASK_WATER)
                    pm.waterlevel = 3;
            }
        }
    }
    function PM_CheckJump(): void {
        if (pm.s.pm_flags & PMF_TIME_LAND) {
            return;
        }
        if (pm.cmd.upmove < 10) {
            pm.s.pm_flags &= ~PMF_JUMP_HELD;
            return;
        }
        if (pm.s.pm_flags & PMF_JUMP_HELD)
            return;
        if (pm.s.pm_type === PmTypeT.PM_DEAD)
            return;
        if (pm.waterlevel >= 2) {
            pm.groundentity = null;
            if (element(pml.velocity, 2) <= -300)
                return;
            if (pm.watertype === CONTENTS_WATER)
                pml.velocity[2] = numericOps.store(100);
            else if (pm.watertype === CONTENTS_SLIME)
                pml.velocity[2] = numericOps.store(80);
            else
                pml.velocity[2] = numericOps.store(50);
            return;
        }
        if (pm.groundentity === null)
            return;
        pm.s.pm_flags |= PMF_JUMP_HELD;
        pm.groundentity = null;
        pml.velocity[2] = numericOps.store(numericOps.add(element(pml.velocity, 2), 270));
        if (element(pml.velocity, 2) < 270)
            pml.velocity[2] = numericOps.store(270);
    }
    function PM_CheckSpecialMovement(): void {
        const spot = vec3();
        const flatforward = vec3();
        if (pm.s.pm_time)
            return;
        pml.ladder = false;
        flatforward[0] = numericOps.store(element(pml.forward, 0));
        flatforward[1] = numericOps.store(element(pml.forward, 1));
        flatforward[2] = numericOps.store(0);
        VectorNormalize(flatforward);
        VectorMA(pml.origin, 1, flatforward, spot);
        const trace = pm.trace(pml.origin, pm.mins, pm.maxs, spot);
        if (trace.fraction < 1 && trace.contents & CONTENTS_LADDER)
            pml.ladder = true;
        if (pm.waterlevel !== 2)
            return;
        VectorMA(pml.origin, 30, flatforward, spot);
        spot[2] = numericOps.store(numericOps.add(element(spot, 2), 4));
        let cont = pm.pointcontents(spot);
        if (!(cont & CONTENTS_SOLID))
            return;
        spot[2] = numericOps.store(numericOps.add(element(spot, 2), 16));
        cont = pm.pointcontents(spot);
        if (cont)
            return;
        VectorScale(flatforward, 50, pml.velocity);
        pml.velocity[2] = numericOps.store(350);
        pm.s.pm_flags |= PMF_TIME_WATERJUMP;
        pm.s.pm_time = 255;
    }
    function PM_FlyMove(doclip: boolean): void {
        pm.viewheight = characterHeight(pm.characterBounds, 22, numericOps);
        const speed = VectorLength(pml.velocity);
        if (speed < 1) {
            VectorClear(pml.velocity);
        }
        else {
            const friction = numericOps.multiply(pm_friction, 1.5);
            const control = speed < pm_stopspeed ? pm_stopspeed : speed;
            const drop = numericOps.multiply(numericOps.multiply(control, friction), pml.frametime);
            let newspeed = numericOps.subtract(speed, drop);
            if (newspeed < 0)
                newspeed = 0;
            newspeed = numericOps.divide(newspeed, speed);
            VectorScale(pml.velocity, newspeed, pml.velocity);
        }
        const fmove = equipmentSpeed(pm.cmd.forwardmove);
        const smove = equipmentSpeed(pm.cmd.sidemove);
        VectorNormalize(pml.forward);
        VectorNormalize(pml.right);
        const wishvel = vec3();
        for (const i of axes)
            wishvel[i] = numericOps.store(numericOps.add(numericOps.multiply(element(pml.forward, i), fmove), numericOps.multiply(element(pml.right, i), smove)));
        wishvel[2] = numericOps.store(numericOps.add(element(wishvel, 2), equipmentSpeed(pm.cmd.upmove)));
        const wishdir = vec3();
        VectorCopy(wishvel, wishdir);
        let wishspeed = VectorNormalize(wishdir);
        if (wishspeed > pm_maxspeed) {
            VectorScale(wishvel, numericOps.divide(pm_maxspeed, wishspeed), wishvel);
            wishspeed = pm_maxspeed;
        }
        const currentspeed = DotProduct(pml.velocity, wishdir);
        const addspeed = numericOps.subtract(wishspeed, currentspeed);
        if (addspeed <= 0 && !doclip)
            return;
        let accelspeed = numericOps.multiply(numericOps.multiply(pm_accelerate, pml.frametime), wishspeed);
        accelspeed = Math.max(0, Math.min(accelspeed, addspeed));
        for (const i of axes)
            pml.velocity[i] = numericOps.store(numericOps.add(element(pml.velocity, i), numericOps.multiply(accelspeed, element(wishdir, i))));
        if (doclip) {
            PM_StepSlideMove();
        }
        else {
            VectorMA(pml.origin, pml.frametime, pml.velocity, pml.origin);
        }
    }
    function PM_CheckDuck(): void {
        pm.mins[0] = numericOps.store(pm.characterBounds.min.x);
        pm.mins[1] = numericOps.store(pm.characterBounds.min.y);
        pm.maxs[0] = numericOps.store(pm.characterBounds.max.x);
        pm.maxs[1] = numericOps.store(pm.characterBounds.max.y);
        if (pm.s.pm_type === PmTypeT.PM_GIB) {
            pm.mins[2] = numericOps.store(characterHeight(pm.characterBounds, 0, numericOps));
            pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 16, numericOps));
            pm.viewheight = characterHeight(pm.characterBounds, 8, numericOps);
            return;
        }
        pm.mins[2] = numericOps.store(characterHeight(pm.characterBounds, -24, numericOps));
        if (pm.s.pm_type === PmTypeT.PM_DEAD) {
            pm.s.pm_flags |= PMF_DUCKED;
        }
        else if (pm.cmd.upmove < 0 && (pm.s.pm_flags & PMF_ON_GROUND)) {
            pm.s.pm_flags |= PMF_DUCKED;
        }
        else {
            if (pm.s.pm_flags & PMF_DUCKED) {
                pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 32, numericOps));
                const trace = pm.trace(pml.origin, pm.mins, pm.maxs, pml.origin);
                if (!trace.allsolid)
                    pm.s.pm_flags &= ~PMF_DUCKED;
            }
        }
        if (pm.s.pm_flags & PMF_DUCKED) {
            pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 4, numericOps));
            pm.viewheight = characterHeight(pm.characterBounds, -2, numericOps);
        }
        else {
            pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 32, numericOps));
            pm.viewheight = characterHeight(pm.characterBounds, 22, numericOps);
        }
    }
    function PM_DeadMove(): void {
        if (!pm.groundentity)
            return;
        let forward = VectorLength(pml.velocity);
        forward = numericOps.subtract(forward, 20);
        if (forward <= 0) {
            VectorClear(pml.velocity);
        }
        else {
            VectorNormalize(pml.velocity);
            VectorScale(pml.velocity, forward, pml.velocity);
        }
    }
    function PM_GoodPosition(): boolean {
        if (pm.s.pm_type === PmTypeT.PM_SPECTATOR)
            return true;
        const origin = vec3();
        const end = vec3();
        for (const i of axes)
            origin[i] = numericOps.store(end[i] = numericOps.store(numericOps.multiply(element(pm.s.origin, i), 0.125)));
        const trace = pm.trace(origin, pm.mins, pm.maxs, end);
        return !trace.allsolid;
    }
    const jitterbits: readonly number[] = [0, 4, 1, 2, 3, 5, 6, 7];
    function PM_SnapPosition(): void {
        const sign = [0, 0, 0];
        const base = new Int16Array(3);
        for (const i of axes)
            pm.s.velocity[i] = toShort(numericOps.multiply(element(pml.velocity, i), 8));
        for (const i of axes) {
            sign[i] = numericOps.store(element(pml.origin, i) >= 0 ? 1 : -1);
            pm.s.origin[i] = toShort(numericOps.multiply(element(pml.origin, i), 8));
            if (numericOps.multiply(element(pm.s.origin, i), 0.125) === element(pml.origin, i))
                sign[i] = numericOps.store(0);
        }
        for (const i of axes)
            base[i] = numericOps.store(element(pm.s.origin, i));
        for (let j = 0; j < 8; j++) {
            const bits = element(jitterbits, j);
            for (const i of axes)
                pm.s.origin[i] = toShort(element(base, i));
            for (const i of axes)
                if (bits & (1 << i))
                    pm.s.origin[i] = toShort(numericOps.add(element(pm.s.origin, i), element(sign, i)));
            if (PM_GoodPosition())
                return;
        }
        for (const i of axes)
            pm.s.origin[i] = toShort(element(pml.previous_origin, i));
    }
    const offset: readonly number[] = [0, -1, 1];
    function PM_InitialSnapPosition(): void {
        const base = new Int16Array(3);
        for (const i of axes)
            base[i] = numericOps.store(element(pm.s.origin, i));
        for (const z of axes) {
            pm.s.origin[2] = toShort(numericOps.add(element(base, 2), element(offset, z)));
            for (const y of axes) {
                pm.s.origin[1] = toShort(numericOps.add(element(base, 1), element(offset, y)));
                for (const x of axes) {
                    pm.s.origin[0] = toShort(numericOps.add(element(base, 0), element(offset, x)));
                    if (PM_GoodPosition()) {
                        pml.origin[0] = numericOps.store(numericOps.multiply(element(pm.s.origin, 0), 0.125));
                        pml.origin[1] = numericOps.store(numericOps.multiply(element(pm.s.origin, 1), 0.125));
                        pml.origin[2] = numericOps.store(numericOps.multiply(element(pm.s.origin, 2), 0.125));
                        for (const i of axes)
                            pml.previous_origin[i] = numericOps.store(element(pm.s.origin, i));
                        return;
                    }
                }
            }
        }
    }
    function PM_ClampAngles(): void {
        classicViewAngles(pm.viewangles, pm.cmd.angles, pm.s.delta_angles, pm.s.pm_flags, numericOps);
        AngleVectors(pm.viewangles, pml.forward, pml.right, pml.up);
    }
    function run(): void {
        pm.numtouch = 0;
        VectorClear(pm.viewangles);
        pm.viewheight = 0;
        pm.groundentity = null;
        pm.watertype = 0;
        pm.waterlevel = 0;
        pml = new PmlT();
        pml.origin[0] = numericOps.store(numericOps.multiply(element(pm.s.origin, 0), 0.125));
        pml.origin[1] = numericOps.store(numericOps.multiply(element(pm.s.origin, 1), 0.125));
        pml.origin[2] = numericOps.store(numericOps.multiply(element(pm.s.origin, 2), 0.125));
        pml.velocity[0] = numericOps.store(numericOps.multiply(element(pm.s.velocity, 0), 0.125));
        pml.velocity[1] = numericOps.store(numericOps.multiply(element(pm.s.velocity, 1), 0.125));
        pml.velocity[2] = numericOps.store(numericOps.multiply(element(pm.s.velocity, 2), 0.125));
        for (const i of axes)
            pml.previous_origin[i] = numericOps.store(element(pm.s.origin, i));
        pml.frametime = numericOps.multiply(pm.cmd.msec, 0.001);
        PM_ClampAngles();
        if (flight && pm.s.pm_type === PmTypeT.PM_NORMAL) {
            pm.s.pm_flags &= ~(PMF_ON_GROUND | PMF_DUCKED | PMF_TIME_WATERJUMP);
            pm.s.pm_time = 0;
            PM_FlyMove(true);
            PM_SnapPosition();
            return;
        }
        if (pm.s.pm_type === PmTypeT.PM_SPECTATOR) {
            PM_FlyMove(false);
            PM_SnapPosition();
            return;
        }
        if (pm.s.pm_type >= PmTypeT.PM_DEAD) {
            pm.cmd.forwardmove = 0;
            pm.cmd.sidemove = 0;
            pm.cmd.upmove = 0;
        }
        if (pm.s.pm_type === PmTypeT.PM_FREEZE)
            return;
        PM_CheckDuck();
        if (pm.snapinitial)
            PM_InitialSnapPosition();
        PM_CatagorizePosition();
        if (pm.s.pm_type === PmTypeT.PM_DEAD)
            PM_DeadMove();
        PM_CheckSpecialMovement();
        if (pm.s.pm_time) {
            let msec = pm.cmd.msec >> 3;
            if (!msec)
                msec = 1;
            if (msec >= pm.s.pm_time) {
                pm.s.pm_flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT);
                pm.s.pm_time = 0;
            }
            else {
                pm.s.pm_time = numericOps.subtract(pm.s.pm_time, msec);
            }
        }
        if (pm.s.pm_flags & PMF_TIME_TELEPORT) {
        }
        else if (pm.s.pm_flags & PMF_TIME_WATERJUMP) {
            pml.velocity[2] = numericOps.store(numericOps.subtract(element(pml.velocity, 2), numericOps.multiply(pm.s.gravity, pml.frametime)));
            if (element(pml.velocity, 2) < 0) {
                pm.s.pm_flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT);
                pm.s.pm_time = 0;
            }
            PM_StepSlideMove();
        }
        else {
            PM_CheckJump();
            PM_Friction();
            if (pm.waterlevel >= 2) {
                PM_WaterMove();
            }
            else {
                const angles = vec3();
                VectorCopy(pm.viewangles, angles);
                if (element(angles, PITCH) > 180)
                    angles[PITCH] = numericOps.store(numericOps.subtract(element(angles, PITCH), 360));
                angles[PITCH] = numericOps.store(numericOps.divide(element(angles, PITCH), 3));
                AngleVectors(angles, pml.forward, pml.right, pml.up);
                PM_AirMove();
            }
        }
        PM_CatagorizePosition();
        PM_SnapPosition();
    }
    run();
}
