import { isDeepStrictEqual } from "node:util";
import { clientConnect, clipVelocity, dropTimers, nestedVm, singleClock, subdivideMove, weaponSequence } from "./semantics.ts";
import type { ClipInput, ConnectInput, MoveInput, WeaponInput } from "./semantics.ts";

export interface SourceAssertion {
  readonly id: string;
  readonly derivation: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly passed: boolean;
}

export interface SourceScenario {
  readonly id: string;
  readonly sourceLocations: readonly string[];
  readonly assumptions: readonly string[];
  readonly input: unknown;
  readonly output: unknown;
  readonly assertions: readonly SourceAssertion[];
}

function check(id: string, derivation: string, expected: unknown, actual: unknown): SourceAssertion {
  return { id, derivation, expected, actual, passed: isDeepStrictEqual(expected, actual) };
}

function numericScenario(): SourceScenario {
  const input = {
    entering: { velocity: [-100, 2, 3], normal: [1, 0, 0], overbounce: 1.125 } satisfies ClipInput,
    leaving: { velocity: [100, 2, 3], normal: [1, 0, 0], overbounce: 1.25 } satisfies ClipInput,
    cancellation: { velocity: [16777216, 1, -16777216], normal: [1, 1, 1], overbounce: 1 } satisfies ClipInput,
    clockDeltas: [-1, 0, 1, 125, 200, 201],
  };
  const entering = clipVelocity(input.entering);
  const leaving = clipVelocity(input.leaving);
  const cancellation = clipVelocity(input.cancellation);
  const clocks = input.clockDeltas.map((delta) => singleClock(100, 100 + delta));
  return {
    id: "q3-numeric-source",
    sourceLocations: ["code/game/bg_pmove.c:145-162", "code/game/bg_pmove.c:1894-1910", "code/game/q_shared.h:611"],
    assumptions: [
      "Float arithmetic uses IEEE-754 binary32 round-to-nearest ties-to-even at each float operation, with no excess precision or reassociation.",
      "The non-unit cancellation normal is an arithmetic probe of PM_ClipVelocity, not a collision-world normal.",
      "The 0.001 literal promotes multiplication to binary64 before assignment to pml.frametime rounds to binary32.",
    ],
    input, output: { entering, leaving, cancellation, clocks },
    assertions: [
      check("entering", "Negative dot -100 is multiplied by 9/8 to -112.5; x minus backoff is 12.5. All values are exactly binary-representable.", { backoff: -112.5, velocity: [12.5, 2, 3] }, entering),
      check("leaving", "Positive dot 100 is divided by 5/4 to 80; x minus backoff is 20. All values are exactly representable.", { backoff: 80, velocity: [20, 2, 3] }, leaving),
      check("binary32-dot-staging", "At 2^24 the binary32 spacing is two; ties-to-even rounds 2^24+1 to 2^24 before subtracting 2^24, yielding zero.", { backoff: 0, velocity: [16777216, 1, -16777216] }, cancellation),
      check("single-clock-clamps", "PmoveSingle clamps local duration to [1,200] while assigning commandTime the original serverTime. 1/1000 and 1/5 round to the listed binary32 values; 1/8 is exact.", [
        { commandTime: 99, msec: 1, frametime: 0.0010000000474974513 },
        { commandTime: 100, msec: 1, frametime: 0.0010000000474974513 },
        { commandTime: 101, msec: 1, frametime: 0.0010000000474974513 },
        { commandTime: 225, msec: 125, frametime: 0.125 },
        { commandTime: 300, msec: 200, frametime: 0.20000000298023224 },
        { commandTime: 301, msec: 200, frametime: 0.20000000298023224 },
      ], clocks),
    ],
  };
}

