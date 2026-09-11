/* Copyright (c) ZeniMax Media Inc.
 * Licensed under the GNU General Public License 2.0.
 * Ported through quake-2-re-ts and checked against rerelease/p_move.cpp. */
import type { NumericOperations } from "../../contracts/numeric.ts";
import { characterHeight } from "./dimensions.ts";
import { createMovementMath } from "./math.ts";
import { type Vec3, type KexPmoveT, type KexTraceT, type KexTouchListT, type KexCsurfaceT, ContentsT, MASK_SOLID, MASK_DEADSOLID, MASK_PLAYERSOLID, MASK_WATER, MASK_CURRENT, SurfflagsT, WaterLevelT, KexPmTypeT, PmflagsT, ButtonT, RefdefFlagsT, MAXTOUCH, STEPSIZE, StuckResultT, PM_CONFIG_DEFAULT, type PmConfigT, type PmTraceFn, type StuckObjectTraceFn, PITCH, YAW, ROLL, axes, element } from "./types.ts";
export function createRereleaseMovement(numericOps: NumericOperations) {
    const sourceFloat = (value: number): number => numericOps.profile.arithmetic.kind === "donor-binary64" ? value : numericOps.store(value);
    const { vec3, VectorCopy, clamp, G_AddBlend, vec3_add, vec3_sub, vec3_muls, vec3_mulEqs, vec3_addEq, vec3_dot, vec3_cross, vec3_normalize, vec3_length, vec3_lengthSquared, SlideClipVelocity, AngleVectors } = createMovementMath(numericOps, "rerelease");
    const pm_stopspeed = 100;
    const pm_maxspeed = 300;
    const pm_duckspeed = 100;
    const pm_accelerate = 10;
    const pm_wateraccelerate = 10;
    const pm_friction = 6;
    const pm_waterfriction = 1;
    const pm_waterspeed = 400;
    const pm_laddermod = sourceFloat(0.5);
    const MIN_STEP_NORMAL = sourceFloat(0.7);
    const MAX_CLIP_PLANES = 5;
    interface SideCheck {
        readonly normal: readonly [
            number,
            number,
            number
        ];
        readonly mins: readonly [
            number,
            number,
            number
        ];
        readonly maxs: readonly [
            number,
            number,
            number
        ];
    }
    const SIDE_CHECKS: readonly SideCheck[] = [
        { normal: [0, 0, 1], mins: [-1, -1, 0], maxs: [1, 1, 0] },
        { normal: [0, 0, -1], mins: [-1, -1, 0], maxs: [1, 1, 0] },
        { normal: [1, 0, 0], mins: [0, -1, -1], maxs: [0, 1, 1] },
        { normal: [-1, 0, 0], mins: [0, -1, -1], maxs: [0, 1, 1] },
        { normal: [0, 1, 0], mins: [-1, 0, -1], maxs: [1, 0, 1] },
        { normal: [0, -1, 0], mins: [-1, 0, -1], maxs: [1, 0, 1] },
    ];
    function G_FixStuckObject_Generic(origin: Vec3, own_mins: Vec3, own_maxs: Vec3, trace: StuckObjectTraceFn): StuckResultT {
        if (!trace(origin, own_mins, own_maxs, origin).startsolid) {
            return StuckResultT.GOOD_POSITION;
        }
        const good_positions: {
            distance: number;
            origin: Vec3;
        }[] = [];
        for (let sn = 0; sn < SIDE_CHECKS.length; sn++) {
            const side = element(SIDE_CHECKS, sn);
            let start = vec3(element(origin, 0), element(origin, 1), element(origin, 2));
            const mins = vec3(0, 0, 0);
            const maxs = vec3(0, 0, 0);
            for (const n of axes) {
                if (element(side.normal, n) < 0)
                    start[n] = numericOps.store(numericOps.add(element(start, n), element(own_mins, n)));
                else if (element(side.normal, n) > 0)
                    start[n] = numericOps.store(numericOps.add(element(start, n), element(own_maxs, n)));
                if (element(side.mins, n) === -1)
                    mins[n] = numericOps.store(element(own_mins, n));
                else if (element(side.mins, n) === 1)
                    mins[n] = numericOps.store(element(own_maxs, n));
                if (element(side.maxs, n) === -1)
                    maxs[n] = numericOps.store(element(own_mins, n));
                else if (element(side.maxs, n) === 1)
                    maxs[n] = numericOps.store(element(own_maxs, n));
            }
            let tr = trace(start, mins, maxs, start);
            let needed_epsilon_fix = -1;
            let needed_epsilon_dir = 0;
            if (tr.startsolid) {
                for (const e of axes) {
                    if (element(side.normal, e) !== 0)
                        continue;
                    const ep_start = vec3(element(start, 0), element(start, 1), element(start, 2));
                    ep_start[e] = numericOps.store(numericOps.add(element(ep_start, e), 1));
                    tr = trace(ep_start, mins, maxs, ep_start);
                    if (!tr.startsolid) {
                        start = ep_start;
                        needed_epsilon_fix = e;
                        needed_epsilon_dir = 1;
                        break;
                    }
                    ep_start[e] = numericOps.store(numericOps.subtract(element(ep_start, e), 2));
                    tr = trace(ep_start, mins, maxs, ep_start);
                    if (!tr.startsolid) {
                        start = ep_start;
                        needed_epsilon_fix = e;
                        needed_epsilon_dir = -1;
                        break;
                    }
                }
            }
            if (tr.startsolid)
                continue;
            const opposite_start = vec3(element(origin, 0), element(origin, 1), element(origin, 2));
            const other_side = element(SIDE_CHECKS, sn ^ 1);
            for (const n of axes) {
                if (element(other_side.normal, n) < 0)
                    opposite_start[n] = numericOps.store(numericOps.add(element(opposite_start, n), element(own_mins, n)));
                else if (element(other_side.normal, n) > 0)
                    opposite_start[n] = numericOps.store(numericOps.add(element(opposite_start, n), element(own_maxs, n)));
            }
            if (needed_epsilon_fix >= 0)
                opposite_start[needed_epsilon_fix] = numericOps.store(numericOps.add(element(opposite_start, needed_epsilon_fix), needed_epsilon_dir));
            tr = trace(start, mins, maxs, opposite_start);
            if (tr.startsolid)
                continue;
            const end = vec3(element(tr.endpos, 0), element(tr.endpos, 1), element(tr.endpos, 2));
            end[0] = numericOps.store(numericOps.add(element(end, 0), numericOps.multiply(element(side.normal, 0), sourceFloat(0.125))));
            end[1] = numericOps.store(numericOps.add(element(end, 1), numericOps.multiply(element(side.normal, 1), sourceFloat(0.125))));
            end[2] = numericOps.store(numericOps.add(element(end, 2), numericOps.multiply(element(side.normal, 2), sourceFloat(0.125))));
            const delta = vec3_sub(end, opposite_start);
            const new_origin = vec3_add(origin, delta);
            if (needed_epsilon_fix >= 0)
                new_origin[needed_epsilon_fix] = numericOps.store(numericOps.add(element(new_origin, needed_epsilon_fix), needed_epsilon_dir));
            tr = trace(new_origin, own_mins, own_maxs, new_origin);
            if (tr.startsolid)
                continue;
            good_positions.push({ origin: new_origin, distance: vec3_lengthSquared(delta) });
        }
        if (good_positions.length > 0) {
            const n = good_positions.length;
            if (n > 1) {
                const sortable = good_positions.slice(0, numericOps.subtract(n, 1));
                sortable.sort((a, b) => numericOps.subtract(a.distance, b.distance));
                for (let i = 0; i < sortable.length; i++)
                    good_positions[i] = element(sortable, i);
            }
            VectorCopy(element(good_positions, 0).origin, origin);
            return StuckResultT.FIXED;
        }
        return StuckResultT.NO_GOOD_POSITION;
    }
    function PM_RecordTrace(touch: KexTouchListT, tr: KexTraceT): void {
        if (touch.num === MAXTOUCH)
            return;
        for (let i = 0; i < touch.num; i++) {
            if (element(touch.traces, i).ent === tr.ent)
                return;
        }
        touch.traces[touch.num] = tr;
        touch.num++;
    }
    /** Duplicate-plane recovery intentionally nudges the live player during water-jump probes, as p_move.cpp does. */
    function PM_StepSlideMove_Generic(origin: Vec3, velocity: Vec3, frametime: number, mins: Vec3, maxs: Vec3, touch: KexTouchListT, has_time: boolean, trace_func: PmTraceFn, liveOrigin: Vec3 = origin): void {
        const numbumps = 4;
        const primal_velocity = vec3(element(velocity, 0), element(velocity, 1), element(velocity, 2));
        let numplanes = 0;
        const planes: Vec3[] = [];
        let time_left = frametime;
        for (let bumpcount = 0; bumpcount < numbumps; bumpcount++) {
            const end = vec3(numericOps.add(element(origin, 0), numericOps.multiply(time_left, element(velocity, 0))), numericOps.add(element(origin, 1), numericOps.multiply(time_left, element(velocity, 1))), numericOps.add(element(origin, 2), numericOps.multiply(time_left, element(velocity, 2))));
            let trace = trace_func(origin, mins, maxs, end);
            if (trace.allsolid) {
                velocity[2] = numericOps.store(0);
                PM_RecordTrace(touch, trace);
                return;
            }
            if (trace.surface2) {
                const clipped_a = SlideClipVelocity(velocity, trace.plane.normal, sourceFloat(1.01));
                const clipped_b = SlideClipVelocity(velocity, trace.plane2.normal, sourceFloat(1.01));
                let better = false;
                for (const i of axes) {
                    if (Math.abs(element(clipped_a, i)) < Math.abs(element(clipped_b, i))) {
                        better = true;
                        break;
                    }
                }
                if (better) {
                    trace.plane = trace.plane2;
                    trace.surface = trace.surface2;
                }
            }
            if (trace.fraction > 0) {
                VectorCopy(trace.endpos, origin);
                numplanes = 0;
            }
            if (trace.fraction === 1)
                break;
            PM_RecordTrace(touch, trace);
            time_left = numericOps.subtract(time_left, numericOps.multiply(time_left, trace.fraction));
            if (numplanes >= MAX_CLIP_PLANES) {
                velocity[0] = numericOps.store(velocity[1] = numericOps.store(velocity[2] = numericOps.store(0)));
                break;
            }
            let i = 0;
            let hitDuplicate = false;
            for (i = 0; i < numplanes; i++) {
                if (vec3_dot(trace.plane.normal, element(planes, i)) > sourceFloat(0.99)) {
                    liveOrigin[0] = numericOps.store(numericOps.add(element(liveOrigin, 0), numericOps.multiply(element(trace.plane.normal, 0), sourceFloat(0.01))));
                    liveOrigin[1] = numericOps.store(numericOps.add(element(liveOrigin, 1), numericOps.multiply(element(trace.plane.normal, 1), sourceFloat(0.01))));
                    G_FixStuckObject_Generic(origin, mins, maxs, trace_func);
                    hitDuplicate = true;
                    break;
                }
            }
            if (hitDuplicate)
                continue;
            planes[numplanes] = vec3(element(trace.plane.normal, 0), element(trace.plane.normal, 1), element(trace.plane.normal, 2));
            numplanes++;
            for (i = 0; i < numplanes; i++) {
                const clipped = SlideClipVelocity(velocity, element(planes, i), sourceFloat(1.01));
                VectorCopy(clipped, velocity);
                let j = 0;
                for (j = 0; j < numplanes; j++) {
                    if (j !== i) {
                        if (vec3_dot(velocity, element(planes, j)) < 0)
                            break;
                    }
                }
                if (j === numplanes)
                    break;
            }
            if (i !== numplanes) {
            }
            else {
                if (numplanes !== 2) {
                    velocity[0] = numericOps.store(velocity[1] = numericOps.store(velocity[2] = numericOps.store(0)));
                    break;
                }
                const dir = vec3_cross(element(planes, 0), element(planes, 1));
                const d = vec3_dot(dir, velocity);
                VectorCopy(vec3_muls(dir, d), velocity);
            }
            if (vec3_dot(velocity, primal_velocity) <= 0) {
                velocity[0] = numericOps.store(velocity[1] = numericOps.store(velocity[2] = numericOps.store(0)));
                break;
            }
        }
        if (has_time) {
            VectorCopy(primal_velocity, velocity);
        }
    }
    interface PmlT {
        origin: Vec3;
        velocity: Vec3;
        forward: Vec3;
        right: Vec3;
        up: Vec3;
        frametime: number;
        groundsurface: KexCsurfaceT | null;
        groundcontents: ContentsT;
        previous_origin: Vec3;
        start_velocity: Vec3;
    }
    function Pmove(pmove: KexPmoveT, config: PmConfigT = PM_CONFIG_DEFAULT): void {
        const pm = pmove;
        pm.touch.num = 0;
        pm.viewangles[0] = numericOps.store(0);
        pm.viewangles[1] = numericOps.store(0);
        pm.viewangles[2] = numericOps.store(0);
        pm.s.viewheight = 0;
        pm.groundentity = null;
        pm.watertype = ContentsT.CONTENTS_NONE;
        pm.waterlevel = WaterLevelT.WATER_NONE;
        pm.screen_blend[0] = numericOps.store(0);
        pm.screen_blend[1] = numericOps.store(0);
        pm.screen_blend[2] = numericOps.store(0);
        pm.screen_blend[3] = numericOps.store(0);
        pm.rdflags = RefdefFlagsT.RDF_NONE;
        pm.jump_sound = false;
        pm.step_clip = false;
        pm.impact_delta = 0;
        const pml: PmlT = {
            origin: vec3(element(pm.s.origin, 0), element(pm.s.origin, 1), element(pm.s.origin, 2)),
            velocity: vec3(element(pm.s.velocity, 0), element(pm.s.velocity, 1), element(pm.s.velocity, 2)),
            forward: vec3(),
            right: vec3(),
            up: vec3(),
            frametime: numericOps.multiply(pm.cmd.msec, sourceFloat(0.001)),
            groundsurface: null,
            groundcontents: ContentsT.CONTENTS_NONE,
            previous_origin: vec3(element(pm.s.origin, 0), element(pm.s.origin, 1), element(pm.s.origin, 2)),
            start_velocity: vec3(element(pm.s.velocity, 0), element(pm.s.velocity, 1), element(pm.s.velocity, 2)),
        };
        pml.start_velocity = vec3(element(pml.velocity, 0), element(pml.velocity, 1), element(pml.velocity, 2));
        function PM_Clip(start: Vec3, mins: Vec3, maxs: Vec3, end: Vec3, mask: ContentsT): KexTraceT {
            return pm.clip(start, mins, maxs, end, mask);
        }
        function PM_Trace(start: Vec3, mins: Vec3, maxs: Vec3, end: Vec3, maskArg: ContentsT = ContentsT.CONTENTS_NONE): KexTraceT {
            if (pm.s.pm_type === KexPmTypeT.PM_SPECTATOR) {
                return PM_Clip(start, mins, maxs, end, MASK_SOLID);
            }
            let mask = maskArg;
            if (mask === ContentsT.CONTENTS_NONE) {
                if (pm.s.pm_type === KexPmTypeT.PM_DEAD || pm.s.pm_type === KexPmTypeT.PM_GIB)
                    mask = MASK_DEADSOLID;
                else
                    mask = MASK_PLAYERSOLID;
                if (pm.s.pm_flags & PmflagsT.PMF_IGNORE_PLAYER_COLLISION)
                    mask &= ~ContentsT.CONTENTS_PLAYER;
            }
            return pm.trace(start, mins, maxs, end, pm.player, mask);
        }
        function PM_Trace_Auto(start: Vec3, mins: Vec3, maxs: Vec3, end: Vec3): KexTraceT {
            return PM_Trace(start, mins, maxs, end);
        }
        function PM_StepSlideMove_(): void {
            PM_StepSlideMove_Generic(pml.origin, pml.velocity, pml.frametime, pm.mins, pm.maxs, pm.touch, pm.s.pm_time !== 0, PM_Trace_Auto);
        }
        function PM_StepSlideMove(): void {
            const start_o = vec3(element(pml.origin, 0), element(pml.origin, 1), element(pml.origin, 2));
            const start_v = vec3(element(pml.velocity, 0), element(pml.velocity, 1), element(pml.velocity, 2));
            PM_StepSlideMove_();
            const down_o = vec3(element(pml.origin, 0), element(pml.origin, 1), element(pml.origin, 2));
            const down_v = vec3(element(pml.velocity, 0), element(pml.velocity, 1), element(pml.velocity, 2));
            const up = vec3(element(start_o, 0), element(start_o, 1), numericOps.add(element(start_o, 2), STEPSIZE));
            let trace = PM_Trace(start_o, pm.mins, pm.maxs, up);
            if (trace.allsolid)
                return;
            const stepSize = numericOps.subtract(element(trace.endpos, 2), element(start_o, 2));
            VectorCopy(trace.endpos, pml.origin);
            VectorCopy(start_v, pml.velocity);
            PM_StepSlideMove_();
            const down = vec3(element(pml.origin, 0), element(pml.origin, 1), numericOps.subtract(element(pml.origin, 2), stepSize));
            const original_down = vec3(element(down, 0), element(down, 1), element(down, 2));
            if (element(start_o, 2) < element(down, 2))
                down[2] = numericOps.store(numericOps.subtract(element(start_o, 2), 1));
            trace = PM_Trace(pml.origin, pm.mins, pm.maxs, down);
            if (!trace.allsolid) {
                const real_trace = PM_Trace(pml.origin, pm.mins, pm.maxs, original_down);
                VectorCopy(real_trace.endpos, pml.origin);
                if (element(pml.velocity, 2) > 0) {
                    pm.step_clip = true;
                }
            }
            const upEnd = vec3(element(pml.origin, 0), element(pml.origin, 1), element(pml.origin, 2));
            const down_dist = numericOps.add(numericOps.multiply((numericOps.subtract(element(down_o, 0), element(start_o, 0))), (numericOps.subtract(element(down_o, 0), element(start_o, 0)))), numericOps.multiply((numericOps.subtract(element(down_o, 1), element(start_o, 1))), (numericOps.subtract(element(down_o, 1), element(start_o, 1)))));
            const up_dist = numericOps.add(numericOps.multiply((numericOps.subtract(element(upEnd, 0), element(start_o, 0))), (numericOps.subtract(element(upEnd, 0), element(start_o, 0)))), numericOps.multiply((numericOps.subtract(element(upEnd, 1), element(start_o, 1))), (numericOps.subtract(element(upEnd, 1), element(start_o, 1)))));
            if (down_dist > up_dist || element(trace.plane.normal, 2) < MIN_STEP_NORMAL) {
                VectorCopy(down_o, pml.origin);
                VectorCopy(down_v, pml.velocity);
            }
            else {
                pml.velocity[2] = numericOps.store(element(down_v, 2));
            }
            if (pm.s.pm_flags & PmflagsT.PMF_ON_GROUND &&
                !(pm.s.pm_flags & PmflagsT.PMF_ON_LADDER) &&
                (pm.waterlevel < WaterLevelT.WATER_WAIST || (!(pm.cmd.buttons & ButtonT.BUTTON_JUMP) && element(pml.velocity, 2) <= 0))) {
                const downStairs = vec3(element(pml.origin, 0), element(pml.origin, 1), numericOps.subtract(element(pml.origin, 2), STEPSIZE));
                trace = PM_Trace(pml.origin, pm.mins, pm.maxs, downStairs);
                if (trace.fraction < 1) {
                    VectorCopy(trace.endpos, pml.origin);
                }
            }
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
            if ((pm.groundentity && pml.groundsurface && !(pml.groundsurface.flags & SurfflagsT.SURF_SLICK)) || pm.s.pm_flags & PmflagsT.PMF_ON_LADDER) {
                const friction = pm_friction;
                const control = speed < pm_stopspeed ? pm_stopspeed : speed;
                drop = numericOps.add(drop, numericOps.multiply(numericOps.multiply(control, friction), pml.frametime));
            }
            if (pm.waterlevel && !(pm.s.pm_flags & PmflagsT.PMF_ON_LADDER)) {
                drop = numericOps.add(drop, numericOps.multiply(numericOps.multiply(numericOps.multiply(speed, pm_waterfriction), pm.waterlevel), pml.frametime));
            }
            let newspeed = numericOps.subtract(speed, drop);
            if (newspeed < 0)
                newspeed = 0;
            newspeed = numericOps.divide(newspeed, speed);
            vel[0] = numericOps.store(numericOps.multiply(element(vel, 0), newspeed));
            vel[1] = numericOps.store(numericOps.multiply(element(vel, 1), newspeed));
            vel[2] = numericOps.store(numericOps.multiply(element(vel, 2), newspeed));
        }
        function PM_Accelerate(wishdir: Vec3, wishspeed: number, accel: number): void {
            const currentspeed = vec3_dot(pml.velocity, wishdir);
            const addspeed = numericOps.subtract(wishspeed, currentspeed);
            if (addspeed <= 0)
                return;
            let accelspeed = numericOps.multiply(numericOps.multiply(accel, pml.frametime), wishspeed);
            if (accelspeed > addspeed)
                accelspeed = addspeed;
            pml.velocity[0] = numericOps.store(numericOps.add(element(pml.velocity, 0), numericOps.multiply(accelspeed, element(wishdir, 0))));
            pml.velocity[1] = numericOps.store(numericOps.add(element(pml.velocity, 1), numericOps.multiply(accelspeed, element(wishdir, 1))));
            pml.velocity[2] = numericOps.store(numericOps.add(element(pml.velocity, 2), numericOps.multiply(accelspeed, element(wishdir, 2))));
        }
        function PM_AirAccelerate(wishdir: Vec3, wishspeed: number, accel: number): void {
            let wishspd = wishspeed;
            if (wishspd > 30)
                wishspd = 30;
            const currentspeed = vec3_dot(pml.velocity, wishdir);
            const addspeed = numericOps.subtract(wishspd, currentspeed);
            if (addspeed <= 0)
                return;
            let accelspeed = numericOps.multiply(numericOps.multiply(accel, wishspeed), pml.frametime);
            if (accelspeed > addspeed)
                accelspeed = addspeed;
            pml.velocity[0] = numericOps.store(numericOps.add(element(pml.velocity, 0), numericOps.multiply(accelspeed, element(wishdir, 0))));
            pml.velocity[1] = numericOps.store(numericOps.add(element(pml.velocity, 1), numericOps.multiply(accelspeed, element(wishdir, 1))));
            pml.velocity[2] = numericOps.store(numericOps.add(element(pml.velocity, 2), numericOps.multiply(accelspeed, element(wishdir, 2))));
        }
        function PM_AddCurrents(wishvel: Vec3): void {
            if (pm.s.pm_flags & PmflagsT.PMF_ON_LADDER) {
                if (pm.cmd.buttons & (ButtonT.BUTTON_JUMP | ButtonT.BUTTON_CROUCH)) {
                    const ladder_speed = pm.waterlevel >= WaterLevelT.WATER_WAIST ? pm_maxspeed : 200;
                    if (pm.cmd.buttons & ButtonT.BUTTON_JUMP)
                        wishvel[2] = numericOps.store(ladder_speed);
                    else if (pm.cmd.buttons & ButtonT.BUTTON_CROUCH)
                        wishvel[2] = numericOps.store(-ladder_speed);
                }
                else if (pm.cmd.forwardmove) {
                    const ladder_speed = clamp(pm.cmd.forwardmove, -200, 200);
                    if (pm.cmd.forwardmove > 0) {
                        if (element(pm.viewangles, PITCH) < 15)
                            wishvel[2] = numericOps.store(ladder_speed);
                        else
                            wishvel[2] = numericOps.store(-ladder_speed);
                    }
                    else if (pm.cmd.forwardmove < 0) {
                        if (!pm.groundentity) {
                            wishvel[0] = numericOps.store(0);
                            wishvel[1] = numericOps.store(0);
                        }
                        wishvel[2] = numericOps.store(ladder_speed);
                    }
                }
                else {
                    wishvel[2] = numericOps.store(0);
                }
                if (!pm.groundentity) {
                    if (pm.cmd.sidemove) {
                        let ladder_speed = clamp(pm.cmd.sidemove, -150, 150);
                        if (pm.waterlevel < WaterLevelT.WATER_WAIST)
                            ladder_speed = numericOps.multiply(ladder_speed, pm_laddermod);
                        const flatforward = vec3(element(pml.forward, 0), element(pml.forward, 1), 0);
                        vec3_normalize(flatforward);
                        const spot = vec3_add(pml.origin, vec3_muls(flatforward, 1));
                        const trace = PM_Trace(pml.origin, pm.mins, pm.maxs, spot, ContentsT.CONTENTS_LADDER);
                        if (trace.fraction !== 1 && trace.contents & ContentsT.CONTENTS_LADDER) {
                            const right = vec3_cross(trace.plane.normal, vec3(0, 0, 1));
                            wishvel[0] = numericOps.store(0);
                            wishvel[1] = numericOps.store(0);
                            vec3_addEq(wishvel, vec3_muls(right, -ladder_speed));
                        }
                    }
                    else {
                        if (element(wishvel, 0) < -25)
                            wishvel[0] = numericOps.store(-25);
                        else if (element(wishvel, 0) > 25)
                            wishvel[0] = numericOps.store(25);
                        if (element(wishvel, 1) < -25)
                            wishvel[1] = numericOps.store(-25);
                        else if (element(wishvel, 1) > 25)
                            wishvel[1] = numericOps.store(25);
                    }
                }
            }
            if (pm.watertype & MASK_CURRENT) {
                const v = vec3(0, 0, 0);
                if (pm.watertype & ContentsT.CONTENTS_CURRENT_0)
                    v[0] = numericOps.store(numericOps.add(element(v, 0), 1));
                if (pm.watertype & ContentsT.CONTENTS_CURRENT_90)
                    v[1] = numericOps.store(numericOps.add(element(v, 1), 1));
                if (pm.watertype & ContentsT.CONTENTS_CURRENT_180)
                    v[0] = numericOps.store(numericOps.subtract(element(v, 0), 1));
                if (pm.watertype & ContentsT.CONTENTS_CURRENT_270)
                    v[1] = numericOps.store(numericOps.subtract(element(v, 1), 1));
                if (pm.watertype & ContentsT.CONTENTS_CURRENT_UP)
                    v[2] = numericOps.store(numericOps.add(element(v, 2), 1));
                if (pm.watertype & ContentsT.CONTENTS_CURRENT_DOWN)
                    v[2] = numericOps.store(numericOps.subtract(element(v, 2), 1));
                let s = pm_waterspeed;
                if (pm.waterlevel === WaterLevelT.WATER_FEET && pm.groundentity)
                    s = numericOps.divide(s, 2);
                vec3_addEq(wishvel, vec3_muls(v, s));
            }
            if (pm.groundentity) {
                const v = vec3(0, 0, 0);
                if (pml.groundcontents & ContentsT.CONTENTS_CURRENT_0)
                    v[0] = numericOps.store(numericOps.add(element(v, 0), 1));
                if (pml.groundcontents & ContentsT.CONTENTS_CURRENT_90)
                    v[1] = numericOps.store(numericOps.add(element(v, 1), 1));
                if (pml.groundcontents & ContentsT.CONTENTS_CURRENT_180)
                    v[0] = numericOps.store(numericOps.subtract(element(v, 0), 1));
                if (pml.groundcontents & ContentsT.CONTENTS_CURRENT_270)
                    v[1] = numericOps.store(numericOps.subtract(element(v, 1), 1));
                if (pml.groundcontents & ContentsT.CONTENTS_CURRENT_UP)
                    v[2] = numericOps.store(numericOps.add(element(v, 2), 1));
                if (pml.groundcontents & ContentsT.CONTENTS_CURRENT_DOWN)
                    v[2] = numericOps.store(numericOps.subtract(element(v, 2), 1));
                vec3_addEq(wishvel, vec3_muls(v, 100));
            }
        }
        function PM_WaterMove(): void {
            const wishvel = vec3(numericOps.add(numericOps.multiply(element(pml.forward, 0), pm.cmd.forwardmove), numericOps.multiply(element(pml.right, 0), pm.cmd.sidemove)), numericOps.add(numericOps.multiply(element(pml.forward, 1), pm.cmd.forwardmove), numericOps.multiply(element(pml.right, 1), pm.cmd.sidemove)), numericOps.add(numericOps.multiply(element(pml.forward, 2), pm.cmd.forwardmove), numericOps.multiply(element(pml.right, 2), pm.cmd.sidemove)));
            if (!pm.cmd.forwardmove && !pm.cmd.sidemove && !(pm.cmd.buttons & (ButtonT.BUTTON_JUMP | ButtonT.BUTTON_CROUCH))) {
                if (!pm.groundentity)
                    wishvel[2] = numericOps.store(numericOps.subtract(element(wishvel, 2), 60));
            }
            else {
                if (pm.cmd.buttons & ButtonT.BUTTON_CROUCH)
                    wishvel[2] = numericOps.store(numericOps.subtract(element(wishvel, 2), numericOps.multiply(pm_waterspeed, sourceFloat(0.5))));
                else if (pm.cmd.buttons & ButtonT.BUTTON_JUMP)
                    wishvel[2] = numericOps.store(numericOps.add(element(wishvel, 2), numericOps.multiply(pm_waterspeed, sourceFloat(0.5))));
            }
            PM_AddCurrents(wishvel);
            const wishdir = vec3(element(wishvel, 0), element(wishvel, 1), element(wishvel, 2));
            let wishspeed = vec3_normalize(wishdir);
            if (wishspeed > pm_maxspeed) {
                vec3_mulEqs(wishvel, numericOps.divide(pm_maxspeed, wishspeed));
                wishspeed = pm_maxspeed;
            }
            wishspeed = numericOps.multiply(wishspeed, sourceFloat(0.5));
            if (pm.s.pm_flags & PmflagsT.PMF_DUCKED && wishspeed > pm_duckspeed) {
                vec3_mulEqs(wishvel, numericOps.divide(pm_duckspeed, wishspeed));
                wishspeed = pm_duckspeed;
            }
            PM_Accelerate(wishdir, wishspeed, pm_wateraccelerate);
            PM_StepSlideMove();
        }
        function PM_AirMove(): void {
            const fmove = pm.cmd.forwardmove;
            const smove = pm.cmd.sidemove;
            const wishvel = vec3(numericOps.add(numericOps.multiply(element(pml.forward, 0), fmove), numericOps.multiply(element(pml.right, 0), smove)), numericOps.add(numericOps.multiply(element(pml.forward, 1), fmove), numericOps.multiply(element(pml.right, 1), smove)), 0);
            PM_AddCurrents(wishvel);
            const wishdir = vec3(element(wishvel, 0), element(wishvel, 1), element(wishvel, 2));
            let wishspeed = vec3_normalize(wishdir);
            const maxspeed = pm.s.pm_flags & PmflagsT.PMF_DUCKED ? pm_duckspeed : pm_maxspeed;
            if (wishspeed > maxspeed) {
                vec3_mulEqs(wishvel, numericOps.divide(maxspeed, wishspeed));
                wishspeed = maxspeed;
            }
            if (pm.s.pm_flags & PmflagsT.PMF_ON_LADDER) {
                PM_Accelerate(wishdir, wishspeed, pm_accelerate);
                if (!element(wishvel, 2)) {
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
                if (!element(pml.velocity, 0) && !element(pml.velocity, 1))
                    return;
                PM_StepSlideMove();
            }
            else {
                if (config.airaccel)
                    PM_AirAccelerate(wishdir, wishspeed, config.airaccel);
                else
                    PM_Accelerate(wishdir, wishspeed, 1);
                if (pm.s.pm_type !== KexPmTypeT.PM_GRAPPLE)
                    pml.velocity[2] = numericOps.store(numericOps.subtract(element(pml.velocity, 2), numericOps.multiply(pm.s.gravity, pml.frametime)));
                PM_StepSlideMove();
            }
        }
        function PM_GetWaterLevel(position: Vec3): {
            level: WaterLevelT;
            type: ContentsT;
        } {
            let level: WaterLevelT = WaterLevelT.WATER_NONE;
            let type: ContentsT = ContentsT.CONTENTS_NONE;
            const sample2 = Math.trunc(numericOps.subtract(pm.s.viewheight, element(pm.mins, 2)));
            const sample1 = Math.trunc(numericOps.divide(sample2, 2));
            const point = vec3(element(position, 0), element(position, 1), numericOps.add(numericOps.add(element(position, 2), element(pm.mins, 2)), 1));
            let cont = pm.pointcontents(point);
            if (cont & MASK_WATER) {
                type = cont;
                level = WaterLevelT.WATER_FEET;
                point[2] = numericOps.store(numericOps.add(numericOps.add(element(pml.origin, 2), element(pm.mins, 2)), sample1));
                cont = pm.pointcontents(point);
                if (cont & MASK_WATER) {
                    level = WaterLevelT.WATER_WAIST;
                    point[2] = numericOps.store(numericOps.add(numericOps.add(element(pml.origin, 2), element(pm.mins, 2)), sample2));
                    cont = pm.pointcontents(point);
                    if (cont & MASK_WATER)
                        level = WaterLevelT.WATER_UNDER;
                }
            }
            return { level, type };
        }
        function PM_CatagorizePosition(): void {
            const point = vec3(element(pml.origin, 0), element(pml.origin, 1), numericOps.subtract(element(pml.origin, 2), sourceFloat(0.25)));
            if (element(pml.velocity, 2) > 180 || pm.s.pm_type === KexPmTypeT.PM_GRAPPLE) {
                pm.s.pm_flags &= ~PmflagsT.PMF_ON_GROUND;
                pm.groundentity = null;
            }
            else {
                const trace = PM_Trace(pml.origin, pm.mins, pm.maxs, point);
                pm.groundplane = trace.plane;
                pml.groundsurface = trace.surface;
                pml.groundcontents = trace.contents;
                let slanted_ground = trace.fraction < 1 && element(trace.plane.normal, 2) < sourceFloat(0.7);
                if (slanted_ground) {
                    const slant = PM_Trace(pml.origin, pm.mins, pm.maxs, vec3_add(pml.origin, trace.plane.normal));
                    if (slant.fraction < 1 && !slant.startsolid)
                        slanted_ground = false;
                }
                if (trace.fraction === 1 || (slanted_ground && !trace.startsolid)) {
                    pm.groundentity = null;
                    pm.s.pm_flags &= ~PmflagsT.PMF_ON_GROUND;
                }
                else {
                    pm.groundentity = trace.ent;
                    if (pm.s.pm_flags & PmflagsT.PMF_TIME_WATERJUMP) {
                        pm.s.pm_flags &= ~(PmflagsT.PMF_TIME_WATERJUMP | PmflagsT.PMF_TIME_LAND | PmflagsT.PMF_TIME_TELEPORT | PmflagsT.PMF_TIME_TRICK);
                        pm.s.pm_time = 0;
                    }
                    if (!(pm.s.pm_flags & PmflagsT.PMF_ON_GROUND)) {
                        if (!config.n64_physics && element(pml.velocity, 2) >= 100 && element(pm.groundplane.normal, 2) >= sourceFloat(0.9) && !(pm.s.pm_flags & PmflagsT.PMF_DUCKED)) {
                            pm.s.pm_flags |= PmflagsT.PMF_TIME_TRICK;
                            pm.s.pm_time = 64;
                        }
                        const clipped_velocity = SlideClipVelocity(pml.velocity, pm.groundplane.normal, sourceFloat(1.01));
                        pm.impact_delta = numericOps.subtract(element(pml.start_velocity, 2), element(clipped_velocity, 2));
                        pm.s.pm_flags |= PmflagsT.PMF_ON_GROUND;
                        if (config.n64_physics || pm.s.pm_flags & PmflagsT.PMF_DUCKED) {
                            pm.s.pm_flags |= PmflagsT.PMF_TIME_LAND;
                            pm.s.pm_time = 128;
                        }
                    }
                }
                PM_RecordTrace(pm.touch, trace);
            }
            const { level, type } = PM_GetWaterLevel(pml.origin);
            pm.waterlevel = level;
            pm.watertype = type;
        }
        function PM_CheckJump(): void {
            if (pm.s.pm_flags & PmflagsT.PMF_TIME_LAND) {
                return;
            }
            if (!(pm.cmd.buttons & ButtonT.BUTTON_JUMP)) {
                pm.s.pm_flags &= ~PmflagsT.PMF_JUMP_HELD;
                return;
            }
            if (pm.s.pm_flags & PmflagsT.PMF_JUMP_HELD)
                return;
            if (pm.s.pm_type === KexPmTypeT.PM_DEAD)
                return;
            if (pm.waterlevel >= WaterLevelT.WATER_WAIST) {
                pm.groundentity = null;
                return;
            }
            if (pm.groundentity === null)
                return;
            pm.s.pm_flags |= PmflagsT.PMF_JUMP_HELD;
            pm.jump_sound = true;
            pm.groundentity = null;
            pm.s.pm_flags &= ~PmflagsT.PMF_ON_GROUND;
            const jump_height = 270;
            pml.velocity[2] = numericOps.store(numericOps.add(element(pml.velocity, 2), jump_height));
            if (element(pml.velocity, 2) < jump_height)
                pml.velocity[2] = numericOps.store(jump_height);
        }
        function PM_CheckSpecialMovement(): void {
            if (pm.s.pm_time)
                return;
            pm.s.pm_flags &= ~PmflagsT.PMF_ON_LADDER;
            const flatforward = vec3(element(pml.forward, 0), element(pml.forward, 1), 0);
            vec3_normalize(flatforward);
            const spot = vec3_add(pml.origin, vec3_muls(flatforward, 1));
            let trace = PM_Trace(pml.origin, pm.mins, pm.maxs, spot, ContentsT.CONTENTS_LADDER);
            if (trace.fraction < 1 && trace.contents & ContentsT.CONTENTS_LADDER && pm.waterlevel < WaterLevelT.WATER_WAIST) {
                pm.s.pm_flags |= PmflagsT.PMF_ON_LADDER;
            }
            if (!pm.s.gravity)
                return;
            if (!(pm.cmd.buttons & ButtonT.BUTTON_JUMP) && pm.cmd.forwardmove <= 0)
                return;
            if (pm.waterlevel !== WaterLevelT.WATER_WAIST)
                return;
            else if (pm.watertype & ContentsT.CONTENTS_NO_WATERJUMP)
                return;
            trace = PM_Trace(pml.origin, pm.mins, pm.maxs, vec3_add(pml.origin, vec3_muls(flatforward, 40)), MASK_SOLID);
            if (trace.fraction === 1 || element(trace.plane.normal, 2) >= sourceFloat(0.7))
                return;
            const waterjump_vel = vec3_muls(flatforward, 50);
            waterjump_vel[2] = numericOps.store(350);
            const touches: KexTouchListT = { num: 0, traces: [] };
            const waterjump_origin = vec3(element(pml.origin, 0), element(pml.origin, 1), element(pml.origin, 2));
            const time = sourceFloat(0.1);
            let has_time = true;
            const iterCount = Math.min(50, Math.trunc(numericOps.multiply(10, (numericOps.divide(800, pm.s.gravity)))));
            for (let i = 0; i < iterCount; i++) {
                waterjump_vel[2] = numericOps.store(numericOps.subtract(element(waterjump_vel, 2), numericOps.multiply(pm.s.gravity, time)));
                if (element(waterjump_vel, 2) < 0)
                    has_time = false;
                PM_StepSlideMove_Generic(waterjump_origin, waterjump_vel, time, pm.mins, pm.maxs, touches, has_time, PM_Trace_Auto, pml.origin);
            }
            trace = PM_Trace(waterjump_origin, pm.mins, pm.maxs, vec3_sub(waterjump_origin, vec3(0, 0, 2)), MASK_SOLID);
            if (trace.fraction === 1 || element(trace.plane.normal, 2) < sourceFloat(0.7) || element(trace.endpos, 2) < element(pml.origin, 2))
                return;
            if (pm.groundentity && Math.abs(numericOps.subtract(element(pml.origin, 2), element(trace.endpos, 2))) <= STEPSIZE)
                return;
            const { level } = PM_GetWaterLevel(trace.endpos);
            if (level >= WaterLevelT.WATER_WAIST)
                return;
            pml.velocity[0] = numericOps.store(numericOps.multiply(element(flatforward, 0), 50));
            pml.velocity[1] = numericOps.store(numericOps.multiply(element(flatforward, 1), 50));
            pml.velocity[2] = numericOps.store(350);
            pm.s.pm_flags |= PmflagsT.PMF_TIME_WATERJUMP;
            pm.s.pm_time = 2048;
        }
        function PM_FlyMove(doclip: boolean): void {
            pm.s.viewheight = doclip ? 0 : 22;
            const speed = vec3_length(pml.velocity);
            if (speed < 1) {
                pml.velocity[0] = numericOps.store(0);
                pml.velocity[1] = numericOps.store(0);
                pml.velocity[2] = numericOps.store(0);
            }
            else {
                const friction = numericOps.multiply(pm_friction, 1.5);
                const control = speed < pm_stopspeed ? pm_stopspeed : speed;
                const drop = numericOps.multiply(numericOps.multiply(control, friction), pml.frametime);
                let newspeed = numericOps.subtract(speed, drop);
                if (newspeed < 0)
                    newspeed = 0;
                newspeed = numericOps.divide(newspeed, speed);
                vec3_mulEqs(pml.velocity, newspeed);
            }
            const fmove = pm.cmd.forwardmove;
            const smove = pm.cmd.sidemove;
            vec3_normalize(pml.forward);
            vec3_normalize(pml.right);
            const wishvel = vec3(numericOps.add(numericOps.multiply(element(pml.forward, 0), fmove), numericOps.multiply(element(pml.right, 0), smove)), numericOps.add(numericOps.multiply(element(pml.forward, 1), fmove), numericOps.multiply(element(pml.right, 1), smove)), numericOps.add(numericOps.multiply(element(pml.forward, 2), fmove), numericOps.multiply(element(pml.right, 2), smove)));
            if (pm.cmd.buttons & ButtonT.BUTTON_JUMP)
                wishvel[2] = numericOps.store(numericOps.add(element(wishvel, 2), numericOps.multiply(pm_waterspeed, sourceFloat(0.5))));
            if (pm.cmd.buttons & ButtonT.BUTTON_CROUCH)
                wishvel[2] = numericOps.store(numericOps.subtract(element(wishvel, 2), numericOps.multiply(pm_waterspeed, sourceFloat(0.5))));
            const wishdir = vec3(element(wishvel, 0), element(wishvel, 1), element(wishvel, 2));
            let wishspeed = vec3_normalize(wishdir);
            if (wishspeed > pm_maxspeed) {
                vec3_mulEqs(wishvel, numericOps.divide(pm_maxspeed, wishspeed));
                wishspeed = pm_maxspeed;
            }
            wishspeed = numericOps.multiply(wishspeed, 2);
            const currentspeed = vec3_dot(pml.velocity, wishdir);
            const addspeed = numericOps.subtract(wishspeed, currentspeed);
            if (addspeed > 0) {
                let accelspeed = numericOps.multiply(numericOps.multiply(pm_accelerate, pml.frametime), wishspeed);
                if (accelspeed > addspeed)
                    accelspeed = addspeed;
                pml.velocity[0] = numericOps.store(numericOps.add(element(pml.velocity, 0), numericOps.multiply(accelspeed, element(wishdir, 0))));
                pml.velocity[1] = numericOps.store(numericOps.add(element(pml.velocity, 1), numericOps.multiply(accelspeed, element(wishdir, 1))));
                pml.velocity[2] = numericOps.store(numericOps.add(element(pml.velocity, 2), numericOps.multiply(accelspeed, element(wishdir, 2))));
            }
            if (doclip) {
                PM_StepSlideMove();
            }
            else {
                pml.origin[0] = numericOps.store(numericOps.add(element(pml.origin, 0), numericOps.multiply(element(pml.velocity, 0), pml.frametime)));
                pml.origin[1] = numericOps.store(numericOps.add(element(pml.origin, 1), numericOps.multiply(element(pml.velocity, 1), pml.frametime)));
                pml.origin[2] = numericOps.store(numericOps.add(element(pml.origin, 2), numericOps.multiply(element(pml.velocity, 2), pml.frametime)));
            }
        }
        function PM_SetDimensions(): void {
            pm.mins[0] = numericOps.store(pm.characterBounds.min.x);
            pm.mins[1] = numericOps.store(pm.characterBounds.min.y);
            pm.maxs[0] = numericOps.store(pm.characterBounds.max.x);
            pm.maxs[1] = numericOps.store(pm.characterBounds.max.y);
            if (pm.s.pm_type === KexPmTypeT.PM_GIB) {
                pm.mins[2] = numericOps.store(characterHeight(pm.characterBounds, 0, numericOps));
                pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 16, numericOps));
                pm.s.viewheight = characterHeight(pm.characterBounds, 8, numericOps);
                return;
            }
            pm.mins[2] = numericOps.store(characterHeight(pm.characterBounds, -24, numericOps));
            if (pm.s.pm_flags & PmflagsT.PMF_DUCKED || pm.s.pm_type === KexPmTypeT.PM_DEAD) {
                pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 4, numericOps));
                pm.s.viewheight = characterHeight(pm.characterBounds, -2, numericOps);
            }
            else {
                pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 32, numericOps));
                pm.s.viewheight = characterHeight(pm.characterBounds, 22, numericOps);
            }
        }
        function PM_AboveWater(): boolean {
            const below = vec3(element(pml.origin, 0), element(pml.origin, 1), numericOps.subtract(element(pml.origin, 2), 8));
            const solid_below = pm.trace(pml.origin, pm.mins, pm.maxs, below, pm.player, MASK_SOLID).fraction < 1;
            if (solid_below)
                return false;
            const water_below = pm.trace(pml.origin, pm.mins, pm.maxs, below, pm.player, MASK_WATER).fraction < 1;
            return water_below;
        }
        function PM_CheckDuck(): boolean {
            if (pm.s.pm_type === KexPmTypeT.PM_GIB)
                return false;
            let flags_changed = false;
            if (pm.s.pm_type === KexPmTypeT.PM_DEAD) {
                if (!(pm.s.pm_flags & PmflagsT.PMF_DUCKED)) {
                    pm.s.pm_flags |= PmflagsT.PMF_DUCKED;
                    flags_changed = true;
                }
            }
            else if (pm.cmd.buttons & ButtonT.BUTTON_CROUCH &&
                (pm.groundentity || (pm.waterlevel <= WaterLevelT.WATER_FEET && !PM_AboveWater())) &&
                !(pm.s.pm_flags & PmflagsT.PMF_ON_LADDER) &&
                !config.n64_physics) {
                if (!(pm.s.pm_flags & PmflagsT.PMF_DUCKED)) {
                    const check_maxs = vec3(element(pm.maxs, 0), element(pm.maxs, 1), characterHeight(pm.characterBounds, 4, numericOps));
                    const trace = PM_Trace(pml.origin, pm.mins, check_maxs, pml.origin);
                    if (!trace.allsolid) {
                        pm.s.pm_flags |= PmflagsT.PMF_DUCKED;
                        flags_changed = true;
                    }
                }
            }
            else {
                if (pm.s.pm_flags & PmflagsT.PMF_DUCKED) {
                    const check_maxs = vec3(element(pm.maxs, 0), element(pm.maxs, 1), pm.characterBounds.max.z);
                    const trace = PM_Trace(pml.origin, pm.mins, check_maxs, pml.origin);
                    if (!trace.allsolid) {
                        pm.s.pm_flags &= ~PmflagsT.PMF_DUCKED;
                        flags_changed = true;
                    }
                }
            }
            if (!flags_changed)
                return false;
            PM_SetDimensions();
            return true;
        }
        function PM_DeadMove(): void {
            if (!pm.groundentity)
                return;
            let forward = vec3_length(pml.velocity);
            forward = numericOps.subtract(forward, 20);
            if (forward <= 0) {
                pml.velocity[0] = numericOps.store(0);
                pml.velocity[1] = numericOps.store(0);
                pml.velocity[2] = numericOps.store(0);
            }
            else {
                vec3_normalize(pml.velocity);
                vec3_mulEqs(pml.velocity, forward);
            }
        }
        function PM_GoodPosition(): boolean {
            if (pm.s.pm_type === KexPmTypeT.PM_NOCLIP)
                return true;
            const trace = PM_Trace(pm.s.origin, pm.mins, pm.maxs, pm.s.origin);
            return !trace.allsolid;
        }
        function PM_SnapPosition(): void {
            VectorCopy(pml.velocity, pm.s.velocity);
            VectorCopy(pml.origin, pm.s.origin);
            if (PM_GoodPosition())
                return;
            if (G_FixStuckObject_Generic(pm.s.origin, pm.mins, pm.maxs, PM_Trace_Auto) === StuckResultT.NO_GOOD_POSITION) {
                VectorCopy(pml.previous_origin, pm.s.origin);
                return;
            }
        }
        function PM_InitialSnapPosition(): void {
            const offset = [0, -1, 1];
            const base = vec3(element(pm.s.origin, 0), element(pm.s.origin, 1), element(pm.s.origin, 2));
            for (const z of axes) {
                pm.s.origin[2] = numericOps.store(numericOps.add(element(base, 2), element(offset, z)));
                for (const y of axes) {
                    pm.s.origin[1] = numericOps.store(numericOps.add(element(base, 1), element(offset, y)));
                    for (const x of axes) {
                        pm.s.origin[0] = numericOps.store(numericOps.add(element(base, 0), element(offset, x)));
                        if (PM_GoodPosition()) {
                            VectorCopy(pm.s.origin, pml.origin);
                            VectorCopy(pm.s.origin, pml.previous_origin);
                            return;
                        }
                    }
                }
            }
        }
        function PM_ClampAngles(): void {
            if (pm.s.pm_flags & PmflagsT.PMF_TIME_TELEPORT) {
                pm.viewangles[YAW] = numericOps.store(numericOps.add(element(pm.cmd.angles, YAW), element(pm.s.delta_angles, YAW)));
                pm.viewangles[PITCH] = numericOps.store(0);
                pm.viewangles[ROLL] = numericOps.store(0);
            }
            else {
                pm.viewangles[0] = numericOps.store(numericOps.add(element(pm.cmd.angles, 0), element(pm.s.delta_angles, 0)));
                pm.viewangles[1] = numericOps.store(numericOps.add(element(pm.cmd.angles, 1), element(pm.s.delta_angles, 1)));
                pm.viewangles[2] = numericOps.store(numericOps.add(element(pm.cmd.angles, 2), element(pm.s.delta_angles, 2)));
                if (element(pm.viewangles, PITCH) > 89 && element(pm.viewangles, PITCH) < 180)
                    pm.viewangles[PITCH] = numericOps.store(89);
                else if (element(pm.viewangles, PITCH) < 271 && element(pm.viewangles, PITCH) >= 180)
                    pm.viewangles[PITCH] = numericOps.store(271);
            }
            AngleVectors(pm.viewangles, pml.forward, pml.right, pml.up);
        }
        function PM_ScreenEffects(): void {
            const vieworg = vec3(numericOps.add(element(pml.origin, 0), element(pm.viewoffset, 0)), numericOps.add(element(pml.origin, 1), element(pm.viewoffset, 1)), numericOps.add(numericOps.add(element(pml.origin, 2), element(pm.viewoffset, 2)), pm.s.viewheight));
            const contents = pm.pointcontents(vieworg);
            if (contents & (ContentsT.CONTENTS_LAVA | ContentsT.CONTENTS_SLIME | ContentsT.CONTENTS_WATER)) {
                pm.rdflags |= RefdefFlagsT.RDF_UNDERWATER;
            }
            else {
                pm.rdflags &= ~RefdefFlagsT.RDF_UNDERWATER;
            }
            if (contents & (ContentsT.CONTENTS_SOLID | ContentsT.CONTENTS_LAVA)) {
                G_AddBlend(1.0, sourceFloat(0.3), sourceFloat(0.0), sourceFloat(0.6), pm.screen_blend);
            }
            else if (contents & ContentsT.CONTENTS_SLIME) {
                G_AddBlend(sourceFloat(0.0), sourceFloat(0.1), sourceFloat(0.05), sourceFloat(0.6), pm.screen_blend);
            }
            else if (contents & ContentsT.CONTENTS_WATER) {
                G_AddBlend(sourceFloat(0.5), sourceFloat(0.3), sourceFloat(0.2), sourceFloat(0.4), pm.screen_blend);
            }
        }
        PM_ClampAngles();
        if (pm.s.pm_type === KexPmTypeT.PM_SPECTATOR || pm.s.pm_type === KexPmTypeT.PM_NOCLIP) {
            pm.s.pm_flags = PmflagsT.PMF_NONE;
            if (pm.s.pm_type === KexPmTypeT.PM_SPECTATOR) {
                pm.mins[0] = numericOps.multiply(pm.characterBounds.min.x, 0.5);
                pm.mins[1] = numericOps.multiply(pm.characterBounds.min.y, 0.5);
                pm.maxs[0] = numericOps.multiply(pm.characterBounds.max.x, 0.5);
                pm.maxs[1] = numericOps.multiply(pm.characterBounds.max.y, 0.5);
                pm.mins[2] = numericOps.store(characterHeight(pm.characterBounds, -8, numericOps));
                pm.maxs[2] = numericOps.store(characterHeight(pm.characterBounds, 8, numericOps));
            }
            PM_FlyMove(pm.s.pm_type === KexPmTypeT.PM_SPECTATOR);
            PM_SnapPosition();
            return;
        }
        if (pm.s.pm_type >= KexPmTypeT.PM_DEAD) {
            pm.cmd.forwardmove = 0;
            pm.cmd.sidemove = 0;
            pm.cmd.buttons &= ~(ButtonT.BUTTON_JUMP | ButtonT.BUTTON_CROUCH);
        }
        if (pm.s.pm_type === KexPmTypeT.PM_FREEZE)
            return;
        PM_SetDimensions();
        PM_CatagorizePosition();
        if (pm.snapinitial)
            PM_InitialSnapPosition();
        if (PM_CheckDuck())
            PM_CatagorizePosition();
        if (pm.s.pm_type === KexPmTypeT.PM_DEAD)
            PM_DeadMove();
        PM_CheckSpecialMovement();
        if (pm.s.pm_time) {
            if (pm.cmd.msec >= pm.s.pm_time) {
                pm.s.pm_flags &= ~(PmflagsT.PMF_TIME_WATERJUMP | PmflagsT.PMF_TIME_LAND | PmflagsT.PMF_TIME_TELEPORT | PmflagsT.PMF_TIME_TRICK);
                pm.s.pm_time = 0;
            }
            else {
                pm.s.pm_time = numericOps.subtract(pm.s.pm_time, pm.cmd.msec);
            }
        }
        if (pm.s.pm_flags & PmflagsT.PMF_TIME_TELEPORT) {
        }
        else if (pm.s.pm_flags & PmflagsT.PMF_TIME_WATERJUMP) {
            pml.velocity[2] = numericOps.store(numericOps.subtract(element(pml.velocity, 2), numericOps.multiply(pm.s.gravity, pml.frametime)));
            if (element(pml.velocity, 2) < 0) {
                pm.s.pm_flags &= ~(PmflagsT.PMF_TIME_WATERJUMP | PmflagsT.PMF_TIME_LAND | PmflagsT.PMF_TIME_TELEPORT | PmflagsT.PMF_TIME_TRICK);
                pm.s.pm_time = 0;
            }
            PM_StepSlideMove();
        }
        else {
            PM_CheckJump();
            PM_Friction();
            if (pm.waterlevel >= WaterLevelT.WATER_WAIST) {
                PM_WaterMove();
            }
            else {
                const angles = vec3(element(pm.viewangles, 0), element(pm.viewangles, 1), element(pm.viewangles, 2));
                if (element(angles, PITCH) > 180)
                    angles[PITCH] = numericOps.store(numericOps.subtract(element(angles, PITCH), 360));
                angles[PITCH] = numericOps.store(numericOps.divide(element(angles, PITCH), 3));
                AngleVectors(angles, pml.forward, pml.right, pml.up);
                PM_AirMove();
            }
        }
        PM_CatagorizePosition();
        if (pm.s.pm_flags & PmflagsT.PMF_TIME_TRICK)
            PM_CheckJump();
        PM_ScreenEffects();
        PM_SnapPosition();
    }
    return { Pmove, PM_StepSlideMove_Generic, G_FixStuckObject_Generic };
}
export function pmoveRerelease(pm: KexPmoveT, numericOps: NumericOperations, config: PmConfigT): void { createRereleaseMovement(numericOps).Pmove(pm, config); }