function movementScenario(): SourceScenario {
  const base: MoveInput = { commandTime: 0, serverTime: 133, framecount: 63, subdivision: { kind: "variable" }, jumpHeld: true, upmove: 127 };
  const inputs = {
    variable: base,
    fixed: { ...base, commandTime: 100, serverTime: 125, framecount: 7, subdivision: { kind: "fixed", msec: 8 }, jumpHeld: false, upmove: 0 } satisfies MoveInput,
    catchup: { ...base, serverTime: 1500, jumpHeld: false },
    equal: { ...base, serverTime: 0 },
    backwards: { ...base, serverTime: -1 },
  };
  const output = {
    variable: subdivideMove(inputs.variable), fixed: subdivideMove(inputs.fixed), catchup: subdivideMove(inputs.catchup),
    equal: subdivideMove(inputs.equal), backwards: subdivideMove(inputs.backwards),
    boundaryLengths: [65, 66, 67].map((serverTime) => subdivideMove({ ...base, serverTime }).steps.map((step) => step.msec)),
  };
  return {
    id: "q3-pmove-subdivision-source",
    sourceLocations: ["code/game/bg_pmove.c:2026-2081", "code/game/q_shared.h:1136"],
    assumptions: ["Signed time arithmetic stays within int32 range.", "PmoveSingle is reduced to its clock writes; PMF_JUMP_HELD is held at the stated value throughout. Movement and collision are outside this specimen."],
    input: { ...inputs, boundaryServerTimes: [65, 66, 67] }, output,
    assertions: [
      check("variable", "133=66+66+1; the six-bit frame count wraps 63 to 0; upmove becomes 20 only after the first PmoveSingle returns.", { commandTime: 133, framecount: 0, upmove: 20, steps: [
        { commandTime: 66, msec: 66, upmove: 127 }, { commandTime: 132, msec: 66, upmove: 20 }, { commandTime: 133, msec: 1, upmove: 20 },
      ] }, output.variable),
      check("fixed", "25=8+8+8+1; frame count increments once per Pmove, not once per subdivision.", { commandTime: 125, framecount: 8, upmove: 0, steps: [
        { commandTime: 108, msec: 8, upmove: 0 }, { commandTime: 116, msec: 8, upmove: 0 }, { commandTime: 124, msec: 8, upmove: 0 }, { commandTime: 125, msec: 1, upmove: 0 },
      ] }, output.fixed),
      check("catchup-times", "The 1500 ms gap resets commandTime to 500. The remaining 1000 ms consists of fifteen 66 ms steps and one 10 ms step.", [566, 632, 698, 764, 830, 896, 962, 1028, 1094, 1160, 1226, 1292, 1358, 1424, 1490, 1500], output.catchup.steps.map((step) => step.commandTime)),
      check("equal", "Equal time skips the loop but still increments and masks pmove_framecount.", { commandTime: 0, framecount: 0, upmove: 127, steps: [] }, output.equal),
      check("backwards", "The backward-time return precedes both catch-up and frame-count mutation.", { commandTime: 0, framecount: 63, upmove: 127, steps: [] }, output.backwards),
      check("subdivision-boundary", "The variable branch caps only durations greater than 66.", [[65], [66], [66, 1]], output.boundaryLengths),
    ],
  };
}

function timerScenario(): SourceScenario {
  const input = { pmTime: 66, flags: 355, legsTimer: 66, torsoTimer: 67 };
  const output = [65, 66, 67].map((msec) => dropTimers({ ...input, msec }));
  return {
    id: "q3-timer-expiry-source", sourceLocations: ["code/game/bg_pmove.c:1762-1787", "code/game/bg_public.h:142-157"],
    assumptions: ["The input flags are DUCKED|JUMP_HELD|TIME_LAND|TIME_KNOCKBACK|TIME_WATERJUMP, numerically 355."],
    input: { ...input, durations: [65, 66, 67] }, output,
    assertions: [check("expiry-minus-exact-plus", "PM_DropTimers clears all three time flags at msec>=pm_time and preserves DUCKED|JUMP_HELD=3. Animation timers independently clamp at zero.", [
      { pmTime: 1, flags: 355, legsTimer: 1, torsoTimer: 2 },
      { pmTime: 0, flags: 3, legsTimer: 0, torsoTimer: 1 },
      { pmTime: 0, flags: 3, legsTimer: 0, torsoTimer: 0 },
    ], output)],
  };
}

function firingScenario(): SourceScenario {
  const input: WeaponInput = {
    weapon: "machinegun", weaponState: "firing", weaponTime: 30, torsoAnim: 0,
    ammo: { machinegun: 2, rocket: 4, lightning: -1 }, eventSequence: 0,
    steps: [
      { msec: 66, weapon: "machinegun", attack: true, haste: false },
      { msec: 66, weapon: "machinegun", attack: true, haste: false },
      { msec: 100, weapon: "machinegun", attack: true, haste: false },
    ],
  };
  const output = weaponSequence(input);
  return {
    id: "q3-weapon-ammo-events-source", sourceLocations: ["code/game/bg_pmove.c:58-60", "code/game/bg_pmove.c:1538-1706", "code/game/bg_misc.c:1390-1408", "code/game/bg_public.h:347-378", "code/game/q_shared.h:1134"],
    assumptions: ["Live non-spectator player, no respawn flag or holdable use, owned machinegun, no mission pack; fixture steps are direct PM_Weapon durations.", "No unrelated events occur. The initial two-slot event ring and event parameters are zero."],
    input, output,
    assertions: [
      check("overshoot-ammo-state", "30-66+100=64, then 64-66+100=98, then 98-100+500=498. Ammo falls 2 to 1 to 0, and the third attempt emits NOAMMO while remaining FIRING.", [[64, 1, "firing", 135], [98, 0, "firing", 7], [498, 0, "firing", 135]], output.states.map((state) => [state.weaponTime, state.ammo.machinegun, state.weaponState, state.torsoAnim])),
      check("event-observation", "Animation and FIRING state precede ammo consumption. FIRE_WEAPON is appended after consumption and before cooldown addition; NOAMMO precedes +500. Sequences use index sequence&1.", [[23, 0, 0, 1, -36], [23, 1, 1, 0, -2], [21, 0, 2, 0, -2]], output.events.map((event) => [event.event, event.index, event.state.eventSequence, event.state.ammo.machinegun, event.state.weaponTime])),
      check("event-ring-wrap", "The third event replaces ring slot zero, while sequence grows to three.", { ring: [21, 23], sequence: 3 }, { ring: output.ring, sequence: output.states.at(-1)?.eventSequence }),
      check("event-parameters", "PM_AddEvent passes zero as the event parameter to BG_AddPredictableEventToPlayerstate for both FIRE_WEAPON and NOAMMO.", [0, 0, 0], output.events.map((event) => event.parm)),
      check("causal-order", "Each shot restarts TORSO_ATTACK=7 by flipping ANIM_TOGGLEBIT=128. Ammo consumption is visible before the corresponding predictable event.", [
        "step:0", "animation:135", "ammo:machinegun:1", "event:23:sequence:0",
        "step:1", "animation:7", "ammo:machinegun:0", "event:23:sequence:1",
        "step:2", "animation:135", "event:21:sequence:2",
      ], output.trace),
    ],
  };
}

function switchScenario(): SourceScenario {
  const input: WeaponInput = {
    weapon: "machinegun", weaponState: "ready", weaponTime: 0, torsoAnim: 0,
    ammo: { machinegun: 1, rocket: 4, lightning: -1 }, eventSequence: 0,
    steps: [
      { msec: 1, weapon: "rocket", attack: true, haste: false },
      { msec: 199, weapon: "rocket", attack: true, haste: false },
      { msec: 1, weapon: "rocket", attack: true, haste: false },
      { msec: 249, weapon: "rocket", attack: true, haste: false },
      { msec: 1, weapon: "rocket", attack: true, haste: false },
      { msec: 1, weapon: "rocket", attack: true, haste: false },
    ],
  };
  const output = weaponSequence(input);
  return {
    id: "q3-weapon-switch-boundaries-source", sourceLocations: ["code/game/bg_pmove.c:1469-1510", "code/game/bg_pmove.c:1586-1688", "code/game/bg_pmove.c:95-101"],
    assumptions: ["Live normal player; both weapons are owned. Attack remains held. Each input is a direct PM_Weapon call, so the 199/249 ms intervals are intentionally unsplit."],
    input, output,
    assertions: [
      check("switch-state-boundaries", "Begin adds 200; the exact dropping deadline changes weapon and adds 250; the exact raising deadline returns READY without firing. Attack fires only on the following call.", [
        ["machinegun", "dropping", 200, 4, 137], ["machinegun", "dropping", 1, 4, 137],
        ["rocket", "raising", 250, 4, 10], ["rocket", "raising", 1, 4, 10],
        ["rocket", "ready", 0, 4, 139], ["rocket", "firing", 800, 3, 7],
      ], output.states.map((state) => [state.weapon, state.weaponState, state.weaponTime, state.ammo.rocket, state.torsoAnim])),
      check("switch-event-order", "CHANGE_WEAPON is emitted while weaponstate is still READY and before the drop timer/animation writes; the next event is FIRE_WEAPON after rocket ammo is consumed.", [[22, "machinegun", "ready", 0, 4], [23, "rocket", "firing", 0, 3]], output.events.map((event) => [event.event, event.state.weapon, event.state.weaponState, event.state.weaponTime, event.state.ammo.rocket])),
    ],
  };
}

function hasteScenario(): SourceScenario {
  const input: WeaponInput = {
    weapon: "lightning", weaponState: "ready", weaponTime: 0, torsoAnim: 0,
    ammo: { machinegun: 1, rocket: 1, lightning: -1 }, eventSequence: 1,
    steps: [{ msec: 1, weapon: "lightning", attack: true, haste: true }],
  };
  const output = weaponSequence(input);
  return {
    id: "q3-haste-infinite-ammo-source", sourceLocations: ["code/game/bg_pmove.c:1628-1706"],
    assumptions: ["Base-game haste is active; weapon is lightning; -1 denotes infinite ammunition; no holdable or respawn guard."],
    input, output,
    assertions: [check("integer-haste-infinite", "C compound assignment addTime/=1.3 converts 50/1.3 back to int by truncation, yielding 38. Ammo -1 skips consumption, and sequence one uses slot one.", { time: 38, ammo: -1, ring: [0, 23], trace: ["step:0", "animation:135", "event:23:sequence:1"] }, {
      time: output.states.at(-1)?.weaponTime, ammo: output.states.at(-1)?.ammo.lightning, ring: output.ring, trace: output.trace,
    })],
  };
}

function connectScenario(): SourceScenario {
  const base: ConnectInput = { banned: false, ip: "203.0.113.4", configuredPassword: "secret", providedPassword: "bad", existingBotFlag: false, priorVm: null };
  const input = {
    password: base, banned: { ...base, banned: true },
    local: { ...base, ip: "localhost", priorVm: "ui" } satisfies ConnectInput,
    nonePassword: { ...base, configuredPassword: "NoNe" }, existingBot: { ...base, existingBotFlag: true },
  };
  const output = {
    password: clientConnect(input.password), banned: clientConnect(input.banned), local: clientConnect(input.local),
    nonePassword: clientConnect(input.nonePassword), existingBot: clientConnect(input.existingBot),
  };
  return {
    id: "q3-client-connect-immediate-source",
    sourceLocations: ["code/game/g_client.c:903-988", "code/game/g_main.c:203-213", "code/server/sv_client.c:423-440", "code/qcommon/vm.c:625-641", "code/qcommon/vm.c:668-710"],
    assumptions: [
      "Direct-connect call arguments are firstTime=true and isBot=false. Non-team game; successful imported session/userinfo/rank operations are represented by their call sites.",
      "Denial string address is represented by synthetic nonzero QVM offset 32 in a 256-byte memory region; this is not an observed original address or a QVM interpreter test.",
      "G_FilterPacket outcome and userinfo lookup values are fixed inputs. Existing SVF_BOT is distinct from the isBot argument.",
    ],
    input, output,
    assertions: [
      check("password-immediate-return", "ClientConnect returns Invalid password before initializing a client. vmMain forwards the nonzero return, VM_Call returns it synchronously, then SV_DirectConnect resolves and prints the denial and returns before connectResponse.", {
        returnValue: 32, denial: "Invalid password", serverState: "free", currentVm: "game", trace: [
          "VM_Call:game:enter", "vmMain:GAME_CLIENT_CONNECT", "trap_GetUserinfo", "G_FilterPacket", "password:check",
          "ClientConnect:return:32", "vmMain:return:32", "VM_Call:return:32", "VM_ExplicitArgPtr:game:32",
          "NET_OutOfBandPrint:print\nInvalid password\n", "server:return",
        ],
      }, output.password),
      check("banned-precedes-password", "The IP filter denial occurs before the password branch and every accepted-client side effect.", [
        "VM_Call:game:enter", "vmMain:GAME_CLIENT_CONNECT", "trap_GetUserinfo", "G_FilterPacket",
        "ClientConnect:return:32", "vmMain:return:32", "VM_Call:return:32", "VM_ExplicitArgPtr:game:32",
        "NET_OutOfBandPrint:print\nYou are banned from this server.\n", "server:return",
      ], output.banned.trace),
      check("local-accepted-order", "localhost skips password comparison; game initialization and userinfo callbacks finish before null returns and the server sends connectResponse. VM_Call restores the previous ui context.", {
        returnValue: 0, denial: null, serverState: "connected", currentVm: "ui", trace: [
          "VM_Call:game:enter", "vmMain:GAME_CLIENT_CONNECT", "trap_GetUserinfo", "G_FilterPacket",
          "client:zero", "connected:CON_CONNECTING", "G_InitSessionData", "G_ReadSessionData", "G_LogPrintf", "ClientUserinfoChanged",
          "trap_SendServerCommand:connected", "CalculateRanks", "ClientConnect:return:0", "vmMain:return:0", "VM_Call:return:0",
          "SV_UserinfoChanged", "NET_OutOfBandPrint:connectResponse", "server:CS_CONNECTED",
        ],
      }, output.local),
      check("password-exemptions", "The configured value none is case-insensitive; an existing SVF_BOT flag bypasses password checks even though the direct-connect isBot argument is false.", [0, 0], [output.nonePassword.returnValue, output.existingBot.returnValue]),
    ],
  };
}

function nestedScenario(): SourceScenario {
  const output = { outermost: nestedVm(null), nested: nestedVm("ui") };
  return {
    id: "q3-nested-vm-callback-source", sourceLocations: ["code/qcommon/vm.c:668-710"],
    assumptions: ["Synthetic entry callbacks exercise only VM_Call save/restore and synchronous integer return flow. They do not execute QVM opcodes, host syscalls, or real gameplay."],
    input: { priorContexts: [null, "ui"], nestedReturn: 7 }, output,
    assertions: [
      check("outermost-context-retained", "A nested call restores game before its caller resumes. At the outermost return oldVM is null, so the guarded restoration leaves currentVM=game.", { result: 8, currentVm: "game", trace: [
        "enter:game:current:game", "host:before:current:game", "enter:cgame:current:cgame",
        "return:cgame:7:current:game", "host:after:7:current:game", "return:game:8:current:game",
      ] }, output.outermost),
      check("nested-context-restored", "A non-null prior VM is restored only after the game entry returns, while the host callback observes game immediately after cgame returns.", { result: 8, currentVm: "ui", trace: [
        "enter:game:current:game", "host:before:current:game", "enter:cgame:current:cgame",
        "return:cgame:7:current:game", "host:after:7:current:game", "return:game:8:current:ui",
      ] }, output.nested),
    ],
  };
}

export function evaluateScenarios(): readonly SourceScenario[] {
  return [numericScenario(), movementScenario(), timerScenario(), firingScenario(), switchScenario(), hasteScenario(), connectScenario(), nestedScenario()];
}
